-- Incremental completion after the frozen 10/20/30 migrations.
-- No financial RPC, historic record, Auth identity, password or private-schema change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_trigger
      WHERE (tgrelid='public.todo_item'::regclass AND tgname='todo_item_touch'
          OR tgrelid='public.note'::regclass AND tgname='note_touch')
        AND NOT tgisinternal AND tgenabled IN ('O','A')) <> 2 THEN
    RAISE EXCEPTION 'Reviewed collaboration actor/timestamp triggers are required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
             WHERE schemaname='public' AND tablename IN ('todo_item','note','product_category','notification')
               AND cmd IN ('UPDATE','ALL') AND policyname NOT IN (
                 'be_todo_status_update_staff','be_note_publish_update_own',
                 'be_category_status_update_staff','be_notification_read_update_self')) THEN
    RAISE EXCEPTION 'Unexpected broader collaboration write policy; review before applying';
  END IF;
END;
$preflight$;

-- Unknown old names stay NULL. The default applies only to future records.
ALTER TABLE public.todo_item ADD COLUMN IF NOT EXISTS mentioned_employee_names text[];
ALTER TABLE public.todo_item ALTER COLUMN mentioned_employee_names SET DEFAULT '{}'::text[];

REVOKE UPDATE ON TABLE public.todo_item,public.note,public.product_category,public.notification
FROM PUBLIC,anon,authenticated;
GRANT UPDATE (status) ON public.todo_item TO authenticated;
GRANT UPDATE (is_published) ON public.note TO authenticated;
GRANT UPDATE (status) ON public.product_category TO authenticated;
GRANT UPDATE (read_at) ON public.notification TO authenticated;
GRANT INSERT (phone) ON public.employee TO authenticated;
GRANT INSERT (mentioned_employee_names) ON public.todo_item TO authenticated;

-- The user chose employee-name snapshots, not Auth-account notifications.
-- Keep the pre-existing Auth mention array empty for browser-created todos.
ALTER POLICY be_todo_insert_staff ON public.todo_item
WITH CHECK (public.is_staff() AND created_by=auth.uid() AND updated_by=auth.uid()
  AND mentioned_user_ids='{}'::uuid[]);

DROP POLICY IF EXISTS be_todo_status_update_staff ON public.todo_item;
CREATE POLICY be_todo_status_update_staff ON public.todo_item FOR UPDATE TO authenticated
USING (public.is_staff())
WITH CHECK (public.is_staff() AND updated_by=auth.uid());

-- Keep private notes private: bosses also change only their own publication state.
-- Existing SELECT policy for published-or-own notes is deliberately unchanged.
DROP POLICY IF EXISTS be_note_publish_update_own ON public.note;
CREATE POLICY be_note_publish_update_own ON public.note FOR UPDATE TO authenticated
USING (public.is_staff() AND created_by=auth.uid())
WITH CHECK (public.is_staff() AND created_by=auth.uid() AND updated_by=auth.uid());

DROP POLICY IF EXISTS be_category_status_update_staff ON public.product_category;
CREATE POLICY be_category_status_update_staff ON public.product_category FOR UPDATE TO authenticated
USING (public.is_staff()) WITH CHECK (public.is_staff());

-- The old timestamp cannot be rewritten: only unread recipient-owned rows qualify.
DROP POLICY IF EXISTS be_notification_read_update_self ON public.notification;
CREATE POLICY be_notification_read_update_self ON public.notification FOR UPDATE TO authenticated
USING (public.is_staff() AND recipient_id=auth.uid() AND read_at IS NULL)
WITH CHECK (public.is_staff() AND recipient_id=auth.uid() AND read_at IS NOT NULL);

DO $check$
BEGIN
  IF has_column_privilege('authenticated','public.users','password_hash','SELECT,INSERT,UPDATE')
    OR has_column_privilege('anon','public.users','password_hash','SELECT,INSERT,UPDATE')
    OR has_column_privilege('authenticated','public.users','role','INSERT,UPDATE')
    OR has_column_privilege('authenticated','public.users','status','INSERT,UPDATE')
    OR has_column_privilege('authenticated','public.employee','wallet_balance','INSERT,UPDATE')
    OR has_column_privilege('authenticated','public.customer','principal_balance','INSERT,UPDATE') THEN
    RAISE EXCEPTION 'Unexpected sensitive/financial browser column privilege';
  END IF;
  IF has_schema_privilege('authenticated','recovery_20261007','USAGE')
    OR has_schema_privilege('anon','recovery_20261007','USAGE') THEN
    RAISE EXCEPTION 'Private recovery schema must remain inaccessible';
  END IF;
END;
$check$;
COMMIT;
