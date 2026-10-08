-- Non-financial status transitions only. No real order is changed by installation.
-- Preserve compatibility with an already-open frontend's UPDATE(status).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
 IF to_regprocedure('public.is_staff()') IS NULL THEN RAISE EXCEPTION 'Hardened active staff helper required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.order'::regclass
   AND tgname='order_direct_status_guard' AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'Reviewed order status trigger required';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.order'::regclass AND NOT tgisinternal
   AND tgenabled<>'D' AND tgname NOT IN ('order_direct_status_guard','set_updated_at_order')) THEN
  RAISE EXCEPTION 'Unexpected order trigger: review non-financial transition safety first';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.guard_direct_order_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $guard$
BEGIN
 IF current_user='authenticated' THEN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
   RAISE EXCEPTION 'Active staff session required' USING ERRCODE='42501';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at']) THEN
   RAISE EXCEPTION 'Direct status update cannot change financial or other order fields' USING ERRCODE='42501';
  END IF;
  IF OLD.audit_status IS NULL OR OLD.audit_status NOT IN ('pending','approved')
     OR NEW.audit_status IS NULL OR NEW.audit_status NOT IN ('pending','approved') THEN
   RAISE EXCEPTION 'Only pending or approved non-cancelled orders can advance status';
  END IF;
  IF OLD.status='cancelled' THEN RAISE EXCEPTION 'Cancelled orders cannot advance status'; END IF;
  -- Returning NULL cancels a same-value UPDATE, including updated_at changes.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  IF ((OLD.status='booking' AND NEW.status IN ('in_progress','completed'))
       OR (OLD.status='in_progress' AND NEW.status='completed')) IS NOT TRUE THEN
   RAISE EXCEPTION 'Order status only supports forward start/completion';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_member WHERE order_id=OLD.id) THEN
   RAISE EXCEPTION '请先为订单添加至少一名员工';
  END IF;
 END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.guard_direct_order_status() FROM PUBLIC,anon,authenticated;

ALTER POLICY be_order_status_update_staff ON public."order"
USING (public.is_staff() AND audit_status IN ('pending','approved')
       AND status IN ('booking','in_progress','completed'))
WITH CHECK (public.is_staff() AND audit_status IN ('pending','approved')
            AND status IN ('in_progress','completed'));
-- Existing column-level UPDATE(status) is retained; no other column is granted.

CREATE OR REPLACE FUNCTION public.set_order_status(p_order_id uuid,p_status public.order_status)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $status$
DECLARE v_order public."order"%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
  RETURN jsonb_build_object('success',false,'count',0,'code','FORBIDDEN','message','无权限：仅启用的老板或管理员可操作','updated_ids','[]'::jsonb);
 END IF;
 IF p_order_id IS NULL OR p_status IS NULL OR p_status NOT IN ('in_progress','completed') THEN
  RETURN jsonb_build_object('success',false,'count',0,'code','INVALID_ARGUMENT','message','仅支持开始或完成订单','updated_ids','[]'::jsonb);
 END IF;
 SELECT * INTO v_order FROM public."order" WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('success',false,'count',0,'code','NOT_FOUND','message','订单不存在或已删除','updated_ids','[]'::jsonb);
 END IF;
 IF v_order.audit_status IS NULL OR v_order.audit_status NOT IN ('pending','approved') OR v_order.status='cancelled' THEN
  RETURN jsonb_build_object('success',false,'count',0,'code','ORDER_CLOSED','message','已取消、已驳回或审核状态未知的订单不能推进状态','updated_ids','[]'::jsonb);
 END IF;
 IF v_order.status=p_status THEN
  RETURN jsonb_build_object('success',true,'count',0,'order_id',p_order_id,'status',v_order.status,
   'unchanged',true,'updated_ids','[]'::jsonb,'skipped','[]'::jsonb);
 END IF;
 IF ((v_order.status='booking' AND p_status IN ('in_progress','completed'))
      OR (v_order.status='in_progress' AND p_status='completed')) IS NOT TRUE THEN
  RETURN jsonb_build_object('success',false,'count',0,'code','INVALID_TRANSITION','message','订单状态只支持向前开始或完成，不支持回退','updated_ids','[]'::jsonb);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.order_member WHERE order_id=p_order_id) THEN
  RETURN jsonb_build_object('success',false,'count',0,'code','NEED_EMPLOYEE','message','请先为订单添加至少一名员工','updated_ids','[]'::jsonb);
 END IF;
 UPDATE public."order" SET status=p_status,updated_at=now() WHERE id=p_order_id;
 RETURN jsonb_build_object('success',true,'count',1,'order_id',p_order_id,'status',p_status,
  'updated_ids',jsonb_build_array(p_order_id),'skipped','[]'::jsonb);
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('success',false,'count',0,'code','STATUS_UPDATE_FAILED','message',SQLERRM,'sqlstate',SQLSTATE,'updated_ids','[]'::jsonb);
END;
$status$;

