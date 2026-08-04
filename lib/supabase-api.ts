import { supabase } from "@/lib/supabase";
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

export interface WalletLedgerRow {
  id: string;
  employeeId?: string;
  employee: string;
  type: string;
  amount: number;
  balance: number;
  orderNo: string;
  at: string;
}

export interface CustomerLedgerRow {
  id: string;
  customer: string;
  type: string;
  amount: number;
  principal: number;
  bonus: number;
  at: string;
}

export interface PayoutRow {
  id: string;
  batchNo: string;
  operator: string;
  total: number;
  count: number;
  status: string;
  at: string;
  proofPath?: string | null;
}

export interface PayoutDetailRow {
  id: string;
  employeeId: string;
  employee: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
}

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
  return supabase.from("users").update({ name }).eq("id", userId);
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
  const { data } = await supabase
    .from("product")
    .select("id, name, category, price, commission_type, fixed_rate, status")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category ?? "",
    price: Number(r.price ?? 0),
    commissionType: r.commission_type === "grade" ? "grade" : "fixed",
    fixedRate: r.fixed_rate != null ? Number(r.fixed_rate) : null,
    status: r.status === "off_shelf" ? "off_shelf" : "on_sale",
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
  const { data } = await supabase
    .from("order")
    .select("id, order_no, customer_id, customer_type_snapshot, vip_level_snapshot, pay_method, original_amount, paid_amount, discount_amount, total_commission, gross_profit, status, audit_status, operator_id, pending_amount, created_at, customer(name), creator:operator_id(name), order_member(id, employee_id, grade_snapshot, base_amount, applied_rate, commission_amount, employee(nickname, name))")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    customerName: (r.customer as { name?: string } | null)?.name ?? "—",
    customerType: (r.customer_type_snapshot === "vip" ? "vip" : "normal") as "vip" | "normal",
    vipLevel: r.vip_level_snapshot ?? 0,
    payMethod: r.pay_method === "cash" ? "cash" : "wallet",
    original: Number(r.original_amount ?? 0),
    paid: Number(r.paid_amount ?? 0),
    discount: Number(r.discount_amount ?? 0),
    pending: Number(r.pending_amount ?? 0),
    commission: Number(r.total_commission ?? 0),
    grossProfit: Number(r.gross_profit ?? 0),
    status: r.status as Order["status"],
    auditStatus: r.audit_status as Order["auditStatus"],
    operator: (r.creator as { name?: string } | null)?.name ?? "—",
    createdAt: r.created_at ? new Date(r.created_at).toLocaleString("zh-CN") : "—",
    proofPath: null,
    items: [],
    members: (r.order_member ?? []).map((m) => ({
      employeeId: m.employee_id,
      name: (m.employee as { nickname?: string; name?: string } | null)?.nickname || (m.employee as { name?: string } | null)?.name || "员工",
      grade: m.grade_snapshot ?? 1,
      base: Number(m.base_amount ?? 0),
      rate: Number(m.applied_rate ?? 0),
      commission: Number(m.commission_amount ?? 0),
    })),
  }));
}

