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

create or replace function public.edit_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method
  p_paid_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord public."order"%rowtype;
  v_old_cust public.customer%rowtype;
  v_cust public.customer%rowtype;
  v_prod public.product%rowtype;
  v_line record;
  v_employee_id uuid;
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
  v_rev_principal numeric(12,2) := 0;
  v_rev_bonus numeric(12,2) := 0;
  v_op uuid;
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可编辑订单');
  end if;

  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_ord.status <> 'booking' then
    return jsonb_build_object('success', false, 'message', '仅待开始状态的订单可编辑');
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

  -- 冲正原订单的钱包/待结算影响（按该订单实际流水精确冲正）
  if v_ord.customer_id is not null then
    select * into v_old_cust from public.customer where id = v_ord.customer_id for update;
    if found then
      select coalesce(sum(abs(amount)), 0) into v_rev_principal
      from public.customer_wallet_ledger
      where order_id = p_order_id and type = 'consume_principal';
      select coalesce(sum(abs(amount)), 0) into v_rev_bonus
      from public.customer_wallet_ledger
      where order_id = p_order_id and type = 'consume_bonus';
      update public.customer set
        principal_balance = principal_balance + v_rev_principal,
        bonus_balance = bonus_balance + v_rev_bonus,
        pending_balance = greatest(0, pending_balance - v_ord.paid_amount)
      where id = v_ord.customer_id;
    end if;
  end if;

  delete from public.order_item where order_id = p_order_id;
  delete from public.order_member where order_id = p_order_id;

  -- 重算（与 create_order_multi 口径一致）
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
  v_paid := round(coalesce(p_paid_amount, v_calculated_paid), 2);
  if v_paid < 0 or v_paid > v_original then
    return jsonb_build_object('success', false, 'message', '实付金额需在 0 与订单原价之间');
  end if;
  v_discount := v_original - v_paid;
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
  update public."order" set
    customer_id = p_customer_id,
    product_id = v_first_product_id,
    customer_type_snapshot = v_cust.type,
    vip_level_snapshot = v_cust.vip_level,
    pay_method = p_pay_method,
    original_amount = v_original,
    paid_amount = v_paid,
    discount_amount = v_discount,
    pending_amount = v_paid,
    quantity = v_total_quantity,
    operator_id = v_op
  where id = p_order_id;

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
    v_item_paid := case
      when p_paid_amount is null then round(v_item_original * v_item_rate, 2)
      when v_original > 0 then round(v_paid * v_item_original / v_original, 2)
      else 0 end;

    insert into public.order_item (
      order_id, product_id, product_name_snapshot, category_id_snapshot, category_snapshot,
      unit_price, quantity, original_amount, discount_rate, discount_amount, paid_amount,
      commission_type_snapshot, fixed_rate_snapshot
    ) values (
      p_order_id, v_prod.id, v_prod.name, v_prod.category_id, v_prod.category,
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
  select p_order_id, unnest(coalesce(p_employee_ids, array[]::uuid[]))
  on conflict do nothing;

  if p_pay_method = 'wallet' then
    update public.customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = pending_balance + v_paid
    where id = p_customer_id;

    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_principal', -v_principal_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, p_order_id, v_op, '编辑订单-质押本金');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_bonus', -v_bonus_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, p_order_id, v_op, '编辑订单-质押赠送');
  else
    update public.customer set pending_balance = pending_balance + v_paid where id = p_customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'cash_received', v_paid, v_cust.principal_balance, v_cust.bonus_balance, p_order_id, v_op, '编辑订单-现金预收');
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'original_amount', v_original,
    'paid_amount', v_paid,
    'discount', v_discount,
    'pending_amount', v_paid
  );
end;
$$;

revoke all on function public.edit_order(uuid, uuid, jsonb, uuid[], pay_method) from public;
grant execute on function public.edit_order(uuid, uuid, jsonb, uuid[], pay_method, numeric) to authenticated;

