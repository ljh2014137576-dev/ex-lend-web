"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { ORDERS, type Order, type OrderItem, type OrderMember } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const order = ORDERS.find((o) => o.id === params.id);
  const [localOrder, setLocalOrder] = useState<Order | null>(order ?? null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundMethod, setRefundMethod] = useState<"wallet" | "cash">("wallet");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!localOrder) {
    return (
      <div>
        <PageHeader title="订单不存在或已删除" meta="/orders/[id]" />
        <Link href="/orders" className="font-mono text-xs underline underline-offset-2">← 返回订单列表</Link>
      </div>
    );
  }

  const o = localOrder;

  const setStatus = (status: "booking" | "in_progress" | "completed") => {
    setNotice(null);
    setLocalOrder({ ...o, status });
  };

  const refund = () => {
    setNotice(null);
    setLocalOrder({ ...o, status: "cancelled", auditStatus: "rejected", commission: 0, grossProfit: 0 });
    setRefundOpen(false);
    setNotice(`已退款（${refundMethod === "wallet" ? "钱包" : "现金"}），订单置为已取消/已拒绝`);
  };

  const removeOrder = () => {
    setDeleteOpen(false);
    setNotice(`订单 ${o.orderNo} 已删除（Mock，已写入删除审计）`);
    setLocalOrder(null);
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className="border border-line bg-surface p-3 font-mono text-xs text-muted">{notice}</div>
      )}

      <PageHeader title={o.orderNo} meta={`/orders/${o.id} · Mock 数据 · ${o.createdAt}`} />

      <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "客户", value: `${o.customerName}${o.customerType === "vip" ? ` · VIP${o.vipLevel}` : ""}` },
          { label: "支付方式", value: o.payMethod === "wallet" ? "钱包（本金/赠送质押）" : "现金（预收）" },
          { label: "原价 / 实付 / 折扣", value: `${money(o.original)} / ${money(o.paid)} / ${money(o.discount)}` },
          { label: "佣金 / 毛利", value: `${money(o.commission)} / ${money(o.grossProfit)}` },
        ].map((x) => (
          <div key={x.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{x.label}</p>
            <p className="mt-1 text-sm font-medium">{x.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <OrderStatusTag status={o.status} />
          <AuditStatusTag status={o.auditStatus} />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setStatus("booking")} disabled={o.status === "booking"}>待开始</Button>
          <Button size="sm" variant="secondary" onClick={() => setStatus("in_progress")} disabled={o.status === "in_progress"}>开始</Button>
          <Button size="sm" variant="secondary" onClick={() => setStatus("completed")} disabled={o.status === "completed"}>完成</Button>
          <Link href="/audit"><Button size="sm">去审核</Button></Link>
          <Button size="sm" variant="danger" onClick={() => setRefundOpen(true)} disabled={o.status === "cancelled"}>退款</Button>
          <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)} disabled={o.status !== "booking" || o.auditStatus !== "pending"}>删除</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="商品明细" meta={`${o.items.length} 项`}>
          <DataTable<OrderItem>
            rowKey={(r, i) => r.productName + i}
            columns={[
              { key: "name", label: "商品" },
              { key: "category", label: "分类", mono: true },
              { key: "qty", label: "数量", align: "right", mono: true, render: (r) => r.quantity },
              { key: "unit", label: "单价", align: "right", mono: true, render: (r) => money(r.unitPrice) },
              { key: "paid", label: "实付", align: "right", mono: true, render: (r) => money(r.paid) },
            ]}
            rows={o.items}
          />
        </Panel>

        <Panel title="参与员工与提成" meta={`${o.members.length} 人`}>
          <DataTable<OrderMember>
            rowKey={(r) => r.employeeId}
            columns={[
              { key: "name", label: "员工" },
              { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
              { key: "base", label: "基数", align: "right", mono: true, render: (r) => money(r.base) },
              { key: "rate", label: "比例", align: "right", mono: true, render: (r) => (r.rate * 100).toFixed(1) + "%" },
              { key: "commission", label: "佣金", align: "right", mono: true, render: (r) => money(r.commission) },
            ]}
            rows={o.members}
          />
        </Panel>
      </div>

      <Modal open={refundOpen} title={`退款 — ${o.orderNo}`} onClose={() => setRefundOpen(false)}>
        <div className="space-y-4">
          <p className="font-mono text-[11px] text-muted">
            待审核单须按原支付方式退款（{o.payMethod === "wallet" ? "钱包" : "现金"}）；已审核单仅老板可退。
          </p>
          <div className="flex gap-1">
            {(["wallet", "cash"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRefundMethod(m)}
                aria-pressed={refundMethod === m}
                className={[
                  "flex-1 rounded-md px-3 py-2 text-xs transition-colors",
                  refundMethod === m ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2",
                ].join(" ")}
              >
                {m === "wallet" ? "钱包退回" : "现金退回"}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRefundOpen(false)}>取消</Button>
            <Button variant="danger" onClick={refund}>确认退款（{money(o.paid)}）</Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteOpen} title={`删除订单 — ${o.orderNo}`} onClose={() => setDeleteOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm">仅「待开始 + 未审核 + 未产生提成」的订单可删除；删除后写入审计日志。</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="danger" onClick={removeOrder}>确认删除</Button>
          </div>
        </div>
      </Modal>

      <p className="font-mono text-[11px] text-muted">
        <Link href="/orders" className="underline underline-offset-2 hover:text-accent">← 返回订单列表</Link>
        {" · 状态/退款/删除为本地 Mock 交互"}
      </p>
    </div>
  );
}