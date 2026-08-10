-- ============================================================================
-- 模块：cashier_vip_discount_fallback.sql
-- 内容：确保 vip_discount_rule 存在 VIP4/5/6 全分类兜底行 + 读权限卫生
-- 日期：2026-08-10
-- 用法：线上 Supabase SQL Editor 直接执行（幂等，可重复运行）
-- 背景：收银台下单 VIP 折扣已改为读后端 vip_discount_rule 表，
--       折扣匹配优先级：精确 category_id > 精确 category 文本 > 空串兜底行
--       （category_id 为 null 且 category 为空串）。此处仅保证数据与 grant 卫生，
--       不重定义 create_order_multi（已在 vip_recharge_rules.sql 中覆盖兜底逻辑）。
-- ============================================================================

-- a) VIP4/5/6 全分类兜底行（category_id 为 null 且 category 为空串）
--    VIP1-3 无折扣，不插行 → 折扣 1
insert into public.vip_discount_rule (vip_level, category, category_id, discount) values
  (4, '', null, 0.99), (5, '', null, 0.98), (6, '', null, 0.97)
on conflict (vip_level, category) do update set discount = excluded.discount;

-- b) 读权限卫生：RLS 已有 vipdiscount_read_staff 策略，确保 authenticated 角色
--    对表 select 有权限（函数 select 权限默认 public 可执行，此处一并确认 grant）。
--    容错包裹（exception when others then null），可重复执行。
do $$
begin
  grant select on public.vip_discount_rule to authenticated;
exception
  when others then
    null;
end;
$$;
