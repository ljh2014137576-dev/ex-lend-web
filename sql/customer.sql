-- ============================================================
-- 模块：customer.sql
-- 内容：客户与会员 RPC：充值（套餐/自定义，含旧重载）、VIP 调整与重算
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.recalculate_customer_vip(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_customer customer%rowtype;
  v_level int;
begin
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可以重算 VIP 等级');
  end if;

  select * into v_customer from customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  select coalesce(max(vip_level), 0)
    into v_level
    from vip_upgrade_rule
   where consumption_threshold <= coalesce(v_customer.total_consumption, 0);

  if v_level > coalesce(v_customer.vip_level, 0) then
    update customer set type = 'vip', vip_level = v_level where id = p_customer_id;
  end if;

  return jsonb_build_object('success', true, 'vip_level', greatest(v_level, coalesce(v_customer.vip_level, 0)));
end;
$function$


CREATE OR REPLACE FUNCTION public.recharge_custom(p_customer_id uuid, p_amount numeric, p_bonus numeric, p_remark text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid;
begin
  -- 仅老板可用
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：自定义充值仅老板可用');
  end if;

  v_op := auth.uid();

  if p_amount <= 0 then
    return jsonb_build_object('success', false, 'message', '充值金额必须大于0');
  end if;
  if p_bonus < 0 then
    return jsonb_build_object('success', false, 'message', '赠送金额不能为负');
  end if;

  select * into v_cust from customer where id = p_customer_id;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;

  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, remark)
  values (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, coalesce(p_remark,'自定义充值-本金'));

  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, remark)
  values (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, coalesce(p_remark,'自定义充值-赠送'));

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$function$


CREATE OR REPLACE FUNCTION public.recharge_custom(p_customer_id uuid, p_amount numeric, p_bonus numeric, p_remark text, p_proof_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cust public.customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板或管理员可自定义充值');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'message', '充值金额必须大于0');
  end if;
  if p_bonus is null or p_bonus < 0 then
    return jsonb_build_object('success', false, 'message', '赠送金额不能为负');
  end if;

  select * into v_cust from public.customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;
  update public.customer
  set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  insert into public.customer_wallet_ledger (
    customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark
  ) values
    (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, coalesce(p_remark, '自定义充值本金')),
    (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, coalesce(p_remark, '自定义充值赠送'));

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$function$


CREATE OR REPLACE FUNCTION public.recharge_wallet(p_customer_id uuid, p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_pkg  recharge_package%rowtype;
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid;
begin
  -- 当前操作人
  v_op := auth.uid();

  -- 查套餐
  select * into v_pkg from recharge_package where id = p_package_id and status = 'enabled';
  if not found then
    return jsonb_build_object('success', false, 'message', '套餐不存在或已停用');
  end if;

  -- 查客户
  select * into v_cust from customer where id = p_customer_id;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  -- 算新余额（Decimal 运算，PostgreSQL numeric 原生精确）
  v_new_principal := v_cust.principal_balance + v_pkg.amount;
  v_new_bonus := v_cust.bonus_balance + v_pkg.bonus;

  -- 更新客户余额
  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  -- 写本金流水
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, remark)
  values (p_customer_id, 'recharge_principal', v_pkg.amount, v_new_principal, v_cust.bonus_balance, v_op, '套餐充值-本金');

  -- 写赠送流水
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, remark)
  values (p_customer_id, 'recharge_bonus', v_pkg.bonus, v_new_principal, v_new_bonus, v_op, '套餐充值-赠送');

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$function$


