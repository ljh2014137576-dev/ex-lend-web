-- ============================================================
-- 模块：rls.sql
-- 内容：行级安全：RLS 启用、全部策略、角色判断函数 is_boss/is_manager/is_staff
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

alter table users enable row level security;
alter table employee enable row level security;
alter table product enable row level security;
alter table customer enable row level security;
alter table wallet_ledger enable row level security;
alter table customer_wallet_ledger enable row level security;
alter table "order" enable row level security;
alter table order_member enable row level security;
alter table payout enable row level security;
alter table payout_detail enable row level security;
alter table grade_commission_rule enable row level security;
alter table vip_discount_rule enable row level security;
alter table vip_upgrade_rule enable row level security;
alter table recharge_package enable row level security;
create or replace function is_boss()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.users where id = auth.uid()), '') = 'boss';
$$;

create or replace function is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.users where id = auth.uid()), '') = 'manager';
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select is_boss() or is_manager();
$$;

create policy "rule_read_staff" on grade_commission_rule for select to authenticated using (is_staff());
create policy "rule_write_boss" on grade_commission_rule for all to authenticated using (is_boss()) with check (is_boss());
create policy "vipdiscount_read_staff" on vip_discount_rule for select to authenticated using (is_staff());
create policy "vipdiscount_write_boss" on vip_discount_rule for all to authenticated using (is_boss()) with check (is_boss());
create policy "vipupgrade_read_staff" on vip_upgrade_rule for select to authenticated using (is_staff());
create policy "vipupgrade_write_boss" on vip_upgrade_rule for all to authenticated using (is_boss()) with check (is_boss());
create policy "pkg_read_staff" on recharge_package for select to authenticated using (is_staff());
create policy "pkg_write_boss" on recharge_package for all to authenticated using (is_boss()) with check (is_boss());
create policy "user_read_boss_all" on users for select to authenticated using (is_boss());
create policy "user_read_self" on users for select to authenticated using (id = auth.uid());
create policy "user_write_boss" on users for all to authenticated using (is_boss()) with check (is_boss());
create policy "emp_read_staff" on employee for select to authenticated using (is_staff());
create policy "emp_write_staff" on employee for all to authenticated using (is_staff()) with check (is_staff());
create policy "prod_read_staff" on product for select to authenticated using (is_staff());
create policy "prod_write_staff" on product for all to authenticated using (is_staff()) with check (is_staff());
create policy "cust_read_staff" on customer for select to authenticated using (is_staff());
create policy "cust_write_staff" on customer for all to authenticated using (is_staff()) with check (is_staff());
create policy "order_read_staff" on "order" for select to authenticated using (is_staff());
create policy "order_write_staff" on "order" for all to authenticated using (is_staff()) with check (is_staff());
create policy "om_read_staff" on order_member for select to authenticated using (is_staff());
create policy "om_write_staff" on order_member for all to authenticated using (is_staff()) with check (is_staff());
create policy "wledger_read_staff" on wallet_ledger for select to authenticated using (is_staff());
create policy "wledger_write_rpc" on wallet_ledger for all to authenticated using (is_boss() or (is_manager() and false = true)) with check (is_staff());
create policy "cwledger_read_staff" on customer_wallet_ledger for select to authenticated using (is_staff());
create policy "cwledger_write_staff" on customer_wallet_ledger for all to authenticated using (is_staff()) with check (is_staff());
create policy "payout_read_boss" on payout for select to authenticated using (is_boss());
create policy "payout_write_boss" on payout for all to authenticated using (is_boss()) with check (is_boss());
create policy "pdetail_read_boss" on payout_detail for select to authenticated using (is_boss());
create policy "pdetail_write_boss" on payout_detail for all to authenticated using (is_boss()) with check (is_boss());
alter table customer_account_adjustment enable row level security;
drop policy if exists "customer_adjustment_read_staff" on customer_account_adjustment;
create policy "customer_adjustment_read_staff" on customer_account_adjustment
  for select to authenticated using (is_staff());
