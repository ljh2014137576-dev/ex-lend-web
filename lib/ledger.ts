import type { Order } from "@/lib/mock-data";
import type { WalletLedgerRow } from "@/lib/ledger-types";

export const CUSTOMER_LEDGER_TYPE_LABELS: Record<string, string> = {
  recharge_principal: "充值本金", recharge_bonus: "充值赠送", recharge_custom: "自定义充值",
  consume_principal: "下单扣款·本金", consume_bonus: "下单扣款·赠送", consume_from_pending: "预收转消费",
  cash_received: "现金预收", cash_refund: "现金退款", refund: "订单退款", adjust: "人工调整",
};
export function customerLedgerTypeLabel(type: string, amount?: number | null): string {
  if (type === "consume_from_pending" && amount != null && amount < 0) return "撤回预收转消费";
  return CUSTOMER_LEDGER_TYPE_LABELS[type] ?? type;
}
export function walletLedgerTypeLabel(type: string): string {
  return ({ commission: "订单提成", payout: "工资发放", refund_deduct: "提成冲回", adjust: "人工调整" } as Record<string, string>)[type] ?? type;
}
export function ledgerNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function ledgerMoney(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "未知" : "¥" + value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function ledgerSignedAmount(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "未知" : `${value > 0 ? "+" : ""}${ledgerMoney(value)}`;
}
export interface EmployeeLedgerTotals { commission: number | null; payout: number | null; other: number | null }
export function employeeLedgerTotals(rows: WalletLedgerRow[]): Map<string, EmployeeLedgerTotals> {
  const groups = new Map<string, EmployeeLedgerTotals>();
  for (const row of rows) {
    if (!row.employeeId) continue; // No identity may be inferred from a display name.
    const group = groups.get(row.employeeId) ?? { commission: 0, payout: 0, other: 0 };
    const field = row.type === "commission" || row.type === "refund_deduct" ? "commission" : row.type === "payout" ? "payout" : "other";
    group[field] = group[field] === null || row.amount === null ? null : Math.round((group[field] + row.amount) * 100) / 100;
    groups.set(row.employeeId, group);
  }
  return groups;
}
export interface EmployeeCommissionReference { id: string; orderId: string; orderNo: string; orderDate: string; amount: number | null }
// Order snapshots are reconciliation references, never fabricated journal rows.
export function employeeCommissionReferences(employeeId: string, orders: Order[], ledgers: WalletLedgerRow[]): EmployeeCommissionReference[] {
  const linked = new Set(ledgers.filter(row => row.employeeId === employeeId && row.type === "commission" && row.orderId).map(row => row.orderId));
  return orders.filter(order => order.auditStatus === "approved" && !linked.has(order.id)).flatMap(order => {
    const members = order.members.filter(member => member.employeeId === employeeId);
    if (!members.length) return [];
    // Duplicate member snapshots are ambiguous; never add them together.
    const amount = members.length === 1 ? ledgerNumber(members[0].recordedCommission) : null;
    return [{ id: order.id, orderId: order.id, orderNo: order.orderNo, orderDate: order.createdAt, amount }];
  });
}