CREATE OR REPLACE FUNCTION public.recharge_wallet(p_customer_id uuid, p_package_id uuid, p_proof_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_pkg recharge_package%rowtype;
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  select * into v_pkg from recharge_package where id = p_package_id and status = 'enabled';
  if not found then return jsonb_build_object('success', false, 'message', '充值套餐不存在或已停用'); end if;
  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;
  v_new_principal := v_cust.principal_balance + v_pkg.amount;
  v_new_bonus := v_cust.bonus_balance + v_pkg.bonus;
  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus where id = p_customer_id;
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_principal', v_pkg.amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, '套餐充值本金');
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_bonus', v_pkg.bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, '套餐充值赠送');
  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$function$


create or replace function set_customer_vip_level(
  p_customer_id uuid,
  p_vip_level int,
  p_reason text
)
returns jsonb as $$
declare
  v_customer customer%rowtype;
  v_old int;
begin
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可以调整 VIP 等级');
  end if;
  if p_vip_level < 0 then
    return jsonb_build_object('success', false, 'message', 'VIP 等级不能小于 0');
  end if;
  if nullif(trim(p_reason), '') is null then
    return jsonb_build_object('success', false, 'message', '请填写调整原因');
  end if;

  select * into v_customer from customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_old := coalesce(v_customer.vip_level, 0);
  update customer
     set type = case when p_vip_level > 0 then 'vip'::customer_type else 'normal'::customer_type end,
         vip_level = p_vip_level
   where id = p_customer_id;

  insert into customer_account_adjustment
    (customer_id, field, amount, before_value, after_value, reason, operator_id)
  values
    (p_customer_id, 'vip_level', p_vip_level - v_old, v_old, p_vip_level, p_reason, auth.uid());

  return jsonb_build_object('success', true, 'old_level', v_old, 'vip_level', p_vip_level);
end;
$$ language plpgsql security definer;

create or replace function adjust_customer_consumption(
  p_customer_id uuid,
  p_delta numeric,
  p_reason text
)
returns jsonb as $$
declare
  v_customer customer%rowtype;
  v_before numeric(12,2);
  v_after numeric(12,2);
begin
  if not is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可以调整累计消费');
  end if;
  if p_delta = 0 then
    return jsonb_build_object('success', false, 'message', '调整金额不能为 0');
  end if;
  if nullif(trim(p_reason), '') is null then
    return jsonb_build_object('success', false, 'message', '请填写调整原因');
  end if;

  select * into v_customer from customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_before := coalesce(v_customer.total_consumption, 0);
  v_after := v_before + p_delta;
  if v_after < 0 then
    return jsonb_build_object('success', false, 'message', '累计消费不能小于 0');
  end if;

  update customer set total_consumption = v_after where id = p_customer_id;

  insert into customer_account_adjustment
    (customer_id, field, amount, before_value, after_value, reason, operator_id)
  values
    (p_customer_id, 'total_consumption', p_delta, v_before, v_after, p_reason, auth.uid());

  return jsonb_build_object('success', true, 'before_value', v_before, 'after_value', v_after);
end;
$$ language plpgsql security definer;



create or replace function recharge_wallet(p_customer_id uuid, p_package_id uuid, p_proof_path text)
returns jsonb as $$
declare
  v_pkg recharge_package%rowtype;
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  select * into v_pkg from recharge_package where id = p_package_id and status = 'enabled';
  if not found then return jsonb_build_object('success', false, 'message', '充值套餐不存在或已停用'); end if;
  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;
  v_new_principal := v_cust.principal_balance + v_pkg.amount;
  v_new_bonus := v_cust.bonus_balance + v_pkg.bonus;
  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus where id = p_customer_id;
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_principal', v_pkg.amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, '套餐充值本金');
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_bonus', v_pkg.bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, '套餐充值赠送');
  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$$ language plpgsql security definer;

create or replace function recharge_custom(p_customer_id uuid, p_amount numeric, p_bonus numeric, p_remark text, p_proof_path text)
returns jsonb as $$
declare
  v_cust customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  if not is_boss() then return jsonb_build_object('success', false, 'message', '无权限：自定义充值仅老板可用'); end if;
  if p_amount <= 0 then return jsonb_build_object('success', false, 'message', '充值金额必须大于0'); end if;
  if p_bonus < 0 then return jsonb_build_object('success', false, 'message', '赠送金额不能为负'); end if;
  select * into v_cust from customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;
  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;
  update customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus where id = p_customer_id;
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, coalesce(p_remark, '自定义充值本金'));
  insert into customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, coalesce(p_remark, '自定义充值赠送'));
  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$$ language plpgsql security definer;



create or replace function public.recharge_custom(
  p_customer_id uuid,
  p_amount numeric,
  p_bonus numeric,
  p_remark text,
  p_proof_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust public.customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板或管理员可自定义充值');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'message', '充值金额必须大于0');
  end if;
  if p_bonus is null or p_bonus < 0 then
    return jsonb_build_object('success', false, 'message', '赠送金额不能为负');
  end if;

  select * into v_cust from public.customer where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '客户不存在');
  end if;

  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;
  update public.customer
  set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  insert into public.customer_wallet_ledger (
    customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark
  ) values
    (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, coalesce(p_remark, '自定义充值本金')),
    (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, coalesce(p_remark, '自定义充值赠送'));

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$$;

revoke all on function public.recharge_custom(uuid, numeric, numeric, text, text) from public;
grant execute on function public.recharge_custom(uuid, numeric, numeric, text, text) to authenticated;



-- P0 安全加固：recharge_wallet 补权限校验（与 sql/p0_security_fixes.sql 一致）
create or replace function public.recharge_wallet(p_customer_id uuid, p_package_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pkg public.recharge_package%rowtype;
  v_cust public.customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
begin
  if not public.is_staff() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板/管理员可充值');
  end if;
  select * into v_pkg from public.recharge_package where id = p_package_id and status = 'enabled';
  if not found then return jsonb_build_object('success', false, 'message', '充值套餐不存在或已停用'); end if;
  select * into v_cust from public.customer where id = p_customer_id;
  if not found then return jsonb_build_object('success', false, 'message', '客户不存在'); end if;
  v_new_principal := v_cust.principal_balance + v_pkg.amount;
  v_new_bonus := v_cust.bonus_balance + v_pkg.bonus;
  update public.customer set principal_balance = v_new_principal, bonus_balance = v_new_bonus where id = p_customer_id;
  insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_principal', v_pkg.amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, '套餐充值本金');
  insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark)
    values (p_customer_id, 'recharge_bonus', v_pkg.bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, '套餐充值赠送');
  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
end;
$$;