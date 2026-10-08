"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { OrderDetailModal } from "@/components/business/OrderDetailModal";
import { useResource } from "@/lib/data-store";
import { DataSourceBadge } from "@/lib/use-real-data";
import { dateKey } from "@/lib/date";
import { apiOrders, apiEmployees, rpcBatchStartOrders, rpcBatchApproveOrders, rpcBatchCompleteOrders } from "@/lib/supabase-api";
import { ORDERS, EMPLOYEES, type Order } from "@/lib/mock-data";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";
import { orderActionMessage, verifiedBatchCount } from "@/lib/order-actions";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

function exportCsv(rows: Order[], from: string, to: string) {
  const header = ["订单号", "客户", "支付方式", "原价", "实付", "折扣", "佣金", "毛利", "状态", "审核", "时间"];
  const lines = rows.map((o) =>
    [
      o.orderNo,
      o.customerName,
      o.payMethod === "wallet" ? "钱包" : "现金",
      o.original,
      o.paid,
      o.discount,
      o.commission,
      o.grossProfit,
      o.status,
      o.auditStatus,
      o.createdAt,
    ]
      .map((c) => '"' + String(c).replace(/"/g, '""') + '"')
      .join(","),
  );
  const csv = "\uFEFF" + [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "orders-" + (from || "all") + "-" + (to || "all") + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function OrdersPage() {
  const { data: orders, real, error, loading, mutate } = useResource<Order>("orders", apiOrders, ORDERS);
  const { session, isBoss, mockRole } = useAuth();

  const [status, setStatus] = useState("all");
  const [audit, setAudit] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [keyword, setKeyword] = useState("");
  const [payMethod, setPayMethod] = useState("all");
  const [minPaid, setMinPaid] = useState("");
  const [maxPaid, setMaxPaid] = useState("");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [employeeMode, setEmployeeMode] = useState<"or" | "and">("or");
  const [empKeyword, setEmpKeyword] = useState("");
  const { data: employees } = useResource("employees", apiEmployees, EMPLOYEES);

  const employeeSuggestions = employees.filter(
    (e) =>
      !employeeIds.includes(e.id) &&
      (empKeyword === "" || e.name.includes(empKeyword)),
  );

  const toggleEmployee = (id: string) =>
    setEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const batchRef = useRef(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [syncRequired, setSyncRequired] = useState(false);
  const syncRequiredRef = useRef(false);
  const refreshVersion = useRef(0);
  const markSyncRequired = (value: boolean) => { syncRequiredRef.current = value; setSyncRequired(value); };

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (audit !== "all" && o.auditStatus !== audit) return false;
      const day = dateKey(o.createdAt);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (keyword && !o.orderNo.includes(keyword) && !o.customerName.includes(keyword)) return false;
      if (employeeIds.length > 0) {
        const has = (id: string) => o.members.some((m) => m.employeeId === id);
        if (employeeMode === "or") {
          if (!employeeIds.some(has)) return false;
        } else if (!employeeIds.every(has)) return false;
      }
      if (payMethod !== "all" && o.payMethod !== payMethod) return false;
      if (minPaid !== "" && o.paid < Number(minPaid)) return false;
      if (maxPaid !== "" && o.paid > Number(maxPaid)) return false;
      return true;
    });
  }, [orders, status, audit, dateFrom, dateTo, keyword, payMethod, minPaid, maxPaid, employeeIds, employeeMode]);

  useEffect(() => {
    setSelected((prev) => prev.filter((id) => orders.some((o) => o.id === id)));
  }, [orders]);

  const resetFilters = () => {
    setStatus("all");
    setAudit("all");
    setDateFrom("");
    setDateTo("");
    setKeyword("");
    setPayMethod("all");
    setMinPaid("");
    setMaxPaid("");
    setEmployeeIds([]);
    setEmployeeMode("or");
    setEmpKeyword("");
  };

  const [sortKey, setSortKey] = useState<"createdAt" | "paid" | "commission">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      // 按时间排序必须用原始 ISO 时间（createdAt 是格式化字符串，字典序会把 10 号排到 9 号前）
      const ka = sortKey === "createdAt" ? (a.createdAtRaw || a.createdAt) : (a[sortKey] ?? 0);
      const kb = sortKey === "createdAt" ? (b.createdAtRaw || b.createdAt) : (b[sortKey] ?? 0);
      const av = ka as string | number;
      const bv = kb as string | number;
      const cmp =
        typeof av === "string"
          ? String(av).localeCompare(String(bv))
          : Number(av) - Number(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const countBy = (key: "status" | "auditStatus", v: string) => orders.filter((o) => o[key] === v).length;

  const refreshOrders = async () => {
    const version = ++refreshVersion.current;
    const rows = await apiOrders();
    if (!Array.isArray(rows)) throw new Error("订单列表读取失败，请稍后刷新核对。");
    if (version !== refreshVersion.current) return rows;
    mutate(() => rows);
    markSyncRequired(false);
    return rows;
  };

  const refreshManually = async () => {
    if (batchRef.current) return;
    batchRef.current = true;
    setBatchBusy(true);
    try { await refreshOrders(); setBatchMsg("订单已刷新，请按当前状态操作。"); }
    catch (err) { setBatchMsg(orderActionMessage(err)); }
    finally { batchRef.current = false; setBatchBusy(false); }
  };

  const runBatch = async (kind: "start" | "complete" | "approve") => {
    if (batchRef.current || syncRequiredRef.current || selected.length === 0) return;
    if (kind === "approve" && !isBoss) return setBatchMsg("仅老板可批量审核");
    if (!session && !(MOCK_LOGIN_ENABLED && mockRole)) return setBatchMsg("请先登录后操作订单。");
    const ids = [...new Set(selected)];
    if (ids.length > 200) return setBatchMsg("一次最多操作 200 笔，请减少勾选数量。");
    batchRef.current = true;
    ++refreshVersion.current;
    setBatchBusy(true);
    setBatchMsg(null);
    const label = kind === "start" ? "开始" : kind === "complete" ? "完成" : "审核";
    let confirmed = false;
    let count = 0;
    try {
      if (session) {
        const { data, error: actionError } = await (kind === "start" ? rpcBatchStartOrders(ids) : kind === "complete" ? rpcBatchCompleteOrders(ids) : rpcBatchApproveOrders(ids));
        if (actionError || data?.success !== true) {
          if (actionError?.uncertain) markSyncRequired(true);
          const reasons = data?.skipped?.map(item => orderActionMessage(item.message ?? item.code)).filter(Boolean) ?? [];
          return setBatchMsg("本次 0 笔变更；批量" + label + "未完成：" + orderActionMessage(actionError ?? data?.message) + (reasons.length ? "；" + [...new Set(reasons)].join("；") : ""));
        }
        confirmed = true;
        count = verifiedBatchCount(data, ids);
        await refreshOrders();
        const skipped = data.skipped?.map(item => orderActionMessage(item.message ?? item.code)).filter(Boolean) ?? [];
        setBatchMsg("本次实际" + label + " " + count + " 笔；未变更 " + (ids.length - count) + " 笔。" + (skipped.length ? " " + [...new Set(skipped)].join("；") : ""));
        setSelected(data.updated_ids ? prev => prev.filter(id => !data.updated_ids!.includes(id)) : []);
      } else {
        const changed = orders.filter(o => ids.includes(o.id) && o.auditStatus !== "rejected" && (kind === "start" ? o.status === "booking" : kind === "complete" ? o.status === "booking" || o.status === "in_progress" : o.status === "completed" && o.auditStatus === "pending"));
        const changedIds = new Set(changed.map(o => o.id));
        mutate(prev => prev.map(o => changedIds.has(o.id) ? kind === "approve" ? { ...o, auditStatus: "approved" } : { ...o, status: kind === "start" ? "in_progress" : "completed" } : o));
        setBatchMsg("Mock：本次实际" + label + " " + changed.length + " 笔。");
        setSelected(prev => prev.filter(id => !changedIds.has(id)));
      }
    } catch (err) {
      markSyncRequired(!!session);
      setBatchMsg((confirmed ? "服务端已确认操作，但列表刷新或结果核对未完成，请刷新核对，勿重复提交：" : "操作结果未确认，请刷新核对：") + orderActionMessage(err));
    } finally {
      batchRef.current = false;
      setBatchBusy(false);
    }
  };
  const batchStart = () => runBatch("start");
  const batchComplete = () => runBatch("complete");
  const batchApprove = () => runBatch("approve");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title="订单"
          meta={`/orders · 共 ${orders.length} 笔${real ? " · 真实数据" : "（Mock）"}${error ? " · ⚠ " + error.slice(0, 40) : ""}`}
        />
        <div className="flex items-center gap-3">
          <DataSourceBadge real={real} />
          <Button size="sm" variant="secondary" disabled={batchBusy} onClick={() => { void refreshManually(); }} title="重新拉取订单（应对缓存陈旧）">
            刷新
          </Button>
          <Button size="sm" variant="secondary" onClick={() => exportCsv(filtered, dateFrom, dateTo)} disabled={filtered.length === 0}>
            导出 CSV（{filtered.length}）
          </Button>
        </div>
      </div>

      <Panel title="筛选条件" meta={`命中 ${filtered.length} 笔`}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="搜索订单号 / 客户名…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-56"
            />
            <FilterTabs
              tabs={[
                { id: "all", label: "状态-全部" },
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
          <div className="flex flex-wrap items-center gap-3">
            <FilterTabs
              tabs={[
                { id: "or", label: "合并" },
                { id: "and", label: "交集" },
              ]}
              active={employeeMode}
              onChange={(id) => setEmployeeMode(id as "or" | "and")}
            />
            <div className="relative">
              <Input
                placeholder="搜索员工添加…"
                value={empKeyword}
                onChange={(e) => setEmpKeyword(e.target.value)}
                className="w-44"
              />
              {empKeyword !== "" && employeeSuggestions.length > 0 && (
                <ul className="absolute z-30 mt-1 w-56 rounded-md border border-line bg-surface shadow-md">
                  {employeeSuggestions.slice(0, 6).map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => {
                          toggleEmployee(e.id);
                          setEmpKeyword("");
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface2"
                      >
                        {e.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {employeeIds.map((id) => {
              const e = employees.find((x) => x.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleEmployee(id)}
                  className="rounded-md bg-nav-active px-2 py-1 font-mono text-[10px] text-nav-active-text"
                >
                  {e?.name ?? id} ×
                </button>
              );
            })}
            {employeeIds.length > 0 && (
              <span className="font-mono text-[10px] text-muted">
                {employeeMode === "or" ? "合并（任一）" : "交集（全部）"}
              </span>
            )}
            <FilterTabs
              tabs={[
                { id: "all", label: "支付-全部" },
                { id: "wallet", label: "钱包" },
                { id: "cash", label: "现金" },
              ]}
              active={payMethod}
              onChange={setPayMethod}
            />
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
            <span className="font-mono text-[10px] text-muted">至</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
            <Input type="number" placeholder="实付 ≥" value={minPaid} onChange={(e) => setMinPaid(e.target.value)} className="w-24" />
            <span className="font-mono text-[10px] text-muted">至</span>
            <Input type="number" placeholder="实付 ≤" value={maxPaid} onChange={(e) => setMaxPaid(e.target.value)} className="w-24" />
            <Button size="sm" variant="ghost" onClick={resetFilters}>重置</Button>
            <span className="ml-2 border-l border-line pl-3 font-mono text-[10px] text-muted">排序</span>
            <FilterTabs
              tabs={[
                { id: "createdAt", label: "日期" },
                { id: "paid", label: "金额" },
                { id: "commission", label: "佣金" },
              ]}
              active={sortKey}
              onChange={(id) => setSortKey(id as "createdAt" | "paid" | "commission")}
            />
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[11px] transition-colors hover:bg-surface2"
            >
              {sortDir === "asc" ? "↑ 升序" : "↓ 降序"}
            </button>
          </div>
        </div>
      </Panel>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border border-line bg-surface p-3">
          <span className="font-mono text-xs text-muted">已选 {selected.length} 笔</span>
          <Button size="sm" variant="secondary" disabled={batchBusy || syncRequired} onClick={batchStart}>批量开始</Button>
          <Button size="sm" variant="secondary" disabled={batchBusy || syncRequired} onClick={() => void batchComplete()}>批量完成</Button>
          {isBoss && <Button size="sm" variant="secondary" disabled={batchBusy || syncRequired} onClick={batchApprove}>批量审核</Button>}
          <Button size="sm" variant="ghost" disabled={batchBusy} onClick={() => setSelected([])}>取消选择</Button>
        </div>
      )}

      {batchMsg && <p role="status" className="font-mono text-xs text-muted">{batchMsg}</p>}

      <Panel title={`订单列表（${filtered.length}）`} meta="双击行查看详情 · 支持勾选批量操作">
        <DataTable<Order>
          rowKey={(r) => r.id}
          onRowDoubleClick={(r) => setDetailId(r.id)}
          columns={[
            {
              key: "sel",
              label: (
                <input
                  type="checkbox"
                  checked={sorted.length > 0 && sorted.every((o) => selected.includes(o.id))}
                  ref={(el) => { if (el) el.indeterminate = sorted.some((o) => selected.includes(o.id)) && !sorted.every((o) => selected.includes(o.id)); }}
                  onChange={(e) => {
                    if (e.target.checked) setSelected((prev) => [...new Set([...prev, ...sorted.map((o) => o.id)])]);
                    else setSelected((prev) => prev.filter((id) => !sorted.some((o) => o.id === id)));
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 accent-black"
                  disabled={batchBusy}
                  aria-label="全选当前筛选结果"
                />
              ),
              align: "center",
              render: (r) => (
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  disabled={batchBusy}
                  onChange={() => toggleSelect(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 accent-black"
                />
              ),
            },
            { key: "orderNo", label: "订单号", mono: true, render: (r) => <Link className="underline decoration-line underline-offset-2 hover:text-accent" href={`/orders/${r.id}`}>{r.orderNo}</Link> },
            { key: "operator", label: "创建用户", render: (r) => r.operator || <span className="text-muted">—</span> },
            { key: "customer", label: "客户", render: (r) => `${r.customerName}${r.customerType === "vip" ? ` · VIP${r.vipLevel}` : ""}` },
            { key: "members", label: "员工", render: (r) => (r.members.length > 0 ? r.members.map((m) => m.name).join("、") : <span className="text-muted">—</span>) },
            { key: "payMethod", label: "支付", mono: true, render: (r) => (r.payMethod === "wallet" ? "钱包" : "现金") },
            { key: "original", label: "原价", align: "right", mono: true, render: (r) => money(r.original) },
            { key: "paid", label: "实付", align: "right", mono: true, render: (r) => money(r.paid) },
            { key: "commission", label: "佣金", align: "right", mono: true, render: (r) => money(r.commission) },
            { key: "status", label: "状态", render: (r) => <OrderStatusTag status={r.status} /> },
            { key: "audit", label: "审核", render: (r) => <AuditStatusTag status={r.auditStatus} /> },
            { key: "createdAt", label: "时间", mono: true, render: (r) => r.createdAt },
          ]}
          rows={sorted}
          empty={loading ? "加载中…" : "暂无数据"}
        />
      </Panel>

      <p className="font-mono text-[11px] text-muted">
        <Link href="/audit" className="underline underline-offset-2 hover:text-accent">→ 去审核台处理待审核订单</Link>
      </p>

      <OrderDetailModal
        orderId={detailId}
        onClose={() => setDetailId(null)}
        onDeleted={(id) => {
          mutate((prev) => prev.filter((o) => o.id !== id));
          setDetailId(null);
        }}
        onChanged={() => {
          void refreshManually();
        }}
      />
    </div>
  );
}
