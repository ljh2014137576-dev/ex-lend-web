-- ============================================================
-- PATCH: fix customer_wallet_ledger 'consume_from_pending' amount = 0
-- Approve commission / reject audit / adjust price wrote amount = 0
-- for 'consume_from_pending' ledger rows. Fix semantics:
--   approve_commission : amount = v_ord.paid_amount (positive)
--   reject_order_audit : amount = -v_order.paid_amount (negative)
--   adjust_order_price : amount = p_new_paid (positive)
-- Idempotent: create or replace; backfill only rows with amount = 0.
-- ============================================================

-- ============ 0) PREVIEW (run first, check how many rows) ============
select
  count(*) filter (where cwl.remark like '%' || chr(39044)::text || chr(25910)::text || chr(36716)::text || chr(28040)::text || chr(36153)::text) as approve_rows,
  count(*) filter (where cwl.remark like '%' || chr(24674)::text || chr(22797)::text || chr(20026)::text || chr(39044)::text || '%' or cwl.remark like '%' || chr(28040)::text || chr(36153)::text || chr(24674)::text || '%') as reject_rows
from public.customer_wallet_ledger cwl
where cwl.type = 'consume_from_pending' and cwl.amount = 0;

-- ============================================================
-- 1) REDEFINE FUNCTIONS
-- ============================================================

-- ============ 1.1 approve_commission ============
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
    return jsonb_build_object('success', false, 'message', 'NO PERMISSION');
  end if;
  v_op := auth.uid();
  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'message', 'ORDER NOT FOUND'); end if;
  if v_ord.status <> 'completed' then return jsonb_build_object('success', false, 'message', 'ORDER NOT COMPLETED'); end if;
  if v_ord.audit_status <> 'pending' then return jsonb_build_object('success', false, 'message', 'ALREADY AUDITED'); end if;

  select count(*) into v_member_count from public.order_member where order_id = p_order_id;
  if v_member_count = 0 then return jsonb_build_object('success', false, 'message', 'NO MEMBER'); end if;
  if not exists (select 1 from public.order_item where order_id = p_order_id) then
    return jsonb_build_object('success', false, 'message', 'NO ITEMS');
  end if;
  if exists (
    select 1
    from public.order_member om
    join public.employee e on e.id = om.employee_id
    where om.order_id = p_order_id
      and exists (select 1 from public.order_item oi where oi.order_id = p_order_id and oi.commission_type_snapshot = 'grade')
      and not exists (select 1 from public.grade_commission_rule gr where gr.grade = e.grade)
  ) then
    return jsonb_build_object('success', false, 'message', 'GRADE RULE MISSING');
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
    values (v_member.employee_id, 'commission', v_commission, v_new_emp_balance, p_order_id, v_op, 'COMMISSION');
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
    values (v_cust.id, 'consume_from_pending', v_ord.paid_amount, v_cust.principal_balance, v_cust.bonus_balance, p_order_id, v_op, 'PREPAID TO CONSUMPTION');
  else
    update public.customer set
      pending_balance = pending_balance - v_ord.paid_amount,
      total_consumption = total_consumption + v_ord.paid_amount
    where id = v_ord.customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_ord.customer_id, 'consume_from_pending', v_ord.paid_amount, 0, 0, p_order_id, v_op, 'PREPAID TO CONSUMPTION CASH');
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
    'message', 'OK',
    'total_commission', v_total_commission,
    'real_income', v_real_income,
    'gross_profit', v_gross_profit
  );
end;
$$;

grant execute on function public.approve_commission(uuid) to authenticated;


-- ============ 1.2 reject_order_audit ============
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
    return jsonb_build_object('success', false, 'message', 'NO PERMISSION');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'ORDER NOT FOUND');
  end if;
  if v_order.status <> 'completed' or v_order.audit_status <> 'approved' then
    return jsonb_build_object('success', false, 'message', 'ONLY COMPLETED+APPROVED');
  end if;

  select * into v_customer from public.customer where id = v_order.customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'CUSTOMER NOT FOUND');
  end if;

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
      return jsonb_build_object('success', false, 'message', 'EMPLOYEE NOT FOUND');
    end if;

    v_new_balance := v_employee.wallet_balance - v_member.commission_amount;
    update public.employee
    set wallet_balance = v_new_balance,
        is_debt = case when v_new_balance < 0 then true else is_debt end,
        is_bad_debt = case when status = 'resigned' and v_new_balance < 0 then true else is_bad_debt end
    where id = v_employee.id;

    insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
    values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_balance, p_order_id, v_operator, 'REVERSE COMMISSION');
  end loop;

  update public.customer
  set pending_balance = pending_balance + v_order.paid_amount,
      total_consumption = greatest(total_consumption - v_order.paid_amount, 0)
  where id = v_customer.id;
  insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
  values (v_customer.id, 'consume_from_pending', -v_order.paid_amount, v_customer.principal_balance, v_customer.bonus_balance, p_order_id, v_operator, 'CONSUMPTION BACK TO PREPAID');

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

  return jsonb_build_object('success', true, 'message', 'BACK TO PENDING');
