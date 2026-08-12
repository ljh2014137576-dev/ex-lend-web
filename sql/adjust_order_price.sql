-- ============================================================
-- 修改订单价格 v1（老板/管理员，支持已结算订单）
-- 说明：线上 Supabase 直接执行本文件即可（create or replace）。
-- 行为：原地改实付金额（不换单号）；已审核订单先冲回员工提成、
-- 恢复客户余额，再按新价重新入账（钱包按比例重扣本金/赠金）、
-- 重算商品明细分摊与提成/毛利；未结算订单调整预收与客户余额。
-- 权限：仅老板/管理员。已取消/已拒绝订单不可改价。
-- ============================================================


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
