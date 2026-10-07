-- Installation only; all new RPC execution stays closed until permissions phase.
-- No historical INSERT/UPDATE/DELETE backfills are executed by this migration.
BEGIN;
SET LOCAL search_path=pg_catalog,public,extensions,pg_temp;
CREATE TEMP TABLE _rpc_role_helpers_before ON COMMIT DROP AS
SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('is_boss','is_manager','is_staff');
DO $preflight$ BEGIN
 IF (SELECT count(*) FROM _rpc_role_helpers_before)<>3 THEN RAISE EXCEPTION 'Existing hardened role helpers required'; END IF;
 IF to_regclass('recovery_20261007.business_row_provenance') IS NULL THEN RAISE EXCEPTION 'Recovery provenance required'; END IF;
 IF to_regclass('storage.objects') IS NULL THEN RAISE EXCEPTION 'Supabase Storage objects relation required'; END IF;
END $preflight$;
-- Old rows remain NULL: add without DEFAULT first, then set the default for future rows only.
ALTER TABLE public."order" ADD COLUMN IF NOT EXISTS quantity integer;
ALTER TABLE public."order" ALTER COLUMN quantity SET DEFAULT 1;
DO $quantity_check$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."order"'::regclass AND conname='order_quantity_positive') THEN
   ALTER TABLE public."order" ADD CONSTRAINT order_quantity_positive CHECK(quantity>0);
 END IF;
END $quantity_check$;
CREATE SEQUENCE IF NOT EXISTS public.order_no_recovery_sequence;
REVOKE ALL ON SEQUENCE public.order_no_recovery_sequence FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS recovery_20261007.order_edit_ledger_archive(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id uuid NOT NULL,edited_by uuid NOT NULL,
 archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),old_order jsonb NOT NULL,payment_rows jsonb NOT NULL);
ALTER TABLE recovery_20261007.order_edit_ledger_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recovery_20261007.order_edit_ledger_archive FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION recovery_20261007.assert_order_history_complete(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,recovery_20261007,pg_temp AS $guard$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM recovery_20261007.business_row_provenance WHERE table_name='order' AND record_id=p_order_id) THEN
   RAISE EXCEPTION 'Recovered order cannot be changed financially: complete product IDs/item history, order-linked payment ledgers and historical commission evidence were not captured. Reconcile the source evidence before editing, approving, reversing, refunding, repricing or deleting it.' USING ERRCODE='P0001';
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION recovery_20261007.assert_order_history_complete(uuid) FROM PUBLIC,anon,authenticated;

-- Source: ALL_IN_ONE.sql:430-435
CREATE OR REPLACE FUNCTION public.gen_order_no() RETURNS text LANGUAGE sql AS $rpc$
 SELECT 'ORD'||to_char(clock_timestamp(),'YYYYMMDDHH24MISS')||lpad(nextval('public.order_no_recovery_sequence')::text,12,'0')
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='gen_order_no' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: sql/system.sql:101-111
CREATE OR REPLACE FUNCTION public.is_proof_path_valid(p_path text)
returns boolean
language sql stable security definer  as $rpc$
 SELECT auth.uid() IS NOT NULL AND coalesce(public.is_staff(),false) AND p_path IS NOT NULL
 AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='payment-proofs' AND o.name=p_path
 AND (o.name !~ '(^|/)payout-' OR coalesce(public.is_boss(),false)))
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='is_proof_path_valid' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:305-311
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
returns trigger as $rpc$
begin
  new.updated_at = now();
  return new;
end;
$rpc$ language plpgsql SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='trigger_set_updated_at' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:2659-2695
CREATE OR REPLACE FUNCTION public.auto_upgrade_customer_vip()
returns trigger language plpgsql security definer  as $rpc$
declare
  v_level int;
  v_old_level int;
  v_message text;
begin
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN RAISE EXCEPTION 'Active staff context required for business trigger' USING ERRCODE='42501'; END IF;

  if new.total_consumption <= old.total_consumption then
    return new;
  end if;

  select coalesce(max(vip_level), 0)
    into v_level
    from public.vip_upgrade_rule
   where consumption_threshold <= new.total_consumption;

  v_old_level := coalesce(new.vip_level, 0);
  if v_level > v_old_level then
    update public.customer
       set type = 'vip', vip_level = v_level
     where id = new.id;

    insert into public.customer_account_adjustment
      (customer_id, field, amount, before_value, after_value, reason, operator_id)
    values
      (new.id, 'vip_level', v_level - v_old_level, v_old_level, v_level, '累计消费达到 VIP 升级门槛', auth.uid());

    v_message := format('客户「%s」已从 VIP %s 自动升级为 VIP %s。', new.name, v_old_level, v_level);
    insert into public.notification (recipient_id, type, title, content, reference_type, reference_id)
    select id, 'customer_vip_upgrade', '客户 VIP 自动升级', v_message, 'customer', new.id
      from public.users
     where status = 'active';
  end if;

  return new;
end;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='auto_upgrade_customer_vip' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:1403-1411
CREATE OR REPLACE FUNCTION public.sync_product_category_name()
returns trigger language plpgsql as $rpc$
begin
  if new.category_id is not null then
    select name into new.category from product_category where id = new.category_id;
  end if;
  return new;
end;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sync_product_category_name' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:1418-1426
CREATE OR REPLACE FUNCTION public.sync_discount_category_name()
returns trigger language plpgsql as $rpc$
begin
  if new.category_id is not null then
    select name into new.category from product_category where id = new.category_id;
  end if;
  return new;
end;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sync_discount_category_name' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:2549-2556
CREATE OR REPLACE FUNCTION public.touch_collaboration_record()
returns trigger language plpgsql security definer  as $rpc$
begin
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN RAISE EXCEPTION 'Active staff context required for business trigger' USING ERRCODE='42501'; END IF;

  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='touch_collaboration_record' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:2626-2651
CREATE OR REPLACE FUNCTION public.notify_todo_mentions()
returns trigger language plpgsql security definer  as $rpc$
declare
  v_recipient_id uuid;
begin
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN RAISE EXCEPTION 'Active staff context required for business trigger' USING ERRCODE='42501'; END IF;

  for v_recipient_id in
    select distinct mentioned_id
    from unnest(coalesce(new.mentioned_user_ids, '{}'::uuid[])) as mentioned_id
    where mentioned_id is distinct from auth.uid()
      and (tg_op = 'INSERT' or not mentioned_id = any(coalesce(old.mentioned_user_ids, '{}'::uuid[])))
  loop
    if exists (select 1 from public.users where id = v_recipient_id and status = 'active') then
      insert into public.notification (recipient_id, type, title, content, reference_type, reference_id)
      values (
        v_recipient_id,
        'todo_mention',
        '你被提及了一条待办',
        format('@%s：%s', coalesce(new.title, '待办'), coalesce(new.content, '')),
        'todo_item',
        new.id
      );
    end if;
  end loop;
  return new;
end;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='notify_todo_mentions' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:3757-3798
CREATE OR REPLACE FUNCTION public.add_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer  as $rpc$
declare
  v_status order_status;
  v_path text;
BEGIN
 BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not public.is_staff() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限')->>'message') USING ERRCODE='P0001';
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is null then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '凭证路径为空')->>'message') USING ERRCODE='P0001';
  end if;
  if not public.is_proof_path_valid(v_path) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '凭证文件不存在')->>'message') USING ERRCODE='P0001';
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单不存在')->>'message') USING ERRCODE='P0001';
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证')->>'message') USING ERRCODE='P0001';
  end if;

  if v_path = any(coalesce((select proof_paths from public."order" where id = p_order_id), array[]::text[])) then
    return jsonb_build_object('success', true, 'message', '凭证已存在');
  end if;

  update public."order"
  set proof_paths = array_append(coalesce(proof_paths, array[]::text[]), v_path),
      proof_path = v_path
  where id = p_order_id;

  return jsonb_build_object('success', true);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='add_order_proof' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: sql/fix_consume_from_pending_amount.sql:253-494
