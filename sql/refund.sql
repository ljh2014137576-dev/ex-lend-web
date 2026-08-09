-- ============================================================
-- 模块：refund.sql
-- 内容：退款与删除：refund_order、delete_order
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

create or replace function public.delete_order(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order "order"%rowtype;
  v_customer public.customer%rowtype;
  v_member record;
  v_employee public.employee%rowtype;
  v_principal_refund numeric(12,2) := 0;
  v_bonus_refund numeric(12,2) := 0;
  v_new_balance numeric(12,2);
  v_operator uuid := auth.uid();
  v_was_approved boolean := false;
  v_was_refunded boolean := false;
begin
  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '订单不存在');
  end if;

  if not (public.is_boss() or (public.is_manager() and v_order.operator_id = auth.uid())) then
    return jsonb_build_object('success', false, 'message', '仅老板或创建该订单的管理员可删除');
  end if;

  v_was_approved := v_order.audit_status = 'approved';
  v_was_refunded := v_order.status = 'cancelled' or v_order.audit_status = 'rejected';

  -- 1) 员工侧：已审核通过的订单，回滚已入账提成（员工钱包可转负，标记欠款）
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
      v_new_balance := v_employee.wallet_balance - v_member.commission_amount;
      update public.employee
      set wallet_balance = v_new_balance,
          is_debt = case when v_new_balance < 0 then true else is_debt end,
          is_bad_debt = case when status = 'resigned' and v_new_balance < 0 then true else is_bad_debt end
      where id = v_employee.id;
      insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
      values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_balance, p_order_id, v_operator, '删除订单-提成冲回');
    end loop;
  end if;

  -- 2) 客户侧：未退款订单恢复余额
  if not v_was_refunded then
    select * into v_customer from public.customer where id = v_order.customer_id for update;
    if not found then
      return jsonb_build_object('success', false, 'message', '订单客户不存在');
    end if;

    if v_order.pay_method = 'wallet' then
      select
        coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
        coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal_refund, v_bonus_refund
      from public.customer_wallet_ledger
      where order_id = p_order_id and type in ('consume_principal', 'consume_bonus');

      update public.customer set
        principal_balance = principal_balance + v_principal_refund,
        bonus_balance = bonus_balance + v_bonus_refund
      where id = v_customer.id;
    end if;

    if v_was_approved then
      -- 已审核：预收已转为消费，冲回消费额（金额不足时保持 ≥0）
      update public.customer set
        total_consumption = greatest(total_consumption - v_order.paid_amount, 0)
      where id = v_customer.id;
    else
      -- 未审核：预收仍挂账，删除即释放该笔预收
      update public.customer set
        pending_balance = greatest(pending_balance - v_order.paid_amount, 0)
      where id = v_customer.id;
    end if;
  end if;

  -- 3) 删除审计日志（保留原状态，便于追溯）
  insert into public.order_delete_log(order_id, order_no, deleted_by, paid_amount, status, audit_status, reason)
    values (v_order.id, v_order.order_no, v_operator, v_order.paid_amount, v_order.status::text, v_order.audit_status::text, p_reason);

  -- 4) 物理删除（含该订单全部流水与参与员工）
  delete from public.customer_wallet_ledger where order_id = p_order_id;
  delete from public.wallet_ledger where order_id = p_order_id;
  delete from public.order_member where order_id = p_order_id;
  delete from public."order" where id = p_order_id;

  return jsonb_build_object('success', true, 'order_no', v_order.order_no);
end;
$$;

grant execute on function public.delete_order(uuid, text) to authenticated;