drop policy if exists "customer_adjustment_write_boss" on customer_account_adjustment;
create policy "customer_adjustment_write_boss" on customer_account_adjustment
  for all to authenticated using (is_boss()) with check (is_boss());
alter table product enable row level security;
alter table product_category enable row level security;
drop policy if exists "category_read_staff" on product_category;
drop policy if exists "category_write_staff" on product_category;
create policy "category_read_staff" on product_category for select to authenticated using (is_staff());
create policy "category_write_staff" on product_category for all to authenticated using (is_staff()) with check (is_staff());
alter table order_template enable row level security;
drop policy if exists "order_template_read_self" on order_template;
drop policy if exists "order_template_write_self" on order_template;
create policy "order_template_read_self" on order_template for select to authenticated using (created_by = auth.uid() or is_boss());
create policy "order_template_write_self" on order_template for all to authenticated using (created_by = auth.uid() or is_boss()) with check (created_by = auth.uid() or is_boss());
drop policy if exists "user_update_self_profile" on users;
create policy "user_update_self_profile" on users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
alter table public.user_favorite_product enable row level security;
drop policy if exists "favorite product owner access" on public.user_favorite_product;
create policy "favorite product owner access" on public.user_favorite_product
  for all using (user_id = auth.uid() or public.is_boss())
  with check (user_id = auth.uid() or public.is_boss());
alter table public.system_setting enable row level security;
drop policy if exists "system setting authenticated read" on public.system_setting;
create policy "system setting authenticated read" on public.system_setting
  for select to authenticated using (true);
alter table public.order_delete_log enable row level security;
drop policy if exists "order delete log boss read" on public.order_delete_log;
create policy "order delete log boss read" on public.order_delete_log for select to authenticated using (public.is_boss());
alter table public.order_item enable row level security;
drop policy if exists "order item read staff" on public.order_item;
drop policy if exists "order item write staff" on public.order_item;
create policy "order item read staff" on public.order_item
  for select to authenticated using (public.is_staff());
create policy "order item write staff" on public.order_item
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
alter table public.todo_item enable row level security;
alter table public.announcement enable row level security;
drop policy if exists "todo_item_read_staff" on public.todo_item;
create policy "todo_item_read_staff" on public.todo_item
  for select to authenticated using (is_staff());
drop policy if exists "todo_item_write_staff" on public.todo_item;
create policy "todo_item_write_staff" on public.todo_item
  for all to authenticated using (is_staff()) with check (is_staff());
drop policy if exists "announcement_read_staff" on public.announcement;
create policy "announcement_read_staff" on public.announcement
  for select to authenticated using (is_staff());
drop policy if exists "announcement_write_boss" on public.announcement;
create policy "announcement_write_boss" on public.announcement
  for all to authenticated using (is_boss()) with check (is_boss());
alter table public.notification enable row level security;
drop policy if exists "notification_read_self" on public.notification;
create policy "notification_read_self" on public.notification
  for select to authenticated using (recipient_id = auth.uid());
drop policy if exists "notification_update_self" on public.notification;
create policy "notification_update_self" on public.notification
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
alter table public.note enable row level security;
drop policy if exists "note_read_published_or_own" on public.note;
create policy "note_read_published_or_own" on public.note
  for select to authenticated
  using (is_staff() and (is_published or created_by = auth.uid()));
drop policy if exists "note_create_own" on public.note;
create policy "note_create_own" on public.note
  for insert to authenticated
  with check (is_staff() and created_by = auth.uid());
drop policy if exists "note_update_published_or_own" on public.note;
create policy "note_update_published_or_own" on public.note
  for update to authenticated
  using (is_staff() and (is_published or created_by = auth.uid()))
  with check (is_staff() and (created_by = auth.uid() or is_published));
drop policy if exists "note_delete_own" on public.note;
create policy "note_delete_own" on public.note
  for delete to authenticated
  using (is_staff() and created_by = auth.uid());