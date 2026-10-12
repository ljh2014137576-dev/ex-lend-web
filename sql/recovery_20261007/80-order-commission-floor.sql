-- Runtime DDL archive, not a Supabase CLI migration. Existing financial rows are not rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $preflight$ BEGIN
 IF md5(pg_get_functiondef('public.create_order_multi(uuid,jsonb,uuid[],pay_method,numeric)'::regprocedure)) NOT IN ('ef8bcaae23de5481d3dc470ca957621e','87cad38e1f9bba7c0aab567d2c8d81cc') THEN RAISE EXCEPTION 'Order function changed since reviewed snapshot'; END IF;
 IF md5(pg_get_functiondef('public.edit_order(uuid,uuid,jsonb,uuid[],pay_method,numeric)'::regprocedure)) NOT IN ('7f7206f655988e121b0b958868022605','78163a78dffc6805696bb0cceef8d0ae') THEN RAISE EXCEPTION 'Order function changed since reviewed snapshot'; END IF;
END $preflight$;
-- Validate only newly supplied or changed configuration. A table CHECK, even
-- NOT VALID, would also reject unrelated updates to grandfathered low-rate rows.
CREATE OR REPLACE FUNCTION recovery_20261007.guard_product_commission_floor()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $product_floor$
BEGIN
 IF TG_OP='UPDATE' AND NEW.commission_type IS NOT DISTINCT FROM OLD.commission_type AND NEW.fixed_rate IS NOT DISTINCT FROM OLD.fixed_rate THEN RETURN NEW; END IF;
 IF NEW.commission_type IS NULL OR (NEW.commission_type='fixed' AND (NEW.fixed_rate IS NULL OR NEW.fixed_rate::text IN('NaN','Infinity','-Infinity') OR NEW.fixed_rate<0.8 OR NEW.fixed_rate>1)) THEN
  RAISE EXCEPTION '固定提成比例必须在80%%到100%%之间，且不能为空' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END;
$product_floor$;
CREATE OR REPLACE FUNCTION recovery_20261007.guard_grade_commission_floor()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $grade_floor$
BEGIN
 IF TG_OP='UPDATE' AND NEW.grade IS NOT DISTINCT FROM OLD.grade AND NEW.rate IS NOT DISTINCT FROM OLD.rate THEN RETURN NEW; END IF;
 IF NEW.rate IS NULL OR NEW.rate::text IN('NaN','Infinity','-Infinity') OR NEW.rate<0.8 OR NEW.rate>1 THEN
  RAISE EXCEPTION '等级提成比例必须在80%%到100%%之间，且不能为空' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END;
$grade_floor$;
CREATE OR REPLACE FUNCTION recovery_20261007.guard_order_item_commission_floor()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $item_floor$
BEGIN
 IF TG_OP='UPDATE' AND NEW.commission_type_snapshot IS NOT DISTINCT FROM OLD.commission_type_snapshot AND NEW.fixed_rate_snapshot IS NOT DISTINCT FROM OLD.fixed_rate_snapshot THEN RETURN NEW; END IF;
 IF NEW.commission_type_snapshot IS NULL OR (NEW.commission_type_snapshot='fixed' AND (NEW.fixed_rate_snapshot IS NULL OR NEW.fixed_rate_snapshot::text IN('NaN','Infinity','-Infinity') OR NEW.fixed_rate_snapshot<0.8 OR NEW.fixed_rate_snapshot>1)) THEN
  RAISE EXCEPTION '新订单商品的固定提成比例不能低于80%%，且必须在80%%到100%%之间' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END;
$item_floor$;