create or replace function public.correct_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method
  p_paid_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord public."order"%rowtype;
  v_refund jsonb;
  v_new jsonb;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;

  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_ord.status = 'cancelled' or v_ord.audit_status = 'rejected' then
    return jsonb_build_object('success', false, 'message', '已取消/已拒绝的订单不能更正');
  end if;
  if v_ord.status = 'booking' then
    return jsonb_build_object('success', false, 'message', '待开始订单请使用编辑订单（原地修改）');
  end if;

  -- 按原支付方式退款冲正（已完成/已审核订单的“仅老板”保护由 refund_order 自带）
  v_refund := public.refund_order(
    p_order_id,
    case when v_ord.pay_method = 'wallet' then 'wallet' else 'cash' end
  );
  if (v_refund ->> 'success') <> 'true' then
    return v_refund;
  end if;

  -- 用正确信息重建订单；失败则整体回滚（原单退款也被撤销）
p_employee_ids, p_pay_method, p_paid_amount);
  if (v_new ->> 'success') <> 'true' then
    raise exception '更正失败：%', coalesce(v_new ->> 'message', '重建订单失败');
  end if;
  return v_new;
end;
$$;

revoke all on function public.correct_order(uuid, uuid, jsonb, uuid[], pay_method) from public;
grant execute on function public.correct_order(uuid, uuid, jsonb, uuid[], pay_method, numeric) to authenticated;



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
as $$
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
$$;

create or replace function public.remove_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

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

