-- ============================================================
-- 模块：employee.sql
-- 内容：员工 RPC：批量导入、钱包调整、工资发放 payout_salary
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.payout_salary(p_items jsonb, p_batch_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_payout_id uuid;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_emp employee%rowtype;
  v_balance_before numeric(12,2);
  v_balance_after numeric(12,2);
  v_count int := 0;
  v_op uuid;
begin
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可发放工资');
  end if;
  v_op := auth.uid();

  -- 创建批次
  insert into payout (batch_no, operator_id, status, total_amount, detail_count)
  values (p_batch_no, v_op, 'processing', 0, 0)
  returning id into v_payout_id;

  -- 遍历发放明细
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_count := v_count + 1;
    select * into v_emp from employee where id = (v_item->>'employee_id')::uuid;
    if not found then
      raise exception '员工 % 不存在', v_item->>'employee_id';
    end if;

    v_balance_before := v_emp.wallet_balance;
    v_balance_after := v_balance_before - ((v_item->>'amount')::numeric);

    -- 余额不足校验（非欠款员工）
    if v_emp.is_debt = false and v_balance_after < 0 then
      raise exception '员工 % 余额不足（当前 %，欲发 %）', v_emp.name, v_balance_before, (v_item->>'amount')::numeric;
    end if;

    -- 扣钱包
    update employee set wallet_balance = v_balance_after where id = v_emp.id;

    -- 写员工流水
    insert into wallet_ledger (employee_id, type, amount, balance_after, payout_id, operator_id, remark)
    values (v_emp.id, 'payout', -((v_item->>'amount')::numeric), v_balance_after, v_payout_id, v_op, '工资发放 ' || p_batch_no);

    -- 写发放明细
    insert into payout_detail (payout_id, employee_id, amount, balance_before, balance_after)
    values (v_payout_id, v_emp.id, (v_item->>'amount')::numeric, v_balance_before, v_balance_after);

    v_total := v_total + ((v_item->>'amount')::numeric);
  end loop;

  -- 更新批次汇总
  update payout set total_amount = v_total, detail_count = v_count, status = 'completed'
  where id = v_payout_id;

  return jsonb_build_object('success', true, 'batch_id', v_payout_id, 'total_amount', v_total, 'detail_count', v_count);
end;
$function$;


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
$function$;


create or replace function public.adjust_employee_wallet(p_employee_id uuid, p_amount numeric, p_remark text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employee%rowtype;
  v_new_balance numeric(12,2);
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可调整员工钱包');
  end if;
  if p_amount is null or p_amount = 0 then
    return jsonb_build_object('success', false, 'message', '调整金额不能为零');
  end if;
  if nullif(trim(p_remark), '') is null then
    return jsonb_build_object('success', false, 'message', '请填写调整备注');
  end if;

  select * into v_employee from public.employee where id = p_employee_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '员工不存在');
  end if;

  v_new_balance := round(v_employee.wallet_balance + p_amount, 2);
  if v_new_balance < 0 then
    return jsonb_build_object('success', false, 'message', '调整后钱包余额不能小于零');
  end if;

  update public.employee set wallet_balance = v_new_balance where id = p_employee_id;
  insert into public.wallet_ledger (employee_id, type, amount, balance_after, operator_id, remark)
  values (p_employee_id, 'adjust', round(p_amount, 2), v_new_balance, auth.uid(), trim(p_remark));

  return jsonb_build_object('success', true, 'new_balance', v_new_balance);
end;
$$;

revoke all on function public.adjust_employee_wallet(uuid, numeric, text) from public;
grant execute on function public.adjust_employee_wallet(uuid, numeric, text) to authenticated;


