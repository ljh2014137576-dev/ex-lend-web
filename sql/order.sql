-- ============================================================
-- 模块：order.sql
-- 内容：订单 RPC：gen_order_no、建单（多商品/旧版单商品）、指派员工、批量开始、凭证、创建人
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.gen_order_no()
 RETURNS text
 LANGUAGE sql
AS $function$
  select 'ORD' || to_char(now(), 'YYYYMMDDHH24MISS') || lpad((extract(epoch from now())::bigint % 1000)::text, 3, '0');
$function$


CREATE OR REPLACE FUNCTION public.create_order(p_customer_id uuid, p_product_id uuid, p_employee_ids uuid[], p_pay_method pay_method, p_paid_amount numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_prod product%rowtype;
  v_cust customer%rowtype;
  v_order_id uuid;
  v_order_no text;
  v_original numeric(12,2);
  v_paid numeric(12,2);
  v_discount numeric(12,2) := 0;
  v_disc_rule vip_discount_rule%rowtype;
begin
  if not is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;

  select * into v_prod from product where id = p_product_id and status = 'on_sale';
  if not found then return jsonb_build_object('success', false, 'message', '产品不存在或已下架'); end if;

  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;

  v_original := v_prod.price;

  -- VIP 折扣
  if v_cust.type = 'vip' then
    select * into v_disc_rule from vip_discount_rule where vip_level = v_cust.vip_level and category = v_prod.category limit 1;
    if found then
      v_paid := v_original * v_disc_rule.discount;
      v_discount := v_original - v_paid;
    else
      v_paid := v_original;
    end if;
  else
    v_paid := coalesce(p_paid_amount, v_original);
  end if;

  v_order_no := gen_order_no();
  insert into "order" (order_no, customer_id, product_id, customer_type_snapshot, vip_level_snapshot, pay_method,
    original_amount, paid_amount, discount_amount, operator_id)
  values (v_order_no, p_customer_id, p_product_id, v_cust.type, v_cust.vip_level, p_pay_method,
    v_original, v_paid, v_discount, auth.uid())
  returning id into v_order_id;

  -- 写参与员工
  insert into order_member (order_id, employee_id)
  select v_order_id, unnest(p_employee_ids)
  on conflict do nothing;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'order_no', v_order_no, 'paid_amount', v_paid, 'discount', v_discount);
end;
$function$


CREATE OR REPLACE FUNCTION public.create_order(p_customer_id uuid, p_product_id uuid, p_employee_ids uuid[], p_pay_method pay_method, p_paid_amount numeric DEFAULT NULL::numeric, p_quantity integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_prod product%rowtype;
  v_cust customer%rowtype;
  v_order_id uuid;
  v_order_no text;
  v_original numeric(12,2);
  v_paid numeric(12,2);
  v_discount numeric(12,2) := 0;
  v_disc_rule vip_discount_rule%rowtype;
  v_total_liability numeric(12,2);
  v_principal_consume numeric(12,2);
  v_bonus_consume numeric(12,2);
  v_op uuid;
begin
  if not is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  v_op := auth.uid();

  select * into v_prod from product where id = p_product_id and status = 'on_sale';
  if not found then return jsonb_build_object('success', false, 'message', '产品不存在或已下架'); end if;

  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;

  -- 数量 × 单价
  v_original := v_prod.price * p_quantity;

  -- VIP 折扣
  if v_cust.type = 'vip' then
    select * into v_disc_rule from vip_discount_rule where vip_level = v_cust.vip_level and category = v_prod.category limit 1;
    if found then
      v_paid := v_original * v_disc_rule.discount;
      v_discount := v_original - v_paid;
    else
      v_paid := v_original;
    end if;
  else
    v_paid := coalesce(p_paid_amount, v_original);
  end if;

  v_order_no := gen_order_no();
  insert into "order" (order_no, customer_id, product_id, customer_type_snapshot, vip_level_snapshot, pay_method,
    original_amount, paid_amount, discount_amount, pending_amount, quantity, operator_id)
  values (v_order_no, p_customer_id, p_product_id, v_cust.type, v_cust.vip_level, p_pay_method,
    v_original, v_paid, v_discount, v_paid, p_quantity, v_op)
  returning id into v_order_id;

  -- 写参与员工
  insert into order_member (order_id, employee_id)
  select v_order_id, unnest(p_employee_ids)
  on conflict do nothing;

  -- 质押处理
  if p_pay_method = 'wallet' then
    v_total_liability := v_cust.principal_balance + v_cust.bonus_balance;
    if v_total_liability < v_paid then
      return jsonb_build_object('success', false, 'message', '客户钱包余额不足');
    end if;
    v_principal_consume := v_paid * (v_cust.principal_balance / v_total_liability);
    v_bonus_consume := v_paid * (v_cust.bonus_balance / v_total_liability);

    update customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = pending_balance + v_paid
    where id = p_customer_id;

    insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_principal', -v_principal_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-本金');
    insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_bonus', -v_bonus_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-赠送');
  else
    update customer set pending_balance = pending_balance + v_paid where id = p_customer_id;
    insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'cash_received', v_paid, v_cust.principal_balance, v_cust.bonus_balance, v_order_id, v_op, '下单收取现金(预收)');
  end if;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'order_no', v_order_no, 'paid_amount', v_paid, 'discount', v_discount, 'pending_amount', v_paid);
