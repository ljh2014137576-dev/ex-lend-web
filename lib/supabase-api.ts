import { supabase } from "@/lib/supabase";
import { normalizeOrderResult, type OrderActionResult } from "@/lib/order-actions";
import type {
  Customer,
  Employee,
  Product,
  ProductCategory,
  Order,
  OrderItem,
  OrderMember,
  Todo,
  Announcement,
  Note,
  NotificationItem,
  GradeRule,
  VipDiscountRule,
  VipUpgradeRule,
  RechargePackage,
  DeleteLog,
} from "@/lib/mock-data";

import type { WalletLedgerRow, CustomerLedgerRow, PayoutRow, PayoutDetailRow, PayoutItem, PayoutMutationResult, PayoutLookupResult } from "@/lib/ledger-types";
export type { WalletLedgerRow, CustomerLedgerRow, PayoutRow, PayoutDetailRow, PayoutItem, PayoutReceipt, PayoutApiError, PayoutMutationResult, PayoutLookupResult } from "@/lib/ledger-types";
import { readAllLedgerPages, ledgerCursorFilter, type CursorRow } from "@/lib/ledger-pagination";
import { ledgerNumber } from "@/lib/ledger";
import { requireCommissionRate } from "@/lib/commission-policy";
import { readPayoutReceipt, validatePayoutRequest, payoutProofObjectPath, PAYOUT_UUID } from "@/lib/ledger-payout";

// ============================================================
// 真实数据层（线上 Supabase 表结构，与 lib/mock-data 形状对齐）
// 用法：useRealData(() => api.customers(), MOCK_CUSTOMERS)
// ============================================================

export async function apiCustomers(): Promise<Customer[] | null> {
  const { data } = await supabase
    .from("customer")
    .select("id, name, phone, type, vip_level, principal_balance, bonus_balance, pending_balance, total_consumption, status")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? "—",
    type: r.type === "vip" ? "vip" : "normal",
    vipLevel: r.vip_level ?? 0,
    principal: Number(r.principal_balance ?? 0),
    bonus: Number(r.bonus_balance ?? 0),
    pending: Number(r.pending_balance ?? 0),
    total: Number(r.total_consumption ?? 0),
    status: r.status === "blocked" ? "blocked" : "active",
  }));
}

export interface CurrentProfile {
  name: string;
  avatarPath: string | null;
}

export async function apiSystemLogo(): Promise<string | null> {
  const { data } = await supabase
    .from("system_setting")
    .select("value")
    .eq("key", "system_logo_path")
    .maybeSingle();
  return data?.value ?? null;
}

export async function apiCurrentProfile(userId: string): Promise<CurrentProfile | null> {
  const { data } = await supabase.from("users").select("name, avatar_path").eq("id", userId).maybeSingle();
  if (!data) return null;
  return { name: data.name ?? "", avatarPath: data.avatar_path ?? null };
}

export async function apiUpdateMyName(userId: string, name: string) {
  return supabase.from("users").update({ name }).eq("id", userId).select("id, name").single();
}

export async function uploadAvatar(file: File, userId: string): Promise<string> {
  const ext = file.name.split(".").pop() || "png";
  const path = userId + "/avatar-" + Date.now() + "." + ext;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}

export function rpcUpdateSelfAvatar(avatarPath: string) {
  return supabase.rpc("update_self_avatar", { p_avatar_path: avatarPath });
}

export async function apiUpdateEmployee(
  id: string,
  fields: { name?: string; alipay_account?: string | null; bank_card?: string | null; grade?: number; status?: string },
) {
  return supabase.from("employee").update(fields).eq("id", id);
}

export async function apiEmployees(): Promise<Employee[] | null> {
  const { data } = await supabase
    .from("employee")
    .select("id, name, nickname, alipay_account, bank_card, grade, status, wallet_balance, is_debt")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    name: r.nickname || r.name,
    realName: r.name ?? "",
    alipay: r.alipay_account ?? "",
    bankCard: r.bank_card ?? "",
    grade: r.grade ?? 1,
    status: r.status === "resigned" ? "resigned" : "active",
    wallet: Number(r.wallet_balance ?? 0),
    isDebt: !!r.is_debt,
  }));
}