CREATE OR REPLACE FUNCTION public.adjust_order_price(
  p_order_id uuid,
  p_new_paid numeric,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_order public."order"%rowtype;
  v_customer public.customer%rowtype;
  v_member record;
  v_item record;
  v_employee public.employee%rowtype;
  v_member_count int;
  v_base numeric(12,2);
  v_item_base numeric(12,2);
  v_grade_rate numeric(8,6);
  v_commission numeric(12,2);
  v_total_commission numeric(12,2) := 0;
  v_effective_rate numeric(8,6);
  v_snapshot_type commission_type;
  v_new_emp_balance numeric(12,2);
  v_principal_consume numeric(12,2) := 0;
  v_bonus_consume numeric(12,2) := 0;
  v_old_principal numeric(12,2) := 0;
  v_old_bonus numeric(12,2) := 0;
  v_total_liability numeric(12,2);
  v_real_income numeric(12,2);
  v_gross_profit numeric(12,2);
  v_new_item_paid numeric(12,2);
  v_operator uuid := auth.uid();
  v_was_approved boolean := false;
BEGIN
 BEGIN
  IF p_new_paid IS NULL OR p_new_paid::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Finite paid amount required'; END IF;

  PERFORM recovery_20261007.assert_order_history_complete(p_order_id);

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not (public.is_boss() or public.is_manager()) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'NO PERMISSION')->>'message') USING ERRCODE='P0001';
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'ORDER NOT FOUND')->>'message') USING ERRCODE='P0001';
  end if;
  if v_order.status = 'cancelled' or v_order.audit_status = 'rejected' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'CANCELLED/REJECTED')->>'message') USING ERRCODE='P0001';
  end if;

  p_new_paid := round(p_new_paid, 2);
  if p_new_paid < 0 or p_new_paid > v_order.original_amount then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'BAD AMOUNT')->>'message') USING ERRCODE='P0001';
  end if;
  if p_new_paid = v_order.paid_amount then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'SAME AMOUNT')->>'message') USING ERRCODE='P0001';
  end if;

  v_was_approved := v_order.audit_status = 'approved';
  IF v_was_approved AND NOT coalesce(public.is_boss(),false) THEN RAISE EXCEPTION 'Only boss may reprice an approved order' USING ERRCODE='42501'; END IF;

  select * into v_customer from public.customer where id = v_order.customer_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'CUSTOMER NOT FOUND')->>'message') USING ERRCODE='P0001';
  end if;

  PERFORM 1 FROM public.employee e WHERE e.id IN (SELECT employee_id FROM public.order_member WHERE order_id=p_order_id) ORDER BY e.id FOR UPDATE;
  -- Preserve original ledger evidence before rebuilding active amounts.
  INSERT INTO recovery_20261007.order_edit_ledger_archive(order_id,edited_by,old_order,payment_rows)
  SELECT p_order_id,auth.uid(),to_jsonb(v_order),coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) FROM public.customer_wallet_ledger l WHERE l.order_id=p_order_id;
  -- 1) REVERSE OLD LEDGER
  if v_was_approved then
    for v_member in
      select employee_id, commission_amount
      from public.order_member
      where order_id = p_order_id
    loop
      if coalesce(v_member.commission_amount, 0) = 0 then
        continue;
      end if;
      select * into v_employee from public.employee where id = v_member.employee_id for update;
      if not found then
        RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'EMPLOYEE NOT FOUND')->>'message') USING ERRCODE='P0001';
      end if;
      v_new_emp_balance := v_employee.wallet_balance - v_member.commission_amount;
      update public.employee
      set wallet_balance = v_new_emp_balance,
          is_debt = case when v_new_emp_balance < 0 then true else is_debt end,
          is_bad_debt = case when status = 'resigned' and v_new_emp_balance < 0 then true else is_bad_debt end
      where id = v_employee.id;
      insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
      values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_emp_balance, p_order_id, v_operator, 'PRICE ADJ REVERSE COMMISSION');
    end loop;
  end if;

  if v_order.pay_method = 'wallet' then
    select
      coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
      coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
    into v_old_principal, v_old_bonus
    from public.customer_wallet_ledger
    where order_id = p_order_id and type in ('consume_principal', 'consume_bonus');
    update public.customer set
      principal_balance = principal_balance + v_old_principal,
      bonus_balance = bonus_balance + v_old_bonus
    where id = v_customer.id;
  end if;
  if v_was_approved then
    update public.customer set total_consumption = greatest(total_consumption - v_order.paid_amount, 0) where id = v_customer.id;
  else
    update public.customer set pending_balance = greatest(pending_balance - v_order.paid_amount, 0) where id = v_customer.id;
  end if;

  delete from public.customer_wallet_ledger where order_id = p_order_id;
  delete from public.wallet_ledger where order_id = p_order_id;

  SELECT * INTO v_customer FROM public.customer WHERE id=v_order.customer_id FOR UPDATE;
  -- 2) RE-DISTRIBUTE ITEMS
  for v_item in
    select id, original_amount from public.order_item where order_id = p_order_id
  loop
    v_new_item_paid := case when v_order.original_amount > 0 then round(p_new_paid * v_item.original_amount / v_order.original_amount, 2) else 0 end;
    update public.order_item
    set paid_amount = v_new_item_paid,
        discount_amount = v_item.original_amount - v_new_item_paid,
        discount_rate = case when v_item.original_amount > 0 then v_new_item_paid / v_item.original_amount else 1 end
    where id = v_item.id;
  end loop;

  -- Carry any cent rounding remainder onto one line, preserving exact total.
  WITH delta AS (SELECT p_new_paid-coalesce(sum(paid_amount),0) AS amount FROM public.order_item WHERE order_id=p_order_id),
  chosen AS (SELECT id FROM public.order_item WHERE order_id=p_order_id ORDER BY original_amount DESC,id LIMIT 1)
  UPDATE public.order_item i SET paid_amount=i.paid_amount+d.amount,discount_amount=i.original_amount-(i.paid_amount+d.amount),
    discount_rate=CASE WHEN i.original_amount>0 THEN (i.paid_amount+d.amount)/i.original_amount ELSE 1 END
  FROM delta d,chosen c WHERE i.id=c.id AND d.amount<>0;
  -- 3) UPDATE ORDER AMOUNT
  update public."order" set
    paid_amount = p_new_paid,
    discount_amount = v_order.original_amount - p_new_paid,
    pending_amount = case when v_was_approved then 0 else p_new_paid end,
    total_commission = 0,
    gross_profit = 0,
    updated_at = now()
  where id = p_order_id;

  -- 4) RE-BOOK CUSTOMER
  if v_order.pay_method = 'wallet' then
    v_total_liability := v_customer.principal_balance + v_customer.bonus_balance;
    if v_total_liability < p_new_paid then
      raise exception 'INSUFFICIENT WALLET';
    end if;
    if v_total_liability > 0 then
      v_principal_consume := round(p_new_paid * (v_customer.principal_balance / v_total_liability), 2);
      v_bonus_consume := p_new_paid - v_principal_consume;
    end if;
    update public.customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = case when v_was_approved then pending_balance else pending_balance + p_new_paid end
    where id = v_customer.id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_customer.id, 'consume_principal', -v_principal_consume,
      v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, 'PRICE ADJ PRINCIPAL');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_customer.id, 'consume_bonus', -v_bonus_consume,
      v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, 'PRICE ADJ BONUS');
    if v_was_approved then
      update public.customer set total_consumption = total_consumption + p_new_paid where id = v_customer.id;
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'consume_from_pending', p_new_paid,
        v_customer.principal_balance - v_principal_consume, v_customer.bonus_balance - v_bonus_consume, p_order_id, v_operator, 'PRICE ADJ PREPAID TO CONSUMPTION');
    end if;
  else
    update public.customer set
      pending_balance = case when v_was_approved then pending_balance else pending_balance + p_new_paid end
    where id = v_customer.id;
    if v_was_approved then
      update public.customer set total_consumption = total_consumption + p_new_paid where id = v_customer.id;
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'consume_from_pending', p_new_paid, 0, 0, p_order_id, v_operator, 'PRICE ADJ PREPAID TO CONSUMPTION CASH');
    else
      insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
      values (v_customer.id, 'cash_received', p_new_paid, v_customer.principal_balance, v_customer.bonus_balance, p_order_id, v_operator, 'PRICE ADJ CASH');
    end if;
  end if;

  -- 5) RECOMPUTE COMMISSION
  select count(*) into v_member_count from public.order_member where order_id = p_order_id;
  if v_member_count > 0 and exists (select 1 from public.order_item where order_id = p_order_id) then
    v_base := round(p_new_paid / v_member_count, 2);
    for v_member in
      select om.employee_id, e.grade, e.wallet_balance
      from public.order_member om
      join public.employee e on e.id = om.employee_id
      where om.order_id = p_order_id
    loop
      v_commission := 0;
      v_snapshot_type := null;
      for v_item in
        select commission_type_snapshot, fixed_rate_snapshot, paid_amount
        from public.order_item
        where order_id = p_order_id
      loop
        v_item_base := v_item.paid_amount / v_member_count;
        if v_item.commission_type_snapshot = 'fixed' then
          v_commission := v_commission + round(v_item_base * coalesce(v_item.fixed_rate_snapshot, 0), 2);
        else
          select rate into v_grade_rate from public.grade_commission_rule where grade = v_member.grade limit 1;
          v_commission := v_commission + round(v_item_base * v_grade_rate, 2);
        end if;
        if v_snapshot_type is null then
          v_snapshot_type := v_item.commission_type_snapshot;
        elsif v_snapshot_type <> v_item.commission_type_snapshot then
          v_snapshot_type := null;
        end if;
      end loop;
      v_effective_rate := case when v_base > 0 then v_commission / v_base else 0 end;
      v_total_commission := v_total_commission + v_commission;
      update public.order_member set
        grade_snapshot = v_member.grade,
        base_amount = v_base,
        applied_rate = v_effective_rate,
        commission_amount = v_commission,
        commission_type_snapshot = v_snapshot_type
      where order_id = p_order_id and employee_id = v_member.employee_id;
      if v_was_approved then
        UPDATE public.employee SET wallet_balance=wallet_balance+v_commission WHERE id=v_member.employee_id RETURNING wallet_balance INTO v_new_emp_balance;
        insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
        values (v_member.employee_id, 'commission', v_commission, v_new_emp_balance, p_order_id, v_operator, 'PRICE ADJ COMMISSION');
      end if;
    end loop;
  end if;

  -- 6) UPDATE ORDER COMMISSION & PROFIT
  v_real_income := p_new_paid;
  if v_order.pay_method = 'wallet' then
    v_real_income := v_principal_consume;
  end if;
  v_gross_profit := v_real_income - v_total_commission;
  update public."order" set
    total_commission = v_total_commission,
    gross_profit = v_gross_profit,
    audit_status = case when v_was_approved then 'approved' else v_order.audit_status end
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'order_no', v_order.order_no,
    'paid_amount', p_new_paid,
    'discount', v_order.original_amount - p_new_paid,
    'total_commission', v_total_commission,
    'gross_profit', v_gross_profit
  );
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='adjust_order_price' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: sql/fix_consume_from_pending_amount.sql:23-158
CREATE OR REPLACE FUNCTION public.approve_commission(p_order_id uuid)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_ord public."order"%rowtype;
  v_member record;
  v_item record;
  v_member_count int;
  v_base numeric(12,2);
  v_item_base numeric(12,2);
  v_grade_rate numeric(8,6);
  v_commission numeric(12,2);
  v_total_commission numeric(12,2) := 0;
  v_effective_rate numeric(8,6);
  v_snapshot_type commission_type;
  v_new_emp_balance numeric(12,2);
  v_cust public.customer%rowtype;
  v_principal_consume numeric(12,2);
  v_bonus_consume numeric(12,2);
  v_real_income numeric(12,2);
  v_gross_profit numeric(12,2);
  v_op uuid;
