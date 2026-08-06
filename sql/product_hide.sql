-- ============================================================
-- 商品软删除（隐藏）功能 SQL（幂等，可重复执行；线上库直接执行本文件）
-- 内容：
--  1) product 表加 deleted_at timestamptz（NULL=未隐藏）
--  2) hide_product RPC：仅老板，置 deleted_at=now()
--  3) restore_product RPC：仅老板，置 deleted_at=null
-- 说明：重建数据库时 ALL_IN_ONE.sql 已含同等变更（追加于其末尾）
-- ============================================================

alter table public.product add column if not exists deleted_at timestamptz;

create or replace function public.hide_product(p_product_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可隐藏商品');
  end if;
  select name into v_name from public.product where id = p_product_id;
  if not found then
    return jsonb_build_object('success', false, 'message', '商品不存在');
  end if;
  update public.product set deleted_at = now() where id = p_product_id;
  return jsonb_build_object('success', true, 'name', v_name);
end;
$$;

create or replace function public.restore_product(p_product_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.is_boss() then
    return jsonb_build_object('success', false, 'message', '无权限：仅老板可恢复商品');
  end if;
  select name into v_name from public.product where id = p_product_id;
  if not found then
    return jsonb_build_object('success', false, 'message', '商品不存在');
  end if;
  update public.product set deleted_at = null where id = p_product_id;
  return jsonb_build_object('success', true, 'name', v_name);
end;
$$;

revoke all on function public.hide_product(uuid) from public;
grant execute on function public.hide_product(uuid) to authenticated;
revoke all on function public.restore_product(uuid) from public;
grant execute on function public.restore_product(uuid) to authenticated;