export async function apiProducts(): Promise<Product[] | null> {
  // 商品列表默认不显示已隐藏（deleted_at 非 NULL）的商品
  let { data } = await supabase
    .from("product")
    .select("id, name, category, category_id, price, commission_type, fixed_rate, status, deleted_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  // 兼容：线上库 deleted_at 列尚未迁移时，上述查询会因该列不存在而报错（data 为 null），
  // 此时退回不带该过滤的同一查询，保证迁移前商品列表仍可用
  if (!data) {
    const { data: legacy } = await supabase
      .from("product")
      .select("id, name, category, category_id, price, commission_type, fixed_rate, status")
      .order("created_at", { ascending: false });
    // 断言：两条查询的返回结构一致（仅有无 deleted_at 的差异），此处类型以带 deleted_at 的为准
    data = legacy as typeof data;
  }
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category ?? "",
    categoryId: r.category_id ?? null,
    price: Number(r.price ?? 0),
    commissionType: r.commission_type === "grade" ? "grade" : "fixed",
    fixedRate: r.fixed_rate != null ? Number(r.fixed_rate) : null,
    status: r.status === "off_shelf" ? "off_shelf" : "on_sale",
    deletedAt: r.deleted_at ?? null,
  }));
}

export async function apiDeletedProducts(): Promise<Product[] | null> {
  const { data } = await supabase
    .from("product")
    .select("id, name, category, category_id, price, commission_type, fixed_rate, status, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category ?? "",
    categoryId: r.category_id ?? null,
    price: Number(r.price ?? 0),
    commissionType: r.commission_type === "grade" ? "grade" : "fixed",
    fixedRate: r.fixed_rate != null ? Number(r.fixed_rate) : null,
    status: r.status === "off_shelf" ? "off_shelf" : "on_sale",
    deletedAt: r.deleted_at ?? null,
  }));
}

// 收银台「常用商品目录」：后端 RPC top_products_by_orders 按历史下单次数返回 Top N 在售商品
export interface TopProductRow {
  productId: string;
  name: string;
  category: string;
  categoryId: string | null;
  price: number;
  commissionType: "fixed" | "grade";
  fixedRate: number | null;
  status: "on_sale" | "off_shelf";
  orderCount: number;
}

// RPC 返回行的原始形状（PostgREST 不做类型推导，需显式标注）
interface TopProductsRawRow {
  product_id: string;
  name: string;
  category: string | null;
  category_id: string | null;
  price: number;
  commission_type: string;
  fixed_rate: number | null;
  status: string;
  order_count: number;
}

export async function apiTopProducts(): Promise<Product[] | null> {
  const { data } = await supabase.rpc("top_products_by_orders", { p_limit: 12 });
  if (!data) return null;
  const rows: TopProductRow[] = (data as TopProductsRawRow[]).map((r) => ({
    productId: r.product_id,
    name: r.name,
    category: r.category ?? "",
    categoryId: r.category_id ?? null,
    price: Number(r.price ?? 0),
    commissionType: r.commission_type === "grade" ? "grade" : "fixed",
    fixedRate: r.fixed_rate != null ? Number(r.fixed_rate) : null,
    status: r.status === "off_shelf" ? "off_shelf" : "on_sale",
    orderCount: Number(r.order_count ?? 0),
  }));
  // 转成 Product 形状，供页面 useResource<Product> 与购物车直接使用（orderCount 仅用于后端排序）
  return rows.map((r) => ({
    id: r.productId,
    name: r.name,
    category: r.category,
    categoryId: r.categoryId,
    price: r.price,
    commissionType: r.commissionType,
    fixedRate: r.fixedRate,
    status: r.status,
  }));
}

export async function apiCategories(): Promise<ProductCategory[] | null> {
  const { data } = await supabase
    .from("product_category")
    .select("id, name, description, status")
    .order("created_at", { ascending: true });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    status: r.status === "disabled" ? "disabled" : "enabled",
  }));
}

export async function apiOrders(): Promise<Order[] | null> {
  const data = await readAllLedgerPages(async (cursor, pageSize) => {
    let query = supabase
    .from("order")
    .select("id, order_no, customer_id, customer_type_snapshot, vip_level_snapshot, pay_method, original_amount, paid_amount, discount_amount, total_commission, gross_profit, status, audit_status, operator_id, pending_amount, created_at, customer(name), creator:operator_id(name), order_member(id, employee_id, grade_snapshot, base_amount, applied_rate, commission_amount, commission_override_amount, employee(nickname, name))")
    .order("created_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).limit(pageSize);
    if (cursor) query = query.or(ledgerCursorFilter(cursor));
    const { data, error } = await query;
    return { data, error };
  });
  return data.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    customerId: r.customer_id ?? null,
    customerName: (r.customer as { name?: string } | null)?.name ?? "—",
    customerType: (r.customer_type_snapshot === "vip" ? "vip" : "normal") as "vip" | "normal",
    vipLevel: r.vip_level_snapshot ?? 0,
    payMethod: r.pay_method === "cash" ? "cash" : "wallet",
    original: Number(r.original_amount ?? 0),
    paid: Number(r.paid_amount ?? 0),
    discount: Number(r.discount_amount ?? 0),
    pending: Number(r.pending_amount ?? 0),
    commission: Number(r.total_commission ?? 0),
    grossProfit: ledgerNumber(r.gross_profit),
    status: r.status as Order["status"],
    auditStatus: r.audit_status as Order["auditStatus"],
    operator: (r.creator as { name?: string } | null)?.name ?? "—",
    operatorId: r.operator_id ?? null,
    createdAt: r.created_at ? new Date(r.created_at).toLocaleString("zh-CN") : "—",
    createdAtRaw: r.created_at ?? "",
    proofPath: null,
    items: [],
    members: (r.order_member ?? []).map((m) => ({
      employeeId: m.employee_id,
      name: (m.employee as { nickname?: string; name?: string } | null)?.nickname || (m.employee as { name?: string } | null)?.name || "员工",
      realName: (m.employee as { name?: string } | null)?.name ?? undefined,
      grade: m.grade_snapshot ?? 1,
      base: Number(m.base_amount ?? 0),
      rate: Number(m.applied_rate ?? 0),
      commission: Number(m.commission_amount ?? 0),
      recordedCommission: ledgerNumber(m.commission_amount),
      override: m.commission_override_amount == null ? null : Number(m.commission_override_amount),
    })),
  }));
}