CREATE OR REPLACE FUNCTION public._transition_order_status_batch(p_order_ids uuid[],p_status public.order_status)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $batch$
DECLARE v_id uuid;v_ids uuid[];v_result jsonb;v_updated uuid[]:='{}';v_unchanged uuid[]:='{}';v_skipped jsonb:='[]';
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(),false) THEN
  RETURN jsonb_build_object('success',false,'count',0,'code','FORBIDDEN','message','无权限：仅启用的老板或管理员可操作','updated_ids','[]'::jsonb,'skipped','[]'::jsonb);
 END IF;
 IF p_order_ids IS NULL OR cardinality(p_order_ids)=0 OR cardinality(p_order_ids)>200
    OR array_position(p_order_ids,NULL) IS NOT NULL OR p_status IS NULL OR p_status NOT IN ('in_progress','completed') THEN
  RETURN jsonb_build_object('success',false,'count',0,'code','INVALID_ARGUMENT','message','请选择 1 到 200 个有效订单','updated_ids','[]'::jsonb,'skipped','[]'::jsonb);
 END IF;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_order_ids) AS x;
 -- All batch calls acquire order locks in the same UUID order.
 PERFORM o.id FROM public."order" AS o WHERE o.id=ANY(v_ids) ORDER BY o.id FOR UPDATE;
 FOREACH v_id IN ARRAY v_ids LOOP
  v_result:=public.set_order_status(v_id,p_status);
  IF (v_result->>'success')::boolean THEN
   IF (v_result->>'count')::integer=1 THEN v_updated:=array_append(v_updated,v_id);
   ELSE v_unchanged:=array_append(v_unchanged,v_id); END IF;
  ELSE
   v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object('order_id',v_id,'code',v_result->>'code','message',v_result->>'message'));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('success',cardinality(v_updated)>0 OR cardinality(v_unchanged)>0,
  'count',cardinality(v_updated),'updated_ids',to_jsonb(v_updated),'unchanged_ids',to_jsonb(v_unchanged),
  'skipped',v_skipped,'requested_count',cardinality(p_order_ids),'distinct_count',cardinality(v_ids),
  'code',CASE WHEN cardinality(v_updated)=0 AND cardinality(v_unchanged)=0 THEN 'NO_ORDERS_UPDATED' ELSE NULL END,
  'message',CASE WHEN cardinality(v_updated)=0 AND cardinality(v_unchanged)=0 THEN '没有可推进状态的订单，请查看跳过原因' ELSE NULL END);
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('success',false,'count',0,'code','STATUS_UPDATE_FAILED','message',SQLERRM,'sqlstate',SQLSTATE,'updated_ids','[]'::jsonb,'skipped','[]'::jsonb);
END;
$batch$;

CREATE OR REPLACE FUNCTION public.batch_start_orders(p_order_ids uuid[])
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT public._transition_order_status_batch(p_order_ids,'in_progress'::public.order_status);
$fn$;
CREATE OR REPLACE FUNCTION public.batch_complete_orders(p_order_ids uuid[])
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT public._transition_order_status_batch(p_order_ids,'completed'::public.order_status);
$fn$;

REVOKE ALL ON FUNCTION public.set_order_status(uuid,public.order_status),
 public._transition_order_status_batch(uuid[],public.order_status),
 public.batch_start_orders(uuid[]),public.batch_complete_orders(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_status(uuid,public.order_status),
 public.batch_start_orders(uuid[]),public.batch_complete_orders(uuid[]) TO authenticated;

DO $check$
BEGIN
 IF has_function_privilege('authenticated','public._transition_order_status_batch(uuid[],public.order_status)','EXECUTE')
 OR has_function_privilege('anon','public.set_order_status(uuid,public.order_status)','EXECUTE') THEN
  RAISE EXCEPTION 'Unexpected order state helper privileges';
 END IF;
 IF has_column_privilege('authenticated','public.order','paid_amount','UPDATE')
 OR has_column_privilege('authenticated','public.order','audit_status','UPDATE')
 OR has_column_privilege('authenticated','public.users','password_hash','SELECT,INSERT,UPDATE')
 OR has_schema_privilege('authenticated','recovery_20261007','USAGE') THEN
  RAISE EXCEPTION 'Financial/password/private-schema browser boundary changed';
 END IF;
END;
$check$;
COMMIT;
