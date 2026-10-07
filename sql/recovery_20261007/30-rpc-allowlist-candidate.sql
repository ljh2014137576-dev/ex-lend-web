-- Run LAST, after the independently reviewed RPC/trigger candidate and tests.
-- No missing function is silently skipped. Internal functions stay owner-only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;

DO $allowlist$
DECLARE
  function_signature text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.is_boss()',
    'public.is_manager()',
    'public.is_staff()',
    'public.add_order_proof(uuid,text)',
    'public.adjust_order_price(uuid,numeric,text)',
    'public.approve_commission(uuid)',
    'public.batch_approve_orders(uuid[])',
    'public.batch_complete_orders(uuid[])',
    'public.batch_start_orders(uuid[])',
    'public.correct_order(uuid,uuid,jsonb,uuid[],public.pay_method,numeric)',
    'public.create_order_multi(uuid,jsonb,uuid[],public.pay_method,numeric)',
    'public.delete_order(uuid,text)',
    'public.edit_order(uuid,uuid,jsonb,uuid[],public.pay_method,numeric)',
    'public.hide_product(uuid)',
    'public.payout_salary(jsonb,text)',
    'public.recharge_custom(uuid,numeric,numeric,text,text)',
    'public.refund_order(uuid,text)',
    'public.reject_order_audit(uuid)',
    'public.remove_order_proof(uuid,text)',
    'public.restore_product(uuid)',
    'public.set_pending_order_commissions(uuid,jsonb)',
    'public.top_products_by_orders(integer)',
    'public.update_order_proof(uuid,text)',
    'public.update_self_avatar(text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'Required reviewed frontend function is missing: %',function_signature;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',function_signature);
  END LOOP;
END;
$allowlist$;

-- No sequence grant: gen_order_no and its sequence are accessed only inside
-- owner-executed business RPCs. No API access to the private recovery schema.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'Anonymous public-function execution remains';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND has_function_privilege('authenticated',p.oid,'EXECUTE')) <> 24 THEN
    RAISE EXCEPTION 'Expected exactly 21 frontend RPCs plus 3 role helpers';
  END IF;
  IF has_column_privilege('authenticated','public.users','password_hash','SELECT,INSERT,UPDATE')
     OR has_column_privilege('anon','public.users','password_hash','SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'Password hash browser access remains';
  END IF;
  IF has_schema_privilege('authenticated','recovery_20261007','USAGE')
     OR has_schema_privilege('anon','recovery_20261007','USAGE') THEN
    RAISE EXCEPTION 'Private recovery schema is accessible to clients';
  END IF;
END;
$check$;
COMMIT;
