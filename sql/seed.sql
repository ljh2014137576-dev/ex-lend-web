-- ============================================================
-- 模块：seed.sql
-- 内容：种子数据：等级提成规则、商品分类、系统用户
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

insert into public.grade_commission_rule (grade, rate) values
  (1, 0.8000),
  (2, 0.8500),
  (3, 0.9000)
on conflict (grade) do nothing;
insert into public.product_category (name, description, status) values
  ('体验单', '', 'enabled'),
  ('手游大于300', '', 'enabled'),
  ('手游小于300', '', 'enabled'),
  ('正常单', '', 'enabled')
on conflict (name) do nothing;
insert into public.users (id, username, password_hash, name, role, status) values
  ('c6e1e214-6758-4244-8fb0-26175fb54ef5', 'boss', 'auth-managed', '灰晨', 'boss', 'active'),
  ('18e2f6db-cd24-43fc-a446-a8aa8e5632f3', 'new-manager', 'auth-managed', '张三', 'manager', 'active'),
  ('1b574c5c-db01-4558-a49e-223e65f3d967', '2691371237@qq.com', 'auth-managed', '新用户', 'manager', 'active'),
  ('d1eff7a5-6249-4990-bdbe-fda022ac0085', 'user1317594130', 'auth-managed', '新用户', 'manager', 'active')
on conflict (id) do nothing;
insert into product_category (name)
select distinct trim(category)
from product
where category is not null and trim(category) <> ''
on conflict (name) do nothing;
insert into product_category (name)
select distinct trim(category)
from vip_discount_rule
where category is not null and trim(category) <> ''
on conflict (name) do nothing;
insert into public.order_item (
  order_id, product_id, product_name_snapshot, category_id_snapshot, category_snapshot,
  unit_price, quantity, original_amount, discount_rate, discount_amount, paid_amount,
  commission_type_snapshot, fixed_rate_snapshot
)
select
  o.id,
  p.id,
  p.name,
  p.category_id,
  p.category,
  round(o.original_amount / greatest(coalesce(o.quantity, 1), 1), 2),
  greatest(coalesce(o.quantity, 1), 1),
  o.original_amount,
  case when o.original_amount > 0 then least(1, o.paid_amount / o.original_amount) else 1 end,
  o.discount_amount,
  o.paid_amount,
  p.commission_type,
  p.fixed_rate
from public."order" o
join public.product p on p.id = o.product_id
where not exists (select 1 from public.order_item oi where oi.order_id = o.id)
on conflict (order_id, product_id) do nothing;