-- ============================================================
-- 修复：/rules 页面 VIP/规则表中文乱码（编码问题）
-- 现象：VIP 折扣规则的“分类”等中文显示为乱码。
-- 结论：前端页面与 mock 数据均为正常 UTF-8；乱码来自线上库
--       历史写入的中文列（早期脚本/迁移编码错误）。
-- 用法：在 Supabase SQL Editor 依次执行；先跑①诊断，再按需②修复。
-- ============================================================

-- ① 诊断：列出当前实际存的中文值（正常应为：体验单/手游小于300/手游大于300/正常单）
select id, vip_level, category, discount
from public.vip_discount_rule
order by vip_level;

select name, description, status
from public.product_category
order by name;

select *
from public.vip_upgrade_rule
order by vip_level;

select *
from public.grade_commission_rule
order by grade;

-- ② 修复 vip_discount_rule.category（覆盖常见三条；若你有自定义分类，
--    请按①诊断结果手工 UPDATE，或把乱码文字发给我补全映射）
update public.vip_discount_rule
set category = case vip_level
  when 1 then '体验单'
  when 2 then '手游小于300'
  when 3 then '手游大于300'
  else category
end
where vip_level in (1, 2, 3);

-- ③ product_category 名称修复示例（乱码字节不固定，请先跑①诊断确认后按需放开执行）：
-- update public.product_category set name = '正常单'   where name like '%姝ｅ父%'   or name like '%鍗曪紵%';
-- update public.product_category set name = '体验单'   where name like '%浣撻獙%';
-- update public.product_category set name = '手游大于300' where name like '%鎵嬫父澶т簬%';
-- update public.product_category set name = '手游小于300' where name like '%鎵嬫父灏忎簬%';
