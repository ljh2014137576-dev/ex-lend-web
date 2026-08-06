-- ============================================================
-- P0 安全加固（幂等，可重复执行；线上库直接执行本文件）
-- 内容：
--  1) is_boss/is_manager/is_staff 改为实时读库校验（消除 JWT claim 过期窗口，权限变更即时生效）
--  2) 修复 recharge_wallet 无权限校验漏洞（SECURITY DEFINER + 无角色检查 + 默认 PUBLIC 可执行）
--  3) 支付凭证引用路径校验：仅允许引用 payment-proofs 桶内真实存在的对象（防跨桶/伪造路径）
--  4) 收紧 payment-proofs 存储桶读策略：is_staff()（老板/管理员）
--  5) 补齐 revoke/grant 卫生：关闭未显式授权函数的默认 PUBLIC EXECUTE
-- 说明：重建数据库时 ALL_IN_ONE.sql 已含同等变更（本文件追加于其末尾）
-- ============================================================

-- 1) 实时读库角色校验（SECURITY DEFINER 以属主身份读 users，绕过 RLS 且无递归）
create or replace function public.is_boss()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role::text from public.users where id = auth.uid()), '') = 'boss';
$$;

create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role::text from public.users where id = auth.uid()), '') = 'manager';
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_boss() or public.is_manager();
$$;

-- 2) recharge_wallet 补权限校验（原实现无任何角色检查，任意登录用户可给任意客户充值）
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

-- 3) 凭证路径校验助手：payment-proofs 桶内真实存在的对象才可引用（防跨桶/伪造路径）
create or replace function public.is_proof_path_valid(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_path is not null
     and exists (
       select 1 from storage.objects o
       where o.bucket_id = 'payment-proofs'
         and o.name = p_path
     );
$$;

-- 4) payment-proofs 读策略：is_staff()（老板/管理员；原为所有 authenticated 可读）
drop policy if exists "payment_proofs_authenticated_read" on storage.objects;
create policy "payment_proofs_authenticated_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'payment-proofs'
    and public.is_staff()
  );

-- 5) revoke/grant 卫生：逐条容错（函数不存在时跳过，不中断脚本）
do $$
begin
  -- 需要继续开放给客户端的：revoke public + grant authenticated
  begin revoke all on function public.recharge_wallet(uuid, uuid, text) from public; exception when others then null; end;
  grant execute on function public.recharge_wallet(uuid, uuid, text) to authenticated;
  begin revoke all on function batch_start_orders(uuid[]) from public; exception when others then null; end;
  grant execute on function batch_start_orders(uuid[]) to authenticated;
  begin revoke all on function batch_approve_orders(uuid[]) from public; exception when others then null; end;
  grant execute on function batch_approve_orders(uuid[]) to authenticated;
  -- 仅关闭 PUBLIC 默认授权（前端未直接调用，内部校验已存在；避免 SECURITY DEFINER 被默认公开）
  begin revoke all on function public.set_customer_vip_level(uuid, integer, text) from public; exception when others then null; end;
  begin revoke all on function public.adjust_customer_consumption(uuid, numeric, text) from public; exception when others then null; end;
  begin revoke all on function public.create_order(uuid, uuid, uuid[], pay_method) from public; exception when others then null; end;
  begin revoke all on function public.create_order(uuid, uuid, uuid[], pay_method, numeric) from public; exception when others then null; end;
  begin revoke all on function public.create_order(uuid, uuid, uuid[], pay_method, numeric, integer) from public; exception when others then null; end;
  begin revoke all on function assign_order_employees(uuid, uuid[]) from public; exception when others then null; end;
  begin revoke all on function gen_order_no() from public; exception when others then null; end;
end $$;
-- 6) 支付凭证引用路径校验：update/add/remove_order_proof 仅允许 payment-proofs 桶内真实存在的对象
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
    return jsonb_build_object('success', false, 'message', '凭证文件不存在');
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
  set proof_path = v_path
  where id = p_order_id;

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
  if v_path is null then
    return jsonb_build_object('success', false, 'message', '凭证路径为空');
  end if;
  if not public.is_proof_path_valid(v_path) then
    return jsonb_build_object('success', false, 'message', '凭证文件不存在');
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
  if v_path is null then
    return jsonb_build_object('success', false, 'message', '凭证路径为空');
  end if;
  if not public.is_proof_path_valid(v_path) then
    return jsonb_build_object('success', false, 'message', '凭证文件不存在');
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