BEGIN
 BEGIN
  PERFORM recovery_20261007.assert_order_history_complete(p_order_id);

  IF auth.uid() IS NULL OR NOT coalesce(public.is_boss(),false) THEN
    RAISE EXCEPTION 'Active boss session required' USING ERRCODE='42501';
  END IF;

  if not public.is_boss() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'NO PERMISSION')->>'message') USING ERRCODE='P0001';
  end if;
  v_op := auth.uid();
  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'ORDER NOT FOUND')->>'message') USING ERRCODE='P0001'; end if;
  if v_ord.status <> 'completed' then RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'ORDER NOT COMPLETED')->>'message') USING ERRCODE='P0001'; end if;
  if v_ord.audit_status <> 'pending' then RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'ALREADY AUDITED')->>'message') USING ERRCODE='P0001'; end if;

  select count(*) into v_member_count from public.order_member where order_id = p_order_id;
  if v_member_count = 0 then RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'NO MEMBER')->>'message') USING ERRCODE='P0001'; end if;
  if not exists (select 1 from public.order_item where order_id = p_order_id) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'NO ITEMS')->>'message') USING ERRCODE='P0001';
  end if;
  if exists (
    select 1
    from public.order_member om
    join public.employee e on e.id = om.employee_id
    where om.order_id = p_order_id
      and exists (select 1 from public.order_item oi where oi.order_id = p_order_id and oi.commission_type_snapshot = 'grade')
      and not exists (select 1 from public.grade_commission_rule gr where gr.grade = e.grade)
  ) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'GRADE RULE MISSING')->>'message') USING ERRCODE='P0001';
  end if;

  -- Consistent order: order row, customer row, employee rows by ID.
  SELECT * INTO v_cust FROM public.customer WHERE id=v_ord.customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order customer missing'; END IF;
  PERFORM 1 FROM public.employee e WHERE e.id IN (SELECT employee_id FROM public.order_member WHERE order_id=p_order_id) ORDER BY e.id FOR UPDATE;
  v_base := round(v_ord.paid_amount / v_member_count, 2);
  for v_member in
    select om.employee_id, e.grade, e.wallet_balance, om.commission_override_amount
    from public.order_member om
    join public.employee e on e.id = om.employee_id
    where om.order_id = p_order_id
    order by e.id
  loop
    v_commission := 0;
    v_snapshot_type := null;
    for v_item in select * from public.order_item where order_id = p_order_id loop
      v_item_base := v_item.paid_amount / v_member_count;
      if v_item.commission_type_snapshot = 'fixed' then
        v_commission := v_commission + round(v_item_base * coalesce(v_item.fixed_rate_snapshot, 0), 2);
      else
        select rate into v_grade_rate from public.grade_commission_rule where grade = v_member.grade limit 1;
        v_commission := v_commission + round(v_item_base * v_grade_rate, 2);
      end if;
      if v_member.commission_override_amount is not null then v_commission := v_member.commission_override_amount; end if;

      if v_snapshot_type is null then
        v_snapshot_type := v_item.commission_type_snapshot;
      elsif v_snapshot_type <> v_item.commission_type_snapshot then
        v_snapshot_type := null;
      end if;
    end loop;

    v_effective_rate := case when v_base > 0 then v_commission / v_base else 0 end;
    v_total_commission := v_total_commission + v_commission;
    update public.order_member set
      grade_snapshot = v_member.grade,
      base_amount = v_base,
      applied_rate = v_effective_rate,
      commission_amount = v_commission,
      commission_type_snapshot = v_snapshot_type
    where order_id = p_order_id and employee_id = v_member.employee_id;

    UPDATE public.employee SET wallet_balance=wallet_balance+v_commission WHERE id=v_member.employee_id RETURNING wallet_balance INTO v_new_emp_balance;
    insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
    values (v_member.employee_id, 'commission', v_commission, v_new_emp_balance, p_order_id, v_op, 'COMMISSION');
  end loop;

  v_real_income := v_ord.paid_amount;
  if v_ord.pay_method = 'wallet' then
    select * into v_cust from public.customer where id = v_ord.customer_id;
    select
      coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
      coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
    into v_principal_consume, v_bonus_consume
    from public.customer_wallet_ledger
    where order_id = p_order_id and type in ('consume_principal', 'consume_bonus');
    v_real_income := v_principal_consume;
    update public.customer set
      pending_balance = pending_balance - v_ord.paid_amount,
      total_consumption = total_consumption + v_ord.paid_amount
    where id = v_cust.id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_cust.id, 'consume_from_pending', v_ord.paid_amount, v_cust.principal_balance, v_cust.bonus_balance, p_order_id, v_op, 'PREPAID TO CONSUMPTION');
  else
    update public.customer set
      pending_balance = pending_balance - v_ord.paid_amount,
      total_consumption = total_consumption + v_ord.paid_amount
    where id = v_ord.customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (v_ord.customer_id, 'consume_from_pending', v_ord.paid_amount, 0, 0, p_order_id, v_op, 'PREPAID TO CONSUMPTION CASH');
  end if;

  v_gross_profit := v_real_income - v_total_commission;
  update public."order" set
    audit_status = 'approved',
    total_commission = v_total_commission,
    gross_profit = v_gross_profit,
    auditor_id = v_op,
    audited_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'message', 'OK',
    'total_commission', v_total_commission,
    'real_income', v_real_income,
    'gross_profit', v_gross_profit
  );
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='approve_commission' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:1295-1318
CREATE OR REPLACE FUNCTION public.batch_approve_orders(p_order_ids uuid[])
returns jsonb as $rpc$
declare
  v_id uuid;
  v_result jsonb;
  v_count int := 0;
BEGIN
 BEGIN
  IF p_order_ids IS NULL OR cardinality(p_order_ids)=0 OR cardinality(p_order_ids)>200 THEN RAISE EXCEPTION 'Batch requires 1 to 200 order IDs'; END IF;

  PERFORM recovery_20261007.assert_order_history_complete(x) FROM unnest(p_order_ids) x;

  IF auth.uid() IS NULL OR NOT coalesce(public.is_boss(),false) THEN
    RAISE EXCEPTION 'Active boss session required' USING ERRCODE='42501';
  END IF;

  if not is_boss() then RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '仅老板可以审核订单')->>'message') USING ERRCODE='P0001'; end if;
  foreach v_id in array p_order_ids loop
    if not exists (select 1 from "order" where id = v_id and status = 'completed' and audit_status = 'pending') then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '所选订单中存在不可审核的订单')->>'message') USING ERRCODE='P0001';
    end if;
    if not exists (select 1 from order_member where order_id = v_id) then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单必须先添加接单员工')->>'message') USING ERRCODE='P0001';
    end if;
  end loop;
  foreach v_id in array p_order_ids loop
    select approve_commission(v_id) into v_result;
    if coalesce(v_result->>'success', 'true') = 'false' then raise exception '%', coalesce(v_result->>'message', '订单审核失败'); end if;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('success', true, 'count', v_count);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$ language plpgsql security definer SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='batch_approve_orders' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:3606-3617
CREATE OR REPLACE FUNCTION public.batch_complete_orders(p_order_ids uuid[])
returns jsonb as $rpc$
declare
  v_count int;
BEGIN
 BEGIN
  IF p_order_ids IS NULL OR cardinality(p_order_ids)=0 OR cardinality(p_order_ids)>200 THEN RAISE EXCEPTION 'Batch requires 1 to 200 order IDs'; END IF;

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not is_staff() then RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限')->>'message') USING ERRCODE='P0001'; end if;
  update "order" set status = 'completed', updated_at = now()
  where id = any(p_order_ids) and status = 'in_progress';
  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'count', v_count);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$ language plpgsql security definer SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='batch_complete_orders' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:1270-1290
CREATE OR REPLACE FUNCTION public.batch_start_orders(p_order_ids uuid[])
returns jsonb as $rpc$
declare
  v_count int;
BEGIN
 BEGIN
  IF p_order_ids IS NULL OR cardinality(p_order_ids)=0 OR cardinality(p_order_ids)>200 THEN RAISE EXCEPTION 'Batch requires 1 to 200 order IDs'; END IF;

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not is_staff() then RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限')->>'message') USING ERRCODE='P0001'; end if;
  if exists (
    select 1 from "order" o
    where o.id = any(p_order_ids)
      and o.status = 'booking'
      and o.audit_status = 'pending'
      and not exists (select 1 from order_member om where om.order_id = o.id)
  ) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '所选订单中存在未添加员工的订单')->>'message') USING ERRCODE='P0001';
  end if;
  update "order" set status = 'in_progress', updated_at = now()
  where id = any(p_order_ids) and status = 'booking' and audit_status = 'pending';
  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'count', v_count);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$ language plpgsql security definer SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='batch_start_orders' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:2170-2219
CREATE OR REPLACE FUNCTION public.correct_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method,
  p_paid_amount numeric default null
)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_ord public."order"%rowtype;
  v_refund jsonb;
  v_new jsonb;
