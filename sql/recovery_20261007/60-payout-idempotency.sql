-- New settlements only: no historical payroll/ledger/balance backfill.
-- Deploy with the PB2-capable frontend. Old new-request tokens fail without writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

CREATE TABLE IF NOT EXISTS recovery_20261007.payout_operation_receipts (
 receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_no text NOT NULL UNIQUE,
 operator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 payout_id uuid NOT NULL UNIQUE REFERENCES public.payout(id) ON DELETE RESTRICT,
 request_items jsonb NOT NULL CHECK(jsonb_typeof(request_items)='array'),
 request_hash text NOT NULL,
 total_amount numeric(12,2) NOT NULL CHECK(total_amount>0 AND total_amount::text NOT IN ('NaN','Infinity','-Infinity')),
 detail_count integer NOT NULL CHECK(detail_count BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recovery_20261007.payout_operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recovery_20261007.payout_operation_receipts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA recovery_20261007 FROM PUBLIC,anon,authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS payout_pb2_batch_no_unique ON public.payout(batch_no)
 WHERE batch_no LIKE 'PB2:%';

CREATE OR REPLACE FUNCTION recovery_20261007.payout_receipt_result(p_receipt_id uuid,p_replayed boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $receipt$
DECLARE op recovery_20261007.payout_operation_receipts%rowtype;head public.payout%rowtype;
 v_count integer;v_distinct integer;v_total numeric;v_canonical jsonb;v_items jsonb;v_receipt jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_boss(),false) THEN
  RETURN jsonb_build_object('success',false,'code','FORBIDDEN','message','仅启用的老板可以核对工资结算');
 END IF;
 SELECT * INTO op FROM recovery_20261007.payout_operation_receipts WHERE receipt_id=p_receipt_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND','definitive',false,'retry_same_request',true,'message','暂未查到操作回执，请保留原操作编号核对'); END IF;
 IF op.operator_id IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('success',false,'code','ACTOR_MISMATCH','message','操作编号与当前账号不一致'); END IF;
 SELECT * INTO head FROM public.payout WHERE id=op.payout_id;
 IF NOT FOUND OR head.status IS DISTINCT FROM 'completed'::public.payout_status
 OR head.batch_no IS DISTINCT FROM op.batch_no OR head.operator_id IS DISTINCT FROM op.operator_id
 OR head.total_amount IS DISTINCT FROM op.total_amount OR head.detail_count IS DISTINCT FROM op.detail_count
 OR op.request_hash IS DISTINCT FROM encode(extensions.digest(convert_to(op.request_items::text,'UTF8'),'sha256'),'hex') THEN
  RETURN jsonb_build_object('success',false,'code','RECEIPT_INCOMPLETE','settlement_exists',true,'message','已有结算回执与批次信息不一致，禁止再次扣款，请核对');
 END IF;
 SELECT count(*)::integer,count(DISTINCT employee_id)::integer,coalesce(sum(amount),0),
  jsonb_agg(jsonb_build_object('employee_id',employee_id,'amount',amount) ORDER BY employee_id)
 INTO v_count,v_distinct,v_total,v_canonical FROM public.payout_detail WHERE payout_id=head.id;
 IF v_count<>op.detail_count OR v_distinct<>v_count OR v_total IS DISTINCT FROM op.total_amount
 OR v_canonical IS DISTINCT FROM op.request_items
 OR EXISTS (SELECT 1 FROM public.payout_detail d WHERE d.payout_id=head.id AND
  (d.amount::text IN ('NaN','Infinity','-Infinity') OR d.balance_before::text IN ('NaN','Infinity','-Infinity')
   OR d.balance_after::text IN ('NaN','Infinity','-Infinity') OR d.balance_before-d.balance_after IS DISTINCT FROM d.amount))
 OR (SELECT count(*) FROM public.wallet_ledger WHERE payout_id=head.id)<>v_count
 OR EXISTS (SELECT 1 FROM public.payout_detail d LEFT JOIN public.wallet_ledger l
  ON l.payout_id=d.payout_id AND l.employee_id=d.employee_id AND l.type='payout'
  WHERE d.payout_id=head.id AND (l.id IS NULL OR l.amount IS DISTINCT FROM -d.amount
   OR l.balance_after IS DISTINCT FROM d.balance_after OR l.operator_id IS DISTINCT FROM op.operator_id OR l.order_id IS NOT NULL)) THEN
  RETURN jsonb_build_object('success',false,'code','RECEIPT_INCOMPLETE','settlement_exists',true,'message','已有结算明细或流水不完整，禁止再次扣款，请核对');
 END IF;
 SELECT jsonb_agg(jsonb_build_object('employee_id',d.employee_id,'amount',d.amount,
  'balance_before',d.balance_before,'balance_after',d.balance_after,'detail_id',d.id,'ledger_id',l.id) ORDER BY d.employee_id)
 INTO v_items FROM public.payout_detail d JOIN public.wallet_ledger l
 ON l.payout_id=d.payout_id AND l.employee_id=d.employee_id AND l.type='payout' WHERE d.payout_id=head.id;
 v_receipt:=jsonb_build_object('receipt_id',op.receipt_id,'payout_id',head.id,'batch_no',head.batch_no,
  'operator_id',op.operator_id,'total_amount',head.total_amount,'detail_count',head.detail_count,
  'status',head.status,'created_at',head.created_at,'items',v_items);
 RETURN jsonb_build_object('success',true,'batch_id',head.id,'payout_id',head.id,'receipt_id',op.receipt_id,
  'batch_no',head.batch_no,'operator_id',op.operator_id,'total_amount',head.total_amount,'detail_count',head.detail_count,
  'status',head.status,'proof_path',head.proof_path,'created_at',head.created_at,'replayed',p_replayed,'receipt',v_receipt);
END;
$receipt$;
REVOKE ALL ON FUNCTION recovery_20261007.payout_receipt_result(uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_payout_receipt(p_batch_no text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $lookup$
DECLARE v_actor uuid:=auth.uid();v_embedded uuid;v_request uuid;v_key text;v_receipt uuid;
BEGIN
 IF v_actor IS NULL OR NOT coalesce(public.is_boss(),false) THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN','message','仅启用的老板可以核对工资结算'); END IF;
 IF p_batch_no IS NULL OR length(p_batch_no)<>77 OR p_batch_no !~ '^PB2:[0-9A-Fa-f-]{36}:[0-9A-Fa-f-]{36}$' THEN
  IF EXISTS (SELECT 1 FROM public.payout WHERE batch_no=p_batch_no) THEN RETURN jsonb_build_object('success',false,'code','LEGACY_UNVERIFIED','settlement_exists',true,'message','旧批次没有可验证的操作回执，不能按本次请求重放'); END IF;
  RETURN jsonb_build_object('success',false,'code','REQUEST_TOKEN_REQUIRED','message','请刷新到新版工资页面后操作');
 END IF;
 v_embedded:=split_part(p_batch_no,':',2)::uuid;v_request:=split_part(p_batch_no,':',3)::uuid;
 IF v_embedded<>v_actor THEN RETURN jsonb_build_object('success',false,'code','ACTOR_MISMATCH','message','操作编号与当前账号不一致'); END IF;
 v_key:='PB2:'||v_embedded::text||':'||v_request::text;
 SELECT receipt_id INTO v_receipt FROM recovery_20261007.payout_operation_receipts WHERE batch_no=v_key;
 IF FOUND THEN RETURN recovery_20261007.payout_receipt_result(v_receipt,true); END IF;
 IF EXISTS (SELECT 1 FROM public.payout WHERE batch_no=v_key) THEN RETURN jsonb_build_object('success',false,'code','LEGACY_UNVERIFIED','settlement_exists',true,'message','已有批次缺少可验证回执，禁止再次扣款，请核对'); END IF;
 RETURN jsonb_build_object('success',false,'code','NOT_FOUND','definitive',false,'retry_same_request',true,'message','暂未查到回执，原请求仍可能执行中；请保留同一操作编号核对');
EXCEPTION WHEN invalid_text_representation THEN
 RETURN jsonb_build_object('success',false,'code','REQUEST_TOKEN_REQUIRED','message','操作编号无效，请刷新新版页面');
END;
$lookup$;

CREATE OR REPLACE FUNCTION public.payout_salary(p_items jsonb,p_batch_no text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $payout$
DECLARE v_actor uuid:=auth.uid();v_embedded uuid;v_request uuid;v_key text;
 v_items jsonb;v_total numeric;v_count integer;v_locked_count integer;v_payout uuid;v_receipt uuid;
 v_existing recovery_20261007.payout_operation_receipts%rowtype;v_employee public.employee%rowtype;
 item record;v_before numeric;v_after numeric;v_result jsonb;
BEGIN
 IF v_actor IS NULL OR NOT coalesce(public.is_boss(),false) THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN','message','仅启用的老板可发放工资'); END IF;
 IF p_batch_no IS NULL OR length(p_batch_no)<>77 OR p_batch_no !~ '^PB2:[0-9A-Fa-f-]{36}:[0-9A-Fa-f-]{36}$' THEN
  IF EXISTS (SELECT 1 FROM public.payout WHERE batch_no=p_batch_no) THEN RETURN jsonb_build_object('success',false,'code','LEGACY_UNVERIFIED','settlement_exists',true,'message','旧批次没有可验证的操作回执，禁止按本次请求重放'); END IF;
  RETURN jsonb_build_object('success',false,'code','REQUEST_TOKEN_REQUIRED','message','请刷新到新版工资页面后操作；本次未扣款');
 END IF;
 v_embedded:=split_part(p_batch_no,':',2)::uuid;v_request:=split_part(p_batch_no,':',3)::uuid;
 IF v_embedded<>v_actor THEN RETURN jsonb_build_object('success',false,'code','ACTOR_MISMATCH','message','操作编号与当前账号不一致；本次未扣款'); END IF;
 v_key:='PB2:'||v_embedded::text||':'||v_request::text;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 1000 THEN RETURN jsonb_build_object('success',false,'code','INVALID_ITEMS','message','结算需包含 1 到 1000 条员工金额'); END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) j WHERE jsonb_typeof(j)<>'object') THEN RETURN jsonb_build_object('success',false,'code','INVALID_ITEMS','message','结算明细格式无效'); END IF;
 IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) x(employee_id uuid,amount numeric)
  WHERE employee_id IS NULL OR amount IS NULL OR amount<=0 OR amount::text IN ('NaN','Infinity','-Infinity')) THEN RETURN jsonb_build_object('success',false,'code','INVALID_ITEMS','message','员工和正数有限金额不能为空'); END IF;
 IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) x(employee_id uuid,amount numeric) WHERE amount<>round(amount,2)) THEN RETURN jsonb_build_object('success',false,'code','INVALID_AMOUNT_PRECISION','message','结算金额必须精确到分，不自动舍入'); END IF;
 IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) x(employee_id uuid,amount numeric) GROUP BY employee_id HAVING count(*)>1) THEN RETURN jsonb_build_object('success',false,'code','DUPLICATE_EMPLOYEE','message','同一员工不能在一个结算请求中重复出现'); END IF;
 SELECT jsonb_agg(jsonb_build_object('employee_id',employee_id,'amount',round(amount,2)) ORDER BY employee_id),sum(amount),count(*)::integer
 INTO v_items,v_total,v_count FROM jsonb_to_recordset(p_items) x(employee_id uuid,amount numeric);
 IF v_total>9999999999.99 THEN RETURN jsonb_build_object('success',false,'code','AMOUNT_TOO_LARGE','message','结算总额超出金额字段范围'); END IF;
 -- Same advisory-lock namespace as the previous implementation; receipt/header constraints back it up.
 PERFORM pg_advisory_xact_lock(hashtextextended('payout:'||v_key,0));
 SELECT * INTO v_existing FROM recovery_20261007.payout_operation_receipts WHERE batch_no=v_key;
 IF FOUND THEN
  IF v_existing.operator_id IS DISTINCT FROM v_actor THEN RETURN jsonb_build_object('success',false,'code','ACTOR_MISMATCH','message','操作回执属于其它账号'); END IF;
  IF v_existing.request_items IS DISTINCT FROM v_items THEN RETURN jsonb_build_object('success',false,'code','PAYLOAD_MISMATCH','settlement_exists',true,'message','该操作编号已用于不同的员工或金额；禁止再次扣款'); END IF;
  RETURN recovery_20261007.payout_receipt_result(v_existing.receipt_id,true);
 END IF;
 IF EXISTS (SELECT 1 FROM public.payout WHERE batch_no=v_key) THEN RETURN jsonb_build_object('success',false,'code','LEGACY_UNVERIFIED','settlement_exists',true,'message','已有批次缺少操作回执，禁止再次扣款，请核对'); END IF;
 -- Stable lock order across different requests that share employees.
 PERFORM e.id FROM public.employee e JOIN jsonb_to_recordset(v_items) x(employee_id uuid,amount numeric)
 ON x.employee_id=e.id ORDER BY e.id FOR UPDATE OF e;
 GET DIAGNOSTICS v_locked_count=ROW_COUNT;
 IF v_locked_count<>v_count THEN RETURN jsonb_build_object('success',false,'code','EMPLOYEE_NOT_FOUND','message','结算包含不存在的员工；本次未扣款'); END IF;
 FOR item IN SELECT * FROM jsonb_to_recordset(v_items) x(employee_id uuid,amount numeric) ORDER BY employee_id LOOP
  SELECT * INTO v_employee FROM public.employee WHERE id=item.employee_id;
  IF v_employee.wallet_balance IS NULL OR v_employee.wallet_balance::text IN ('NaN','Infinity','-Infinity') OR v_employee.is_debt IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID_EMPLOYEE_BALANCE','message','员工余额或欠款标记不完整；本次未扣款'); END IF;
  v_after:=v_employee.wallet_balance-item.amount;
  IF v_employee.is_debt=false AND v_after<0 THEN RETURN jsonb_build_object('success',false,'code','INSUFFICIENT_BALANCE','employee_id',item.employee_id,'message','存在余额不足的非欠款员工；本次未扣款'); END IF;
  IF v_after< -9999999999.99 OR v_after>9999999999.99 THEN RETURN jsonb_build_object('success',false,'code','AMOUNT_TOO_LARGE','message','结算后余额超出字段范围；本次未扣款'); END IF;
 END LOOP;
 INSERT INTO public.payout(batch_no,operator_id,status,total_amount,detail_count)
 VALUES(v_key,v_actor,'processing',0,0) RETURNING id INTO v_payout;
 FOR item IN SELECT * FROM jsonb_to_recordset(v_items) x(employee_id uuid,amount numeric) ORDER BY employee_id LOOP
  SELECT wallet_balance INTO v_before FROM public.employee WHERE id=item.employee_id;
  v_after:=v_before-item.amount;
  UPDATE public.employee SET wallet_balance=v_after WHERE id=item.employee_id;
  INSERT INTO public.wallet_ledger(employee_id,type,amount,balance_after,payout_id,operator_id,remark)
  VALUES(item.employee_id,'payout',-item.amount,v_after,v_payout,v_actor,'工资发放 '||v_key);
  INSERT INTO public.payout_detail(payout_id,employee_id,amount,balance_before,balance_after)
  VALUES(v_payout,item.employee_id,item.amount,v_before,v_after);
 END LOOP;
 UPDATE public.payout SET total_amount=v_total,detail_count=v_count,status='completed' WHERE id=v_payout;
 INSERT INTO recovery_20261007.payout_operation_receipts(batch_no,operator_id,payout_id,request_items,request_hash,total_amount,detail_count)
 VALUES(v_key,v_actor,v_payout,v_items,encode(extensions.digest(convert_to(v_items::text,'UTF8'),'sha256'),'hex'),v_total,v_count)
 RETURNING receipt_id INTO v_receipt;
 v_result:=recovery_20261007.payout_receipt_result(v_receipt,false);
 IF (v_result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'New payout failed receipt/detail/ledger invariant'; END IF;
 RETURN v_result;
EXCEPTION
 WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('success',false,'code','RETRY_SAME_REQUEST','retry_same_request',true,'message','结算暂未确认，请保留原编号核对或重试，勿创建新批次');
 WHEN data_exception THEN
  RETURN jsonb_build_object('success',false,'code','INVALID_ITEMS','message','员工标识或金额格式无效，本次请求已回滚');
 WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'code','PAYOUT_FAILED','message','结算未完成，本次请求已回滚，请保留原编号核对','sqlstate',SQLSTATE);