export async function apiOrderDetail(id: string, throwOnError = false): Promise<{ order: Order; items: OrderItem[]; members: OrderMember[] } | null> {
  const { data, error } = await supabase
    .from("order")
    .select(
      "id, order_no, customer_id, customer_type_snapshot, vip_level_snapshot, pay_method, original_amount, paid_amount, discount_amount, total_commission, gross_profit, status, audit_status, operator_id, proof_path, proof_paths, created_at, customer(name), order_item(id, product_id, product_name_snapshot, category_snapshot, unit_price, quantity, original_amount, discount_amount, paid_amount, commission_type_snapshot), order_member(id, employee_id, grade_snapshot, base_amount, applied_rate, commission_amount, commission_override_amount, employee(nickname, name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error && throwOnError) throw new Error(error.message);
  if (!data) return null;
  const items = (data.order_item ?? []).map((it) => ({
    productId: it.product_id ?? null,
    productName: it.product_name_snapshot ?? "—",
    category: it.category_snapshot ?? "",
    unitPrice: Number(it.unit_price ?? 0),
    quantity: it.quantity ?? 1,
    original: Number(it.original_amount ?? 0),
    discount: Number(it.discount_amount ?? 0),
    paid: Number(it.paid_amount ?? 0),
    commissionType: (it.commission_type_snapshot === "grade" ? "grade" : "fixed") as "fixed" | "grade",
  }));
  const members = (data.order_member ?? []).map((m) => ({
    employeeId: m.employee_id,
    name: (m.employee as { nickname?: string; name?: string } | null)?.nickname || (m.employee as { name?: string } | null)?.name || "员工",
      realName: (m.employee as { name?: string } | null)?.name ?? undefined,
    grade: m.grade_snapshot ?? 1,
    base: Number(m.base_amount ?? 0),
    rate: Number(m.applied_rate ?? 0),
    commission: Number(m.commission_amount ?? 0),
      recordedCommission: ledgerNumber(m.commission_amount),
    override: m.commission_override_amount == null ? null : Number(m.commission_override_amount),
  }));
  const order: Order = {
    id: data.id,
    orderNo: data.order_no,
    customerId: data.customer_id ?? null,
    customerName: (data.customer as { name?: string } | null)?.name ?? "—",
    customerType: (data.customer_type_snapshot === "vip" ? "vip" : "normal") as "vip" | "normal",
    vipLevel: data.vip_level_snapshot ?? 0,
    payMethod: data.pay_method === "cash" ? "cash" : "wallet",
    original: Number(data.original_amount ?? 0),
    paid: Number(data.paid_amount ?? 0),
    discount: Number(data.discount_amount ?? 0),
    commission: Number(data.total_commission ?? 0),
    grossProfit: ledgerNumber(data.gross_profit),
    status: data.status as Order["status"],
    auditStatus: data.audit_status as Order["auditStatus"],
    operator: "—",
    operatorId: data.operator_id ?? null,
    createdAt: data.created_at ? new Date(data.created_at).toLocaleString("zh-CN") : "—",
    createdAtRaw: data.created_at ?? "",
    proofPath: data.proof_path ?? null,
    proofPaths: Array.isArray(data.proof_paths) ? data.proof_paths : data.proof_path ? [data.proof_path] : [],
    items,
    members,
  };
  return { order, items, members };
}

async function orderRpc(name: string, params: Record<string, unknown>): Promise<OrderActionResult> {
  try {
    const { data, error } = await supabase.rpc(name, params);
    return normalizeOrderResult(data, error);
  } catch (error) {
    return normalizeOrderResult(null, error);
  }
}

// RPC（写入类，真实会话下调用）
export const rpc = {
  createOrderMulti: (params: {
    p_customer_id: string;
    p_items: { product_id: string; quantity: number }[];
    p_employee_ids: string[];
    p_pay_method: "wallet" | "cash";
    p_paid_amount: number | null;
  }) => orderRpc("create_order_multi", params),
};
// RPC：写入类（真实会话下调用，错误返回 {success:false,message}）
export function rpcCorrectOrder(params: {
  p_order_id: string;
  p_customer_id: string;
  p_items: { product_id: string; quantity: number }[];
  p_employee_ids: string[];
  p_pay_method: "wallet" | "cash";
  p_paid_amount?: number | null;
}) {
  return orderRpc("correct_order", params);
}

export function rpcEditOrder(params: {
  p_order_id: string;
  p_customer_id: string;
  p_items: { product_id: string; quantity: number }[];
  p_employee_ids: string[];
  p_pay_method: "wallet" | "cash";
  p_paid_amount?: number | null;
}) {
  return orderRpc("edit_order", params);
}

export async function rpcCreateOrderMulti(params: {
  p_customer_id: string;
  p_items: { product_id: string; quantity: number }[];
  p_employee_ids: string[];
  p_pay_method: "wallet" | "cash";
  p_paid_amount: number | null;
}) {
  return orderRpc("create_order_multi", params);
}

export function rpcAdjustOrderPrice(p_order_id: string, p_new_paid: number, p_reason?: string | null) {
  return orderRpc("adjust_order_price", { p_order_id, p_new_paid, p_reason: p_reason ?? null });
}

export function rpcDeleteOrder(p_order_id: string, p_reason?: string | null) {
  return orderRpc("delete_order", { p_order_id, p_reason: p_reason ?? null });
}

export function rpcApproveCommission(p_order_id: string) {
  return orderRpc("approve_commission", { p_order_id });
}

export function rpcRefundOrder(p_order_id: string, p_refund_method: "wallet" | "cash") {
  return orderRpc("refund_order", { p_order_id, p_refund_method });
}

export function rpcRechargeCustom(params: {
  p_customer_id: string;
  p_amount: number;
  p_bonus: number;
  p_remark: string;
  p_proof_path: string | null;
}) {
  return supabase.rpc("recharge_custom", params);
}

export async function rpcPayoutSalary(p_items: PayoutItem[], p_batch_no: string): Promise<PayoutMutationResult> {
  let request: ReturnType<typeof validatePayoutRequest>;
  try { request = validatePayoutRequest(p_items, p_batch_no); }
  catch (error) { return { data: null, error: { code: "INVALID_REQUEST", message: error instanceof Error ? error.message : String(error), uncertain: false } }; }
  try {
    const { data, error } = await supabase.rpc("payout_salary", { p_items: request.items, p_batch_no });
    if (error) return { data: null, error: { code: error.code || "TRANSPORT_ERROR", message: error.message, uncertain: true } };
    if (data?.success === false && typeof data.code === "string") {
      // Only these explicit rejections certify this request made no money writes.
      const definitive = ["FORBIDDEN", "REQUEST_TOKEN_REQUIRED", "INVALID_ITEMS", "INVALID_AMOUNT_PRECISION", "DUPLICATE_EMPLOYEE", "AMOUNT_TOO_LARGE", "EMPLOYEE_NOT_FOUND", "INVALID_EMPLOYEE_BALANCE", "INSUFFICIENT_BALANCE"];
      return { data: null, error: { code: data.code, message: data.message || data.error || "工资结算未确认，请按原批次核对。", uncertain: !definitive.includes(data.code) } };
    }
    return { data: readPayoutReceipt(data, { batchNo: p_batch_no, actorId: request.actorId, items: request.items }), error: null };
  } catch (error) {
    return { data: null, error: { code: "RESULT_UNCONFIRMED", message: error instanceof Error ? error.message : String(error), uncertain: true } };
  }
}

export async function apiPayoutByBatch(batchNo: string, actorId: string): Promise<PayoutLookupResult> {
  if (!PAYOUT_UUID.test(actorId) || !batchNo) throw new Error("核对工资批次需要原操作人和批次编号。");
  const { data, error } = await supabase.rpc("get_payout_receipt", { p_batch_no: batchNo });
  if (error) throw error;
  if (data?.success === false && data.code === "NOT_FOUND" && data.definitive === false && data.retry_same_request === true) return { kind: "not_found" };
  if (data?.success === false && data.code === "LEGACY_UNVERIFIED" && data.settlement_exists === true) return { kind: "found", receipt: null, reason: "历史批次缺少完整回执，只可查看和补凭证，不能再次发放。" };
  return { kind: "found", receipt: readPayoutReceipt(data, { batchNo, actorId }) };
}

export async function updateOrderStatus(id: string, status: "booking" | "in_progress" | "completed"): Promise<OrderActionResult> {
  const result = await orderRpc("set_order_status", { p_order_id: id, p_status: status });
  if (!result.error && (result.data?.order_id !== id || result.data?.status !== status || !((result.data.count === 1) || (result.data.count === 0 && result.data.unchanged === true)))) {
    return { data: result.data, error: { message: "服务端未确认目标订单状态，请刷新核对，勿重复提交。", code: "STATE_RESULT_UNCONFIRMED", uncertain: true } };
  }
  return result;
}
// ============ 协作 / 规则 / 财务（预取用） ============

export async function apiTodos(): Promise<Todo[] | null> {
  const { data } = await supabase
    .from("todo_item")
    .select("id, title, content, status, mentioned_employee_names, created_by, updated_at")
    .order("updated_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content ?? "",
    status: r.status as Todo["status"],
    mentions: r.mentioned_employee_names ?? [],
    createdBy: "—",
    updatedAt: r.updated_at ? new Date(r.updated_at).toLocaleString("zh-CN") : "—",
  }));
}

