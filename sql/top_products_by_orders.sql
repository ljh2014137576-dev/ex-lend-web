-- ============================================================
-- 收银台「常用商品目录」RPC（幂等，可重复执行；线上库直接执行本文件）
-- 用途：
--   top_products_by_orders(p_limit) —— 按历史下单次数统计商品，
--   返回在售且未删除的 Top N 商品（默认 12，上限 50），
--   供收银台商品目录默认展示「常用」商品使用。
-- 说明：PostgREST 不支持 group by 聚合，因此统计逻辑放在后端 SQL 完成。
-- ============================================================

create or replace function public.top_products_by_orders(p_limit int default 12)
returns table(
  product_id uuid, name text, category text, category_id uuid, price numeric,
  commission_type text, fixed_rate numeric, status text, order_count bigint
)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.category_id, p.price,
         p.commission_type::text, p.fixed_rate, p.status::text,
         count(oi.id) as order_count
  from public.order_item oi
  join public.product p on p.id = oi.product_id
  where p.status = 'on_sale' and p.deleted_at is null
  group by p.id
  order by order_count desc
  limit greatest(1, least(coalesce(p_limit, 12), 50))
$$;
grant execute on function public.top_products_by_orders(integer) to authenticated;