end;
$function$


create or replace function assign_order_employees(p_order_id uuid, p_employee_ids uuid[])
returns jsonb as $$
declare
  v_order "order"%rowtype;
  v_employee_id uuid;
begin
  if not is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if cardinality(p_employee_ids) <> 2 then
    return jsonb_build_object('success', false, 'message', '必须选择两名接单员工');
  end if;
  if p_employee_ids[1] = p_employee_ids[2] then
    return jsonb_build_object('success', false, 'message', '不能重复选择同一名员工');
  end if;

  select * into v_order from "order" where id = p_order_id;
  if not found then return jsonb_build_object('success', false, 'message', '订单不存在'); end if;
  if v_order.audit_status <> 'pending' or v_order.status = 'cancelled' then
    return jsonb_build_object('success', false, 'message', '当前订单状态不允许添加员工');
  end if;
  if exists (select 1 from order_member where order_id = p_order_id) then
    return jsonb_build_object('success', false, 'message', '订单已经有接单员工');
  end if;

  foreach v_employee_id in array p_employee_ids loop
    if not exists (select 1 from employee where id = v_employee_id and status = 'active') then
      return jsonb_build_object('success', false, 'message', '只能选择在职员工');
    end if;
  end loop;

  insert into order_member (order_id, employee_id)
  select p_order_id, unnest(p_employee_ids);
  return jsonb_build_object('success', true, 'message', '接单员工已添加');
end;
$$ language plpgsql security definer;



create or replace function batch_start_orders(p_order_ids uuid[])
returns jsonb as $$
declare
  v_count int;
begin
  if not is_staff() then return jsonb_build_object('success', false, 'message', '无权限'); end if;
  if exists (
    select 1 from "order" o
    where o.id = any(p_order_ids)
      and o.status = 'booking'
      and o.audit_status = 'pending'
      and not exists (select 1 from order_member om where om.order_id = o.id)
  ) then
    return jsonb_build_object('success', false, 'message', '所选订单中存在未添加员工的订单');
  end if;
  update "order" set status = 'in_progress', updated_at = now()
  where id = any(p_order_ids) and status = 'booking' and audit_status = 'pending';
  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'count', v_count);
end;
$$ language plpgsql security definer;



