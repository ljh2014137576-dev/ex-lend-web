"use client";

import { useMemo, useState } from "react";
import { dateKey } from "@/lib/date";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { Modal } from "@/components/ui/Modal";
import { WALLET_LEDGERS, CUSTOMER_LEDGERS, EMPLOYEES, DELETE_LOGS, ORDERS, CUSTOMERS, type Employee, type Order, type Customer } from "@/lib/mock-data";
import { apiEmployees, apiOrders, apiCustomers, apiWalletLedgers, apiCustomerLedgers, apiPayouts, apiDeleteLogs } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { BossOnly } from "@/components/business/RequireRole";
import { OrderNoPreview } from "@/components/business/OrderPreview";
import { LedgerPartners } from "@/components/business/LedgerPartners";
import { rpcPayoutSalary } from "@/lib/supabase-api";
import { useAuth } from "@/lib/auth";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

interface PayoutRow {
  id: string;
  batchNo: string;
  operator: string;
  total: number;
  count: number;
  status: string;
  at: string;
}

const fmtDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1));
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const RANGE_PRESETS: { id: string; label: string; range: () => { from: string; to: string } }[] = [
  { id: "today", label: "今日", range: () => { const t = new Date(); return { from: fmtDay(t), to: fmtDay(t) }; } },
  { id: "week", label: "本周", range: () => { const t = new Date(); return { from: fmtDay(startOfWeek(t)), to: fmtDay(t) }; } },
  { id: "lastWeek", label: "上周", range: () => { const t = new Date(); const m = startOfWeek(t); return { from: fmtDay(addDays(m, -7)), to: fmtDay(addDays(m, -1)) }; } },
  { id: "month", label: "本月", range: () => { const t = new Date(); return { from: fmtDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: fmtDay(t) }; } },
  { id: "d7", label: "近7天", range: () => { const t = new Date(); return { from: fmtDay(addDays(t, -6)), to: fmtDay(t) }; } },
  { id: "d30", label: "近30天", range: () => { const t = new Date(); return { from: fmtDay(addDays(t, -29)), to: fmtDay(t) }; } },
  { id: "all", label: "全部", range: () => ({ from: "", to: "" }) },
];

const INITIAL_PAYOUTS: PayoutRow[] = [
  { id: "pa1", batchNo: "PB20260731", operator: "灰晨", total: 3200, count: 3, status: "completed", at: "2026-07-31 20:00" },
  { id: "pa2", batchNo: "PB20260715", operator: "灰晨", total: 2800, count: 2, status: "completed", at: "2026-07-15 20:00" },
];

