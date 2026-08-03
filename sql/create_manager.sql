-- ============================================================
-- 创建管理员（manager）账号 —— 固定参数，直接执行即可
-- 登录账号：manager@exlend.com
-- 登录密码：Manager@2026
-- 说明：
--   1) 登录走 Supabase Auth；RLS 的 is_manager()/is_staff() 读 JWT 的 user_role.role；
--   2) 前端另查 public.users.role。
--   因此需要同时：①建 Auth 用户并写入角色 claim；②登记 public.users。
--   执行后请用上面账号重新登录（新登录的 JWT 才带角色 claim）。
-- ============================================================

-- ① 创建 Supabase Auth 用户（固定参数）
--    若 auth.admin_create_user 在你版本不可用，改用：
--    Dashboard → Authentication → Users → Add user → 填 manager@exlend.com / Manager@2026，勾选 Auto Confirm。
select auth.admin_create_user(
  jsonb_build_object(
    'email', 'manager@exlend.com',
    'password', 'Manager@2026',
    'email_confirm', true
  )
);

-- ② 写入角色 claim（RLS 判断用）
update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb),
  '{user_role,role}',
  '"manager"'
)
where email = 'manager@exlend.com';

-- ③ 登记到业务 users 表
insert into public.users (id, username, name, role, status, password_hash)
select id, 'manager', '管理员', 'manager', 'active', 'managed-by-supabase-auth'
from auth.users
where email = 'manager@exlend.com'
on conflict (id) do nothing;

-- ④ 验证
select u.email,
       u.raw_app_meta_data -> 'user_role' ->> 'role' as jwt_role,
       (s.id is not null) as has_profile,
       s.role as table_role
from auth.users u
left join public.users s on s.id = u.id
where u.email = 'manager@exlend.com';