BEGIN
 BEGIN
  IF p_customer_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR p_pay_method IS NULL THEN RAISE EXCEPTION 'Customer, nonempty items and payment method required'; END IF;
  IF p_paid_amount IS NOT NULL AND p_paid_amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Finite paid amount required'; END IF;

  PERFORM recovery_20261007.assert_order_history_complete(p_order_id);

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not public.is_staff() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限')->>'message') USING ERRCODE='P0001';
  end if;

  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单不存在')->>'message') USING ERRCODE='P0001';
  end if;
  if v_ord.status = 'cancelled' or v_ord.audit_status = 'rejected' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '已取消/已拒绝的订单不能更正')->>'message') USING ERRCODE='P0001';
  end if;
  if v_ord.status = 'booking' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '待开始订单请使用编辑订单（原地修改）')->>'message') USING ERRCODE='P0001';
  end if;

  -- 按原支付方式退款冲正（已完成/已审核订单的“仅老板”保护由 refund_order 自带）
  v_refund := public.refund_order(
    p_order_id,
    case when v_ord.pay_method = 'wallet' then 'wallet' else 'cash' end
  );
  if (v_refund ->> 'success') <> 'true' then
    return v_refund;
  end if;

  -- 用正确信息重建订单；失败则整体回滚（原单退款也被撤销）
  v_new := public.create_order_multi(p_customer_id, p_items, p_employee_ids, p_pay_method, p_paid_amount);
  if (v_new ->> 'success') <> 'true' then
    raise exception '更正失败：%', coalesce(v_new ->> 'message', '重建订单失败');
  end if;
  return v_new;
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='correct_order' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: sql/vip_recharge_rules.sql:34-241
CREATE OR REPLACE FUNCTION public.create_order_multi(
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method,
  p_paid_amount numeric default null
)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_cust public.customer%rowtype;
  v_prod public.product%rowtype;
  v_line record;
  v_employee_id uuid;
  v_order_id uuid;
  v_order_no text;
  v_first_product_id uuid;
  v_last_item_id uuid;
  v_total_quantity int := 0;
  v_original numeric(12,2) := 0;
  v_calculated_paid numeric(12,2) := 0;
  v_paid numeric(12,2);
  v_discount numeric(12,2);
  v_rule_rate numeric(8,6);
  v_item_original numeric(12,2);
  v_item_paid numeric(12,2);
  v_item_rate numeric(8,6);
  v_inserted_paid numeric(12,2) := 0;
  v_rounding_delta numeric(12,2);
  v_total_liability numeric(12,2);
  v_principal_consume numeric(12,2) := 0;
  v_bonus_consume numeric(12,2) := 0;
  v_op uuid;
BEGIN
 BEGIN
  IF p_customer_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR p_pay_method IS NULL THEN RAISE EXCEPTION 'Customer, nonempty items and payment method required'; END IF;
  IF p_paid_amount IS NOT NULL AND p_paid_amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Finite paid amount required'; END IF;

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not public.is_staff() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限')->>'message') USING ERRCODE='P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单至少需要一个商品')->>'message') USING ERRCODE='P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '单张订单最多添加 50 种商品')->>'message') USING ERRCODE='P0001';
  end if;
  if coalesce(cardinality(p_employee_ids), 0) > 2 then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '员工最多选择两名（可 0/1/2 名）')->>'message') USING ERRCODE='P0001';
  end if;
  if cardinality(p_employee_ids) = 2 and p_employee_ids[1] = p_employee_ids[2] then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '不能重复选择同一名员工')->>'message') USING ERRCODE='P0001';
  end if;

  select * into v_cust from public.customer where id = p_customer_id and status = 'active' for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '客户不存在或已停用')->>'message') USING ERRCODE='P0001';
  end if;

  foreach v_employee_id in array coalesce(p_employee_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.employee where id = v_employee_id and status = 'active') then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '只能选择在职员工')->>'message') USING ERRCODE='P0001';
    end if;
  end loop;

  -- Validate products and calculate the server-authoritative total.
  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
  loop
    if v_line.product_id is null or v_line.quantity is null or v_line.quantity <= 0 then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '商品或数量无效')->>'message') USING ERRCODE='P0001';
    end if;
    select * into v_prod from public.product where id = v_line.product_id and status = 'on_sale' and deleted_at is null and price::text not in ('NaN','Infinity','-Infinity');
    if not found then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单中存在已下架或不存在的商品')->>'message') USING ERRCODE='P0001';
    end if;

    if v_first_product_id is null then v_first_product_id := v_prod.id; end if;
    v_total_quantity := v_total_quantity + v_line.quantity;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and (r.category = v_prod.category or r.category = '')))
      order by case when r.category_id is not null then 2 when r.category = v_prod.category then 1 else 0 end desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    v_original := v_original + v_item_original;
    v_calculated_paid := v_calculated_paid + round(v_item_original * v_item_rate, 2);
  end loop;

  v_original := round(v_original, 2);
  v_calculated_paid := round(v_calculated_paid, 2);
  v_paid := round(coalesce(p_paid_amount, v_calculated_paid), 2);
  if v_paid < 0 or v_paid > v_original then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '实付金额必须在 0 和订单原价之间')->>'message') USING ERRCODE='P0001';
  end if;
  v_discount := v_original - v_paid;

  if p_pay_method = 'wallet' then
    v_total_liability := v_cust.principal_balance + v_cust.bonus_balance;
    if v_total_liability < v_paid then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '客户钱包余额不足')->>'message') USING ERRCODE='P0001';
    end if;
    if v_total_liability > 0 then
      v_principal_consume := round(v_paid * (v_cust.principal_balance / v_total_liability), 2);
      v_bonus_consume := v_paid - v_principal_consume;
    end if;
  end if;

  v_op := auth.uid();
  v_order_no := public.gen_order_no();
  insert into public."order" (
    order_no, customer_id, product_id, customer_type_snapshot, vip_level_snapshot, pay_method,
    original_amount, paid_amount, discount_amount, pending_amount, quantity, operator_id
  ) values (
    v_order_no, p_customer_id, v_first_product_id, v_cust.type, v_cust.vip_level, p_pay_method,
    v_original, v_paid, v_discount, v_paid, v_total_quantity, v_op
  ) returning id into v_order_id;

  -- Store immutable product snapshots. Manual total overrides are distributed by original value.
  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
    order by x.product_id
  loop
    select * into v_prod from public.product where id = v_line.product_id;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and (r.category = v_prod.category or r.category = '')))
      order by case when r.category_id is not null then 2 when r.category = v_prod.category then 1 else 0 end desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    if p_paid_amount is null then
      v_item_paid := round(v_item_original * v_item_rate, 2);
    else
      v_item_paid := case when v_original > 0 then round(v_paid * v_item_original / v_original, 2) else 0 end;
    end if;

    insert into public.order_item (
      order_id, product_id, product_name_snapshot, category_id_snapshot, category_snapshot,
      unit_price, quantity, original_amount, discount_rate, discount_amount, paid_amount,
      commission_type_snapshot, fixed_rate_snapshot
    ) values (
      v_order_id, v_prod.id, v_prod.name, v_prod.category_id, v_prod.category,
      v_prod.price, v_line.quantity, v_item_original,
      case when v_item_original > 0 then v_item_paid / v_item_original else 1 end,
      v_item_original - v_item_paid, v_item_paid, v_prod.commission_type, v_prod.fixed_rate
    ) returning id into v_last_item_id;
    v_inserted_paid := v_inserted_paid + v_item_paid;
  end loop;

  v_rounding_delta := v_paid - v_inserted_paid;
  if v_rounding_delta <> 0 and v_last_item_id is not null then
    update public.order_item
    set paid_amount = paid_amount + v_rounding_delta,
        discount_amount = original_amount - (paid_amount + v_rounding_delta),
        discount_rate = case when original_amount > 0 then (paid_amount + v_rounding_delta) / original_amount else 1 end
    where id = v_last_item_id;
  end if;

  insert into public.order_member (order_id, employee_id)
  select v_order_id, unnest(coalesce(p_employee_ids, array[]::uuid[]))
  on conflict do nothing;

  if p_pay_method = 'wallet' then
    update public.customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = pending_balance + v_paid
    where id = p_customer_id;

    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_principal', -v_principal_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-本金');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_bonus', -v_bonus_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, v_order_id, v_op, '下单质押-赠送');
  else
    update public.customer set pending_balance = pending_balance + v_paid where id = p_customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'cash_received', v_paid, v_cust.principal_balance, v_cust.bonus_balance, v_order_id, v_op, '下单收取现金(预收)');
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_no', v_order_no,
    'original_amount', v_original,
    'paid_amount', v_paid,
    'discount', v_discount,
    'item_count', (select count(*) from public.order_item where order_id = v_order_id)
  );
