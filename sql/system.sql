-- ============================================================
-- 模块：system.sql
-- 内容：系统与存储：个人资料/头像/Logo、storage buckets 与策略、realtime 发布
-- 来源：ALL_IN_ONE.sql 按业务域自动切分（2026-08-01）
-- 说明：阅读参考用；完整可执行版见 ALL_IN_ONE.sql
-- ============================================================

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;
drop policy if exists "payment_proofs_authenticated_read" on storage.objects;
create policy "payment_proofs_authenticated_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'payment-proofs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_boss())
  );
do $$ begin
  create policy "payment_proofs_authenticated_upload" on storage.objects
    for insert to authenticated with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "payment_proofs_authenticated_delete" on storage.objects
    for delete to authenticated using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;
do $$ begin
  create policy "avatars_authenticated_read" on storage.objects
    for select to authenticated using (bucket_id = 'avatars');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "avatars_authenticated_upload" on storage.objects
    for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
create or replace function update_self_avatar(p_avatar_path text)
returns jsonb as $$
begin
  update users set avatar_path = p_avatar_path where id = auth.uid();
  if not found then return jsonb_build_object('success', false, 'message', '用户资料不存在'); end if;
  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer;



create or replace function update_self_profile(p_name text, p_bio text, p_shortcut text)
returns jsonb as $$
begin
  update users
  set name = nullif(trim(p_name), ''),
      bio = nullif(trim(p_bio), ''),
      order_create_shortcut = coalesce(nullif(trim(p_shortcut), ''), 'Ctrl+Shift+O'),
      updated_at = now()
  where id = auth.uid();
  if not found then return jsonb_build_object('success', false, 'message', '用户资料不存在'); end if;
  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer;



create or replace function public.update_system_logo(p_logo_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'boss') then
    return jsonb_build_object('success', false, 'message', '只有老板可以修改系统 Logo');
  end if;
  insert into public.system_setting(key, value, updated_by)
  values ('system_logo_path', p_logo_path, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_system_logo(text) to authenticated;



do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification') then
      alter publication supabase_realtime add table public.notification;
    end if;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note'
    ) then
    alter publication supabase_realtime add table public.note;
  end if;
end;
$$;
-- P0 安全加固：凭证路径校验助手（与 sql/p0_security_fixes.sql 一致）
create or replace function public.is_own_proof_path(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_path is not null
     and exists (
       select 1 from storage.objects o
       where o.bucket_id = 'payment-proofs'
         and o.name = p_path
         and ((storage.foldername(o.name))[1] = auth.uid()::text or public.is_boss())
     );
$$;