-- ============================================================
-- 批量完成订单 batch_complete_orders
-- 说明：线上 Supabase 直接执行本文件即可（create or replace + grant）。
-- 行为：将所选订单中 status='in_progress' 的置为 completed。
-- 权限：is_staff()（老板/管理员）。
-- ============================================================


create or replace function public.batch_complete_orders(p_order_ids uuid[])
returns jsonb as $$
declare
  v_count int;
begin
  if not is_staff() then return jsonb_build_object('success', false, 'message', '无权限'); end if;
  update "order" set status = 'completed', updated_at = now()
  where id = any(p_order_ids) and status = 'in_progress';
  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'count', v_count);
end;
$$ language plpgsql security definer;

grant execute on function public.batch_complete_orders(uuid[]) to authenticated;
