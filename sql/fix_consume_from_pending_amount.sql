-- ============================================================
-- 线上补丁：修复 customer_wallet_ledger type='consume_from_pending' 流水金额写死为 0
-- 背景：订单审核时"预收转消费"（approve_commission）、撤销审核时"消费恢复为预收"
--       （reject_order_audit）、已审核订单改价（adjust_order_price）写入的
--       consume_from_pending 流水 amount 均为 0，前端流水表直接展示 amount，
--       导致"预收转消费"行金额全是 0。
-- 修复语义：
--   - approve_commission：amount = 订单实付 v_ord.paid_amount（正数）
--   - reject_order_audit：amount = -v_order.paid_amount（负数，方向相反）
--   - adjust_order_price（已审核订单）：amount = 新实付 p_new_paid（正数）
-- 本文件幂等：函数为 create or replace；历史数据回填仅改 amount = 0 的行。
-- ============================================================

-- ============ 0) 预检（执行前先跑 select 查看将影响多少行） ============
-- 预收转消费（应回填为正数）：
--   select cwl.id, cwl.order_id, cwl.amount, o.paid_amount, cwl.remark
--   from public.customer_wallet_ledger cwl
--   join public."order" o on o.id = cwl.order_id
--   where cwl.type = 'consume_from_pending' and cwl.amount = 0
--     and cwl.remark like '%预收转消费%';
-- 消费恢复为预收（应回填为负数）：
--   select cwl.id, cwl.order_id, cwl.amount, o.paid_amount, cwl.remark
--   from public.customer_wallet_ledger cwl
--   join public."order" o on o.id = cwl.order_id
--   where cwl.type = 'consume_from_pending' and cwl.amount = 0
--     and (cwl.remark like '%恢复为预收%' or cwl.remark like '%消费恢复%');

select
  count(*) filter (where cwl.remark like '%预收转消费%') as approve_rows,
  count(*) filter (where cwl.remark like '%恢复为预收%' or cwl.remark like '%消费恢复%') as reject_rows
from public.customer_wallet_ledger cwl
where cwl.type = 'consume_from_pending' and cwl.amount = 0;

-- ============================================================
-- 1) 重新定义受影响函数
-- ============================================================

