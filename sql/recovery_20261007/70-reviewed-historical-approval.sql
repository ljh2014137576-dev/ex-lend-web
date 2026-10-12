-- Runtime archive, not a Supabase CLI migration. No public RPC is changed.
-- The reviewed data and one-time execution live in the private recovery folder.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public."order" ALTER COLUMN gross_profit DROP NOT NULL;
CREATE TABLE IF NOT EXISTS recovery_20261007.reviewed_historical_approval_receipts (
  execution_id uuid PRIMARY KEY,
  manifest_sha256 text NOT NULL UNIQUE CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_text text NOT NULL,
  reviewed_manifest jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id),
  source_captured_at timestamptz NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  policy jsonb NOT NULL,
  order_ids uuid[] NOT NULL CHECK (cardinality(order_ids) = 21),
  approved_count integer NOT NULL CHECK (approved_count = 21),
  member_count integer NOT NULL CHECK (member_count = 34),
  commission_total numeric(12,2) NOT NULL CHECK (commission_total = 5181.77),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  evidence_gaps jsonb NOT NULL,
  CHECK (manifest_text::jsonb = reviewed_manifest),
  CHECK (manifest_sha256 = encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex'))
);
ALTER TABLE recovery_20261007.reviewed_historical_approval_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recovery_20261007.reviewed_historical_approval_receipts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA recovery_20261007 FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