export async function apiAnnouncements(): Promise<Announcement[] | null> {
  const { data } = await supabase
    .from("announcement")
    .select("id, title, content, is_pinned, created_by, updated_at")
    .order("updated_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content ?? "",
    pinned: !!r.is_pinned,
    createdBy: "—",
    updatedAt: r.updated_at ? new Date(r.updated_at).toLocaleString("zh-CN") : "—",
  }));
}

type AnnouncementRecord = {
  id: string;
  title: string;
  content: string | null;
  is_pinned: boolean;
  updated_at: string | null;
};

function savedAnnouncement(row: AnnouncementRecord): Announcement {
  return {
    id: row.id,
    title: row.title,
    content: row.content ?? "",
    pinned: row.is_pinned,
    createdBy: "—",
    updatedAt: row.updated_at ? new Date(row.updated_at).toLocaleString("zh-CN") : "—",
  };
}

export async function apiCreateAnnouncement(
  input: Pick<Announcement, "title" | "content" | "pinned">,
): Promise<Announcement> {
  const { data, error } = await supabase
    .from("announcement")
    .insert({ title: input.title, content: input.content, is_pinned: input.pinned })
    .select("id, title, content, is_pinned, updated_at")
    .single<AnnouncementRecord>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("发布未返回公告记录，请刷新后重试");
  return savedAnnouncement(data);
}