END;
$payout$;

-- Lock the header, check real object ownership and exact batch folder, then CAS the reference.
CREATE OR REPLACE FUNCTION public.attach_payout_proof(p_payout_id uuid,p_proof_path text,p_expected_proof_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $proof$
DECLARE v_actor uuid:=auth.uid();v_head public.payout%rowtype;v_prefix text;v_object uuid;v_owner text;v_replayed boolean;
BEGIN
 IF v_actor IS NULL OR NOT coalesce(public.is_boss(),false) THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN','message','仅启用的老板可以补传工资凭证'); END IF;
 SELECT * INTO v_head FROM public.payout WHERE id=p_payout_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND','message','工资批次不存在，未关联凭证'); END IF;
 IF v_head.status IS DISTINCT FROM 'completed'::public.payout_status THEN RETURN jsonb_build_object('success',false,'code','PAYOUT_NOT_COMPLETED','message','批次未确认结算完成，不能关联凭证'); END IF;
 v_prefix:=v_actor::text||'/payout-'||p_payout_id::text||'/';
 IF p_proof_path IS NULL OR left(p_proof_path,length(v_prefix))<>v_prefix
 OR substring(p_proof_path FROM length(v_prefix)+1) !~ '^[0-9A-Fa-f-]{36}\.[A-Za-z0-9]{1,10}$' THEN
  RETURN jsonb_build_object('success',false,'code','INVALID_PROOF','message','凭证路径不属于当前上传账号和目标批次');
 END IF;
 SELECT id,coalesce(nullif(owner_id,''),owner::text) INTO v_object,v_owner
 FROM storage.objects WHERE bucket_id='payment-proofs' AND name=p_proof_path FOR KEY SHARE;
 IF NOT FOUND OR v_owner IS DISTINCT FROM v_actor::text THEN RETURN jsonb_build_object('success',false,'code','INVALID_PROOF','message','凭证对象不存在或上传账号不符'); END IF;
 v_replayed:=v_head.proof_path IS NOT DISTINCT FROM p_proof_path;
 IF NOT v_replayed AND v_head.proof_path IS DISTINCT FROM p_expected_proof_path THEN
  RETURN jsonb_build_object('success',false,'code','PROOF_CONFLICT','message','该批次凭证已被另一操作更新，请核对后明确选择；不会覆盖现有凭证','current_proof_path',v_head.proof_path);
 END IF;
 IF NOT v_replayed THEN UPDATE public.payout SET proof_path=p_proof_path WHERE id=p_payout_id; END IF;
 RETURN jsonb_build_object('success',true,'batch_id',v_head.id,'payout_id',v_head.id,'batch_no',v_head.batch_no,
  'proof_path',p_proof_path,'attached',true,'replayed',v_replayed);
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('success',false,'code','PROOF_ATTACH_FAILED','message','凭证关联未完成，请按原期望路径核对后重试','sqlstate',SQLSTATE);
END;
$proof$;

-- Close the old unchecked direct assignment route; active bosses use the confirmed CAS RPC.
REVOKE UPDATE ON public.payout FROM PUBLIC,anon,authenticated;
REVOKE UPDATE(proof_path) ON public.payout FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS be_payout_proof_update_boss ON public.payout;
REVOKE ALL ON FUNCTION public.payout_salary(jsonb,text),public.get_payout_receipt(text),
 public.attach_payout_proof(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payout_salary(jsonb,text),public.get_payout_receipt(text),
 public.attach_payout_proof(uuid,text,text) TO authenticated;

DO $check$
BEGIN
 IF has_schema_privilege('authenticated','recovery_20261007','USAGE') OR has_schema_privilege('anon','recovery_20261007','USAGE')
 OR has_table_privilege('authenticated','recovery_20261007.payout_operation_receipts','SELECT,INSERT,UPDATE,DELETE')
 OR has_column_privilege('authenticated','public.payout','proof_path','UPDATE')
 OR has_column_privilege('authenticated','public.employee','wallet_balance','UPDATE')
 OR has_column_privilege('authenticated','public.users','password_hash','SELECT,INSERT,UPDATE') THEN RAISE EXCEPTION 'Payroll/private/password boundary not closed'; END IF;
END;
$check$;
COMMIT;