export default function FinancePage() {

  const { data: employees, mutate: setEmployees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: payouts, mutate: setPayouts } = useResource<PayoutRow>("payouts", apiPayouts, INITIAL_PAYOUTS);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);

  const openPayout = () => {
    const init: Record<string, string> = {};
    employees.filter((e) => e.status === "active").forEach((e) => (init[e.id] = ""));
    setAmounts(init);
    setHint(null);
    setPayoutOpen(true);
  };

  const { session, name } = useAuth();
  const { data: orders, real } = useResource<Order>("orders", apiOrders, ORDERS);
  const { data: customers } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { data: walletLedgers } = useResource("walletLedgers", apiWalletLedgers, WALLET_LEDGERS);
  const { data: customerLedgers } = useResource("customerLedgers", apiCustomerLedgers, CUSTOMER_LEDGERS);
  const { data: deleteLogs } = useResource("deleteLogs", apiDeleteLogs, DELETE_LOGS);
  const approvedOrders = orders.filter((o) => o.auditStatus === "approved");
  const grossProfitTotal = approvedOrders.reduce((s, o) => s + o.grossProfit, 0);
  const commissionTotal = approvedOrders.reduce((s, o) => s + o.commission, 0);
  const inFlightPending = orders
    .filter((o) => o.status === "booking" || o.status === "in_progress")
    .reduce((s, o) => s + (o.pending ?? 0), 0);
  const customerDeposits = customers.reduce((s, c) => s + c.principal + c.bonus, 0);
  const customerPending = customers.reduce((s, c) => s + c.pending, 0);
  const [preset, setPreset] = useState("week");
  const [range, setRange] = useState(() => RANGE_PRESETS.find((p) => p.id === "week")!.range());
  const pickPreset = (id: string) => {
    setPreset(id);
    const r = RANGE_PRESETS.find((p) => p.id === id)?.range();
    if (r) setRange(r);
  };

  const today = dateKey(new Date());
  const todayOrders = orders.filter((o) => dateKey(o.createdAt) === today);
  const todayCommission = todayOrders
    .filter((o) => o.auditStatus === "approved")
    .reduce((s, o) => s + o.commission, 0);
  // 营业额：按日期范围筛选（默认本周）；名义收入=订单字面金额（未减折扣），真实收入=实付（已去折扣）且不含已取消订单
  const rangeOrders = useMemo(
    () =>
      orders.filter((o) => {
        const d = dateKey(o.createdAt);
        return (!range.from || d >= range.from) && (!range.to || d <= range.to);
      }),
    [orders, range],
  );
  const nominalRevenue = rangeOrders.reduce((s, o) => s + o.original, 0);
  const activeRangeOrders = rangeOrders.filter((o) => o.status !== "cancelled");
  const realRevenue = activeRangeOrders.reduce((s, o) => s + o.paid, 0);
  const rangeDiscount = activeRangeOrders.reduce((s, o) => s + o.discount, 0);
  const rangeCancelled = rangeOrders.length - activeRangeOrders.length;
  const pendingAuditCommission = orders
    .filter((o) => o.auditStatus === "pending")
    .reduce((s, o) => s + o.commission, 0);
  // 员工钱包合计 = 所有在职员工的 wallet_balance 之和（来自缓存，真实模式为线上数据）
  const totalWallet = employees.filter((e) => e.status === "active").reduce((s, e) => s + e.wallet, 0);
  // 毛利趋势：近 7 日，按已审核订单毛利聚合（真实数据）
  const trendData = useMemo(() => {
    const days: { day: string; v: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = dateKey(new Date(Date.now() - i * 86400000));
      days.push({ day: d.slice(5), v: 0 });
    }
    approvedOrders.forEach((o) => {
      const hit = days.find((x) => dateKey(o.createdAt) === x.day);
      if (hit) hit.v += o.grossProfit;
    });
    return days;
  }, [approvedOrders]);
  const maxTrend = Math.max(1, ...trendData.map((g) => g.v));



  const submitPayout = async () => {
    setHint(null);
    const active = employees.filter((e) => e.status === "active");
    const rows = active
      .map((e) => ({ e, v: Number(amounts[e.id]) || 0 }))
      .filter((r) => r.v > 0);
    if (rows.length === 0) return setHint("请至少填写一名员工的发放金额");
    for (const r of rows) {
      if (!r.e.isDebt && r.e.wallet < r.v) {
        return setHint(`员工 ${r.e.name} 余额不足（当前 ${money(r.e.wallet)}，欲发 ${money(r.v)}）`);
      }
    }
    const total = rows.reduce((s, r) => s + r.v, 0);
    const batchNo = "PB" + new Date().toISOString().replace(/\D/g, "").slice(0, 8);

    if (session) {
      const { data, error } = await rpcPayoutSalary(
        rows.map((r) => ({ employee_id: r.e.id, amount: r.v })),
        batchNo,
      );
      if (error || data?.success === false) {
        return setHint("发放失败：" + (error?.message ?? data?.message ?? "未知错误"));
      }
    }
    setEmployees((prev) =>
      prev.map((e) => {
        const row = rows.find((r) => r.e.id === e.id);
        return row ? { ...e, wallet: +(e.wallet - row.v).toFixed(2) } : e;
      }),
    );
    setPayouts((p) => [{ id: "pa" + Date.now(), batchNo, operator: name || "当前用户", total, count: rows.length, status: "completed", at: new Date().toLocaleString("zh-CN") }, ...p]);
    setPayoutOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="财务" meta={`/finance · ${real ? "真实数据" : "Mock 数据"} · 老板可操作，管理岗只读`} />

      <Panel title="营业额" meta={`${range.from || "最早"} ~ ${range.to || "今天"} · 名义=字面金额 · 真实=实付且不含已取消`}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <FilterTabs
              tabs={RANGE_PRESETS.map((p) => ({ id: p.id, label: p.label }))}
              active={preset}
              onChange={pickPreset}
            />
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={range.from}
                onChange={(e) => {
                  setPreset("");
                  setRange((r) => ({ ...r, from: e.target.value }));
                }}
                className="w-36"
              />
              <span className="font-mono text-[10px] text-muted">至</span>
              <Input
                type="date"
                value={range.to}
                onChange={(e) => {
                  setPreset("");
                  setRange((r) => ({ ...r, to: e.target.value }));
                }}
                className="w-36"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-surface p-4">
              <p className="font-mono text-[11px] text-muted">名义收入</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{money(nominalRevenue)}</p>
              <p className="font-mono text-[10px] text-muted">{rangeOrders.length} 单 · 订单字面金额合计（未减折扣）</p>
            </div>
            <div className="bg-surface p-4">
              <p className="font-mono text-[11px] text-muted">真实收入</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{money(realRevenue)}</p>
              <p className="font-mono text-[10px] text-muted">{activeRangeOrders.length} 单 · 实付合计（已去折扣，不含已取消）</p>
            </div>
            <div className="bg-surface p-4">
              <p className="font-mono text-[11px] text-muted">折扣金额</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{money(rangeDiscount)}</p>
              <p className="font-mono text-[10px] text-muted">区间内非取消订单折扣合计</p>
            </div>
            <div className="bg-surface p-4">
              <p className="font-mono text-[11px] text-muted">已取消订单</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{rangeCancelled} 单</p>
              <p className="font-mono text-[10px] text-muted">已从真实收入中排除</p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {[
          { label: "今日提成", value: money(todayCommission) },
          { label: "总毛利（已审核）", value: money(grossProfitTotal) },
          { label: "进行中临时金额", value: money(inFlightPending) },
          { label: "客户存款总额", value: money(customerDeposits) },
          { label: "客户待结", value: money(customerPending) },
          { label: "员工钱包合计", value: money(totalWallet) },
          { label: "待审核佣金", value: money(pendingAuditCommission) },
        ].map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{s.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <Panel title="毛利趋势（近 7 日）" meta={`元 · ${real ? "真实" : "Mock"}`}>
        <div className="flex h-40 items-end gap-3 border-b border-line">
          {trendData.map((g) => (
            <div key={g.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[10px] text-muted">{g.v}</span>
              <div className="w-full bg-accent/70" style={{ height: Math.max(8, (g.v / maxTrend) * 120) + "px" }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-3">
          {trendData.map((g) => (
            <span key={g.day} className="flex-1 text-center font-mono text-[10px] text-muted">{g.day}</span>
          ))}
        </div>
      </Panel>

      <Panel title="打款批次" meta={`payout${real ? "（真实）" : "（Mock）"}`}>
        <DataTable<PayoutRow>
          rowKey={(r) => r.id}
          columns={[
            { key: "batchNo", label: "批次号", mono: true },
            { key: "operator", label: "操作人" },
            { key: "total", label: "总额", align: "right", mono: true, render: (r) => money(r.total) },
            { key: "count", label: "明细数", align: "right", mono: true },
            { key: "status", label: "状态", mono: true },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={payouts}
        />
      </Panel>

      <Panel title="员工钱包流水" meta={`wallet_ledger${real ? "（真实）" : "（Mock）"}`}>
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "employee", label: "员工" },
            { key: "amount", label: "金额", align: "right", mono: true, render: (r) => money(r.amount) },
            { key: "balance", label: "变动后余额", align: "right", mono: true, render: (r) => money(r.balance) },
            { key: "orderNo", label: "关联订单", render: (r) => <OrderNoPreview orderNo={r.orderNo} orders={orders} /> },
            { key: "partner", label: "协作", render: (r) => <LedgerPartners orderNo={r.orderNo} currentEmployee={r.employee} orders={orders} /> },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={walletLedgers}
        />
      </Panel>

      <Panel title="客户钱包流水" meta={`customer_wallet_ledger${real ? "（真实）" : "（Mock）"}`}>
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "customer", label: "客户" },
            { key: "type", label: "类型", mono: true },
            { key: "amount", label: "金额", align: "right", mono: true, render: (r) => money(r.amount) },
            { key: "principal", label: "本金余额", align: "right", mono: true, render: (r) => money(r.principal) },
            { key: "bonus", label: "赠送余额", align: "right", mono: true, render: (r) => money(r.bonus) },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={customerLedgers}
        />
      </Panel>

      <Panel title="订单删除审计" meta={`order_delete_log${real ? "（真实）" : "（Mock）"}`}>
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "orderNo", label: "订单号", mono: true },
            { key: "deletedBy", label: "删除人" },
            { key: "paid", label: "实付", align: "right", mono: true, render: (r) => money(r.paid) },
            { key: "reason", label: "原因" },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={deleteLogs}
        />
      </Panel>

      <Panel title="工资发放" meta={`payout_salary${real ? "（真实）" : "（Mock）"}`}>
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-xs text-muted">按批次扣减员工钱包；非欠款员工余额不足将整体中断</p>
          <BossOnly fallback={<span className="font-mono text-[11px] text-muted">仅老板可操作</span>}><Button onClick={openPayout}>发起工资发放</Button></BossOnly>
        </div>
      </Panel>

      <Modal open={payoutOpen} title={`工资发放${real ? "" : "（Mock）"}`} onClose={() => setPayoutOpen(false)} wide>
        <div className="space-y-4">
          {hint && <p className="rounded-md border border-line bg-paper p-2 font-mono text-xs text-danger">{hint}</p>}
          <div className="max-h-[50vh] overflow-y-auto">
            <DataTable<Employee>
              rowKey={(r) => r.id}
              columns={[
                { key: "name", label: "员工" },
                { key: "wallet", label: "当前余额", align: "right", mono: true, render: (r) => money(r.wallet) },
                { key: "isDebt", label: "欠款", mono: true, render: (r) => (r.isDebt ? "是" : "否") },
                {
                  key: "amount", label: "发放金额", align: "right",
                  render: (r) => (
                    <input
                      type="number" min="0"
                      value={amounts[r.id] ?? ""}
                      onChange={(e) => setAmounts({ ...amounts, [r.id]: e.target.value })}
                      placeholder="0"
                      className="w-24 rounded-md border border-line bg-paper px-2 py-1 text-right font-mono text-xs outline-none focus:border-ink"
                    />
                  ),
                },
              ]}
              rows={employees.filter((e) => e.status === "active")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPayoutOpen(false)}>取消</Button>
            <Button onClick={submitPayout}>确认发放</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}