export async function apiUpdateAnnouncementPin(id: string, pinned: boolean): Promise<Announcement> {
  const { data, error } = await supabase
    .from("announcement")
    .update({ is_pinned: pinned })
    .eq("id", id)
    .select("id, title, content, is_pinned, updated_at")
    .single<AnnouncementRecord>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("保存未返回公告记录，请刷新后重试");
  return savedAnnouncement(data);
}

export async function apiUpdateGradeRate(grade: number, rate: number): Promise<GradeRule> {
  requireCommissionRate(rate);
  const { data, error } = await supabase
    .from("grade_commission_rule")
    .update({ rate })
    .eq("grade", grade)
    .select("grade, rate")
    .single<{ grade: number; rate: number }>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("保存未返回等级记录，请刷新后重试");
  const savedRate = requireCommissionRate(data.rate);
  if (data.grade !== grade || savedRate !== rate) throw new Error("提成规则保存结果不一致，请刷新核对");
  return { grade: data.grade, rate: savedRate };
}

export async function apiUpdateRechargePackageStatus(
  id: string,
  status: RechargePackage["status"],
): Promise<Pick<RechargePackage, "id" | "status">> {
  const { data, error } = await supabase
    .from("recharge_package")
    .update({ status })
    .eq("id", id)
    .select("id, status")
    .single<{ id: string; status: RechargePackage["status"] }>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("保存未返回套餐记录，请刷新后重试");
  return data;
}

export type NoteWithOwner = Note & { createdById?: string | null };

export async function apiNotes(): Promise<NoteWithOwner[] | null> {
  const { data } = await supabase
    .from("note")
    .select("id, title, content, is_published, created_by, updated_at")
    .order("updated_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content ?? "",
    published: !!r.is_published,
    createdById: r.created_by ?? null,
    createdBy: "—",
    updatedAt: r.updated_at ? new Date(r.updated_at).toLocaleString("zh-CN") : "—",
  }));
}

type TodoWriteRow = {
  id: string; title: string; content: string | null; status: Todo["status"];
  mentioned_employee_names: string[] | null; updated_at: string | null;
};