exception
  when invalid_text_representation or data_exception then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '商品明细格式不正确')->>'message') USING ERRCODE='P0001';
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_order_multi' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:1551-1648
CREATE OR REPLACE FUNCTION public.delete_order(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer  as $rpc$
declare
  v_order "order"%rowtype;
  v_customer public.customer%rowtype;
  v_member record;
  v_employee public.employee%rowtype;
  v_principal_refund numeric(12,2) := 0;
  v_bonus_refund numeric(12,2) := 0;
  v_new_balance numeric(12,2);
  v_operator uuid := auth.uid();
  v_was_approved boolean := false;
  v_was_refunded boolean := false;
BEGIN
 BEGIN
  PERFORM recovery_20261007.assert_order_history_complete(p_order_id);

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单不存在')->>'message') USING ERRCODE='P0001';
  end if;
  PERFORM 1 FROM public.customer WHERE id=v_order.customer_id FOR UPDATE;
  PERFORM 1 FROM public.employee e WHERE e.id IN (SELECT employee_id FROM public.order_member WHERE order_id=p_order_id) ORDER BY e.id FOR UPDATE;

  if not (public.is_boss() or (public.is_manager() and v_order.operator_id = auth.uid())) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '仅老板或创建该订单的管理员可删除')->>'message') USING ERRCODE='P0001';
  end if;

  v_was_approved := v_order.audit_status = 'approved';
  v_was_refunded := v_order.status = 'cancelled' or v_order.audit_status = 'rejected';

  -- 1) 员工侧：已审核通过的订单，回滚已入账提成（员工钱包可转负，标记欠款）
  if v_was_approved then
    for v_member in
      select employee_id, commission_amount
      from public.order_member
      where order_id = p_order_id
    loop
      if coalesce(v_member.commission_amount, 0) = 0 then
        continue;
      end if;
      select * into v_employee from public.employee where id = v_member.employee_id for update;
      if not found then
        RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '参与员工不存在')->>'message') USING ERRCODE='P0001';
      end if;
      v_new_balance := v_employee.wallet_balance - v_member.commission_amount;
      update public.employee
      set wallet_balance = v_new_balance,
          is_debt = case when v_new_balance < 0 then true else is_debt end,
          is_bad_debt = case when status = 'resigned' and v_new_balance < 0 then true else is_bad_debt end
      where id = v_employee.id;
      insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
      values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_balance, p_order_id, v_operator, '删除订单-提成冲回');
    end loop;
  end if;

  -- 2) 客户侧：未退款订单恢复余额
  if not v_was_refunded then
    select * into v_customer from public.customer where id = v_order.customer_id for update;
    if not found then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单客户不存在')->>'message') USING ERRCODE='P0001';
    end if;

    if v_order.pay_method = 'wallet' then
      select
        coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
        coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal_refund, v_bonus_refund
      from public.customer_wallet_ledger
      where order_id = p_order_id and type in ('consume_principal', 'consume_bonus');

      update public.customer set
        principal_balance = principal_balance + v_principal_refund,
        bonus_balance = bonus_balance + v_bonus_refund
      where id = v_customer.id;
    end if;

    if v_was_approved then
      -- 已审核：预收已转为消费，冲回消费额（金额不足时保持 ≥0）
      update public.customer set
        total_consumption = greatest(total_consumption - v_order.paid_amount, 0)
      where id = v_customer.id;
    else
      -- 未审核：预收仍挂账，删除即释放该笔预收
      update public.customer set
        pending_balance = greatest(pending_balance - v_order.paid_amount, 0)
      where id = v_customer.id;
    end if;
  end if;

  -- 3) 删除审计日志（保留原状态，便于追溯）
  insert into public.order_delete_log(order_id, order_no, deleted_by, paid_amount, status, audit_status, reason)
    values (v_order.id, v_order.order_no, v_operator, v_order.paid_amount, v_order.status::text, v_order.audit_status::text, p_reason);

  -- 4) 物理删除（含该订单全部流水与参与员工）
  delete from public.customer_wallet_ledger where order_id = p_order_id;
  delete from public.wallet_ledger where order_id = p_order_id;
  delete from public.order_member where order_id = p_order_id;
  delete from public."order" where id = p_order_id;

  return jsonb_build_object('success', true, 'order_no', v_order.order_no);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='delete_order' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: sql/vip_recharge_rules.sql:246-484
CREATE OR REPLACE FUNCTION public.edit_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_employee_ids uuid[],
  p_pay_method pay_method,
  p_paid_amount numeric default null
)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_ord public."order"%rowtype;
  v_old_cust public.customer%rowtype;
  v_cust public.customer%rowtype;
  v_prod public.product%rowtype;
  v_line record;
  v_employee_id uuid;
  v_first_product_id uuid;
  v_last_item_id uuid;
  v_total_quantity int := 0;
  v_original numeric(12,2) := 0;
  v_calculated_paid numeric(12,2) := 0;
  v_paid numeric(12,2);
  v_discount numeric(12,2);
  v_rule_rate numeric(8,6);
  v_item_original numeric(12,2);
  v_item_paid numeric(12,2);
  v_item_rate numeric(8,6);
  v_inserted_paid numeric(12,2) := 0;
  v_rounding_delta numeric(12,2);
  v_total_liability numeric(12,2);
  v_principal_consume numeric(12,2) := 0;
  v_bonus_consume numeric(12,2) := 0;
  v_rev_principal numeric(12,2) := 0;
  v_rev_bonus numeric(12,2) := 0;
  v_op uuid;
BEGIN
 BEGIN
  IF p_customer_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR p_pay_method IS NULL THEN RAISE EXCEPTION 'Customer, nonempty items and payment method required'; END IF;
  IF p_paid_amount IS NOT NULL AND p_paid_amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Finite paid amount required'; END IF;

  PERFORM recovery_20261007.assert_order_history_complete(p_order_id);

  IF auth.uid() IS NULL OR NOT coalesce(public.is_boss(),false) THEN
    RAISE EXCEPTION 'Active boss session required' USING ERRCODE='42501';
  END IF;

  if not public.is_boss() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限：仅老板可编辑订单')->>'message') USING ERRCODE='P0001';
  end if;

  select * into v_ord from public."order" where id = p_order_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单不存在')->>'message') USING ERRCODE='P0001';
  end if;
  if v_ord.status <> 'booking' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '仅待开始状态的订单可编辑')->>'message') USING ERRCODE='P0001';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单至少需要一个商品')->>'message') USING ERRCODE='P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '单张订单最多添加 50 种商品')->>'message') USING ERRCODE='P0001';
  end if;
  if coalesce(cardinality(p_employee_ids), 0) > 2 then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '员工最多选择两名（可 0/1/2 名）')->>'message') USING ERRCODE='P0001';
  end if;
  if cardinality(p_employee_ids) = 2 and p_employee_ids[1] = p_employee_ids[2] then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '不能重复选择同一名员工')->>'message') USING ERRCODE='P0001';
  end if;

  IF v_ord.audit_status <> 'pending' THEN RAISE EXCEPTION 'Only pending-audit orders can be edited'; END IF;
  PERFORM 1 FROM public.customer WHERE id IN (p_customer_id,v_ord.customer_id) ORDER BY id FOR UPDATE;
  select * into v_cust from public.customer where id = p_customer_id and status = 'active' for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '客户不存在或已停用')->>'message') USING ERRCODE='P0001';
  end if;

  foreach v_employee_id in array coalesce(p_employee_ids, array[]::uuid[]) loop
    if not exists (select 1 from public.employee where id = v_employee_id and status = 'active') then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '只能选择在职员工')->>'message') USING ERRCODE='P0001';
    end if;
  end loop;

  -- Validate item identities and amounts before any reversal.
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity int) LEFT JOIN public.product p ON p.id=x.product_id
    WHERE x.product_id IS NULL OR x.quantity IS NULL OR x.quantity<=0 OR p.id IS NULL OR p.status<>'on_sale' OR p.deleted_at IS NOT NULL OR p.price::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Invalid, unavailable or hidden product'; END IF;
  IF p_paid_amount IS NOT NULL AND (p_paid_amount<0 OR p_paid_amount>(SELECT coalesce(sum(p.price*x.quantity),0) FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity int) JOIN public.product p ON p.id=x.product_id)) THEN RAISE EXCEPTION 'Paid amount outside order original total'; END IF;
  -- 冲正原订单的钱包/待结算影响（按该订单实际流水精确冲正）
  if v_ord.customer_id is not null then
    select * into v_old_cust from public.customer where id = v_ord.customer_id for update;
    if found then
      select coalesce(sum(abs(amount)), 0) into v_rev_principal
      from public.customer_wallet_ledger
      where order_id = p_order_id and type = 'consume_principal';
      select coalesce(sum(abs(amount)), 0) into v_rev_bonus
      from public.customer_wallet_ledger
      where order_id = p_order_id and type = 'consume_bonus';
      update public.customer set
        principal_balance = principal_balance + v_rev_principal,
        bonus_balance = bonus_balance + v_rev_bonus,
        pending_balance = greatest(0, pending_balance - v_ord.paid_amount)
      where id = v_ord.customer_id;
    end if;
  end if;

  -- Preserve prior payment state privately, then replace only active booking payment rows.
  INSERT INTO recovery_20261007.order_edit_ledger_archive(order_id,edited_by,old_order,payment_rows)
  SELECT p_order_id,auth.uid(),to_jsonb(v_ord),coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
  FROM public.customer_wallet_ledger l WHERE l.order_id=p_order_id AND l.type IN ('consume_principal','consume_bonus','cash_received');
  DELETE FROM public.customer_wallet_ledger WHERE order_id=p_order_id AND type IN ('consume_principal','consume_bonus','cash_received');
  -- Same-customer edits must use balances after the old payment was returned.
  SELECT * INTO v_cust FROM public.customer WHERE id=p_customer_id FOR UPDATE;
  delete from public.order_item where order_id = p_order_id;
  delete from public.order_member where order_id = p_order_id;

  -- 重算（与 create_order_multi 口径一致）
  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
  loop
    if v_line.product_id is null or v_line.quantity is null or v_line.quantity <= 0 then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '商品或数量无效')->>'message') USING ERRCODE='P0001';
    end if;
    select * into v_prod from public.product where id = v_line.product_id and status = 'on_sale' and deleted_at is null and price::text not in ('NaN','Infinity','-Infinity');
    if not found then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单中存在已下架或不存在的商品')->>'message') USING ERRCODE='P0001';
    end if;
    if v_first_product_id is null then v_first_product_id := v_prod.id; end if;
    v_total_quantity := v_total_quantity + v_line.quantity;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and (r.category = v_prod.category or r.category = '')))
      order by case when r.category_id is not null then 2 when r.category = v_prod.category then 1 else 0 end desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    v_original := v_original + v_item_original;
    v_calculated_paid := v_calculated_paid + round(v_item_original * v_item_rate, 2);
  end loop;

  v_original := round(v_original, 2);
  v_paid := round(coalesce(p_paid_amount, v_calculated_paid), 2);
  if v_paid < 0 or v_paid > v_original then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '实付金额需在 0 与订单原价之间')->>'message') USING ERRCODE='P0001';
  end if;
  v_discount := v_original - v_paid;
  v_discount := v_original - v_paid;

  if p_pay_method = 'wallet' then
    v_total_liability := v_cust.principal_balance + v_cust.bonus_balance;
    if v_total_liability < v_paid then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '客户钱包余额不足')->>'message') USING ERRCODE='P0001';
    end if;
    if v_total_liability > 0 then
      v_principal_consume := round(v_paid * (v_cust.principal_balance / v_total_liability), 2);
      v_bonus_consume := v_paid - v_principal_consume;
    end if;
  end if;

  v_op := auth.uid();
  update public."order" set
    customer_id = p_customer_id,
    product_id = v_first_product_id,
    customer_type_snapshot = v_cust.type,
    vip_level_snapshot = v_cust.vip_level,
    pay_method = p_pay_method,
    original_amount = v_original,
    paid_amount = v_paid,
    discount_amount = v_discount,
    pending_amount = v_paid,
    quantity = v_total_quantity,
    operator_id = v_op
  where id = p_order_id;

  for v_line in
    select x.product_id, sum(x.quantity)::int as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity int)
    group by x.product_id
    order by x.product_id
  loop
    select * into v_prod from public.product where id = v_line.product_id;
    v_item_original := round(v_prod.price * v_line.quantity, 2);
    v_item_rate := 1;
    if v_cust.type = 'vip' then
      select r.discount into v_rule_rate
      from public.vip_discount_rule r
      where r.vip_level = v_cust.vip_level
        and (r.category_id = v_prod.category_id or (r.category_id is null and (r.category = v_prod.category or r.category = '')))
      order by case when r.category_id is not null then 2 when r.category = v_prod.category then 1 else 0 end desc
      limit 1;
      if found then v_item_rate := v_rule_rate; end if;
    end if;
    v_item_paid := case
      when p_paid_amount is null then round(v_item_original * v_item_rate, 2)
      when v_original > 0 then round(v_paid * v_item_original / v_original, 2)
      else 0 end;

    insert into public.order_item (
      order_id, product_id, product_name_snapshot, category_id_snapshot, category_snapshot,
      unit_price, quantity, original_amount, discount_rate, discount_amount, paid_amount,
      commission_type_snapshot, fixed_rate_snapshot
    ) values (
      p_order_id, v_prod.id, v_prod.name, v_prod.category_id, v_prod.category,
      v_prod.price, v_line.quantity, v_item_original,
      case when v_item_original > 0 then v_item_paid / v_item_original else 1 end,
      v_item_original - v_item_paid, v_item_paid, v_prod.commission_type, v_prod.fixed_rate
    ) returning id into v_last_item_id;
    v_inserted_paid := v_inserted_paid + v_item_paid;
  end loop;

  v_rounding_delta := v_paid - v_inserted_paid;
  if v_rounding_delta <> 0 and v_last_item_id is not null then
    update public.order_item
    set paid_amount = paid_amount + v_rounding_delta,
        discount_amount = original_amount - (paid_amount + v_rounding_delta),
        discount_rate = case when original_amount > 0 then (paid_amount + v_rounding_delta) / original_amount else 1 end
    where id = v_last_item_id;
  end if;

  insert into public.order_member (order_id, employee_id)
  select p_order_id, unnest(coalesce(p_employee_ids, array[]::uuid[]))
  on conflict do nothing;

  if p_pay_method = 'wallet' then
    update public.customer set
      principal_balance = principal_balance - v_principal_consume,
      bonus_balance = bonus_balance - v_bonus_consume,
      pending_balance = pending_balance + v_paid
    where id = p_customer_id;

    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_principal', -v_principal_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, p_order_id, v_op, '编辑订单-质押本金');
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'consume_bonus', -v_bonus_consume,
      v_cust.principal_balance - v_principal_consume, v_cust.bonus_balance - v_bonus_consume, p_order_id, v_op, '编辑订单-质押赠送');
  else
    update public.customer set pending_balance = pending_balance + v_paid where id = p_customer_id;
    insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
    values (p_customer_id, 'cash_received', v_paid, v_cust.principal_balance, v_cust.bonus_balance, p_order_id, v_op, '编辑订单-现金预收');
  end if;

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'original_amount', v_original,
    'paid_amount', v_paid,
    'discount', v_discount,
    'pending_amount', v_paid
  );
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='edit_order' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:3863-3879
CREATE OR REPLACE FUNCTION public.hide_product(p_product_id uuid)
returns jsonb
language plpgsql security definer  as $rpc$
declare
  v_name text;
