-- ============================================================
-- 模块：commission.sql
-- 内容：提成审核 RPC：approve_commission、批量审核、审核前覆盖、撤销审核
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

create or replace function batch_approve_orders(p_order_ids uuid[])
returns jsonb as $$
declare
  v_id uuid;
  v_result jsonb;
  v_count int := 0;
begin
  if not is_boss() then return jsonb_build_object('success', false, 'message', '仅老板可以审核订单'); end if;
  foreach v_id in array p_order_ids loop
    if not exists (select 1 from "order" where id = v_id and status = 'completed' and audit_status = 'pending') then
      return jsonb_build_object('success', false, 'message', '所选订单中存在不可审核的订单');
    end if;
    if not exists (select 1 from order_member where order_id = v_id) then
      return jsonb_build_object('success', false, 'message', '订单必须先添加接单员工');
    end if;
  end loop;
  foreach v_id in array p_order_ids loop
    select approve_commission(v_id) into v_result;
    if coalesce(v_result->>'success', 'true') = 'false' then raise exception '%', coalesce(v_result->>'message', '订单审核失败'); end if;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('success', true, 'count', v_count);
end;
$$ language plpgsql security definer;



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
    select om.employee_id, e.grade, e.wallet_balance
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



create or replace function public.set_pending_order_commissions(p_order_id uuid, p_commissions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_operator uuid := auth.uid();
  v_count int;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if jsonb_typeof(p_commissions) <> 'array' then
    return jsonb_build_object('success', false, 'message', '提成数据格式不正确');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;
  if v_order.status <> 'completed' or v_order.audit_status <> 'pending' then
    return jsonb_build_object('success', false, 'message', '仅已完成且待审核的订单可以临时调整提成');
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    where item.employee_id is null or item.amount < 0
  ) then
    return jsonb_build_object('success', false, 'message', '提成员工或金额不正确');
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    group by item.employee_id
    having count(*) > 1
  ) then
    return jsonb_build_object('success', false, 'message', '同一员工只能提交一次');
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    left join public.order_member member on member.order_id = p_order_id and member.employee_id = item.employee_id
    where member.employee_id is null
  ) then
    return jsonb_build_object('success', false, 'message', '存在不属于该订单的员工');
  end if;

  with changes as (
    select employee_id, amount
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
  )
  update public.order_member member
  set commission_override_amount = case when changes.amount is null then null else round(changes.amount, 2) end,
      commission_override_by = case when changes.amount is null then null else v_operator end,
      commission_override_at = case when changes.amount is null then null else now() end,
      commission_amount = coalesce(round(changes.amount, 2), 0)
  from changes
  where member.order_id = p_order_id and member.employee_id = changes.employee_id;

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

revoke all on function public.set_pending_order_commissions(uuid, jsonb) from public;
grant execute on function public.set_pending_order_commissions(uuid, jsonb) to authenticated;

do $$
declare
  v_definition text;
  v_updated_definition text;
begin
  select pg_get_functiondef('public.approve_commission(uuid)'::regprocedure) into v_definition;
  v_updated_definition := replace(
    v_definition,
    'select om.employee_id, e.grade, e.wallet_balance',
    'select om.employee_id, e.grade, e.wallet_balance, om.commission_override_amount'
  );
  v_updated_definition := replace(
    v_updated_definition,
    '    if v_mixed_commission_type then v_snapshot_type := null; end if;',
    '    if v_member.commission_override_amount is not null then v_commission := v_member.commission_override_amount; end if;' || E'\n\n' ||
    '    if v_mixed_commission_type then v_snapshot_type := null; end if;'
  );
  if v_updated_definition = v_definition then
    raise exception 'approve_commission 的提成计算结构未找到，请先确认已执行 20_multi_product_orders.sql';
  end if;
  execute v_updated_definition;
end;
$$;
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