create or replace function public.create_order_multi(
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method,
  p_paid_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust public.customer%rowtype;
  v_prod public.product%rowtype;
  v_line record;
  v_employee_id uuid;
  v_order_id uuid;
  v_order_no text;
  v_first_product_id uuid;
  v_last_item_id uuid;
  v_total_quantity int := 0;
  v_original numeric(12,2) := 0;
  v_calculated_paid numeric(12,2) := 0;
  v_paid numeric(12,2);
  v_discount numeric(12,2);
  v_rule_rate numeric(8,6);
  v_item_original numeric(12,2);
  v_item_paid numeric(12,2);
  v_item_rate numeric(8,6);
  v_inserted_paid numeric(12,2) := 0;
  v_rounding_delta numeric(12,2);
  v_total_liability numeric(12,2);
  v_principal_consume numeric(12,2) := 0;
  v_bonus_consume numeric(12,2) := 0;
  v_op uuid;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'message', '订单至少需要一个商品');
  end if;
  if jsonb_array_length(p_items) > 50 then
    return jsonb_build_object('success', false, 'message', '单张订单最多添加 50 种商品');
  end if;
  if coalesce(cardinality(p_employee_ids), 0) not in (0, 2) then
    return jsonb_build_object('success', false, 'message', '员工应暂不选择或一次选择两名');
  end if;
  if cardinality(p_employee_ids) = 2 and p_employee_ids[1] = p_employee_ids[2] then
    return jsonb_build_object('success', false, 'message', '不能重复选择同一名员工');
  end if;

  select * into v_cust from public.customer where id = p_customer_id and status = 'active' for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在或已停用');
  end if;

  foreach v_employee_id in array coalesce(p_employee_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.employee where id = v_employee_id and status = 'active') then
      return jsonb_build_object('success', false, 'message', '只能选择在职员工');
    end if;
  end loop;

  -- Validate products and calculate the server-authoritative total.
  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
  loop
    if v_line.product_id is null or v_line.quantity is null or v_line.quantity <= 0 then
      return jsonb_build_object('success', false, 'message', '商品或数量无效');
    end if;
    select * into v_prod from public.product where id = v_line.product_id and status = 'on_sale';
    if not found then
      return jsonb_build_object('success', false, 'message', '订单中存在已下架或不存在的商品');
    end if;

    if v_first_product_id is null then v_first_product_id := v_prod.id; end if;
    v_total_quantity := v_total_quantity + v_line.quantity;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and r.category = v_prod.category))
      order by (r.category_id is not null) desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    v_original := v_original + v_item_original;
    v_calculated_paid := v_calculated_paid + round(v_item_original * v_item_rate, 2);
  end loop;

  v_original := round(v_original, 2);
  v_calculated_paid := round(v_calculated_paid, 2);
  v_paid := round(coalesce(p_paid_amount, v_calculated_paid), 2);
  if v_paid < 0 or v_paid > v_original then
    return jsonb_build_object('success', false, 'message', '实付金额必须在 0 和订单原价之间');
  end if;
  v_discount := v_original - v_paid;

  if p_pay_method = 'wallet' then
    v_total_liability := v_cust.principal_balance + v_cust.bonus_balance;
    if v_total_liability < v_paid then
      return jsonb_build_object('success', false, 'message', '客户钱包余额不足');
    end if;
    if v_total_liability > 0 then
      v_principal_consume := round(v_paid * (v_cust.principal_balance / v_total_liability), 2);
      v_bonus_consume := v_paid - v_principal_consume;
    end if;
  end if;

  v_op := auth.uid();
  v_order_no := public.gen_order_no();
  insert into public."order" (
    order_no, customer_id, product_id, customer_type_snapshot, vip_level_snapshot, pay_method,
    original_amount, paid_amount, discount_amount, pending_amount, quantity, operator_id
  ) values (
    v_order_no, p_customer_id, v_first_product_id, v_cust.type, v_cust.vip_level, p_pay_method,
    v_original, v_paid, v_discount, v_paid, v_total_quantity, v_op
  ) returning id into v_order_id;

  -- Store immutable product snapshots. Manual total overrides are distributed by original value.
  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
    order by x.product_id
  loop
    select * into v_prod from public.product where id = v_line.product_id;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and r.category = v_prod.category))
      order by (r.category_id is not null) desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    if p_paid_amount is null then
      v_item_paid := round(v_item_original * v_item_rate, 2);
    else
      v_item_paid := case when v_original > 0 then round(v_paid * v_item_original / v_original, 2) else 0 end;
    end if;

    insert into public.order_item (
      order_id, product_id, product_name_snapshot, category_id_snapshot, category_snapshot,
      unit_price, quantity, original_amount, discount_rate, discount_amount, paid_amount,
      commission_type_snapshot, fixed_rate_snapshot
    ) values (
      v_order_id, v_prod.id, v_prod.name, v_prod.category_id, v_prod.category,
      v_prod.price, v_line.quantity, v_item_original,
      case when v_item_original > 0 then v_item_paid / v_item_original else 1 end,
      v_item_original - v_item_paid, v_item_paid, v_prod.commission_type, v_prod.fixed_rate
    ) returning id into v_last_item_id;
    v_inserted_paid := v_inserted_paid + v_item_paid;
  end loop;

  v_rounding_delta := v_paid - v_inserted_paid;
  if v_rounding_delta <> 0 and v_last_item_id is not null then
    update public.order_item
    set paid_amount = paid_amount + v_rounding_delta,
        discount_amount = original_amount - (paid_amount + v_rounding_delta),
        discount_rate = case when original_amount > 0 then (paid_amount + v_rounding_delta) / original_amount else 1 end
    where id = v_last_item_id;
  end if;

  insert into public.order_member (order_id, employee_id)
  select v_order_id, unnest(coalesce(p_employee_ids, array[]::uuid[]))
  on conflict do nothing;

  if p_pay_method = 'wallet' then
    update public.customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = pending_balance + v_paid
    where id = p_customer_id;

    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_principal', -v_principal_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-本金');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_bonus', -v_bonus_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-赠送');
  else
    update public.customer set pending_balance = pending_balance + v_paid where id = p_customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'cash_received', v_paid, v_cust.principal_balance, v_cust.bonus_balance, v_order_id, v_op, '下单收取现金(预收)');
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_no', v_order_no,
    'original_amount', v_original,
    'paid_amount', v_paid,
    'discount', v_discount,
    'item_count', (select count(*) from public.order_item where order_id = v_order_id)
  );
