"use client";

import { useEffect, useMemo, useState } from "react";
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
import { apiOrders, apiEmployees, rpcBatchStartOrders, rpcBatchApproveOrders } from "@/lib/supabase-api";
import { ORDERS, EMPLOYEES, type Order } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth";

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
  const { session, isBoss } = useAuth();

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

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (audit !== "all" && o.auditStatus !== audit) return false;
      const day = o.createdAt.slice(0, 10);
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
      const av = (a[sortKey] ?? 0) as string | number;
      const bv = (b[sortKey] ?? 0) as string | number;
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

  const batchStart = async () => {
    if (selected.length === 0) return;
    if (session) {
      const { data, error } = await rpcBatchStartOrders(selected);
      if (error || data?.success === false) return setBatchMsg("批量开始失败：" + (error?.message ?? data?.message));
    }
    mutate((prev) =>
      prev.map((o) => (selected.includes(o.id) && o.status === "booking" ? { ...o, status: "in_progress" } : o)),
    );
    setBatchMsg(`已批量开始 ${selected.length} 笔`);
    setSelected([]);
  };

  const batchApprove = async () => {
    if (selected.length === 0) return;
    if (!isBoss) return setBatchMsg("仅老板可批量审核");
    if (session) {
      const { data, error } = await rpcBatchApproveOrders(selected);
      if (error || data?.success === false) return setBatchMsg("批量审核失败：" + (error?.message ?? data?.message));
    }
    mutate((prev) =>
      prev.map((o) => (selected.includes(o.id) && o.auditStatus === "pending" ? { ...o, auditStatus: "approved" } : o)),
    );
    setBatchMsg(`已批量审核 ${selected.length} 笔`);
    setSelected([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title="订单"
          meta={`/orders · 共 ${orders.length} 笔${real ? " · 真实数据" : "（Mock）"}${error ? " · ⚠ " + error.slice(0, 40) : ""}`}
        />
        <div className="flex items-center gap-3">
          <DataSourceBadge real={real} />
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
          <Button size="sm" variant="secondary" onClick={batchStart}>批量开始</Button>
          {isBoss && <Button size="sm" variant="secondary" onClick={batchApprove}>批量审核</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>取消选择</Button>
          {batchMsg && <span className="font-mono text-[11px] text-muted">{batchMsg}</span>}
        </div>
      )}

      <Panel title={`订单列表（${filtered.length}）`} meta="双击行查看详情 · 支持勾选批量操作">
        <DataTable<Order>
          rowKey={(r) => r.id}
          onRowDoubleClick={(r) => setDetailId(r.id)}
          columns={[
            {
              key: "sel",
              label: "✓",
              align: "center",
              render: (r) => (
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={() => toggleSelect(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 accent-black"
                />
              ),
            },
            { key: "orderNo", label: "订单号", mono: true, render: (r) => <Link className="underline decoration-line underline-offset-2 hover:text-accent" href={`/orders/${r.id}`}>{r.orderNo}</Link> },
            { key: "customer", label: "客户", render: (r) => `${r.customerName}${r.customerType === "vip" ? ` · VIP${r.vipLevel}` : ""}` },
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

      <OrderDetailModal orderId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}