function todoFromWrite(row: TodoWriteRow): Todo {
  return { id: row.id, title: row.title, content: row.content ?? "", status: row.status,
    mentions: row.mentioned_employee_names ?? [], createdBy: "—",
    updatedAt: row.updated_at ? new Date(row.updated_at).toLocaleString("zh-CN") : "—" };
}

export async function apiCreateTodo(input: { title: string; content: string; mentionedEmployeeNames: string[] }): Promise<Todo> {
  const { data, error } = await supabase.from("todo_item")
    .insert({ title: input.title, content: input.content, status: "pending", mentioned_user_ids: [], mentioned_employee_names: input.mentionedEmployeeNames })
    .select("id, title, content, status, mentioned_employee_names, updated_at").single<TodoWriteRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("创建未返回待办记录，请刷新后重试");
  return todoFromWrite(data);
}

export async function apiUpdateTodoStatus(id: string, status: Todo["status"]): Promise<Todo> {
  const { data, error } = await supabase.from("todo_item").update({ status }).eq("id", id)
    .select("id, title, content, status, mentioned_employee_names, updated_at").single<TodoWriteRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("保存未返回待办记录，请刷新后重试");
  return todoFromWrite(data);
}

type NoteWriteRow = {
  id: string; title: string; content: string | null; is_published: boolean;
  created_by: string | null; updated_at: string | null;
};

function noteFromWrite(row: NoteWriteRow): NoteWithOwner {
  return { id: row.id, title: row.title, content: row.content ?? "", published: row.is_published,
    createdById: row.created_by, createdBy: "—",
    updatedAt: row.updated_at ? new Date(row.updated_at).toLocaleString("zh-CN") : "—" };
}

export async function apiCreateNote(input: Pick<Note, "title" | "content" | "published">): Promise<NoteWithOwner> {
  const { data, error } = await supabase.from("note")
    .insert({ title: input.title, content: input.content, is_published: input.published })
    .select("id, title, content, is_published, created_by, updated_at").single<NoteWriteRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("创建未返回笔记记录，请刷新后重试");
  return noteFromWrite(data);
}

export async function apiUpdateNotePublished(id: string, published: boolean): Promise<NoteWithOwner> {
  const { data, error } = await supabase.from("note").update({ is_published: published }).eq("id", id)
    .select("id, title, content, is_published, created_by, updated_at").single<NoteWriteRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("笔记未更新，可能已无权限，请刷新后重试");
  return noteFromWrite(data);
}

export async function apiCreateCategory(input: Pick<ProductCategory, "name" | "description">): Promise<ProductCategory> {
  const { data, error } = await supabase.from("product_category")
    .insert({ name: input.name, description: input.description, status: "enabled" })
    .select("id, name, description, status").single<ProductCategory>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("创建未返回分类记录，请刷新后重试");
  return { ...data, description: data.description ?? "" };
}

export async function apiUpdateCategoryStatus(id: string, status: ProductCategory["status"]): Promise<ProductCategory> {
  const { data, error } = await supabase.from("product_category").update({ status }).eq("id", id)
    .select("id, name, description, status").single<ProductCategory>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("保存未返回分类记录，请刷新后重试");
  return { ...data, description: data.description ?? "" };
}

export async function apiMarkNotificationsRead(recipientId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("notification")
    .update({ read_at: new Date().toISOString() }).eq("recipient_id", recipientId)
    .in("id", [...new Set(ids)]).is("read_at", null).select("id, read_at");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("通知状态未更新或已发生变化，请刷新后重试");
  return data.filter((row) => row.read_at !== null).map((row) => String(row.id));
}

export async function apiNotifications(): Promise<NotificationItem[] | null> {
  const { data } = await supabase
    .from("notification")
    .select("id, recipient_id, type, title, content, read_at, created_at")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    recipient: "—",
    type: (r.type === "todo_mention" ? "todo_mention" : "customer_vip_upgrade") as NotificationItem["type"],
    title: r.title,
    content: r.content ?? "",
    read: !!r.read_at,
    at: r.created_at ? new Date(r.created_at).toLocaleString("zh-CN") : "—",
  }));
}

export async function apiGradeRules(): Promise<GradeRule[] | null> {
  const { data } = await supabase.from("grade_commission_rule").select("grade, rate").order("grade", { ascending: true });
  if (!data) return null;
  return data.map((r) => ({ grade: r.grade, rate: Number(r.rate ?? 0) }));
}

export async function apiVipDiscountRules(): Promise<VipDiscountRule[] | null> {
  const { data } = await supabase
    .from("vip_discount_rule")
    .select("id, vip_level, category, category_id, discount")
    .order("vip_level", { ascending: true });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    vipLevel: r.vip_level,
    category: r.category ?? "",
    categoryId: r.category_id ?? null,
    discount: Number(r.discount ?? 1),
  }));
}