create or replace function public.refund_order(
  p_order_id uuid,
  p_refund_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public."order"%rowtype;
  v_customer public.customer%rowtype;
  v_reversal jsonb;
  v_operator uuid := auth.uid();
  v_principal_refund numeric(12,2) := 0;
  v_bonus_refund numeric(12,2) := 0;
  v_wallet_refund numeric(12,2) := 0;
  v_pending_before numeric(12,2);
  v_was_approved boolean := false;
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', 'Only authenticated business staff can refund orders');
  end if;

  if p_refund_method not in ('wallet', 'cash') then
    return jsonb_build_object('success', false, 'message', 'Unsupported refund method');
  end if;

  select *
  into v_order
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Order not found');
  end if;

  if v_order.status = 'cancelled' or v_order.audit_status = 'rejected' then
    return jsonb_build_object('success', false, 'message', 'Order has already been refunded or cancelled');
  end if;

  if v_order.customer_id is null then
    return jsonb_build_object('success', false, 'message', 'Order has no customer account');
  end if;

  -- Lock and validate the customer before any approved-order reversal. A
  -- returned JSON error does not roll back writes already made in this
  -- function, so this check must happen before reject_order_audit.
  select *
  into v_customer
  from public.customer
  where id = v_order.customer_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Order customer not found');
  end if;

  if v_order.audit_status = 'approved' then
    v_was_approved := true;
    if not public.is_boss() then
      return jsonb_build_object('success', false, 'message', 'Only the boss can refund an approved order');
    end if;

    if v_order.status <> 'completed' then
      return jsonb_build_object('success', false, 'message', 'Only completed approved orders can be refunded');
    end if;

    -- Validate the data needed by the later refund step before reversing the
    -- approval. A returned JSON error does not roll back writes in a function.
    if p_refund_method = 'wallet' and v_order.pay_method = 'wallet' then
      select
        coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
        coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal_refund, v_bonus_refund
      from public.customer_wallet_ledger
      where order_id = p_order_id
        and type in ('consume_principal', 'consume_bonus');

      if v_principal_refund + v_bonus_refund <> v_order.paid_amount then
        return jsonb_build_object('success', false, 'message', 'Wallet refund ledger does not match the order amount');
      end if;
    end if;

    -- reject_order_audit updates commission rows one by one. Detect a broken
    -- employee reference before invoking it, so the later refund cannot leave
    -- an approved order partially reversed.
    if exists (
      select 1
      from public.order_member om
      left join public.employee e on e.id = om.employee_id
      where om.order_id = p_order_id
        and coalesce(om.commission_amount, 0) <> 0
        and e.id is null
    ) then
      return jsonb_build_object('success', false, 'message', 'Order commission data is incomplete');
    end if;

    v_reversal := public.reject_order_audit(p_order_id);
    if coalesce(v_reversal->>'success', 'false') <> 'true' then
      return v_reversal;
    end if;

    select *
    into v_order
    from public."order"
    where id = p_order_id
    for update;
  elsif v_order.audit_status <> 'pending' then
    return jsonb_build_object('success', false, 'message', 'Only pending-audit or approved orders can be refunded');
  end if;

  if v_order.status not in ('booking', 'in_progress', 'completed') then
    return jsonb_build_object('success', false, 'message', 'This order status cannot be refunded');
  end if;

  -- Before approval, return the payment by the original method. This keeps a
  -- wallet hold from being converted into a cash refund accidentally.
  if v_was_approved = false then
    if p_refund_method <> v_order.pay_method::text then
      return jsonb_build_object('success', false, 'message', 'Pending-audit orders must be refunded by the original payment method');
    end if;
  end if;

  v_pending_before := v_customer.pending_balance;
  if v_was_approved = false then
    if v_pending_before < v_order.paid_amount then
      return jsonb_build_object('success', false, 'message', 'Customer pending balance is smaller than the order amount');
    end if;
  end if;

  if p_refund_method = 'wallet' then
    if v_order.pay_method = 'wallet' then
      select
        coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
        coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal_refund, v_bonus_refund
      from public.customer_wallet_ledger
      where order_id = p_order_id
        and type in ('consume_principal', 'consume_bonus');

      v_wallet_refund := v_principal_refund + v_bonus_refund;
      if v_wallet_refund <> v_order.paid_amount then
        return jsonb_build_object('success', false, 'message', 'Wallet refund ledger does not match the order amount');
      end if;
    else
      -- A cash order refunded to wallet is credited back to principal.
      v_principal_refund := v_order.paid_amount;
      v_wallet_refund := v_order.paid_amount;
    end if;

    update public.customer
    set principal_balance = principal_balance + v_principal_refund,
        bonus_balance = bonus_balance + v_bonus_refund,
        pending_balance = pending_balance - v_order.paid_amount
    where id = v_customer.id;

    insert into public.customer_wallet_ledger (
      customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark
    )
    select
      v_customer.id,
      'refund',
      v_wallet_refund,
      v_customer.principal_balance + v_principal_refund,
      v_customer.bonus_balance + v_bonus_refund,
      p_order_id,
      v_operator,
      'Order refund before final settlement';
  else
    update public.customer
    set pending_balance = pending_balance - v_order.paid_amount
    where id = v_customer.id;

    insert into public.customer_wallet_ledger (
      customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark
    )
    values (
      v_customer.id,
      'cash_refund',
      -v_order.paid_amount,
      v_customer.principal_balance,
      v_customer.bonus_balance,
      p_order_id,
      v_operator,
      'Order cash refund'
    );
  end if;

  -- No commission is payable after a refund. Keep the override fields for
  -- audit history, but clear the computed amount used by deletion guards.
  update public.order_member
  set grade_snapshot = null,
      base_amount = null,
      applied_rate = null,
      commission_amount = 0,
      commission_type_snapshot = null
  where order_id = p_order_id;

  update public."order"
  set status = 'cancelled',
      audit_status = 'rejected',
      pending_amount = 0,
      total_commission = 0,
      gross_profit = 0,
      auditor_id = null,
      audited_at = null,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'refund_method', p_refund_method,
    'refund_amount', v_order.paid_amount
  );
end;
$$;

revoke all on function public.refund_order(uuid, text) from public;
grant execute on function public.refund_order(uuid, text) to authenticated;
