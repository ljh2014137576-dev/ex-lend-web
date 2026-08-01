"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { ORDERS, type OrderItem, type OrderMember } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const order = ORDERS.find((o) => o.id === params.id);
  const [localOrder, setLocalOrder] = useState(order);

  if (!order) {
    return (
      <div>
        <PageHeader title="订单不存在" meta="/orders/[id]" />
        <Link href="/orders" className="font-mono text-xs underline underline-offset-2">← 返回订单列表</Link>
      </div>
    );
  }

  const o = localOrder ?? order;

  const setStatus = (status: "booking" | "in_progress" | "completed") =>
    setLocalOrder({ ...o, status });

  return (
    <div className="space-y-6">
      <PageHeader
        title={o.orderNo}
        meta={`/orders/${o.id} · Mock 数据 · ${o.createdAt}`}
      />

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
          <Button size="sm" variant="secondary" onClick={() => setStatus("booking")} disabled={o.status === "booking"}>置为待开始</Button>
          <Button size="sm" variant="secondary" onClick={() => setStatus("in_progress")} disabled={o.status === "in_progress"}>开始</Button>
          <Button size="sm" variant="secondary" onClick={() => setStatus("completed")} disabled={o.status === "completed"}>完成</Button>
          <Link href="/audit"><Button size="sm">去审核</Button></Link>
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

      <p className="font-mono text-[11px] text-muted">
        <Link href="/orders" className="underline underline-offset-2 hover:text-accent">← 返回订单列表</Link>
        {" · 状态切换为本地 Mock 交互，审核走 /audit"}
      </p>
    </div>
  );
}