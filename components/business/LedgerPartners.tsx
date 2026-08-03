"use client";

import type { Order } from "@/lib/mock-data";

export function LedgerPartners({
  orderNo,
  currentEmployee,
  orders,
}: {
  orderNo: string;
  currentEmployee?: string;
  orders: Order[];
}) {
  const order = orders.find((o) => o.orderNo === orderNo);
  if (!order || order.members.length === 0) {
    return <span className="font-mono text-[11px] text-muted">—</span>;
  }
  const partners = order.members.filter((m) => m.name !== currentEmployee).map((m) => m.name);
  return (
    <span className="font-mono text-[11px]">
      {partners.length > 0 ? `与 ${partners.join("、")} 完成` : "独立完成"}
      {order.operator && order.operator !== "—" ? ` · 操作人 ${order.operator}` : ""}
    </span>
  );
}