-- ============ 1.1 approve_commission ============
-- 重建来源：
--   - 基线：sql/commission.sql 中 public.approve_commission（与 ALL_IN_ONE.sql
--     20_multi_product_orders.sql 段内版本一致）；
--   - 叠加 commission.sql 末尾 do $$ 动态补丁的"提成覆盖"逻辑：
--       a) 员工 select 增加 om.commission_override_amount；
--       b) 商品循环内、快照类型判定前，若存在覆盖金额则用覆盖金额替换计算值；
--   - 本次修正：consume_from_pending 流水 amount 由 0 改为 v_ord.paid_amount（两处分支）。
--   注意：线上若为含 v_mixed_commission_type 分支的多商品版本（本仓库未收录该形态），
--         请在执行前用 pg_get_functiondef 核对本定义与线上定义的差异后使用。
create or replace function public.approve_commission(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord public."order"%rowtype;
  v_member record;
  v_item record;
  v_member_count int;
  v_base numeric(12,2);
  v_item_base numeric(12,2);
  v_grade_rate numeric(8,6);
  v_commission numeric(12,2);
  v_total_commission numeric(12,2) := 0;
  v_effective_rate numeric(8,6);
  v_snapshot_type commission_type;
  v_new_emp_balance numeric(12,2);
  v_cust public.customer%rowtype;
  v_principal_consume numeric(12,2);
  v_bonus_consume numeric(12,2);
  v_real_income numeric(12,2);
  v_gross_profit numeric(12,2);
  v_op uuid;
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可审核提成');
  end if;
  v_op := auth.uid();
  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'message', '订单不存在'); end if;
  if v_ord.status <> 'completed' then return jsonb_build_object('success', false, 'message', '订单未完成，不能审核'); end if;
  if v_ord.audit_status <> 'pending' then return jsonb_build_object('success', false, 'message', '订单已审核过'); end if;

  select count(*) into v_member_count from public.order_member where order_id = p_order_id;
  if v_member_count = 0 then return jsonb_build_object('success', false, 'message', '订单无参与员工'); end if;
  if not exists (select 1 from public.order_item where order_id = p_order_id) then
    return jsonb_build_object('success', false, 'message', '订单缺少商品明细');
  end if;
  if exists (
    select 1
    from public.order_member om
    join public.employee e on e.id = om.employee_id
    where om.order_id = p_order_id
      and exists (select 1 from public.order_item oi where oi.order_id = p_order_id and oi.commission_type_snapshot = 'grade')
      and not exists (select 1 from public.grade_commission_rule gr where gr.grade = e.grade)
  ) then
    return jsonb_build_object('success', false, 'message', '参与员工存在未配置提成规则的等级');
  end if;

  v_base := round(v_ord.paid_amount / v_member_count, 2);
  for v_member in
    select om.employee_id, e.grade, e.wallet_balance, om.commission_override_amount
    from public.order_member om
    join public.employee e on e.id = om.employee_id
    where om.order_id = p_order_id
  loop
    v_commission := 0;
    v_snapshot_type := null;
    for v_item in select * from public.order_item where order_id = p_order_id loop
      v_item_base := v_item.paid_amount / v_member_count;
      if v_item.commission_type_snapshot = 'fixed' then
        v_commission := v_commission + round(v_item_base * coalesce(v_item.fixed_rate_snapshot, 0), 2);
      else
        select rate into v_grade_rate from public.grade_commission_rule where grade = v_member.grade limit 1;
        v_commission := v_commission + round(v_item_base * v_grade_rate, 2);
      end if;
      if v_member.commission_override_amount is not null then v_commission := v_member.commission_override_amount; end if;

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

    v_new_emp_balance := v_member.wallet_balance + v_commission;
    update public.employee set wallet_balance = v_new_emp_balance where id = v_member.employee_id;
    insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
    values (v_member.employee_id, 'commission', v_commission, v_new_emp_balance, p_order_id, v_op, '订单审核提成入账');
  end loop;

  v_real_income := v_ord.paid_amount;
  if v_ord.pay_method = 'wallet' then
    select * into v_cust from public.customer where id = v_ord.customer_id;
    select
      coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
      coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
    into v_principal_consume, v_bonus_consume
    from public.customer_wallet_ledger
    where order_id = p_order_id and type in ('consume_principal', 'consume_bonus');
    v_real_income := v_principal_consume;
    update public.customer set
      pending_balance = pending_balance - v_ord.paid_amount,
      total_consumption = total_consumption + v_ord.paid_amount
    where id = v_cust.id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_cust.id, 'consume_from_pending', v_ord.paid_amount, v_cust.principal_balance, v_cust.bonus_balance, p_order_id, v_op, '订单完成-预收转消费');
  else
    update public.customer set
      pending_balance = pending_balance - v_ord.paid_amount,
      total_consumption = total_consumption + v_ord.paid_amount
    where id = v_ord.customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_ord.customer_id, 'consume_from_pending', v_ord.paid_amount, 0, 0, p_order_id, v_op, '订单完成-现金预收转收入');
  end if;

  v_gross_profit := v_real_income - v_total_commission;
  update public."order" set
    audit_status = 'approved',
    total_commission = v_total_commission,
    gross_profit = v_gross_profit,
    auditor_id = v_op,
    audited_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'message', '审核通过',
    'total_commission', v_total_commission,
    'real_income', v_real_income,
    'gross_profit', v_gross_profit
  );
end;
$$;

grant execute on function public.approve_commission(uuid) to authenticated;


