-- Minimum direct writes observed in G:/new-ui, not legacy broad FOR ALL RLS.
-- Apply after active role hardening, Storage candidate, and RPC/trigger candidate.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.order'::regclass AND tgname='order_direct_status_guard'
      AND NOT tgisinternal AND tgenabled IN ('O','A')) THEN
    RAISE EXCEPTION 'order_direct_status_guard must be installed before granting direct status UPDATE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND cmd<>'SELECT'
             AND policyname NOT LIKE 'be_%') THEN
    RAISE EXCEPTION 'Unexpected legacy write policy; do not combine it with minimum client grants';
  END IF;
END;
$preflight$;

-- Revoke table-wide write grants; grant only the observed columns below.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.users FROM PUBLIC,anon,authenticated;
REVOKE ALL (password_hash) ON TABLE public.users FROM PUBLIC,anon,authenticated;
GRANT SELECT (id,username,name,role,status,created_at,avatar_path,bio,order_create_shortcut,updated_at)
ON TABLE public.users TO authenticated;
GRANT UPDATE (name) ON TABLE public.users TO authenticated;

GRANT INSERT (name,phone,type,vip_level,status) ON public.customer TO authenticated;
GRANT INSERT (name,nickname,grade,status) ON public.employee TO authenticated;
GRANT UPDATE (name,alipay_account,bank_card,grade,status) ON public.employee TO authenticated;
GRANT INSERT (name,category,price,commission_type,fixed_rate,status) ON public.product TO authenticated;
GRANT UPDATE (status) ON public.product TO authenticated;
GRANT INSERT (name,description,status) ON public.product_category TO authenticated;
GRANT INSERT (grade,rate) ON public.grade_commission_rule TO authenticated;
GRANT UPDATE (rate) ON public.grade_commission_rule TO authenticated;
GRANT INSERT (vip_level,category,discount) ON public.vip_discount_rule TO authenticated;
GRANT INSERT (vip_level,consumption_threshold) ON public.vip_upgrade_rule TO authenticated;
GRANT INSERT (amount,bonus,status) ON public.recharge_package TO authenticated;
GRANT UPDATE (status) ON public.recharge_package TO authenticated;
GRANT INSERT (title,content,is_pinned) ON public.announcement TO authenticated;
GRANT UPDATE (title,content,is_pinned) ON public.announcement TO authenticated;
GRANT INSERT (title,content,status,mentioned_user_ids) ON public.todo_item TO authenticated;
GRANT INSERT (title,content,is_published) ON public.note TO authenticated;
GRANT UPDATE (status) ON public."order" TO authenticated;
GRANT UPDATE (proof_path) ON public.payout TO authenticated;

DROP POLICY IF EXISTS be_user_name_update_self ON public.users;
CREATE POLICY be_user_name_update_self ON public.users FOR UPDATE TO authenticated
USING (public.is_staff() AND id=auth.uid())
WITH CHECK (public.is_staff() AND id=auth.uid());

DROP POLICY IF EXISTS be_customer_insert_staff ON public.customer;
CREATE POLICY be_customer_insert_staff ON public.customer FOR INSERT TO authenticated
WITH CHECK (public.is_staff() AND status='active'
  AND ((type='normal' AND vip_level=0) OR (type='vip' AND vip_level=1)));

DROP POLICY IF EXISTS be_employee_insert_staff ON public.employee;
CREATE POLICY be_employee_insert_staff ON public.employee FOR INSERT TO authenticated
WITH CHECK (public.is_staff() AND status='active');
DROP POLICY IF EXISTS be_employee_update_staff ON public.employee;
CREATE POLICY be_employee_update_staff ON public.employee FOR UPDATE TO authenticated
USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS be_product_insert_staff ON public.product;
CREATE POLICY be_product_insert_staff ON public.product FOR INSERT TO authenticated
WITH CHECK (public.is_staff() AND deleted_at IS NULL
  AND price::text NOT IN ('NaN','Infinity','-Infinity')
  AND (fixed_rate IS NULL OR fixed_rate::text NOT IN ('NaN','Infinity','-Infinity')));
DROP POLICY IF EXISTS be_product_status_update_staff ON public.product;
CREATE POLICY be_product_status_update_staff ON public.product FOR UPDATE TO authenticated
USING (public.is_staff() AND deleted_at IS NULL)
WITH CHECK (public.is_staff() AND deleted_at IS NULL
  AND price::text NOT IN ('NaN','Infinity','-Infinity')
  AND (fixed_rate IS NULL OR fixed_rate::text NOT IN ('NaN','Infinity','-Infinity')));