export async function apiVipUpgradeRules(): Promise<VipUpgradeRule[] | null> {
  const { data } = await supabase
    .from("vip_upgrade_rule")
    .select("vip_level, consumption_threshold")
    .order("vip_level", { ascending: true });
  if (!data) return null;
  return data.map((r) => ({ vipLevel: r.vip_level, threshold: Number(r.consumption_threshold ?? 0) }));
}

export async function apiRechargePackages(): Promise<RechargePackage[] | null> {
  const { data } = await supabase
    .from("recharge_package")
    .select("id, amount, bonus, status")
    .order("amount", { ascending: true });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    amount: Number(r.amount ?? 0),
    bonus: Number(r.bonus ?? 0),
    status: r.status === "disabled" ? "disabled" : "enabled",
  }));
}

// Descending (created_at, id) cursor, including NULL dates last. An empty page is
// the only completion signal: PostgREST may cap each response below our limit.
async function ledgerRows(table: string, projection: string, filter?: { column: string; value: string }): Promise<(CursorRow & Record<string, unknown>)[]> {
  return readAllLedgerPages(async (cursor, pageSize) => {
    let query = supabase.from(table).select(projection)
      .order("created_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).limit(pageSize);
    if (filter) query = query.eq(filter.column, filter.value);
    if (cursor) query = query.or(ledgerCursorFilter(cursor));
    const { data, error } = await query;
    return { data: data as unknown as (CursorRow & Record<string, unknown>)[] | null, error };
  });
}
const relation = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const ledgerText = (value: unknown): string | null => typeof value === "string" && value !== "" ? value : null;
const ledgerDate = (value: unknown): string => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN") : "时间未知";

export async function apiWalletLedgers(): Promise<WalletLedgerRow[]> {
  const data = await ledgerRows("wallet_ledger", "id,employee_id,type,amount,balance_after,order_id,payout_id,operator_id,remark,created_at,employee(nickname,name),order:order_id(order_no),payout:payout_id(batch_no,proof_path),creator:operator_id(name)");
  return data.map(r => ({
    id: r.id, employeeId: ledgerText(r.employee_id), employee: ledgerText(relation(r.employee).nickname) || ledgerText(relation(r.employee).name) || "—",
    type: String(r.type ?? "unknown"), amount: ledgerNumber(r.amount), balance: ledgerNumber(r.balance_after),
    orderId: ledgerText(r.order_id), orderNo: ledgerText(relation(r.order).order_no), payoutId: ledgerText(r.payout_id), batchNo: ledgerText(relation(r.payout).batch_no),
    operatorId: ledgerText(r.operator_id), operator: ledgerText(relation(r.creator).name), remark: ledgerText(r.remark), proofPath: ledgerText(relation(r.payout).proof_path),
    createdAtRaw: ledgerText(r.created_at), at: ledgerDate(r.created_at),
  }));
}

export async function apiCustomerLedgers(): Promise<CustomerLedgerRow[]> {
  const data = await ledgerRows("customer_wallet_ledger", "id,customer_id,type,amount,principal_after,bonus_after,order_id,operator_id,remark,proof_path,created_at,customer(name),order:order_id(order_no),creator:operator_id(name)");
  return data.map(r => ({
    id: r.id, customerId: ledgerText(r.customer_id), customer: ledgerText(relation(r.customer).name) ?? "—", type: String(r.type ?? "unknown"),
    amount: ledgerNumber(r.amount), principal: ledgerNumber(r.principal_after), bonus: ledgerNumber(r.bonus_after), orderId: ledgerText(r.order_id), orderNo: ledgerText(relation(r.order).order_no),
    operatorId: ledgerText(r.operator_id), operator: ledgerText(relation(r.creator).name), remark: ledgerText(r.remark), proofPath: ledgerText(r.proof_path),
    createdAtRaw: ledgerText(r.created_at), at: ledgerDate(r.created_at),
  }));
}

const PAYOUT_FIELDS = "id,batch_no,operator_id,total_amount,detail_count,status,proof_path,created_at,creator:operator_id(name)";
function payoutRow(r: Record<string, unknown>): PayoutRow {
  if (typeof r.id !== "string" || !PAYOUT_UUID.test(r.id)) throw new Error("工资批次 ID 不完整。");
  return { id: r.id, batchNo: ledgerText(r.batch_no) ?? "批次编号未保留", operatorId: ledgerText(r.operator_id), operator: ledgerText(relation(r.creator).name) ?? "—", total: ledgerNumber(r.total_amount), count: ledgerNumber(r.detail_count), status: String(r.status ?? "unknown"), proofPath: ledgerText(r.proof_path), createdAtRaw: ledgerText(r.created_at), at: ledgerDate(r.created_at) };
}
export async function apiPayouts(): Promise<PayoutRow[]> {
  return (await ledgerRows("payout", PAYOUT_FIELDS)).map(payoutRow);
}
export async function apiPayoutById(id: string): Promise<PayoutRow | null> {
  if (!PAYOUT_UUID.test(id)) throw new Error("需要有效的工资批次 ID。");
  const { data, error } = await supabase.from("payout").select(PAYOUT_FIELDS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (data && data.id !== id) throw new Error("工资批次读取结果与目标不一致。");
  return data ? payoutRow(data as unknown as Record<string, unknown>) : null;
}
export async function apiPayoutDetails(payoutId: string): Promise<PayoutDetailRow[]> {
  if (!PAYOUT_UUID.test(payoutId)) throw new Error("需要有效的工资批次 ID。");
  const data = await ledgerRows("payout_detail", "id,payout_id,employee_id,amount,balance_before,balance_after,created_at,employee(nickname,name)", { column: "payout_id", value: payoutId });
  return data.map(r => ({ id: r.id, payoutId: ledgerText(r.payout_id), employeeId: ledgerText(r.employee_id), employee: ledgerText(relation(r.employee).nickname) || ledgerText(relation(r.employee).name) || "—", amount: ledgerNumber(r.amount), balanceBefore: ledgerNumber(r.balance_before), balanceAfter: ledgerNumber(r.balance_after), createdAtRaw: ledgerText(r.created_at) }));
}
export async function uploadPayoutProof(file: File, userId: string, payoutId: string, uploadUUID = crypto.randomUUID()): Promise<string> {
  const path = payoutProofObjectPath(file.name, userId, payoutId, uploadUUID);
  const { error } = await supabase.storage.from("payment-proofs").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return path;
}
export async function apiUpdatePayoutProof(payoutId: string, proofPath: string, expectedProofPath: string | null = null): Promise<{ id: string; proofPath: string }> {
  if (!PAYOUT_UUID.test(payoutId) || !proofPath) throw new Error("工资凭证需要真实批次 ID 和上传路径。");
  const { data, error } = await supabase.rpc("attach_payout_proof", { p_payout_id: payoutId, p_proof_path: proofPath, p_expected_proof_path: expectedProofPath });
  if (error) throw error;
  if (data?.success !== true || data.attached !== true || data.payout_id !== payoutId || data.batch_id !== payoutId || data.proof_path !== proofPath) throw Object.assign(new Error(data?.message || data?.error || "凭证关联未确认，请读取原批次核对后重试附件。"), { code: data?.code || "PROOF_RESULT_UNCONFIRMED" });
  return { id: payoutId, proofPath };
}

export async function apiDeleteLogs(): Promise<DeleteLog[] | null> {
  const { data } = await supabase
    .from("order_delete_log")
    .select("id, order_no, deleted_by, paid_amount, reason, deleted_at")
    .order("deleted_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    deletedBy: "—",
    paid: Number(r.paid_amount ?? 0),
    status: "—",
    auditStatus: "—",
    reason: r.reason ?? "",
    at: r.deleted_at ? new Date(r.deleted_at).toLocaleString("zh-CN") : "—",
  }));
}
export function rpcBatchCompleteOrders(p_order_ids: string[]) {
  return orderRpc("batch_complete_orders", { p_order_ids });
}