BEGIN
 BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_boss(),false) THEN
    RAISE EXCEPTION 'Active boss session required' USING ERRCODE='42501';
  END IF;

  if not public.is_boss() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限：仅老板可隐藏商品')->>'message') USING ERRCODE='P0001';
  end if;
  select name into v_name from public.product where id = p_product_id;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '商品不存在')->>'message') USING ERRCODE='P0001';
  end if;
  update public.product set deleted_at = now() where id = p_product_id;
  return jsonb_build_object('success', true, 'name', v_name);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='hide_product' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:585-646
CREATE OR REPLACE FUNCTION public.payout_salary(p_items jsonb, p_batch_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $rpc$
declare
  v_payout_id uuid;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_emp employee%rowtype;
  v_balance_before numeric(12,2);
  v_balance_after numeric(12,2);
  v_count int := 0;
  v_op uuid;
BEGIN
 BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>1000 OR p_batch_no IS NULL OR btrim(p_batch_no)='' THEN RAISE EXCEPTION 'Nonempty payout items and batch number required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(employee_id uuid,amount numeric) WHERE employee_id IS NULL OR amount IS NULL OR amount<=0 OR amount::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Positive finite payout amounts required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(employee_id uuid,amount numeric) GROUP BY employee_id HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate employee in payout'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payout:'||p_batch_no,0));
  IF EXISTS(SELECT 1 FROM public.payout WHERE batch_no=p_batch_no) THEN RAISE EXCEPTION 'Payout batch number already exists'; END IF;

  IF auth.uid() IS NULL OR NOT coalesce(public.is_boss(),false) THEN
    RAISE EXCEPTION 'Active boss session required' USING ERRCODE='42501';
  END IF;

  if not is_boss() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限：仅老板可发放工资')->>'message') USING ERRCODE='P0001';
  end if;
  v_op := auth.uid();

  -- 创建批次
  insert into payout (batch_no, operator_id, status, total_amount, detail_count)
  values (p_batch_no, v_op, 'processing', 0, 0)
  returning id into v_payout_id;

  -- 遍历发放明细
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_count := v_count + 1;
    select * into v_emp from employee where id = (v_item->>'employee_id')::uuid for update;
    if not found then
      raise exception '员工 % 不存在', v_item->>'employee_id';
    end if;

    v_balance_before := v_emp.wallet_balance;
    v_balance_after := v_balance_before - ((v_item->>'amount')::numeric);

    -- 余额不足校验（非欠款员工）
    if v_emp.is_debt = false and v_balance_after < 0 then
      raise exception '员工 % 余额不足（当前 %，欲发 %）', v_emp.name, v_balance_before, (v_item->>'amount')::numeric;
    end if;

    -- 扣钱包
    update employee set wallet_balance = v_balance_after where id = v_emp.id;

    -- 写员工流水
    insert into wallet_ledger (employee_id, type, amount, balance_after, payout_id, operator_id, remark)
    values (v_emp.id, 'payout', -((v_item->>'amount')::numeric), v_balance_after, v_payout_id, v_op, '工资发放 ' || p_batch_no);

    -- 写发放明细
    insert into payout_detail (payout_id, employee_id, amount, balance_before, balance_after)
    values (v_payout_id, v_emp.id, (v_item->>'amount')::numeric, v_balance_before, v_balance_after);

    v_total := v_total + ((v_item->>'amount')::numeric);
  end loop;

  -- 更新批次汇总
  update payout set total_amount = v_total, detail_count = v_count, status = 'completed'
  where id = v_payout_id;

  return jsonb_build_object('success', true, 'batch_id', v_payout_id, 'total_amount', v_total, 'detail_count', v_count);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='payout_salary' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:2830-2877
CREATE OR REPLACE FUNCTION public.recharge_custom(
  p_customer_id uuid,
  p_amount numeric,
  p_bonus numeric,
  p_remark text,
  p_proof_path text
)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_cust public.customer%rowtype;
  v_new_principal numeric(12,2);
  v_new_bonus numeric(12,2);
  v_op uuid := auth.uid();
BEGIN
 BEGIN
  IF p_amount::text IN ('NaN','Infinity','-Infinity') OR p_bonus::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Finite recharge amounts required'; END IF;
  IF p_proof_path IS NOT NULL AND NOT public.is_proof_path_valid(p_proof_path) THEN RAISE EXCEPTION 'Invalid payment proof reference'; END IF;

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not public.is_staff() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限：仅老板或管理员可自定义充值')->>'message') USING ERRCODE='P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '充值金额必须大于0')->>'message') USING ERRCODE='P0001';
  end if;
  if p_bonus is null or p_bonus < 0 then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '赠送金额不能为负')->>'message') USING ERRCODE='P0001';
  end if;

  select * into v_cust from public.customer where id = p_customer_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '客户不存在')->>'message') USING ERRCODE='P0001';
  end if;

  v_new_principal := v_cust.principal_balance + p_amount;
  v_new_bonus := v_cust.bonus_balance + p_bonus;
  update public.customer
  set principal_balance = v_new_principal, bonus_balance = v_new_bonus
  where id = p_customer_id;

  insert into public.customer_wallet_ledger (
    customer_id, type, amount, principal_after, bonus_after, operator_id, proof_path, remark
  ) values
    (p_customer_id, 'recharge_principal', p_amount, v_new_principal, v_cust.bonus_balance, v_op, p_proof_path, coalesce(p_remark, '自定义充值本金')),
    (p_customer_id, 'recharge_bonus', p_bonus, v_new_principal, v_new_bonus, v_op, p_proof_path, coalesce(p_remark, '自定义充值赠送'));

  return jsonb_build_object('success', true, 'new_balance', v_new_principal + v_new_bonus);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='recharge_custom' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:3133-3351
CREATE OR REPLACE FUNCTION public.refund_order(
  p_order_id uuid,
  p_refund_method text
)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_order public."order"%rowtype;
  v_customer public.customer%rowtype;
  v_reversal jsonb;
  v_operator uuid := auth.uid();
  v_principal_refund numeric(12,2) := 0;
  v_bonus_refund numeric(12,2) := 0;
  v_wallet_refund numeric(12,2) := 0;
  v_pending_before numeric(12,2);
  v_was_approved boolean := false;
