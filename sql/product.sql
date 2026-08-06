-- ============================================================
-- 模块：product.sql
-- 内容：商品软删除（隐藏）RPC：hide_product、restore_product
-- 来源：与 sql/product_hide.sql 一致（2026-08-06 新增）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql（末尾追加段）
-- ============================================================

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