end;
$$;

revoke all on function public.reject_order_audit(uuid) from public;
grant execute on function public.reject_order_audit(uuid) to authenticated;


-- ============ 1.3 adjust_order_price ============
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
  if not (public.is_boss() or public.is_manager()) then
    return jsonb_build_object('success', false, 'message', 'NO PERMISSION');
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'ORDER NOT FOUND');
  end if;
  if v_order.status = 'cancelled' or v_order.audit_status = 'rejected' then
    return jsonb_build_object('success', false, 'message', 'CANCELLED/REJECTED');
  end if;

  p_new_paid := round(p_new_paid, 2);
  if p_new_paid < 0 or p_new_paid > v_order.original_amount then
    return jsonb_build_object('success', false, 'message', 'BAD AMOUNT');
  end if;
  if p_new_paid = v_order.paid_amount then
    return jsonb_build_object('success', false, 'message', 'SAME AMOUNT');
  end if;

  v_was_approved := v_order.audit_status = 'approved';

  select * into v_customer from public.customer where id = v_order.customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'CUSTOMER NOT FOUND');
  end if;

  -- 1) REVERSE OLD LEDGER
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
        return jsonb_build_object('success', false, 'message', 'EMPLOYEE NOT FOUND');
      end if;
      v_new_emp_balance := v_employee.wallet_balance - v_member.commission_amount;
      update public.employee
      set wallet_balance = v_new_emp_balance,
          is_debt = case when v_new_emp_balance < 0 then true else is_debt end,
          is_bad_debt = case when status = 'resigned' and v_new_emp_balance < 0 then true else is_bad_debt end
      where id = v_employee.id;
      insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
      values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_emp_balance, p_order_id, v_operator, 'PRICE ADJ REVERSE COMMISSION');
    end loop;
  end if;

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

  delete from public.customer_wallet_ledger where order_id = p_order_id;
  delete from public.wallet_ledger where order_id = p_order_id;

  -- 2) RE-DISTRIBUTE ITEMS
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

  -- 3) UPDATE ORDER AMOUNT
  update public."order" set
    paid_amount = p_new_paid,
    discount_amount = v_order.original_amount - p_new_paid,
    pending_amount = case when v_was_approved then 0 else p_new_paid end,
    total_commission = 0,
    gross_profit = 0,
    updated_at = now()
  where id = p_order_id;

  -- 4) RE-BOOK CUSTOMER
  if v_order.pay_method = 'wallet' then
    v_total_liability := v_customer.principal_balance + v_customer.bonus_balance;
    if v_total_liability < p_new_paid then
      raise exception 'INSUFFICIENT WALLET';
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
      v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, 'PRICE ADJ PRINCIPAL');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_customer.id, 'consume_bonus', -v_bonus_consume,
      v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, 'PRICE ADJ BONUS');
    if v_was_approved then
      update public.customer set total_consumption = total_consumption + p_new_paid where id = v_customer.id;
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'consume_from_pending', p_new_paid,
        v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, 'PRICE ADJ PREPAID TO CONSUMPTION');
    end if;
  else
    update public.customer set
      pending_balance = case when v_was_approved then pending_balance else pending_balance + p_new_paid end
    where id = v_customer.id;
    if v_was_approved then
      update public.customer set total_consumption = total_consumption + p_new_paid where id = v_customer.id;
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'consume_from_pending', p_new_paid, 0, 0, p_order_id, v_operator, 'PRICE ADJ PREPAID TO CONSUMPTION CASH');
    else
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'cash_received', p_new_paid, v_customer.principal_balance, v_customer.bonus_balance, p_order_id, v_operator, 'PRICE ADJ CASH');
    end if;
  end if;

  -- 5) RECOMPUTE COMMISSION
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
        values (v_member.employee_id, 'commission', v_commission, v_new_emp_balance, p_order_id, v_operator, 'PRICE ADJ COMMISSION');
      end if;
    end loop;
  end if;

  -- 6) UPDATE ORDER COMMISSION & PROFIT
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
-- 2) BACKFILL HISTORICAL ROWS (idempotent: only amount = 0)
-- ============================================================

update public.customer_wallet_ledger cwl
set amount = o.paid_amount
from public."order" o
where cwl.type = 'consume_from_pending'
  and cwl.order_id = o.id
  and cwl.amount = 0
  and cwl.remark like '%' || chr(39044)::text || chr(25910)::text || chr(36716)::text || chr(28040)::text || chr(36153)::text;

update public.customer_wallet_ledger cwl
set amount = -o.paid_amount
from public."order" o
where cwl.type = 'consume_from_pending'
  and cwl.order_id = o.id
  and cwl.amount = 0
  and (cwl.remark like '%' || chr(24674)::text || chr(22797)::text || chr(20026)::text || chr(39044)::text || '%'
       or cwl.remark like '%' || chr(28040)::text || chr(36153)::text || chr(24674)::text || '%');
