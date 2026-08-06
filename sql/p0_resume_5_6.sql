-- ===== 续跑第 5 段：revoke/grant 卫生（全容错，可重复执行）=====
do $$
begin
  -- revokes
  begin revoke all on function public.recharge_wallet(uuid, uuid, text) from public; exception when others then null; end;
  begin revoke all on function batch_start_orders(uuid[]) from public; exception when others then null; end;
  begin revoke all on function batch_approve_orders(uuid[]) from public; exception when others then null; end;
  begin revoke all on function public.set_customer_vip_level(uuid, integer, text) from public; exception when others then null; end;
  begin revoke all on function public.adjust_customer_consumption(uuid, numeric, text) from public; exception when others then null; end;
  begin revoke all on function public.create_order(uuid, uuid, uuid[], pay_method) from public; exception when others then null; end;
  begin revoke all on function public.create_order(uuid, uuid, uuid[], pay_method, numeric) from public; exception when others then null; end;
  begin revoke all on function public.create_order(uuid, uuid, uuid[], pay_method, numeric, integer) from public; exception when others then null; end;
  begin revoke all on function assign_order_employees(uuid, uuid[]) from public; exception when others then null; end;
  begin revoke all on function gen_order_no() from public; exception when others then null; end;
  -- grants（同样容错）
  begin grant execute on function public.recharge_wallet(uuid, uuid, text) to authenticated; exception when others then null; end;
  begin grant execute on function batch_start_orders(uuid[]) to authenticated; exception when others then null; end;
  begin grant execute on function batch_approve_orders(uuid[]) to authenticated; exception when others then null; end;
end $$;

-- ===== 补充：recharge_custom(5参) 与仓库 customer.sql 对齐 =====
do $$
begin
  begin revoke all on function public.recharge_custom(uuid, numeric, numeric, text, text) from public; exception when others then null; end;
  grant execute on function public.recharge_custom(uuid, numeric, numeric, text, text) to authenticated;
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
