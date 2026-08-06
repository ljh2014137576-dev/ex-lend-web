"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { AuditStatusTag } from "@/components/business/OrderStatusTag";
import { ORDERS, type Order, type OrderMember } from "@/lib/mock-data";
import { apiOrders } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { rpcApproveCommission, rpcBatchApproveOrders, rpcRejectOrderAudit, rpcSetPendingOrderCommissions } from "@/lib/supabase-api";
import { NoPermission } from "@/components/business/RequireRole";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function AuditPage() {
  const { data: orders, real, mutate: setOrders } = useResource<Order>("orders", apiOrders, ORDERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && orders.length > 0) {
      const firstPending = orders.find((o) => o.auditStatus === "pending");
      if (firstPending) setSelectedId(firstPending.id);
    }
  }, [orders, selectedId]);
  const [log, setLog] = useState<string[]>([]);
  const [overrideOrder, setOverrideOrder] = useState<Order | null>(null);
  const [overrideVals, setOverrideVals] = useState<Record<string, string>>({});
  const { isBoss, session } = useAuth();
  if (!isBoss) return <NoPermission />;

  const pending = orders.filter((o) => o.auditStatus === "pending");
  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const approve = async (id: string) => {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    // 乐观更新：前端立即生效；RPC 失败再回滚
    setOrders((prev) => prev.map((x) => (x.id === id ? { ...x, auditStatus: "approved" } : x)));
    if (session) {
      const { data, error } = await rpcApproveCommission(id);
      if (error || (data && data.success === false)) {
        setOrders((prev) => prev.map((x) => (x.id === id ? { ...x, auditStatus: o.auditStatus } : x)));
        return setLog((l) => [`${new Date().toLocaleTimeString()} 审核失败：${error?.message ?? data?.message}`, ...l]);
      }
      if (data && typeof data.total_commission === "number") {
        setOrders((prev) => prev.map((x) => (x.id === id ? { ...x, commission: Number(data.total_commission), grossProfit: Number(data.gross_profit ?? 0) } : x)));
      }
    }
    setLog((l) => [`${new Date().toLocaleTimeString()} 通过审核：${o.orderNo}（佣金 ${money(o.commission)}）`, ...l]);
  };

  const reject = async (id: string) => {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    setOrders((prev) => prev.map((x) => (x.id === id ? { ...x, auditStatus: "rejected" } : x)));
    if (session) {
      const { data, error } = await rpcRejectOrderAudit(id);
      if (error || (data && data.success === false)) {
        setOrders((prev) => prev.map((x) => (x.id === id ? { ...x, auditStatus: o.auditStatus } : x)));
        return setLog((l) => [`${new Date().toLocaleTimeString()} 撤销失败：${error?.message ?? data?.message}`, ...l]);
      }
    }
    setLog((l) => [`${new Date().toLocaleTimeString()} 撤销审核：${o.orderNo}`, ...l]);
  };

  const approveAll = async () => {
    if (pending.length === 0) return;
    const ids = pending.map((o) => o.id);
    setOrders((prev) => prev.map((o) => (o.auditStatus === "pending" ? { ...o, auditStatus: "approved" } : o)));
    if (session) {
      const { data, error } = await rpcBatchApproveOrders(ids);
      if (error || (data && data.success === false)) {
        setOrders((prev) => prev.map((o) => (ids.includes(o.id) ? { ...o, auditStatus: "pending" } : o)));
        return setLog((l) => [`${new Date().toLocaleTimeString()} 批量审核失败：${error?.message ?? data?.message}`, ...l]);
      }
    }
    setLog((l) => [`${new Date().toLocaleTimeString()} 批量通过 ${ids.length} 笔`, ...l]);
  };

  const openOverride = (o: Order) => {
    setOverrideOrder(o);
    const init: Record<string, string> = {};
    o.members.forEach((m) => (init[m.employeeId] = String(m.commission)));
    setOverrideVals(init);
  };

  const saveOverride = async () => {
    if (!overrideOrder) return;
    const prevOrder = overrideOrder;
    const apply = (o: Order) =>
      o.id === overrideOrder.id
        ? {
            ...o,
            commission: Object.values(overrideVals).reduce((s, v) => s + (Number(v) || 0), 0),
            members: o.members.map((m) => ({ ...m, commission: Number(overrideVals[m.employeeId]) || 0, override: Number(overrideVals[m.employeeId]) || 0 })),
          }
        : o;
    setOrders((prev) => prev.map(apply));
    if (session) {
      const commissions = prevOrder.members.map((m) => ({ employee_id: m.employeeId, amount: Number(overrideVals[m.employeeId]) || 0 }));
      const { data, error } = await rpcSetPendingOrderCommissions(prevOrder.id, commissions);
      if (error || (data && data.success === false)) {
        setOrders((prev) => prev.map((o) => (o.id === prevOrder.id ? prevOrder : o)));
        return setLog((l) => [`${new Date().toLocaleTimeString()} 覆盖提成失败：${error?.message ?? data?.message}`, ...l]);
      }
    }
    setLog((l) => [`${new Date().toLocaleTimeString()} 覆盖提成：${overrideOrder.orderNo}`, ...l]);
    setOverrideOrder(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="提成审核台" meta={`/audit · ${real ? "真实数据" : "Mock 数据"} · 仅老板可操作`} />

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title={`待审核队列（${pending.length}）`} className="lg:col-span-2">
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="secondary" disabled={pending.length === 0} onClick={approveAll}>
              批量通过
            </Button>
          </div>
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
                <div className="bg-surface p-3">
                  <p className="font-mono text-[11px] text-muted">客户</p>
                  <p className="mt-1 text-sm font-medium">{selected.customerName} · {selected.payMethod === "wallet" ? "钱包" : "现金"}</p>
                </div>
                <div className="bg-surface p-3">
                  <p className="font-mono text-[11px] text-muted">实付 / 佣金</p>
                  <p className="mt-1 text-sm font-medium">{money(selected.paid)} / {money(selected.commission)}</p>
                </div>
                <div className="bg-surface p-3">
                  <p className="font-mono text-[11px] text-muted">审核状态</p>
                  <p className="mt-1 text-sm font-medium"><AuditStatusTag status={selected.auditStatus} /></p>
                </div>
              </div>

              <DataTable<OrderMember>
                rowKey={(r) => r.employeeId}
                columns={[
                  { key: "name", label: "员工" },
                  { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
                  { key: "base", label: "基数", align: "right", mono: true, render: (r) => money(r.base) },
                  { key: "rate", label: "比例", align: "right", mono: true, render: (r) => (r.rate * 100).toFixed(1) + "%" },
                  { key: "commission", label: "佣金", align: "right", mono: true, render: (r) => money(r.commission) },
                  { key: "override", label: "覆盖", align: "right", mono: true, render: (r) => (r.override != null ? money(r.override) : <span className="text-muted">—</span>) },
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
                <Button variant="secondary" onClick={() => openOverride(selected)} disabled={selected.auditStatus !== "pending"}>
                  覆盖提成
                </Button>
              </div>
            </div>
          ) : (
            <p className="py-8 text-center font-mono text-xs text-muted">从左侧选择订单</p>
          )}
        </Panel>
      </div>

      <Panel title="操作记录" meta={real ? "本次操作记录" : "Mock 本地状态"}>
        <ul className="space-y-1">
          {log.map((l, i) => (
            <li key={i} className="font-mono text-xs text-muted">{l}</li>
          ))}
          {log.length === 0 && <li className="font-mono text-xs text-muted">暂无操作</li>}
        </ul>
      </Panel>

      <Modal
        open={!!overrideOrder}
        title={`覆盖提成 — ${overrideOrder?.orderNo ?? ""}`}
        onClose={() => setOverrideOrder(null)}
      >
        {overrideOrder && (
          <div className="space-y-3">
            {overrideOrder.members.map((m) => (
              <label key={m.employeeId} className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">
                  {m.name}（原 {money(m.commission)}）
                </span>
                <Input
                  type="number"
                  value={overrideVals[m.employeeId] ?? ""}
                  onChange={(e) => setOverrideVals({ ...overrideVals, [m.employeeId]: e.target.value })}
                />
              </label>
            ))}
            <p className="font-mono text-[11px] text-muted">
              合计：{money(Object.values(overrideVals).reduce((s, v) => s + (Number(v) || 0), 0))}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setOverrideOrder(null)}>取消</Button>
              <Button onClick={saveOverride}>保存覆盖</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}