exception
  when invalid_text_representation or data_exception then
    return jsonb_build_object('success', false, 'message', '商品明细格式不正确');
end;
$$;

grant execute on function public.create_order_multi(uuid, jsonb, uuid[], pay_method, numeric) to authenticated;

create or replace function public.list_order_creator_profiles()
returns table(id uuid, username text, name text, role user_role)
language sql
security definer
set search_path = public
as $$
  select u.id, u.username, u.name, u.role
  from public.users u
  where public.is_staff();
$$;

revoke all on function public.list_order_creator_profiles() from public;
grant execute on function public.list_order_creator_profiles() to authenticated;

create or replace function public.update_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status order_status;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权操作');
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证');
  end if;

  update public."order"
  set proof_path = nullif(trim(p_proof_path), '')
  where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.update_order_proof(uuid, text) from public;
grant execute on function public.update_order_proof(uuid, text) to authenticated;

create or replace function public.add_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  v_status order_status;
  v_path text;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权操作');
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is null then
    return jsonb_build_object('success', false, 'message', '凭证路径为空');
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证');
  end if;

  if v_path = any(coalesce((select proof_paths from public."order" where id = p_order_id), array[]::text[])) then
    return jsonb_build_object('success', true, 'message', '凭证已存在');
  end if;

  update public."order"
  set proof_paths = array_append(coalesce(proof_paths, array[]::text[]), v_path),
      proof_path = v_path
  where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$;

create or replace function public.remove_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  v_status order_status;
  v_path text;
  v_paths text[];
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权操作');
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is null then
    return jsonb_build_object('success', false, 'message', '凭证路径为空');
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证');
  end if;

  select coalesce(proof_paths, array[]::text[]) into v_paths
  from public."order"
  where id = p_order_id;

  v_paths := array_remove(v_paths, v_path);

  update public."order"
  set proof_paths = v_paths,
      proof_path = case
        when coalesce(array_length(v_paths, 1), 0) > 0 then v_paths[array_length(v_paths, 1)]
        else null
      end
  where id = p_order_id;

  return jsonb_build_object('success', true);
end;
$;

revoke all on function public.add_order_proof(uuid, text) from public;
grant execute on function public.add_order_proof(uuid, text) to authenticated;
revoke all on function public.remove_order_proof(uuid, text) from public;
grant execute on function public.remove_order_proof(uuid, text) to authenticated;



create or replace function public.assign_order_employees(p_order_id uuid, p_employee_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_employee_id uuid;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if coalesce(cardinality(p_employee_ids), 0) > 2 then
    return jsonb_build_object('success', false, 'message', '每张订单最多选择两名接单员工');
  end if;
  if cardinality(p_employee_ids) = 2 and p_employee_ids[1] = p_employee_ids[2] then
    return jsonb_build_object('success', false, 'message', '不能重复选择同一名员工');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_order.audit_status <> 'pending' or v_order.status = 'cancelled' then
    return jsonb_build_object('success', false, 'message', '当前订单状态不允许修改员工');
  end if;

  foreach v_employee_id in array coalesce(p_employee_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.employee where id = v_employee_id and status = 'active') then
      return jsonb_build_object('success', false, 'message', '只能选择在职员工');
    end if;
  end loop;

  delete from public.order_member where order_id = p_order_id;
  insert into public.order_member (order_id, employee_id)
  select p_order_id, unnest(coalesce(p_employee_ids, array[]::uuid[]));

  return jsonb_build_object('success', true, 'message', '接单员工已更新');
end;
$$;

revoke all on function public.assign_order_employees(uuid, uuid[]) from public;
grant execute on function public.assign_order_employees(uuid, uuid[]) to authenticated;