export async function apiOrderDetail(id: string): Promise<{ order: Order; items: OrderItem[]; members: OrderMember[] } | null> {
  const { data } = await supabase
    .from("order")
    .select(
      "id, order_no, customer_id, customer_type_snapshot, vip_level_snapshot, pay_method, original_amount, paid_amount, discount_amount, total_commission, gross_profit, status, audit_status, proof_path, proof_paths, created_at, customer(name), order_item(id, product_name_snapshot, category_snapshot, unit_price, quantity, original_amount, discount_amount, paid_amount, commission_type_snapshot), order_member(id, employee_id, grade_snapshot, base_amount, applied_rate, commission_amount, employee(nickname, name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const items = (data.order_item ?? []).map((it) => ({
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
    grade: m.grade_snapshot ?? 1,
    base: Number(m.base_amount ?? 0),
    rate: Number(m.applied_rate ?? 0),
    commission: Number(m.commission_amount ?? 0),
  }));
  const order: Order = {
    id: data.id,
    orderNo: data.order_no,
    customerName: (data.customer as { name?: string } | null)?.name ?? "—",
    customerType: (data.customer_type_snapshot === "vip" ? "vip" : "normal") as "vip" | "normal",
    vipLevel: data.vip_level_snapshot ?? 0,
    payMethod: data.pay_method === "cash" ? "cash" : "wallet",
    original: Number(data.original_amount ?? 0),
    paid: Number(data.paid_amount ?? 0),
    discount: Number(data.discount_amount ?? 0),
    commission: Number(data.total_commission ?? 0),
    grossProfit: Number(data.gross_profit ?? 0),
    status: data.status as Order["status"],
    auditStatus: data.audit_status as Order["auditStatus"],
    operator: "—",
    createdAt: data.created_at ? new Date(data.created_at).toLocaleString("zh-CN") : "—",
    proofPath: data.proof_path ?? null,
    proofPaths: Array.isArray(data.proof_paths) ? data.proof_paths : data.proof_path ? [data.proof_path] : [],
    items,
    members,
  };
  return { order, items, members };
}

// RPC（写入类，真实会话下调用）
export const rpc = {
  createOrderMulti: (params: {
    p_customer_id: string;
    p_items: { product_id: string; quantity: number }[];
    p_employee_ids: string[];
    p_pay_method: "wallet" | "cash";
    p_paid_amount: number | null;
  }) => supabase.rpc("create_order_multi", params),
};
// RPC：写入类（真实会话下调用，错误返回 {success:false,message}）
export async function rpcCreateOrderMulti(params: {
  p_customer_id: string;
  p_items: { product_id: string; quantity: number }[];
  p_employee_ids: string[];
  p_pay_method: "wallet" | "cash";
  p_paid_amount: number | null;
}) {
  return supabase.rpc("create_order_multi", params);
}

export function rpcApproveCommission(p_order_id: string) {
  return supabase.rpc("approve_commission", { p_order_id });
}

export function rpcRefundOrder(p_order_id: string, p_refund_method: "wallet" | "cash") {
  return supabase.rpc("refund_order", { p_order_id, p_refund_method });
}

export function rpcDeleteOrder(p_order_id: string, p_reason: string) {
  return supabase.rpc("delete_order", { p_order_id, p_reason });
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

export function rpcPayoutSalary(p_items: { employee_id: string; amount: number }[], p_batch_no: string) {
  return supabase.rpc("payout_salary", { p_items, p_batch_no });
}

export function updateOrderStatus(id: string, status: "booking" | "in_progress" | "completed") {
  return supabase.from("order").update({ status }).eq("id", id);
}
// ============ 协作 / 规则 / 财务（预取用） ============

export async function apiTodos(): Promise<Todo[] | null> {
  const { data } = await supabase
    .from("todo_item")
    .select("id, title, content, status, mentioned_user_ids, created_by, updated_at")
    .order("updated_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content ?? "",
    status: r.status as Todo["status"],
    mentions: r.mentioned_user_ids ?? [],
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

export async function apiNotes(): Promise<Note[] | null> {
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
    createdBy: "—",
    updatedAt: r.updated_at ? new Date(r.updated_at).toLocaleString("zh-CN") : "—",
  }));
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
    .select("id, vip_level, category, discount")
    .order("vip_level", { ascending: true });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    vipLevel: r.vip_level,
    category: r.category ?? "",
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

export async function apiWalletLedgers(): Promise<WalletLedgerRow[] | null> {
  const { data } = await supabase
    .from("wallet_ledger")
    .select("id, employee_id, type, amount, balance_after, order_id, payout_id, created_at, employee(nickname, name), order:order_id(order_no), payout:payout_id(batch_no)")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    employeeId: r.employee_id ?? undefined,
    employee: (r.employee as { nickname?: string; name?: string } | null)?.nickname || (r.employee as { name?: string } | null)?.name || "—",
    type: r.type,
    amount: Number(r.amount ?? 0),
    balance: Number(r.balance_after ?? 0),
    orderNo: (r.order as { order_no?: string } | null)?.order_no || (r.payout as { batch_no?: string } | null)?.batch_no || "—",
    at: r.created_at ? new Date(r.created_at).toLocaleString("zh-CN") : "—",
  }));
}