BEGIN
 BEGIN
  PERFORM recovery_20261007.assert_order_history_complete(p_order_id);

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not public.is_staff() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Only authenticated business staff can refund orders')->>'message') USING ERRCODE='P0001';
  end if;

  if p_refund_method is null or p_refund_method not in ('wallet', 'cash') then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Unsupported refund method')->>'message') USING ERRCODE='P0001';
  end if;

  select *
  into v_order
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Order not found')->>'message') USING ERRCODE='P0001';
  end if;

  if v_order.status = 'cancelled' or v_order.audit_status = 'rejected' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Order has already been refunded or cancelled')->>'message') USING ERRCODE='P0001';
  end if;

  if v_order.customer_id is null then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Order has no customer account')->>'message') USING ERRCODE='P0001';
  end if;

  -- Lock and validate the customer before any approved-order reversal. A
  -- returned JSON error does not roll back writes already made in this
  -- function, so this check must happen before reject_order_audit.
  select *
  into v_customer
  from public.customer
  where id = v_order.customer_id
  for update;

  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Order customer not found')->>'message') USING ERRCODE='P0001';
  end if;

  if v_order.audit_status = 'approved' then
    v_was_approved := true;
    if not public.is_boss() then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Only the boss can refund an approved order')->>'message') USING ERRCODE='P0001';
    end if;

    if v_order.status <> 'completed' then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Only completed approved orders can be refunded')->>'message') USING ERRCODE='P0001';
    end if;

    -- Validate the data needed by the later refund step before reversing the
    -- approval. A returned JSON error does not roll back writes in a function.
    if p_refund_method = 'wallet' and v_order.pay_method = 'wallet' then
      select
        coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
        coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal_refund, v_bonus_refund
      from public.customer_wallet_ledger
      where order_id = p_order_id
        and type in ('consume_principal', 'consume_bonus');

      if v_principal_refund + v_bonus_refund <> v_order.paid_amount then
        RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Wallet refund ledger does not match the order amount')->>'message') USING ERRCODE='P0001';
      end if;
    end if;

    -- reject_order_audit updates commission rows one by one. Detect a broken
    -- employee reference before invoking it, so the later refund cannot leave
    -- an approved order partially reversed.
    if exists (
      select 1
      from public.order_member om
      left join public.employee e on e.id = om.employee_id
      where om.order_id = p_order_id
        and coalesce(om.commission_amount, 0) <> 0
        and e.id is null
    ) then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Order commission data is incomplete')->>'message') USING ERRCODE='P0001';
    end if;

    v_reversal := public.reject_order_audit(p_order_id);
    if coalesce(v_reversal->>'success', 'false') <> 'true' then
      return v_reversal;
    end if;

    select *
    into v_order
    from public."order"
    where id = p_order_id
    for update;
  elsif v_order.audit_status <> 'pending' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Only pending-audit or approved orders can be refunded')->>'message') USING ERRCODE='P0001';
  end if;

  if v_order.status not in ('booking', 'in_progress', 'completed') then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'This order status cannot be refunded')->>'message') USING ERRCODE='P0001';
  end if;

  -- Before approval, return the payment by the original method. This keeps a
  -- wallet hold from being converted into a cash refund accidentally.
  if v_was_approved = false then
    if p_refund_method <> v_order.pay_method::text then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Pending-audit orders must be refunded by the original payment method')->>'message') USING ERRCODE='P0001';
    end if;
  end if;

  v_pending_before := v_customer.pending_balance;
  if v_was_approved = false then
    if v_pending_before < v_order.paid_amount then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Customer pending balance is smaller than the order amount')->>'message') USING ERRCODE='P0001';
    end if;
  end if;

  if p_refund_method = 'wallet' then
    if v_order.pay_method = 'wallet' then
      select
        coalesce(sum(case when type = 'consume_principal' then -amount else 0 end), 0),
        coalesce(sum(case when type = 'consume_bonus' then -amount else 0 end), 0)
      into v_principal_refund, v_bonus_refund
      from public.customer_wallet_ledger
      where order_id = p_order_id
        and type in ('consume_principal', 'consume_bonus');

      v_wallet_refund := v_principal_refund + v_bonus_refund;
      if v_wallet_refund <> v_order.paid_amount then
        RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'Wallet refund ledger does not match the order amount')->>'message') USING ERRCODE='P0001';
      end if;
    else
      -- A cash order refunded to wallet is credited back to principal.
      v_principal_refund := v_order.paid_amount;
      v_wallet_refund := v_order.paid_amount;
    end if;

    update public.customer
    set principal_balance = principal_balance + v_principal_refund,
        bonus_balance = bonus_balance + v_bonus_refund,
        pending_balance = pending_balance - v_order.paid_amount
    where id = v_customer.id;

    insert into public.customer_wallet_ledger (
      customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark
    )
    select
      v_customer.id,
      'refund',
      v_wallet_refund,
      v_customer.principal_balance + v_principal_refund,
      v_customer.bonus_balance + v_bonus_refund,
      p_order_id,
      v_operator,
      'Order refund before final settlement';
  else
    update public.customer
    set pending_balance = pending_balance - v_order.paid_amount
    where id = v_customer.id;

    insert into public.customer_wallet_ledger (
      customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark
    )
    values (
      v_customer.id,
      'cash_refund',
      -v_order.paid_amount,
      v_customer.principal_balance,
      v_customer.bonus_balance,
      p_order_id,
      v_operator,
      'Order cash refund'
    );
  end if;

  -- No commission is payable after a refund. Keep the override fields for
  -- audit history, but clear the computed amount used by deletion guards.
  update public.order_member
  set grade_snapshot = null,
      base_amount = null,
      applied_rate = null,
      commission_amount = 0,
      commission_type_snapshot = null
  where order_id = p_order_id;

  update public."order"
  set status = 'cancelled',
      audit_status = 'rejected',
      pending_amount = 0,
      total_commission = 0,
      gross_profit = 0,
      auditor_id = null,
      audited_at = null,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'refund_method', p_refund_method,
    'refund_amount', v_order.paid_amount
  );
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='refund_order' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: sql/fix_consume_from_pending_amount.sql:164-246
CREATE OR REPLACE FUNCTION public.reject_order_audit(p_order_id uuid)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_order public."order"%rowtype;
  v_customer public.customer%rowtype;
  v_member record;
  v_employee public.employee%rowtype;
  v_new_balance numeric(12,2);
  v_operator uuid := auth.uid();
BEGIN
 BEGIN
  PERFORM recovery_20261007.assert_order_history_complete(p_order_id);

  IF auth.uid() IS NULL OR NOT coalesce(public.is_boss(),false) THEN
    RAISE EXCEPTION 'Active boss session required' USING ERRCODE='42501';
  END IF;

  if not public.is_boss() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'NO PERMISSION')->>'message') USING ERRCODE='P0001';
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'ORDER NOT FOUND')->>'message') USING ERRCODE='P0001';
  end if;
  if v_order.status <> 'completed' or v_order.audit_status <> 'approved' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'ONLY COMPLETED+APPROVED')->>'message') USING ERRCODE='P0001';
  end if;

  select * into v_customer from public.customer where id = v_order.customer_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'CUSTOMER NOT FOUND')->>'message') USING ERRCODE='P0001';
  end if;

  PERFORM 1 FROM public.employee e WHERE e.id IN (SELECT employee_id FROM public.order_member WHERE order_id=p_order_id) ORDER BY e.id FOR UPDATE;
  for v_member in
    select employee_id, commission_amount, commission_override_amount
    from public.order_member
    where order_id = p_order_id
  loop
    if coalesce(v_member.commission_amount, 0) = 0 then
      continue;
    end if;

    select * into v_employee from public.employee where id = v_member.employee_id for update;
    if not found then
      RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', 'EMPLOYEE NOT FOUND')->>'message') USING ERRCODE='P0001';
    end if;

    v_new_balance := v_employee.wallet_balance - v_member.commission_amount;
    update public.employee
    set wallet_balance = v_new_balance,
        is_debt = case when v_new_balance < 0 then true else is_debt end,
        is_bad_debt = case when status = 'resigned' and v_new_balance < 0 then true else is_bad_debt end
    where id = v_employee.id;

    insert into public.wallet_ledger (employee_id, type, amount, balance_after, order_id, operator_id, remark)
    values (v_employee.id, 'refund_deduct', -v_member.commission_amount, v_new_balance, p_order_id, v_operator, 'REVERSE COMMISSION');
  end loop;

  update public.customer
  set pending_balance = pending_balance + v_order.paid_amount,
      total_consumption = greatest(total_consumption - v_order.paid_amount, 0)
  where id = v_customer.id;
  insert into public.customer_wallet_ledger (customer_id, type, amount, principal_after, bonus_after, order_id, operator_id, remark)
  values (v_customer.id, 'consume_from_pending', -v_order.paid_amount, v_customer.principal_balance, v_customer.bonus_balance, p_order_id, v_operator, 'CONSUMPTION BACK TO PREPAID');

  update public.order_member
  set grade_snapshot = null,
      base_amount = null,
      applied_rate = null,
      commission_amount = coalesce(commission_override_amount, 0),
      commission_type_snapshot = null
  where order_id = p_order_id;

  update public."order"
  set audit_status = 'pending',
      total_commission = 0,
      gross_profit = 0,
      auditor_id = null,
      audited_at = null,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success', true, 'message', 'BACK TO PENDING');
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reject_order_audit' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:3800-3847
CREATE OR REPLACE FUNCTION public.remove_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer  as $rpc$
declare
  v_status order_status;
  v_path text;
  v_paths text[];
