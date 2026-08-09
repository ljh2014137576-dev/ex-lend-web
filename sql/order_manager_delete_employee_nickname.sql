-- 线上迁移：管理员可删除自己创建的订单（delete_order 权限放宽）+ 新建员工 nickname 空值兜底；幂等；线上库直接执行

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

revoke all on function public.delete_order(uuid, text) from public;
grant execute on function public.delete_order(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.batch_create_employees(p_employees jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb;
  v_count int := 0;
  v_op uuid := auth.uid();
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限');
  end if;
  if jsonb_typeof(p_employees) <> 'array' or jsonb_array_length(p_employees) = 0 then
    return jsonb_build_object('success', false, 'message', '员工数据为空');
  end if;
 
  for v_row in select * from jsonb_array_elements(p_employees)
  loop
    insert into public.employee (
      nickname, name, phone, gender, alipay_account, id_card, bank_card,
      bank_name, deposit, wechat_id, remark, grade, status, bio, created_by
    ) values (
      coalesce(nullif(v_row->>'nickname', ''), v_row->>'name', '员工'),
      coalesce(nullif(v_row->>'name', ''), v_row->>'nickname'),
      nullif(v_row->>'phone', ''),
      case v_row->>'gender'
        when 'male' then 'male'::gender
        when 'female' then 'female'::gender
        else 'other'::gender
      end,
      nullif(v_row->>'alipay_account', ''),
      nullif(v_row->>'id_card', ''),
      nullif(v_row->>'bank_card', ''),
      nullif(v_row->>'bank_name', ''),
      coalesce((v_row->>'deposit')::numeric, 0),
      nullif(v_row->>'wechat_id', ''),
      nullif(v_row->>'remark', ''),
      greatest(coalesce((v_row->>'grade')::int, 1), 1),
      coalesce(v_row->>'status', 'active')::employee_status,
      nullif(v_row->>'bio', ''),
      v_op
    );
    v_count := v_count + 1;
  end loop;
 
  return jsonb_build_object('success', true, 'count', v_count);
exception
  when others then
    -- 任何 insert 失败（约束/类型错误）触发回滚，返回错误信息
    raise exception '批量导入失败（已回滚）: %', sqlerrm;
end;
$function$

revoke all on function public.batch_create_employees(jsonb) from public;
grant execute on function public.batch_create_employees(jsonb) to authenticated;
