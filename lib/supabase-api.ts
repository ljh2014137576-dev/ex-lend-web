import { supabase } from "@/lib/supabase";
import type {
  Customer,
  Employee,
  Product,
  ProductCategory,
  Order,
  OrderItem,
  OrderMember,
} from "@/lib/mock-data";

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

export async function apiEmployees(): Promise<Employee[] | null> {
  const { data } = await supabase
    .from("employee")
    .select("id, name, grade, status, wallet_balance, is_debt")
    .order("created_at", { ascending: false });
  if (!data) return null;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
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
    .select("id, order_no, customer_id, customer_type_snapshot, vip_level_snapshot, pay_method, original_amount, paid_amount, discount_amount, total_commission, gross_profit, status, audit_status, operator_id, created_at, customer(name)")
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
    commission: Number(r.total_commission ?? 0),
    grossProfit: Number(r.gross_profit ?? 0),
    status: r.status as Order["status"],
    auditStatus: r.audit_status as Order["auditStatus"],
    operator: "—",
    createdAt: r.created_at ? new Date(r.created_at).toLocaleString("zh-CN") : "—",
    items: [],
    members: [],
  }));
}

export async function apiOrderDetail(id: string): Promise<{ order: Order; items: OrderItem[]; members: OrderMember[] } | null> {
  const { data } = await supabase
    .from("order")
    .select(
      "id, order_no, customer_id, customer_type_snapshot, vip_level_snapshot, pay_method, original_amount, paid_amount, discount_amount, total_commission, gross_profit, status, audit_status, created_at, customer(name), order_item(id, product_name_snapshot, category_snapshot, unit_price, quantity, original_amount, discount_amount, paid_amount, commission_type_snapshot), order_member(id, employee_id, grade_snapshot, base_amount, applied_rate, commission_amount)",
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
    name: "员工",
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