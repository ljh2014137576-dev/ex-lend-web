-- ============================================================
-- 创建管理员（老板）账号
-- 说明：
--   1) 登录走 Supabase Auth（邮箱+密码）；
--   2) RLS 的 is_boss() 从 JWT 的 user_role.role 判断（ALL_IN_ONE.sql 355 行）；
--   3) 前端会再查 public.users.role 用于展示与权限。
--   因此需要同时：①建 Auth 用户并写入角色 claim；②登记 public.users。
--   执行后，请让该账号重新登录（新登录的 JWT 才会带上角色 claim）。
-- ============================================================

-- ① 创建 Supabase Auth 用户（邮箱 + 密码，自动确认）
--    方式 A（最稳，推荐）：Dashboard → Authentication → Users → Add user，
--        填邮箱 + 密码，勾选 Auto Confirm User。
--    方式 B：SQL 一步创建（若提示函数不存在/参数不符，请改用方式 A）：
select auth.admin_create_user(
  jsonb_build_object(
    'email', 'admin@example.com',          -- ← 改成你的管理员邮箱
    'password', 'YourStrongPassword123!',  -- ← 改成强密码
    'email_confirm', true
  )
);

-- ② 给该用户写入角色 claim（RLS 的 is_boss() 靠这个判断）
update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb),
  '{user_role,role}',
  '"boss"'
)
where email = 'admin@example.com';         -- ← 同上邮箱

-- ③ 登记到业务 users 表（前端展示角色/姓名；id 与 Auth 用户一致）
insert into public.users (id, username, name, role, status, password_hash)
select id, 'admin', '管理员', 'boss', 'active', 'managed-by-supabase-auth'
from auth.users
where email = 'admin@example.com'          -- ← 同上邮箱
on conflict (id) do nothing;

-- ④ 验证：应能看到 jwt_role=boss、has_profile=true、table_role=boss
select u.email,
       u.raw_app_meta_data -> 'user_role' ->> 'role' as jwt_role,
       (s.id is not null) as has_profile,
       s.role as table_role
from auth.users u
left join public.users s on s.id = u.id
where u.email = 'admin@example.com';       -- ← 同上邮箱
