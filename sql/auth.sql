-- ============================================================
-- 模块：auth.sql
-- 内容：Auth 钩子：custom_access_token_hook（JWT 注入 user_role）
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_user_id uuid;
  v_role text;
  v_claims jsonb;
begin
  v_user_id := (event->>'user_id')::uuid;
  select role::text into v_role from users where id = v_user_id;

  v_claims := event->'claims';
  if v_role is not null then
    v_claims := v_claims || jsonb_build_object('user_role', jsonb_build_object('role', v_role));
  end if;

  return jsonb_build_object('claims', v_claims);
end;
$function$