-- ============ 1.2 reject_order_audit ============
-- 重建来源：sql/commission.sql 中 public.reject_order_audit（与 ALL_IN_ONE.sql 一致）。
-- 本次修正：consume_from_pending 流水 amount 由 0 改为 -v_order.paid_amount。
create or replace function public.reject_order_audit(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_customer public.customer%rowtype;
  v_member record;
  v_employee public.employee%rowtype;
  v_new_balance numeric(12,2);
  v_operator uuid := auth.uid();
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可撤销审核');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_order.status <> 'completed' or v_order.audit_status <> 'approved' then
    return jsonb_build_object('success', false, 'message', '仅已完成且已审核的订单可以撤销审核');
  end if;

  select * into v_customer from public.customer where id = v_order.customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单客户不存在');
  end if;

  -- Reverse the commission credit with a compensating ledger record per employee.
  for v_member in
    select employee_id, commission_amount, commission_override_amount
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

    v_new_balance := v_employee.wallet_balance - v_member.commission_amount;
    update public.employee
    set wallet_balance = v_new_balance,
        is_debt = case when v_new_balance < 0 then true else is_debt end,
        is_bad_debt = case when status = 'resigned' and v_new_balance < 0 then true else is_bad_debt end
    where id = v_employee.id;

    insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
    values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_balance, p_order_id, v_operator, '撤销订单审核-提成冲回');
  end loop;

  -- The original payment remains held as pending, exactly as it was before approval.
  update public.customer
  set pending_balance = pending_balance + v_order.paid_amount,
      total_consumption = greatest(total_consumption - v_order.paid_amount, 0)
  where id = v_customer.id;
  insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
  values (v_customer.id, 'consume_from_pending', -v_order.paid_amount, v_customer.principal_balance, v_customer.bonus_balance, p_order_id, v_operator, '撤销订单审核-消费恢复为预收');

  update public.order_member
  set grade_snapshot = null,
      base_amount = null,
      applied_rate = null,
      commission_amount = coalesce(commission_override_amount, 0),
      commission_type_snapshot = null
  where order_id = p_order_id;

  update public."order"
  set audit_status = 'pending',
      total_commission = 0,
      gross_profit = 0,
      auditor_id = null,
      audited_at = null,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success', true, 'message', '订单已恢复为待审核');
end;
$$;

revoke all on function public.reject_order_audit(uuid) from public;
grant execute on function public.reject_order_audit(uuid) to authenticated;


-- ============ 1.3 adjust_order_price ============
-- 重建来源：sql/adjust_order_price.sql 中 public.adjust_order_price
--          （与 sql/order.sql 内嵌同名函数逻辑一致）。
-- 本次修正：consume_from_pending 流水 amount 由 0 改为 p_new_paid（钱包/现金两分支）。
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
      values (v_customer.id, 'consume_from_pending', p_new_paid,
        v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, '改价-预收转消费');
    end if;
  else
    update public.customer set
      pending_balance = case when v_was_approved then pending_balance else pending_balance + p_new_paid end
    where id = v_customer.id;
    if v_was_approved then
      update public.customer set total_consumption = total_consumption + p_new_paid where id = v_customer.id;
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'consume_from_pending', p_new_paid, 0, 0, p_order_id, v_operator, '改价-现金预收转收入');
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


-- ============================================================
-- 2) 历史数据回填（幂等：仅更新 amount = 0 的行，用 remark 区分方向）
--    规则：
--      - remark 含"预收转消费"（approve 写入：订单完成-预收转消费 / 改价-预收转消费）
--        → amount = 关联订单 order.paid_amount（正数）
--      - remark 含"恢复为预收"或"消费恢复"（reject 写入：撤销订单审核-消费恢复为预收）
--        → amount = -关联订单 paid_amount（负数）
-- ============================================================

update public.customer_wallet_ledger cwl
set amount = o.paid_amount
from public."order" o
where cwl.type = 'consume_from_pending'
  and cwl.order_id = o.id
  and cwl.amount = 0
  and cwl.remark like '%预收转消费%';

update public.customer_wallet_ledger cwl
set amount = -o.paid_amount
from public."order" o
where cwl.type = 'consume_from_pending'
  and cwl.order_id = o.id
  and cwl.amount = 0
  and (cwl.remark like '%恢复为预收%' or cwl.remark like '%消费恢复%');