BEGIN
 BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not public.is_staff() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限')->>'message') USING ERRCODE='P0001';
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is null then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '凭证路径为空')->>'message') USING ERRCODE='P0001';
  end if;
  if not public.is_proof_path_valid(v_path) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '凭证文件不存在')->>'message') USING ERRCODE='P0001';
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单不存在')->>'message') USING ERRCODE='P0001';
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证')->>'message') USING ERRCODE='P0001';
  end if;

  select coalesce(proof_paths, array[]::text[]) into v_paths
  from public."order"
  where id = p_order_id;

  v_paths := array_remove(v_paths, v_path);

  update public."order"
  set proof_paths = v_paths,
      proof_path = case
        when coalesce(array_length(v_paths, 1), 0) > 0 then v_paths[array_length(v_paths, 1)]
        else null
      end
  where id = p_order_id;

  return jsonb_build_object('success', true);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='remove_order_proof' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:3881-3897
CREATE OR REPLACE FUNCTION public.restore_product(p_product_id uuid)
returns jsonb
language plpgsql security definer  as $rpc$
declare
  v_name text;
BEGIN
 BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_boss(),false) THEN
    RAISE EXCEPTION 'Active boss session required' USING ERRCODE='42501';
  END IF;

  if not public.is_boss() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限：仅老板可恢复商品')->>'message') USING ERRCODE='P0001';
  end if;
  select name into v_name from public.product where id = p_product_id;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '商品不存在')->>'message') USING ERRCODE='P0001';
  end if;
  update public.product set deleted_at = null where id = p_product_id;
  return jsonb_build_object('success', true, 'name', v_name);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='restore_product' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:2891-2956
CREATE OR REPLACE FUNCTION public.set_pending_order_commissions(p_order_id uuid, p_commissions jsonb)
returns jsonb
language plpgsql
security definer

as $rpc$
declare
  v_order public."order"%rowtype;
  v_operator uuid := auth.uid();
  v_count int;
BEGIN
 BEGIN
  IF p_commissions IS NULL OR jsonb_typeof(p_commissions)<>'array' THEN RAISE EXCEPTION 'Commission array required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_commissions) x(employee_id uuid,amount numeric) WHERE amount::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Commission override must be finite'; END IF;

  PERFORM recovery_20261007.assert_order_history_complete(p_order_id);

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not public.is_staff() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限')->>'message') USING ERRCODE='P0001';
  end if;
  if jsonb_typeof(p_commissions) <> 'array' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '提成数据格式不正确')->>'message') USING ERRCODE='P0001';
  end if;

  select * into v_order from public."order" where id = p_order_id for update;
  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单不存在')->>'message') USING ERRCODE='P0001';
  end if;
  if v_order.status <> 'completed' or v_order.audit_status <> 'pending' then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '仅已完成且待审核的订单可以临时调整提成')->>'message') USING ERRCODE='P0001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    where item.employee_id is null or item.amount < 0
  ) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '提成员工或金额不正确')->>'message') USING ERRCODE='P0001';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    group by item.employee_id
    having count(*) > 1
  ) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '同一员工只能提交一次')->>'message') USING ERRCODE='P0001';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
    left join public.order_member member on member.order_id = p_order_id and member.employee_id = item.employee_id
    where member.employee_id is null
  ) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '存在不属于该订单的员工')->>'message') USING ERRCODE='P0001';
  end if;

  with changes as (
    select employee_id, amount
    from jsonb_to_recordset(p_commissions) as item(employee_id uuid, amount numeric)
  )
  update public.order_member member
  set commission_override_amount = case when changes.amount is null then null else round(changes.amount, 2) end,
      commission_override_by = case when changes.amount is null then null else v_operator end,
      commission_override_at = case when changes.amount is null then null else now() end,
      commission_amount = coalesce(round(changes.amount, 2), 0)
  from changes
  where member.order_id = p_order_id and member.employee_id = changes.employee_id;

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'count', v_count);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='set_pending_order_commissions' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: sql/top_products_by_orders.sql:10-25
CREATE OR REPLACE FUNCTION public.top_products_by_orders(p_limit int default 12)
returns table(
  product_id uuid, name text, category text, category_id uuid, price numeric,
  commission_type text, fixed_rate numeric, status text, order_count bigint
)
language sql stable security definer  as $rpc$
  select p.id, p.name, p.category, p.category_id, p.price,
         p.commission_type::text, p.fixed_rate, p.status::text,
         count(oi.id) as order_count
  from public.order_item oi
  join public.product p on p.id = oi.product_id
  where auth.uid() is not null and coalesce(public.is_staff(),false) and p.status = 'on_sale' and p.deleted_at is null
  group by p.id
  order by order_count desc
  limit greatest(1, least(coalesce(p_limit, 12), 50))
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='top_products_by_orders' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:3722-3755
CREATE OR REPLACE FUNCTION public.update_order_proof(p_order_id uuid, p_proof_path text)
returns jsonb
language plpgsql security definer  as $rpc$
declare
  v_status order_status;
  v_path text;
BEGIN
 BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  if not public.is_staff() then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '无权限')->>'message') USING ERRCODE='P0001';
  end if;
  v_path := nullif(trim(p_proof_path), '');
  if v_path is not null and not public.is_proof_path_valid(v_path) then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '凭证文件不存在')->>'message') USING ERRCODE='P0001';
  end if;

  select status into v_status
  from public."order"
  where id = p_order_id
  for update;

  if not found then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单不存在')->>'message') USING ERRCODE='P0001';
  end if;
  if v_status not in ('booking', 'in_progress', 'completed') then
    RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '订单开始后才能编辑支付凭证')->>'message') USING ERRCODE='P0001';
  end if;

  update public."order"
  set proof_path = v_path
  where id = p_order_id;

  return jsonb_build_object('success', true);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$  SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='update_order_proof' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

-- Source: ALL_IN_ONE.sql:1341-1348
CREATE OR REPLACE FUNCTION public.update_self_avatar(p_avatar_path text)
returns jsonb as $rpc$
BEGIN
 BEGIN
  IF p_avatar_path IS NOT NULL AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='avatars' AND o.name=p_avatar_path AND (storage.foldername(o.name))[1]=auth.uid()::text) THEN RAISE EXCEPTION 'Avatar must be an existing file owned by this user'; END IF;

  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
    RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;

  update users set avatar_path = p_avatar_path where id = auth.uid();
  if not found then RAISE EXCEPTION '%', (jsonb_build_object('success', false, 'message', '用户资料不存在')->>'message') USING ERRCODE='P0001'; end if;
  return jsonb_build_object('success', true);
END;
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('success',false,'message',SQLERRM);
END;
$rpc$ language plpgsql security definer SET search_path = pg_catalog, public, extensions, pg_temp;

DO $revoke$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='update_self_avatar' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $revoke$;

CREATE OR REPLACE TRIGGER set_updated_at_employee BEFORE UPDATE ON public.employee FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE OR REPLACE TRIGGER set_updated_at_product BEFORE UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE OR REPLACE TRIGGER set_updated_at_customer BEFORE UPDATE ON public.customer FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE OR REPLACE TRIGGER set_updated_at_order BEFORE UPDATE ON public."order" FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE OR REPLACE TRIGGER customer_auto_upgrade_vip AFTER UPDATE OF total_consumption ON public.customer FOR EACH ROW EXECUTE FUNCTION public.auto_upgrade_customer_vip();
CREATE OR REPLACE TRIGGER sync_product_category_name BEFORE INSERT OR UPDATE OF category_id ON public.product FOR EACH ROW EXECUTE FUNCTION public.sync_product_category_name();
CREATE OR REPLACE TRIGGER sync_discount_category_name BEFORE INSERT OR UPDATE OF category_id ON public.vip_discount_rule FOR EACH ROW EXECUTE FUNCTION public.sync_discount_category_name();
CREATE OR REPLACE TRIGGER todo_item_touch BEFORE UPDATE ON public.todo_item FOR EACH ROW EXECUTE FUNCTION public.touch_collaboration_record();
CREATE OR REPLACE TRIGGER announcement_touch BEFORE UPDATE ON public.announcement FOR EACH ROW EXECUTE FUNCTION public.touch_collaboration_record();
CREATE OR REPLACE TRIGGER note_touch BEFORE UPDATE ON public.note FOR EACH ROW EXECUTE FUNCTION public.touch_collaboration_record();
CREATE OR REPLACE TRIGGER todo_item_notify_mentions AFTER INSERT OR UPDATE OF mentioned_user_ids ON public.todo_item FOR EACH ROW EXECUTE FUNCTION public.notify_todo_mentions();

CREATE OR REPLACE FUNCTION public.guard_direct_order_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $guard$
BEGIN
 IF current_user='authenticated' THEN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501'; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.audit_status IS DISTINCT FROM 'pending'::public.audit_status OR NEW.audit_status IS DISTINCT FROM 'pending'::public.audit_status
     OR NOT ((OLD.status='booking' AND NEW.status='in_progress') OR (OLD.status='in_progress' AND NEW.status='completed')) THEN
    RAISE EXCEPTION 'Direct order status updates only allow pending booking to in_progress to completed';
  END IF;
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.guard_direct_order_status() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER order_direct_status_guard BEFORE UPDATE OF status ON public."order" FOR EACH ROW EXECUTE FUNCTION public.guard_direct_order_status();

DO $verify$ BEGIN
 IF EXISTS(SELECT 1 FROM _rpc_role_helpers_before b WHERE pg_get_functiondef(b.oid) IS DISTINCT FROM b.definition) THEN RAISE EXCEPTION 'Role helper definition unexpectedly changed'; END IF;
 IF EXISTS(SELECT 1 FROM public."order" o JOIN recovery_20261007.business_row_provenance r ON r.table_name='order' AND r.record_id=o.id WHERE o.quantity IS NOT NULL) THEN RAISE EXCEPTION 'Recovered order quantity must remain unknown'; END IF;
END $verify$;
COMMIT;