CREATE OR REPLACE FUNCTION recovery_20261007.assert_order_creation_commission_floor(p_items jsonb,p_employee_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $creation_floor$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501'; END IF;
 -- The outer create/edit RPC already holds the customer lock. Stable employee,
 -- product and rule locks ensure validation and stored snapshots see one state.
 PERFORM e.id FROM public.employee e WHERE e.id=ANY(coalesce(p_employee_ids,ARRAY[]::uuid[])) ORDER BY e.id FOR SHARE;
 IF EXISTS(SELECT 1 FROM unnest(coalesce(p_employee_ids,ARRAY[]::uuid[])) chosen(id) LEFT JOIN public.employee e ON e.id=chosen.id WHERE e.id IS NULL OR e.status IS DISTINCT FROM 'active'::public.employee_status) THEN RAISE EXCEPTION '只能选择在职员工' USING ERRCODE='P0001'; END IF;
 PERFORM p.id FROM public.product p WHERE p.id IN(SELECT x.product_id FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity int)) ORDER BY p.id FOR SHARE;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity int) LEFT JOIN public.product p ON p.id=x.product_id WHERE p.id IS NULL OR p.status<>'on_sale' OR p.deleted_at IS NOT NULL OR p.commission_type IS NULL OR (p.commission_type='fixed' AND (p.fixed_rate IS NULL OR p.fixed_rate::text IN('NaN','Infinity','-Infinity') OR p.fixed_rate<0.8 OR p.fixed_rate>1))) THEN
  RAISE EXCEPTION '商品不可用或固定提成比例低于80%%，请先修正商品提成配置' USING ERRCODE='P0001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.product p WHERE p.id IN(SELECT x.product_id FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity int)) AND p.commission_type='grade') THEN
  PERFORM g.grade FROM public.grade_commission_rule g WHERE g.grade IN(SELECT e.grade FROM public.employee e WHERE e.id=ANY(coalesce(p_employee_ids,ARRAY[]::uuid[]))) ORDER BY g.grade FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.employee e LEFT JOIN public.grade_commission_rule g ON g.grade=e.grade WHERE e.id=ANY(coalesce(p_employee_ids,ARRAY[]::uuid[])) AND (g.id IS NULL OR g.rate IS NULL OR g.rate::text IN('NaN','Infinity','-Infinity') OR g.rate<0.8 OR g.rate>1)) THEN
   RAISE EXCEPTION '所选员工等级提成未配置或低于80%%，无法创建该等级提成订单' USING ERRCODE='P0001';
  END IF;
 END IF;
END;
$creation_floor$;

REVOKE ALL ON FUNCTION recovery_20261007.guard_product_commission_floor(),recovery_20261007.guard_grade_commission_floor(),recovery_20261007.guard_order_item_commission_floor(),recovery_20261007.assert_order_creation_commission_floor(jsonb,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS commission_floor_product_write ON public.product;
CREATE TRIGGER commission_floor_product_write BEFORE INSERT OR UPDATE OF commission_type,fixed_rate ON public.product FOR EACH ROW EXECUTE FUNCTION recovery_20261007.guard_product_commission_floor();
DROP TRIGGER IF EXISTS commission_floor_grade_write ON public.grade_commission_rule;
CREATE TRIGGER commission_floor_grade_write BEFORE INSERT OR UPDATE OF grade,rate ON public.grade_commission_rule FOR EACH ROW EXECUTE FUNCTION recovery_20261007.guard_grade_commission_floor();
DROP TRIGGER IF EXISTS commission_floor_item_snapshot ON public.order_item;
CREATE TRIGGER commission_floor_item_snapshot BEFORE INSERT OR UPDATE OF commission_type_snapshot,fixed_rate_snapshot ON public.order_item FOR EACH ROW EXECUTE FUNCTION recovery_20261007.guard_order_item_commission_floor();

CREATE OR REPLACE FUNCTION public.create_order_multi(p_customer_id uuid, p_items jsonb, p_employee_ids uuid[], p_pay_method pay_method, p_paid_amount numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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

  -- Lock the authoritative products/employees/rules through snapshot creation.
  PERFORM recovery_20261007.assert_order_creation_commission_floor(p_items,p_employee_ids);

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
$function$;
CREATE OR REPLACE FUNCTION public.edit_order(p_order_id uuid, p_customer_id uuid, p_items jsonb, p_employee_ids uuid[], p_pay_method pay_method, p_paid_amount numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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

  -- Lock the authoritative products/employees/rules through snapshot creation.
  PERFORM recovery_20261007.assert_order_creation_commission_floor(p_items,p_employee_ids);

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
$function$;
COMMIT;