export async function apiCustomerLedgers(): Promise<CustomerLedgerRow[] | null> {
  const { data } = await supabase
    .from("customer_wallet_ledger")
    .select("id, customer_id, type, amount, principal_after, bonus_after, created_at, customer(name)")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    customer: (r.customer as { name?: string } | null)?.name ?? "—",
    type: r.type,
    amount: Number(r.amount ?? 0),
    principal: Number(r.principal_after ?? 0),
    bonus: Number(r.bonus_after ?? 0),
    at: r.created_at ? new Date(r.created_at).toLocaleString("zh-CN") : "—",
  }));
}

export async function apiPayouts(): Promise<PayoutRow[] | null> {
  const { data } = await supabase
    .from("payout")
    .select("id, batch_no, operator_id, total_amount, detail_count, status, proof_path, created_at, creator:operator_id(name)")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    batchNo: r.batch_no,
    operator: (r.creator as { name?: string } | null)?.name ?? "—",
    total: Number(r.total_amount ?? 0),
    count: r.detail_count ?? 0,
    status: r.status,
    at: r.created_at ? new Date(r.created_at).toLocaleString("zh-CN") : "—",
    proofPath: r.proof_path ?? null,
  }));
}

export async function apiPayoutDetails(payoutId: string): Promise<PayoutDetailRow[] | null> {
  const { data } = await supabase
    .from("payout_detail")
    .select("id, employee_id, amount, balance_before, balance_after, created_at, employee(nickname, name)")
    .eq("payout_id", payoutId)
    .order("created_at", { ascending: true });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employee: (r.employee as { nickname?: string; name?: string } | null)?.nickname || (r.employee as { name?: string } | null)?.name || "—",
    amount: Number(r.amount ?? 0),
    balanceBefore: Number(r.balance_before ?? 0),
    balanceAfter: Number(r.balance_after ?? 0),
  }));
}

export async function uploadPayoutProof(file: File, userId: string, batchNo: string): Promise<string> {
  const ext = file.name.split(".").pop() || "dat";
  const safe = batchNo.replace(/[^\w-]/g, "");
  const path = userId + "/payout-" + safe + "-" + Date.now() + "." + ext;
  const { error } = await supabase.storage
    .from("payment-proofs")
    .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return path;
}

export async function apiUpdatePayoutProof(payoutId: string, proofPath: string) {
  return supabase.from("payout").update({ proof_path: proofPath }).eq("id", payoutId);
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
export function rpcBatchStartOrders(p_order_ids: string[]) {
  return supabase.rpc("batch_start_orders", { p_order_ids });
}

export function rpcBatchApproveOrders(p_order_ids: string[]) {
  return supabase.rpc("batch_approve_orders", { p_order_ids });
}

export function rpcUpdateOrderProof(p_order_id: string, p_proof_path: string) {
  return supabase.rpc("update_order_proof", { p_order_id, p_proof_path });
}

export function rpcAddOrderProof(p_order_id: string, p_proof_path: string) {
  return supabase.rpc("add_order_proof", { p_order_id, p_proof_path });
}

export function rpcRemoveOrderProof(p_order_id: string, p_proof_path: string) {
  return supabase.rpc("remove_order_proof", { p_order_id, p_proof_path });
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
export function rpcSetPendingOrderCommissions(p_order_id: string, p_commissions: { employee_id: string; amount: number }[]) {
  return supabase.rpc("set_pending_order_commissions", { p_order_id, p_commissions });
}

export function rpcRejectOrderAudit(p_order_id: string) {
  return supabase.rpc("reject_order_audit", { p_order_id });
}