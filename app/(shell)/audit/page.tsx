"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { AuditStatusTag } from "@/components/business/OrderStatusTag";
import { ORDERS, type Order, type OrderMember } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function AuditPage() {
  const [orders, setOrders] = useState(ORDERS);
  const [selectedId, setSelectedId] = useState<string | null>(
    ORDERS.find((o) => o.auditStatus === "pending")?.id ?? null,
  );
  const [log, setLog] = useState<string[]>([]);

  const pending = orders.filter((o) => o.auditStatus === "pending");
  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const approve = (id: string) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, auditStatus: "approved" } : o)));
    setLog((l) => [`${new Date().toLocaleTimeString()} 通过审核：${orders.find((o) => o.id === id)?.orderNo}`, ...l]);
  };

  const reject = (id: string) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, auditStatus: "rejected" } : o)));
    setLog((l) => [`${new Date().toLocaleTimeString()} 撤销：${orders.find((o) => o.id === id)?.orderNo}`, ...l]);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="提成审核台" meta="/audit · Mock 数据 · 仅老板可操作" />

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title={`待审核队列（${pending.length}）`} className="lg:col-span-2">
          <ul className="divide-y divide-line">
            {pending.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(o.id)}
                  className={[
                    "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors",
                    selectedId === o.id ? "bg-nav-active text-nav-active-text" : "hover:bg-surface2",
                  ].join(" ")}
                >
                  <span className="font-mono text-xs">{o.orderNo}</span>
                  <span className="font-mono text-[11px] opacity-70">{money(o.commission)}</span>
                </button>
              </li>
            ))}
            {pending.length === 0 && <li className="px-3 py-6 font-mono text-xs text-muted">暂无待审核订单</li>}
          </ul>
        </Panel>

        <Panel title={selected ? `订单 ${selected.orderNo}` : "未选择订单"} className="lg:col-span-3">
          {selected ? (
            <div className="space-y-4">
              <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
                {[
                  { label: "客户", value: `${selected.customerName} · ${selected.payMethod === "wallet" ? "钱包" : "现金"}` },
                  { label: "实付 / 佣金", value: `${money(selected.paid)} / ${money(selected.commission)}` },
                  { label: "审核状态", value: <AuditStatusTag status={selected.auditStatus} /> },
                ].map((x) => (
                  <div key={String(x.label)} className="bg-surface p-3">
                    <p className="font-mono text-[11px] text-muted">{x.label}</p>
                    <p className="mt-1 text-sm font-medium">{x.value}</p>
                  </div>
                ))}
              </div>

              <DataTable<OrderMember>
                rowKey={(r) => r.employeeId}
                columns={[
                  { key: "name", label: "员工" },
                  { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
                  { key: "base", label: "基数", align: "right", mono: true, render: (r) => money(r.base) },
                  { key: "rate", label: "比例", align: "right", mono: true, render: (r) => (r.rate * 100).toFixed(1) + "%" },
                  { key: "commission", label: "佣金", align: "right", mono: true, render: (r) => money(r.commission) },
                ]}
                rows={selected.members}
              />

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => approve(selected.id)} disabled={selected.auditStatus !== "pending"}>
                  通过审核（入账）
                </Button>
                <Button variant="danger" onClick={() => reject(selected.id)} disabled={selected.auditStatus !== "approved"}>
                  撤销审核（冲回）
                </Button>
                <Button variant="secondary">覆盖提成（待实现）</Button>
              </div>
            </div>
          ) : (
            <p className="py-8 text-center font-mono text-xs text-muted">从左侧选择订单</p>
          )}
        </Panel>
      </div>

      <Panel title="操作记录" meta="Mock 本地状态">
        <ul className="space-y-1">
          {log.map((l, i) => (
            <li key={i} className="font-mono text-xs text-muted">{l}</li>
          ))}
          {log.length === 0 && <li className="font-mono text-xs text-muted">暂无操作</li>}
        </ul>
      </Panel>
    </div>
  );
}