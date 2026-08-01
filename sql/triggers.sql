-- ============================================================
-- 模块：triggers.sql
-- 内容：触发器：updated_at 自动更新、VIP 自动升级、分类名称同步、协作 touch、@提及通知
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$ begin
  create trigger set_updated_at_employee before update on employee
    for each row execute function trigger_set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger set_updated_at_product before update on product
    for each row execute function trigger_set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger set_updated_at_customer before update on customer
    for each row execute function trigger_set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger set_updated_at_order before update on "order"
    for each row execute function trigger_set_updated_at();
exception when duplicate_object then null; end $$;
create or replace function auto_upgrade_customer_vip()
returns trigger as $$
declare
  v_level int;
begin
  if new.total_consumption <= old.total_consumption then
    return new;
  end if;

  select coalesce(max(vip_level), 0)
    into v_level
    from vip_upgrade_rule
   where consumption_threshold <= new.total_consumption;

  if v_level > coalesce(new.vip_level, 0) then
    update customer
       set type = 'vip', vip_level = v_level
     where id = new.id;

    insert into customer_account_adjustment
      (customer_id, field, amount, before_value, after_value, reason, operator_id)
    values
      (new.id, 'vip_level', v_level - coalesce(new.vip_level, 0),
       coalesce(new.vip_level, 0), v_level, '累计消费达到 VIP 升级门槛', auth.uid());
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists customer_auto_upgrade_vip on customer;
create trigger customer_auto_upgrade_vip
  after update of total_consumption on customer
  for each row execute function auto_upgrade_customer_vip();
create or replace function sync_product_category_name()
returns trigger language plpgsql as $$
begin
  if new.category_id is not null then
    select name into new.category from product_category where id = new.category_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_product_category_name on product;
create trigger sync_product_category_name
before insert or update of category_id on product
for each row execute function sync_product_category_name();
create or replace function sync_discount_category_name()
returns trigger language plpgsql as $$
begin
  if new.category_id is not null then
    select name into new.category from product_category where id = new.category_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_discount_category_name on vip_discount_rule;
create trigger sync_discount_category_name
before insert or update of category_id on vip_discount_rule
for each row execute function sync_discount_category_name();
create or replace function public.touch_collaboration_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists todo_item_touch on public.todo_item;
create trigger todo_item_touch
before update on public.todo_item
for each row execute function public.touch_collaboration_record();
drop trigger if exists announcement_touch on public.announcement;
create trigger announcement_touch
before update on public.announcement
for each row execute function public.touch_collaboration_record();
create or replace function public.notify_todo_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recipient_id uuid;
begin
  for v_recipient_id in
    select distinct mentioned_id
    from unnest(coalesce(new.mentioned_user_ids, '{}'::uuid[])) as mentioned_id
    where mentioned_id is distinct from auth.uid()
      and (tg_op = 'INSERT' or not mentioned_id = any(coalesce(old.mentioned_user_ids, '{}'::uuid[])))
  loop
    if exists (select 1 from public.users where id = v_recipient_id and status = 'active') then
      insert into public.notification (recipient_id, type, title, content, reference_type, reference_id)
      values (
        v_recipient_id,
        'todo_mention',
        '你被提及了一条待办',
        format('@%s：%s', coalesce(new.title, '待办'), coalesce(new.content, '')),
        'todo_item',
        new.id
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists todo_item_notify_mentions on public.todo_item;
create trigger todo_item_notify_mentions
after insert or update of mentioned_user_ids on public.todo_item
for each row execute function public.notify_todo_mentions();
create or replace function public.auto_upgrade_customer_vip()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_level int;
  v_old_level int;
  v_message text;
begin
  if new.total_consumption <= old.total_consumption then
    return new;
  end if;

  select coalesce(max(vip_level), 0)
    into v_level
    from public.vip_upgrade_rule
   where consumption_threshold <= new.total_consumption;

  v_old_level := coalesce(new.vip_level, 0);
  if v_level > v_old_level then
    update public.customer
       set type = 'vip', vip_level = v_level
     where id = new.id;

    insert into public.customer_account_adjustment
      (customer_id, field, amount, before_value, after_value, reason, operator_id)
    values
      (new.id, 'vip_level', v_level - v_old_level, v_old_level, v_level, '累计消费达到 VIP 升级门槛', auth.uid());

    v_message := format('客户「%s」已从 VIP %s 自动升级为 VIP %s。', new.name, v_old_level, v_level);
    insert into public.notification (recipient_id, type, title, content, reference_type, reference_id)
    select id, 'customer_vip_upgrade', '客户 VIP 自动升级', v_message, 'customer', new.id
      from public.users
     where status = 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists customer_auto_upgrade_vip on public.customer;
create trigger customer_auto_upgrade_vip
after update of total_consumption on public.customer
for each row execute function public.auto_upgrade_customer_vip();
drop trigger if exists note_touch on public.note;
create trigger note_touch
before update on public.note
for each row execute function public.touch_collaboration_record();