DROP POLICY IF EXISTS be_category_insert_staff ON public.product_category;
CREATE POLICY be_category_insert_staff ON public.product_category FOR INSERT TO authenticated
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS be_grade_insert_boss ON public.grade_commission_rule;
CREATE POLICY be_grade_insert_boss ON public.grade_commission_rule FOR INSERT TO authenticated
WITH CHECK (public.is_boss() AND rate::text NOT IN ('NaN','Infinity','-Infinity'));
DROP POLICY IF EXISTS be_grade_rate_update_boss ON public.grade_commission_rule;
CREATE POLICY be_grade_rate_update_boss ON public.grade_commission_rule FOR UPDATE TO authenticated
USING (public.is_boss())
WITH CHECK (public.is_boss() AND rate::text NOT IN ('NaN','Infinity','-Infinity'));
DROP POLICY IF EXISTS be_vip_discount_insert_boss ON public.vip_discount_rule;
CREATE POLICY be_vip_discount_insert_boss ON public.vip_discount_rule FOR INSERT TO authenticated
WITH CHECK (public.is_boss() AND discount::text NOT IN ('NaN','Infinity','-Infinity'));
DROP POLICY IF EXISTS be_vip_upgrade_insert_boss ON public.vip_upgrade_rule;
CREATE POLICY be_vip_upgrade_insert_boss ON public.vip_upgrade_rule FOR INSERT TO authenticated
WITH CHECK (public.is_boss() AND consumption_threshold::text NOT IN ('NaN','Infinity','-Infinity'));
DROP POLICY IF EXISTS be_package_insert_boss ON public.recharge_package;
CREATE POLICY be_package_insert_boss ON public.recharge_package FOR INSERT TO authenticated
WITH CHECK (public.is_boss() AND amount::text NOT IN ('NaN','Infinity','-Infinity')
  AND bonus::text NOT IN ('NaN','Infinity','-Infinity'));
DROP POLICY IF EXISTS be_package_status_update_boss ON public.recharge_package;
CREATE POLICY be_package_status_update_boss ON public.recharge_package FOR UPDATE TO authenticated
USING (public.is_boss())
WITH CHECK (public.is_boss() AND amount::text NOT IN ('NaN','Infinity','-Infinity')
  AND bonus::text NOT IN ('NaN','Infinity','-Infinity'));

DROP POLICY IF EXISTS be_announcement_insert_boss ON public.announcement;
CREATE POLICY be_announcement_insert_boss ON public.announcement FOR INSERT TO authenticated
WITH CHECK (public.is_boss() AND created_by=auth.uid() AND updated_by=auth.uid());
DROP POLICY IF EXISTS be_announcement_update_boss ON public.announcement;
CREATE POLICY be_announcement_update_boss ON public.announcement FOR UPDATE TO authenticated
USING (public.is_boss())
WITH CHECK (public.is_boss() AND updated_by=auth.uid());

DROP POLICY IF EXISTS be_todo_insert_staff ON public.todo_item;
CREATE POLICY be_todo_insert_staff ON public.todo_item FOR INSERT TO authenticated
WITH CHECK (public.is_staff() AND created_by=auth.uid() AND updated_by=auth.uid());
DROP POLICY IF EXISTS be_note_insert_own ON public.note;
CREATE POLICY be_note_insert_own ON public.note FOR INSERT TO authenticated
WITH CHECK (public.is_staff() AND created_by=auth.uid() AND updated_by=auth.uid());

-- The trigger enforces exact OLD->NEW pairing; RLS alone cannot do that.
DROP POLICY IF EXISTS be_order_status_update_staff ON public."order";
CREATE POLICY be_order_status_update_staff ON public."order" FOR UPDATE TO authenticated
USING (public.is_staff() AND audit_status='pending' AND status IN ('booking','in_progress'))
WITH CHECK (public.is_staff() AND audit_status='pending' AND status IN ('in_progress','completed'));

DROP POLICY IF EXISTS be_payout_proof_update_boss ON public.payout;
CREATE POLICY be_payout_proof_update_boss ON public.payout FOR UPDATE TO authenticated
USING (public.is_boss())
WITH CHECK (public.is_boss() AND proof_path IS NOT NULL AND EXISTS (
  SELECT 1 FROM storage.objects AS proof
  WHERE proof.bucket_id='payment-proofs' AND proof.name=payout.proof_path
));

-- No direct ledger, order_member/item, payout amount/detail, user role/status,
-- or financial balance writes. Those must pass reviewed SECURITY DEFINER RPCs.
DO $check$
BEGIN
  IF has_column_privilege('authenticated','public.users','password_hash','SELECT,INSERT,UPDATE')
     OR has_column_privilege('anon','public.users','password_hash','SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'password_hash cannot be exposed to browser roles';
  END IF;
  IF has_schema_privilege('authenticated','recovery_20261007','USAGE')
     OR has_schema_privilege('anon','recovery_20261007','USAGE') THEN
    RAISE EXCEPTION 'Private recovery evidence must remain inaccessible';
  END IF;
END;
$check$;
COMMIT;