create or replace function public.adjust_order_price(
  p_order_id uuid,
  p_new_paid numeric,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_customer public.customer%rowtype;
  v_member record;
  v_item record;
  v_employee public.employee%rowtype;
  v_member_count int;
  v_base numeric(12,2);
  v_item_base numeric(12,2);
  v_grade_rate numeric(8,6);
  v_commission numeric(12,2);
  v_total_commission numeric(12,2) := 0;
  v_effective_rate numeric(8,6);
  v_snapshot_type commission_type;
  v_new_emp_balance numeric(12,2);
  v_principal_consume numeric(12,2) := 0;
  v_bonus_consume numeric(12,2) := 0;
  v_old_principal numeric(12,2) := 0;
  v_old_bonus numeric(12,2) := 0;
  v_total_liability numeric(12,2);
  v_real_income numeric(12,2);
  v_gross_profit numeric(12,2);
  v_new_item_paid numeric(12,2);
  v_operator uuid := auth.uid();
  v_was_approved boolean := false;
begin
  -- 权限：老板 + 管理员
  if not (public.is_boss() or public.is_manager()) then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板/管理员可修改订单价格');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_order.status = 'cancelled' or v_order.audit_status = 'rejected' then
    return jsonb_build_object('success', false, 'message', '已取消/已拒绝的订单不能修改价格');
  end if;

  p_new_paid := round(p_new_paid, 2);
  if p_new_paid < 0 or p_new_paid > v_order.original_amount then
    return jsonb_build_object('success', false, 'message', '实际收款需在 0 与订单原价之间');
  end if;
  if p_new_paid = v_order.paid_amount then
    return jsonb_build_object('success', false, 'message', '新价格与当前实付一致，无需修改');
  end if;

  v_was_approved := v_order.audit_status = 'approved';

  select * into v_customer from public.customer where id = v_order.customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单客户不存在');
  end if;

  -- ============ 1) 冲正旧账 ============
  -- 1.1 员工提成：已审核订单冲回已入账佣金（员工钱包可转负→欠款）
  if v_was_approved then
    for v_member in
      select employee_id, commission_amount
      from public.order_member
      where order_id = p_order_id
    loop
      if coalesce(v_member.commission_amount, 0) = 0 then
        continue;
      end if;
      select * into v_employee from public.employee where id = v_member.employee_id for update;
      if not found then
        return jsonb_build_object('success', false, 'message', '参与员工不存在');
      end if;
      v_new_emp_balance := v_employee.wallet_balance - v_member.commission_amount;
      update public.employee
      set wallet_balance = v_new_emp_balance,
          is_debt = case when v_new_emp_balance < 0 then true else is_debt end,
          is_bad_debt = case when status = 'resigned' and v_new_emp_balance < 0 then true else is_bad_debt end
      where id = v_employee.id;
      insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
      values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_emp_balance, p_order_id, v_operator, '改价-提成冲回');
    end loop;
  end if;

  -- 1.2 客户钱包回滚（恢复到下单前）
  if v_order.pay_method = 'wallet' then
    select
      coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
      coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
    into v_old_principal, v_old_bonus
    from public.customer_wallet_ledger
    where order_id = p_order_id and type in ('consume_principal', 'consume_bonus');
    update public.customer set
      principal_balance = principal_balance + v_old_principal,
      bonus_balance = bonus_balance + v_old_bonus
    where id = v_customer.id;
  end if;
  if v_was_approved then
    update public.customer set total_consumption = greatest(total_consumption - v_order.paid_amount, 0) where id = v_customer.id;
  else
    update public.customer set pending_balance = greatest(pending_balance - v_order.paid_amount, 0) where id = v_customer.id;
  end if;

  -- 1.3 删除该订单旧流水（重新入账）
  delete from public.customer_wallet_ledger where order_id = p_order_id;
  delete from public.wallet_ledger where order_id = p_order_id;

  -- ============ 2) 商品明细按新实付重新分摊 ============
  for v_item in
    select id, original_amount from public.order_item where order_id = p_order_id
  loop
    v_new_item_paid := case when v_order.original_amount > 0 then round(p_new_paid * v_item.original_amount / v_order.original_amount, 2) else 0 end;
    update public.order_item
    set paid_amount = v_new_item_paid,
        discount_amount = v_item.original_amount - v_new_item_paid,
        discount_rate = case when v_item.original_amount > 0 then v_new_item_paid / v_item.original_amount else 1 end
    where id = v_item.id;
  end loop;

  -- ============ 3) 更新订单金额 ============
  update public."order" set
    paid_amount = p_new_paid,
    discount_amount = v_order.original_amount - p_new_paid,
    pending_amount = case when v_was_approved then 0 else p_new_paid end,
    total_commission = 0,
    gross_profit = 0,
    updated_at = now()
  where id = p_order_id;

  -- ============ 4) 客户按新价格重新入账 ============
  if v_order.pay_method = 'wallet' then
    v_total_liability := v_customer.principal_balance + v_customer.bonus_balance;
    if v_total_liability < p_new_paid then
      raise exception '客户钱包余额不足（本金+赠送），无法按新价格入账';
    end if;
    if v_total_liability > 0 then
      v_principal_consume := round(p_new_paid * (v_customer.principal_balance / v_total_liability), 2);
      v_bonus_consume := p_new_paid - v_principal_consume;
    end if;
    update public.customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = case when v_was_approved then pending_balance else pending_balance + p_new_paid end
    where id = v_customer.id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_customer.id, 'consume_principal', -v_principal_consume,
      v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, '改价-本金扣款');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_customer.id, 'consume_bonus', -v_bonus_consume,
      v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, '改价-赠送扣款');
    if v_was_approved then
      update public.customer set total_consumption = total_consumption + p_new_paid where id = v_customer.id;
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'consume_from_pending', 0,
        v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, '改价-预收转消费');
    end if;
  else
    update public.customer set
      pending_balance = case when v_was_approved then pending_balance else pending_balance + p_new_paid end
    where id = v_customer.id;
    if v_was_approved then
      update public.customer set total_consumption = total_consumption + p_new_paid where id = v_customer.id;
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'consume_from_pending', 0, 0, 0, p_order_id, v_operator, '改价-现金预收转收入');
    else
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'cash_received', p_new_paid, v_customer.principal_balance, v_customer.bonus_balance, p_order_id, v_operator, '改价-现金预收');
    end if;
  end if;

  -- ============ 5) 提成重算 ============
  select count(*) into v_member_count from public.order_member where order_id = p_order_id;
  if v_member_count > 0 and exists (select 1 from public.order_item where order_id = p_order_id) then
    v_base := round(p_new_paid / v_member_count, 2);
    for v_member in
      select om.employee_id, e.grade, e.wallet_balance
      from public.order_member om
      join public.employee e on e.id = om.employee_id
      where om.order_id = p_order_id
    loop
      v_commission := 0;
      v_snapshot_type := null;
      for v_item in
        select commission_type_snapshot, fixed_rate_snapshot, paid_amount
        from public.order_item
        where order_id = p_order_id
      loop
        v_item_base := v_item.paid_amount / v_member_count;
        if v_item.commission_type_snapshot = 'fixed' then
          v_commission := v_commission + round(v_item_base * coalesce(v_item.fixed_rate_snapshot, 0), 2);
        else
          select rate into v_grade_rate from public.grade_commission_rule where grade = v_member.grade limit 1;
          v_commission := v_commission + round(v_item_base * v_grade_rate, 2);
        end if;
        if v_snapshot_type is null then
          v_snapshot_type := v_item.commission_type_snapshot;
        elsif v_snapshot_type <> v_item.commission_type_snapshot then
          v_snapshot_type := null;
        end if;
      end loop;
      v_effective_rate := case when v_base > 0 then v_commission / v_base else 0 end;
      v_total_commission := v_total_commission + v_commission;
      update public.order_member set
        grade_snapshot = v_member.grade,
        base_amount = v_base,
        applied_rate = v_effective_rate,
        commission_amount = v_commission,
        commission_type_snapshot = v_snapshot_type
      where order_id = p_order_id and employee_id = v_member.employee_id;
      if v_was_approved then
        v_new_emp_balance := v_member.wallet_balance + v_commission;
        update public.employee set wallet_balance = v_new_emp_balance where id = v_member.employee_id;
        insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
        values (v_member.employee_id, 'commission', v_commission, v_new_emp_balance, p_order_id, v_operator, '改价-提成重算入账');
      end if;
    end loop;
  end if;

  -- ============ 6) 更新订单提成与毛利 ============
  v_real_income := p_new_paid;
  if v_order.pay_method = 'wallet' then
    v_real_income := v_principal_consume;
  end if;
  v_gross_profit := v_real_income - v_total_commission;
  update public."order" set
    total_commission = v_total_commission,
    gross_profit = v_gross_profit,
    audit_status = case when v_was_approved then 'approved' else v_order.audit_status end
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'order_no', v_order.order_no,
    'paid_amount', p_new_paid,
    'discount', v_order.original_amount - p_new_paid,
    'total_commission', v_total_commission,
    'gross_profit', v_gross_profit
  );
