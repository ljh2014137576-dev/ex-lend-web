"use client";

import { useState } from "react";
import Link from "next/link";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import type { Order } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export function OrderNoPreview({ orderId, orderNo, orders }: { orderId?: string | null; orderNo?: string | null; orders: Order[] }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // Explicit null is a missing historical FK, not permission to guess by label.
  const order = orderId === undefined ? orders.find(o => o.orderNo === orderNo) : orderId ? orders.find(o => o.id === orderId) : undefined;
  const targetId = orderId ?? (orderId === undefined ? order?.id : null);

  if (!order) {
    return targetId
      ? <Link href={`/orders/${encodeURIComponent(targetId)}`} onClick={e => e.stopPropagation()} className="font-mono text-xs text-accent underline">{orderNo || "查看关联订单"}</Link>
      : <span className="font-mono text-xs text-muted">{orderNo || "未保留订单关联"}</span>;
  }

  return (
    <>
      <Link
        href={`/orders/${encodeURIComponent(order.id)}`}
        onClick={e => e.stopPropagation()}
        className="cursor-pointer font-mono text-xs text-accent underline decoration-line underline-offset-2"
        onMouseEnter={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          // 贴订单号左侧显示；空间不足时回退右侧
          const left = r.left - 8 - 320;
          const x = left >= 8 ? left : r.right + 8;
          setPos({ x, y: Math.max(8, Math.min(r.top, window.innerHeight - 320)) });
        }}
        onMouseLeave={() => setPos(null)}
      >
        {order.orderNo}
      </Link>
      {pos && (
        <div
          className="fixed z-50 w-80 border border-line bg-surface p-3 shadow-lg"
          style={{ left: pos.x, top: pos.y, maxHeight: "75vh", overflowY: "auto" }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-xs">{order.orderNo}</p>
            <div className="flex gap-2">
              <OrderStatusTag status={order.status} />
              <AuditStatusTag status={order.auditStatus} />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
            <span className="text-muted">客户</span><span>{order.customerName}{order.customerType === "vip" ? ` · VIP${order.vipLevel}` : ""}</span>
            <span className="text-muted">支付</span><span>{order.payMethod === "wallet" ? "钱包" : "现金"}</span>
            <span className="text-muted">实付</span><span>{money(order.paid)}</span>
            <span className="text-muted">折扣</span><span>{money(order.discount)}</span>
            <span className="text-muted">佣金</span><span>{money(order.commission)}</span>
            <span className="text-muted">毛利</span><span>{money(order.grossProfit)}</span>
          </div>
          {order.items.length > 0 && (
            <ul className="mt-2 border-t border-line pt-2">
              {order.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-2 font-mono text-[11px]">
                  <span className="truncate">{it.productName} × {it.quantity}</span>
                  <span>{money(it.paid)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}