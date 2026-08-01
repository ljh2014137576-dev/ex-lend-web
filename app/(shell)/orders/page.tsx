"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { Button } from "@/components/ui/Button";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { ORDERS, type Order } from "@/lib/mock-data";
import { apiOrders } from "@/lib/supabase-api";
import { useRealData, DataSourceBadge } from "@/lib/use-real-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function OrdersPage() {
  const [status, setStatus] = useState("all");
  const [audit, setAudit] = useState("all");
  const { data: orders, real, error, pending } = useRealData<Order>(apiOrders, ORDERS);

  const filtered = useMemo(() => {
    return orders.filter(
      (o) =>
        (status === "all" || o.status === status) &&
        (audit === "all" || o.auditStatus === audit),
    );
  }, [status, audit]);

  const countBy = (key: "status" | "auditStatus", v: string) =>
    orders.filter((o) => o[key] === v).length;

  return (
    <div className="space-y-6">
      <PageHeader title="订单" meta={`/orders · 共 ${orders.length} 笔${real ? " · 真实数据" : "（Mock）"}${error ? " · ⚠ " + error.slice(0,40) : ""}`} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          tabs={[
            { id: "all", label: "全部", count: orders.length },
            { id: "booking", label: "待开始", count: countBy("status", "booking") },
            { id: "in_progress", label: "进行中", count: countBy("status", "in_progress") },
            { id: "completed", label: "已完成", count: countBy("status", "completed") },
            { id: "cancelled", label: "已取消", count: countBy("status", "cancelled") },
          ]}
          active={status}
          onChange={setStatus}
        />
        <FilterTabs
          tabs={[
            { id: "all", label: "审核-全部" },
            { id: "pending", label: "待审核", count: countBy("auditStatus", "pending") },
            { id: "approved", label: "已通过" },
            { id: "rejected", label: "已拒绝" },
          ]}
          active={audit}
          onChange={setAudit}
        />
      </div>

      <Panel title={`订单列表（${filtered.length}）`} meta="Mock 数据">
        <DataTable<Order>
          rowKey={(r) => r.id}
          columns={[
            { key: "orderNo", label: "订单号", mono: true, render: (r) => <Link className="underline decoration-line underline-offset-2 hover:text-accent" href={`/orders/${r.id}`}>{r.orderNo}</Link> },
            { key: "customer", label: "客户", render: (r) => `${r.customerName}${r.customerType === "vip" ? ` · VIP${r.vipLevel}` : ""}` },
            { key: "payMethod", label: "支付", mono: true, render: (r) => (r.payMethod === "wallet" ? "钱包" : "现金") },
            { key: "original", label: "原价", align: "right", mono: true, render: (r) => money(r.original) },
            { key: "paid", label: "实付", align: "right", mono: true, render: (r) => money(r.paid) },
            { key: "commission", label: "佣金", align: "right", mono: true, render: (r) => money(r.commission) },
            { key: "status", label: "状态", render: (r) => <OrderStatusTag status={r.status} /> },
            { key: "audit", label: "审核", render: (r) => <AuditStatusTag status={r.auditStatus} /> },
            { key: "operator", label: "操作人", render: (r) => r.operator },
            { key: "createdAt", label: "时间", mono: true, render: (r) => r.createdAt },
          ]}
          rows={filtered}
          empty={pending ? "加载中…" : "暂无数据"}
        />
      </Panel>

      <p className="font-mono text-[11px] text-muted">
        <Link href="/audit" className="underline underline-offset-2 hover:text-accent">→ 去审核台处理待审核订单</Link>
      </p>
    </div>
  );
}