end;
$$;

revoke all on function public.adjust_order_price(uuid, numeric, text) from public;
grant execute on function public.adjust_order_price(uuid, numeric, text) to authenticated;

-- P0 安全加固：凭证函数加路径校验（与 sql/p0_security_fixes.sql 一致）
create or replace function public.update_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status order_status;
  v_path text;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is not null and not public.is_proof_path_valid(v_path) then
    return jsonb_build_object('success', false, 'message', '凭证文件不存在或无权引用');
  end if;
  select status into v_status from public."order" where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'message', '订单不存在'); end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证');
  end if;
  update public."order" set proof_path = v_path where id = p_order_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.add_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status order_status;
  v_path text;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is null then return jsonb_build_object('success', false, 'message', '凭证路径为空'); end if;
  if not public.is_proof_path_valid(v_path) then
    return jsonb_build_object('success', false, 'message', '凭证文件不存在或无权引用');
  end if;
  select status into v_status from public."order" where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'message', '订单不存在'); end if;
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
$$;

create or replace function public.remove_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status order_status;
  v_path text;
  v_paths text[];
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is null then return jsonb_build_object('success', false, 'message', '凭证路径为空'); end if;
  if not public.is_proof_path_valid(v_path) then
    return jsonb_build_object('success', false, 'message', '凭证文件不存在或无权引用');
  end if;
  select status into v_status from public."order" where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'message', '订单不存在'); end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证');
  end if;
  select coalesce(proof_paths, array[]::text[]) into v_paths from public."order" where id = p_order_id;
  v_paths := array_remove(v_paths, v_path);
  update public."order"
  set proof_paths = v_paths,
      proof_path = case when coalesce(array_length(v_paths, 1), 0) > 0 then v_paths[array_length(v_paths, 1)] else null end
  where id = p_order_id;
  return jsonb_build_object('success', true);
end;
$$;