export function rpcBatchStartOrders(p_order_ids: string[]) {
  return orderRpc("batch_start_orders", { p_order_ids });
}

export function rpcBatchApproveOrders(p_order_ids: string[]) {
  return orderRpc("batch_approve_orders", { p_order_ids });
}

export function rpcUpdateOrderProof(p_order_id: string, p_proof_path: string) {
  return orderRpc("update_order_proof", { p_order_id, p_proof_path });
}

export function rpcAddOrderProof(p_order_id: string, p_proof_path: string) {
  return orderRpc("add_order_proof", { p_order_id, p_proof_path });
}

export function rpcRemoveOrderProof(p_order_id: string, p_proof_path: string) {
  return orderRpc("remove_order_proof", { p_order_id, p_proof_path });
}

export async function uploadProof(file: File, userId: string, orderId: string): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = userId + "/order-" + orderId + "-" + Date.now() + "." + ext;
  const { error } = await supabase.storage
    .from("payment-proofs")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}
export function rpcSetPendingOrderCommissions(p_order_id: string, p_commissions: { employee_id: string; amount: number | null }[]) {
  return orderRpc("set_pending_order_commissions", { p_order_id, p_commissions });
}

export function rpcRejectOrderAudit(p_order_id: string) {
  return orderRpc("reject_order_audit", { p_order_id });
}

export function rpcHideProduct(p_product_id: string) {
  return supabase.rpc("hide_product", { p_product_id });
}

export function rpcRestoreProduct(p_product_id: string) {
  return supabase.rpc("restore_product", { p_product_id });
}
