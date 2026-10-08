"use client";

import { useEffect, useRef, useState } from "react";
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
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";
import { rpcApproveCommission, rpcBatchApproveOrders, rpcRejectOrderAudit, rpcSetPendingOrderCommissions } from "@/lib/supabase-api";
import { commissionChanges, orderActionMessage, verifiedBatchCount, type OrderActionData, type OrderActionResult } from "@/lib/order-actions";
import { NoPermission } from "@/components/business/RequireRole";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function AuditPage() {
  const { data: orders, real, mutate: setOrders } = useResource<Order>("orders", apiOrders, ORDERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [batchSelected, setBatchSelected] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [overrideOrder, setOverrideOrder] = useState<Order | null>(null);
  const [overrideVals, setOverrideVals] = useState<Record<string, string>>({});
  const [overrideMsg, setOverrideMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const request = useRef(false);
  const refreshRequired = useRef(false);
  const { isBoss, session, mockRole } = useAuth();
  const canMock = MOCK_LOGIN_ENABLED && !!mockRole && isBoss;
  const ready = !!session ? real : canMock;
  const pending = orders.filter((o) => o.auditStatus === "pending");
  const eligible = pending.filter((o) => o.status === "completed" && o.members.length > 0);
  const filteredCount = pending.length - eligible.length;
  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const eligibleSelected = selected?.status === "completed" && selected.auditStatus === "pending" && selected.members.length > 0;

  useEffect(() => {
    if (!selectedId || !orders.some((o) => o.id === selectedId)) {
      const first = orders.find((o) => o.status === "completed" && o.auditStatus === "pending" && o.members.length > 0);
      if (first) setSelectedId(first.id);
      else if (selectedId) setSelectedId(null);
    }
  }, [orders, selectedId]);
  useEffect(() => {
    setBatchSelected((previous) => {
      const retained = previous.filter((id) => orders.some((o) => o.id === id && o.status === "completed" && o.auditStatus === "pending" && o.members.length > 0));
      return retained.length === previous.length ? previous : retained;
    });
  }, [orders]);

  const record = (message: string) => setLog((previous) => [`${new Date().toLocaleTimeString()} ${message}`, ...previous]);

  const runAction = async (
    label: string,
    mutation: () => PromiseLike<OrderActionResult>,
    successMessage: (data: OrderActionData) => string,
    mockChange: () => void,
    onConfirmed?: () => void,
    onError?: (message: string) => void,
  ) => {
    if (request.current || refreshRequired.current) return;
    if (!isBoss || !ready) {
      setActionError("请先登录老板账号并加载真实订单后再操作。");
      return;
    }
    request.current = true;
    setBusy(true);
    setActionError(null);
    let confirmed = false;
    try {
      if (session) {
        const result = await mutation();
        if (result.error) throw result.error;
        if (result.data?.success !== true) throw { message: "服务端未确认成功，请刷新核对，勿重复提交。", uncertain: true };
        confirmed = true;
        onConfirmed?.();
        const message = successMessage(result.data);
        const rows = await apiOrders();
        if (!Array.isArray(rows)) throw new Error("未能读取最新订单");
        setOrders(() => rows);
        record(message);
      } else {
        mockChange();
        onConfirmed?.();
        record(`Mock 演示：${label}，未写入数据库`);
      }
    } catch (error) {
      const uncertain = confirmed || !(error && typeof error === "object" && "uncertain" in error) || !!(error as { uncertain?: boolean }).uncertain;
      if (uncertain) {
        refreshRequired.current = true;
        setNeedsRefresh(true);
      }
      const message = confirmed
        ? `${label}已获服务端确认，但返回结果或列表刷新未核对完成。请刷新订单，勿重复提交：${orderActionMessage(error)}`
        : `${label}${uncertain ? "结果未确认，请先刷新核对，勿重复提交" : "失败"}：${orderActionMessage(error)}`;
      setActionError(message);
      onError?.(message);
      record(message);
    } finally {
      request.current = false;
      setBusy(false);
    }
  };

  const refreshOrders = async () => {
    if (request.current || !session || !isBoss) return;
    request.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const rows = await apiOrders();
      if (!Array.isArray(rows)) throw new Error("未能读取最新订单");
      setOrders(() => rows);
      refreshRequired.current = false;
      setNeedsRefresh(false);
      record("订单已刷新，请按当前状态操作");
    } catch (error) {
      setActionError("刷新失败：" + orderActionMessage(error));
    } finally {
      request.current = false;
      setBusy(false);
    }
  };

  const approve = async (id: string) => {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== "completed" || o.auditStatus !== "pending" || o.members.length === 0) return setActionError("只能审核已完成、待审核且已分配员工的订单。");
    await runAction("审核", () => rpcApproveCommission(id), () => `已通过审核：${o.orderNo}，金额以刷新后的订单为准`,
      () => setOrders((previous) => previous.map((row) => row.id === id ? { ...row, auditStatus: "approved" } : row)));
  };

  const reject = async (id: string) => {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== "completed" || o.auditStatus !== "approved") return setActionError("只能撤销已完成且已审核订单的审核。");
    await runAction("撤销审核", () => rpcRejectOrderAudit(id), () => `已撤销审核：${o.orderNo}，恢复待审核`,
      () => setOrders((previous) => previous.map((row) => row.id === id ? { ...row, auditStatus: "pending", commission: 0, grossProfit: 0 } : row)));
  };

  const approveAll = async () => {
    const ids = [...new Set(eligible.filter((o) => batchSelected.includes(o.id)).map((o) => o.id))];
    if (ids.length === 0) return setActionError("请先勾选需要审核的已完成订单。");
    if (ids.length > 200) return setActionError("每批最多审核 200 笔，请到订单列表分批选择。");
    await runAction("批量审核", () => rpcBatchApproveOrders(ids), (data) => {
      const count = verifiedBatchCount(data, ids);
      return `本次实际审核 ${count} 笔；提交 ${ids.length} 笔，队列另过滤 ${filteredCount} 笔未完成或未分配员工的待审核订单`;
    }, () => setOrders((previous) => previous.map((row) => ids.includes(row.id) ? { ...row, auditStatus: "approved" } : row)));
  };

  const openOverride = (o: Order) => {
    if (request.current || refreshRequired.current || !ready || !isBoss) return;
    if (o.status !== "completed" || o.auditStatus !== "pending" || o.members.length === 0) return;
    setOverrideOrder(o);
    const init: Record<string, string> = {};
    o.members.forEach((m) => (init[m.employeeId] = m.override == null ? "" : String(m.override)));
    setOverrideVals(init);
    setOverrideMsg(null);
  };

  const saveOverride = async () => {
    if (!overrideOrder || request.current || refreshRequired.current) return;
    let commissions: { employee_id: string; amount: number | null }[];
    try {
      commissions = commissionChanges(overrideOrder.members, overrideVals);
    } catch (error) {
      setOverrideMsg(orderActionMessage(error));
      return;
    }
    setOverrideMsg(null);
    const id = overrideOrder.id;
    await runAction("保存提成覆盖", () => rpcSetPendingOrderCommissions(id, commissions), () => `提成覆盖已保存：${overrideOrder.orderNo}，空白项已恢复自动计算`,
      () => setOrders((previous) => previous.map((row) => row.id === id ? { ...row, members: row.members.map((member) => ({ ...member, override: commissions.find((entry) => entry.employee_id === member.employeeId)?.amount ?? null })) } : row)),
      () => setOverrideOrder(null), setOverrideMsg);
  };

  if (!isBoss || (!session && !canMock)) return <NoPermission />;

  return (
    <div className="space-y-6">
      <PageHeader title="提成审核台" meta={`/audit · ${real ? "真实数据" : "Mock 数据"} · 仅老板可操作`} />
      {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" disabled={busy || !session} onClick={() => void refreshOrders()}>{busy ? "处理中…" : "刷新订单"}</Button>
        {needsRefresh && <p role="status" className="text-xs text-muted">请先刷新核对已提交结果，再进行其他财务操作。</p>}
        {!ready && <p role="status" className="text-xs text-muted">真实订单尚未加载，财务操作暂不可用。</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title={`已完成待审核（${eligible.length}）`} className="lg:col-span-2">
          {filteredCount > 0 && <p className="mb-3 text-xs text-muted">已过滤 {filteredCount} 笔未完成或未分配员工的待审核订单。</p>}
          <p className="mb-3 text-xs text-muted">批量审核默认不选任何订单。请明确勾选需要处理的订单；包含受财务保护的历史订单时，整个批次会被拒绝。</p>
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy || batchSelected.length === 0} onClick={() => setBatchSelected([])}>清空选择</Button>
            <Button size="sm" variant="secondary" disabled={batchSelected.length === 0 || busy || needsRefresh || !ready} onClick={() => void approveAll()}>
              批量通过（已选 {batchSelected.length} 笔）
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {eligible.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <input type="checkbox" className="ml-3" aria-label={`选择订单 ${o.orderNo}`} checked={batchSelected.includes(o.id)} disabled={busy || needsRefresh || !ready}
                  onChange={(event) => setBatchSelected((previous) => event.target.checked ? [...new Set([...previous, o.id])] : previous.filter((id) => id !== o.id))} />
                <button
                  type="button"
                  onClick={() => setSelectedId(o.id)}
                  className={[
                    "flex flex-1 items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors",
                    selectedId === o.id ? "bg-nav-active text-nav-active-text" : "hover:bg-surface2",
                  ].join(" ")}
                >
                  <span className="font-mono text-xs">{o.orderNo}</span>
                  <span className="font-mono text-[11px] opacity-70">{money(o.commission)}</span>
                </button>
              </li>
            ))}
            {eligible.length === 0 && <li className="px-3 py-6 font-mono text-xs text-muted">暂无已完成且可审核的订单</li>}
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
                <Button onClick={() => void approve(selected.id)} disabled={!eligibleSelected || busy || needsRefresh || !ready}>
                  通过审核（入账）
                </Button>
                <Button variant="danger" onClick={() => void reject(selected.id)} disabled={selected.status !== "completed" || selected.auditStatus !== "approved" || busy || needsRefresh || !ready}>
                  撤销审核（冲回）
                </Button>
                <Button variant="secondary" onClick={() => openOverride(selected)} disabled={!eligibleSelected || busy || needsRefresh || !ready}>
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
        onClose={() => { if (!request.current) setOverrideOrder(null); }}
      >
        {overrideOrder && (
          <div className="space-y-3">
            {overrideMsg && <p role="alert" className="text-sm text-danger">{overrideMsg}</p>}
            <p className="text-xs text-muted">留空表示使用系统自动计算；只有明确填写的金额才覆盖提成。</p>
            {overrideOrder.members.map((m) => (
              <label key={m.employeeId} className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">
                  {m.name}（{m.override == null ? "当前自动计算" : `当前覆盖 ${money(m.override)}`}）
                </span>
                <Input
                  type="number"
                  disabled={busy}
                  value={overrideVals[m.employeeId] ?? ""}
                  onChange={(e) => setOverrideVals({ ...overrideVals, [m.employeeId]: e.target.value })}
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" disabled={busy} onClick={() => setOverrideOrder(null)}>取消</Button>
              <Button disabled={busy || needsRefresh || !ready} onClick={() => void saveOverride()}>{busy ? "保存中…" : "保存覆盖"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
