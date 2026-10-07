-- FUTURE uploads only. The new project had zero buckets and zero objects.
-- No historical image/proof bytes are reconstructed by this file.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.is_staff()') IS NULL OR to_regprocedure('public.is_boss()') IS NULL THEN
    RAISE EXCEPTION 'Active-status role helpers are required';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='storage.objects'::regclass) THEN
    RAISE EXCEPTION 'Storage objects RLS must already be enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
             AND policyname NOT LIKE 'be_storage_%') THEN
    RAISE EXCEPTION 'Unexpected Storage policy; review it before enabling uploads';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets
             WHERE id IN ('avatars','payment-proofs') AND public IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'Existing target bucket is not private; review instead of overwriting its settings';
  END IF;
END;
$preflight$;

INSERT INTO storage.buckets(id,name,public)
VALUES ('avatars','avatars',false),('payment-proofs','payment-proofs',false)
ON CONFLICT (id) DO NOTHING;
-- Existing bucket MIME/size/privacy settings are not overwritten. The source
-- declared only public=false; no invented MIME or size cap is introduced here.

-- These grants never change the privileged Storage service role.
GRANT USAGE ON SCHEMA storage TO authenticated;
REVOKE ALL ON TABLE storage.objects FROM PUBLIC,anon;
REVOKE UPDATE,TRUNCATE,REFERENCES,TRIGGER ON TABLE storage.objects FROM authenticated;
GRANT SELECT,INSERT,DELETE ON TABLE storage.objects TO authenticated;

DROP POLICY IF EXISTS be_storage_avatar_read ON storage.objects;
CREATE POLICY be_storage_avatar_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='avatars' AND public.is_staff());

DROP POLICY IF EXISTS be_storage_avatar_insert ON storage.objects;
CREATE POLICY be_storage_avatar_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='avatars' AND public.is_staff()
  AND (storage.foldername(name))[1]=auth.uid()::text);

-- The concrete frontend generates <uid>/order-* or <uid>/payout-* paths.
-- Salary proof files remain boss-only even though order proofs are shared staff data.
DROP POLICY IF EXISTS be_storage_proof_read ON storage.objects;
CREATE POLICY be_storage_proof_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='payment-proofs' AND public.is_staff()
  AND (split_part(name,'/',2) LIKE 'order-%' OR public.is_boss()));

DROP POLICY IF EXISTS be_storage_proof_insert ON storage.objects;
CREATE POLICY be_storage_proof_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='payment-proofs' AND public.is_staff()
  AND (storage.foldername(name))[1]=auth.uid()::text
  AND (split_part(name,'/',2) LIKE 'order-%'
       OR (public.is_boss() AND split_part(name,'/',2) LIKE 'payout-%')));

DROP POLICY IF EXISTS be_storage_proof_delete ON storage.objects;
CREATE POLICY be_storage_proof_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='payment-proofs' AND public.is_staff()
  AND ((split_part(name,'/',2) LIKE 'order-%'
        AND ((storage.foldername(name))[1]=auth.uid()::text OR public.is_boss()))
       OR (public.is_boss() AND split_part(name,'/',2) LIKE 'payout-%'
           AND (storage.foldername(name))[1]=auth.uid()::text)));
-- The old Storage policy allowed only uploader deletion. The UI detaches the
-- order reference first and ignores file-delete errors; add boss cleanup for
-- shared order-* files, while managers retain uploader-only physical deletion.

-- No avatar DELETE and no object UPDATE policy: the UI has neither operation,
-- and every observed upload explicitly uses upsert:false.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('avatars','payment-proofs') AND public) THEN
    RAISE EXCEPTION 'Recovery upload buckets must remain private';
  END IF;
  IF has_schema_privilege('authenticated','recovery_20261007','USAGE')
     OR has_schema_privilege('anon','recovery_20261007','USAGE') THEN
    RAISE EXCEPTION 'Private recovery evidence must remain inaccessible to clients';
  END IF;
END;
$check$;
COMMIT;
