-- ============================================================================
-- 模块：vip_recharge_rules.sql
-- 内容：VIP 升级门槛 + VIP 折扣（含全分类兜底）+ 充值套餐（钱相关内容）种子数据
-- 日期：2026-08-10
-- 用法：线上执行（幂等，可重复运行）；重建库参考（ALL_IN_ONE.sql 已含同等数据 insert）。
-- 背景：vip_discount_rule / vip_upgrade_rule / recharge_package 线上为空，需写入业务规则；
--       create_order_multi 折扣查询已支持"全分类兜底"（category_id 为 null 且 category 为空串的行）。
-- ============================================================================

-- a) VIP 升级规则（累计消费门槛，消费达到即升级；
--    auto_upgrade 用 max(vip_level) where threshold <= total_consumption）
insert into public.vip_upgrade_rule (vip_level, consumption_threshold) values
  (1, 1888), (2, 3000), (3, 5000), (4, 8888), (5, 11111), (6, 20888)
on conflict (vip_level) do update set consumption_threshold = excluded.consumption_threshold;

-- b) VIP 折扣规则（flat 折扣；全分类兜底行：category_id 为 null 且 category 为空串）
--    VIP1-3 无折扣，不插行 → 折扣 1
insert into public.vip_discount_rule (vip_level, category, category_id, discount) values
  (4, '', null, 0.99), (5, '', null, 0.98), (6, '', null, 0.97)
on conflict (vip_level, category) do update set discount = excluded.discount;

-- c) 充值档位（amount/bonus/status）
--    首充 1000 赠 50 与单次 1000 赠 25 是两个套餐；表无 name/remark 列，无法表达"首充"标识，保持这样即可。
insert into public.recharge_package (amount, bonus, status) values
  (1000, 50, 'enabled'), (500, 10, 'enabled'), (1000, 25, 'enabled'), (3000, 100, 'enabled'), (5000, 200, 'enabled'), (10000, 500, 'enabled')
on conflict do nothing;

-- ============================================================
-- 折扣兜底函数重定义（2026-08-10）：create_order_multi / edit_order 折扣查询支持全分类兜底
-- （category_id 为 null 且 category 为空串的全局行，VIP4/5/6=0.99/0.98/0.97）
-- 幂等：create or replace；线上库直接执行
-- ============================================================

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
  if coalesce(cardinality(p_employee_ids), 0) > 2 then
    return jsonb_build_object('success', false, 'message', '员工最多选择两名（可 0/1/2 名）');
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
        and (r.category_id = v_prod.category_id or (r.category_id is null and (r.category = v_prod.category or r.category = '')))
      order by case when r.category_id is not null then 2 when r.category = v_prod.category then 1 else 0 end desc
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
        and (r.category_id = v_prod.category_id or (r.category_id is null and (r.category = v_prod.category or r.category = '')))
      order by case when r.category_id is not null then 2 when r.category = v_prod.category then 1 else 0 end desc
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

revoke all on function public.create_order_multi(uuid, jsonb, uuid[], pay_method, numeric) from public;
grant execute on function public.create_order_multi(uuid, jsonb, uuid[], pay_method, numeric) to authenticated;

create or replace function public.edit_order(
  p_order_id uuid,
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
  if coalesce(cardinality(p_employee_ids), 0) > 2 then
    return jsonb_build_object('success', false, 'message', '员工最多选择两名（可 0/1/2 名）');
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
        and (r.category_id = v_prod.category_id or (r.category_id is null and (r.category = v_prod.category or r.category = '')))
      order by case when r.category_id is not null then 2 when r.category = v_prod.category then 1 else 0 end desc
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
        and (r.category_id = v_prod.category_id or (r.category_id is null and (r.category = v_prod.category or r.category = '')))
      order by case when r.category_id is not null then 2 when r.category = v_prod.category then 1 else 0 end desc
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

revoke all on function public.edit_order(uuid, uuid, jsonb, uuid[], pay_method, numeric) from public;
grant execute on function public.edit_order(uuid, uuid, jsonb, uuid[], pay_method, numeric) to authenticated;
