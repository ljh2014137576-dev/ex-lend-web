"use client";

import { useMemo, useState } from "react";
import { dateKey } from "@/lib/date";
import Link from "next/link";
import { shortPayoutBatch } from "@/components/business/PayoutSettlementDialog";
import { customerLedgerTypeLabel, ledgerMoney, ledgerSignedAmount, walletLedgerTypeLabel } from "@/lib/ledger";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { WALLET_LEDGERS, CUSTOMER_LEDGERS, EMPLOYEES, DELETE_LOGS, ORDERS, CUSTOMERS, type Employee, type Order, type Customer } from "@/lib/mock-data";
import { apiEmployees, apiOrders, apiCustomers, apiWalletLedgers, apiCustomerLedgers, apiPayouts, apiDeleteLogs } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { BossOnly } from "@/components/business/RequireRole";
import { OrderNoPreview } from "@/components/business/OrderPreview";
import { LedgerPartners } from "@/components/business/LedgerPartners";
import type { PayoutRow } from "@/lib/supabase-api";

import { summarizeGrossProfit } from "@/lib/order-profit";

const money = ledgerMoney;

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

export default function FinancePage() {

  const { data: employees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: payouts } = useResource<PayoutRow>("payouts", apiPayouts, []);
  const { data: orders, real } = useResource<Order>("orders", apiOrders, ORDERS);
  const { data: customers } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { data: walletLedgers } = useResource("walletLedgers", apiWalletLedgers, WALLET_LEDGERS);
  const { data: customerLedgers } = useResource("customerLedgers", apiCustomerLedgers, CUSTOMER_LEDGERS);
  const { data: deleteLogs } = useResource("deleteLogs", apiDeleteLogs, DELETE_LOGS);
  const approvedOrders = orders.filter((o) => o.auditStatus === "approved");
  const grossProfit = summarizeGrossProfit(approvedOrders.map(o => o.grossProfit));
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
  // 用户预存真实金额：区间内 recharge_principal（充值本金）合计
  const customerRechargeReal = customerLedgers
    .filter((l) => {
      if (l.type !== "recharge_principal") return false;
      const d = dateKey(l.at);
      return (!range.from || d >= range.from) && (!range.to || d <= range.to);
    })
    .reduce<number | null>((sum, row) => sum === null || row.amount === null ? null : sum + row.amount, 0);
  const pendingAuditCommission = orders
    .filter((o) => o.auditStatus === "pending")
    .reduce((s, o) => s + o.commission, 0);
  // 员工钱包合计 = 所有在职员工的 wallet_balance 之和（来自缓存，真实模式为线上数据）
  const totalWallet = employees.filter((e) => e.status === "active").reduce((s, e) => s + e.wallet, 0);
  // 毛利趋势：近 7 日，按已审核订单毛利聚合（真实数据）
  const trendData = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const day = dateKey(new Date(Date.now() - (6 - index) * 86400000));
      return { day, ...summarizeGrossProfit(approvedOrders.filter(order => dateKey(order.createdAt) === day).map(order => order.grossProfit)) };
    });
  }, [approvedOrders]);
  const maxTrend = Math.max(1, ...trendData.map(day => day.knownTotal ?? 0));



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
              <p className="font-mono text-[11px] text-muted">用户预存（真实）</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{money(customerRechargeReal)}</p>
              <p className="font-mono text-[10px] text-muted">区间内充值本金合计（不含赠送）</p>
            </div>
            <div className="bg-surface p-4">
              <p className="font-mono text-[11px] text-muted">订单真实金额</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{money(realRevenue)}</p>
              <p className="font-mono text-[10px] text-muted">区间内非取消订单实付合计</p>
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
          { label: grossProfit.unknownCount ? "毛利已知小计（已审核）" : "总毛利（已审核）", value: money(grossProfit.knownTotal), note: grossProfit.unknownCount ? `有 ${grossProfit.unknownCount} 单毛利未知；不代表完整总额` : undefined },
          { label: "进行中临时金额", value: money(inFlightPending) },
          { label: "客户存款总额", value: money(customerDeposits) },
          { label: "客户待结", value: money(customerPending) },
          { label: "员工钱包合计", value: money(totalWallet) },
          { label: "待审核佣金", value: money(pendingAuditCommission) },
        ].map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{s.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{s.value}</p>
            {s.note && <p className="mt-1 text-xs text-muted">{s.note}</p>}
          </div>
        ))}
      </div>

      <Panel title="毛利趋势（近 7 日）" meta={`已审核订单 · ${real ? "真实" : "Mock"} · 含未知订单的日期仅显示已知小计`}>
        <div className="flex h-40 items-end gap-3 border-b border-line">
          {trendData.map((g) => (
            <div key={g.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-center font-mono text-[10px] text-muted">{g.unknownCount && g.knownCount ? "已知 " : ""}{money(g.knownTotal)}</span>
              {g.unknownCount > 0 && <span className="text-center text-[10px] text-danger">{g.unknownCount} 单未知</span>}
              <div title={g.unknownCount ? "该日毛利不完整，仅显示已知部分" : "该日已审核订单毛利"}
                className={g.unknownCount ? "w-full border border-dashed border-muted bg-accent/20" : "w-full bg-accent/70"}
                style={{ height: (g.knownTotal === null ? 8 : Math.max(0, (g.knownTotal / maxTrend) * 100)) + "px" }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-3">
          {trendData.map((g) => (
            <span key={g.day} className="flex-1 text-center font-mono text-[10px] text-muted">{g.day.slice(5)}</span>
          ))}
        </div>
      </Panel>

      <Panel title="打款批次" meta={`payout${real ? "（真实）" : "（Mock）"}`}>
        <DataTable<PayoutRow>
          rowKey={(r) => r.id}
          columns={[
            { key: "batchNo", label: "批次号", mono: true, render: (r) => <Link className="underline" href={"/payouts?payoutId=" + encodeURIComponent(r.id)}>{shortPayoutBatch(r.batchNo)}</Link> },
            { key: "operator", label: "操作人" },
            { key: "total", label: "总额", align: "right", mono: true, render: (r) => money(r.total) },
            { key: "count", label: "明细数", align: "right", mono: true },
            { key: "status", label: "状态", mono: true },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={payouts}
        />
      </Panel>

      <Panel title="员工钱包流水（已保存）" meta={`wallet_ledger${real ? "（真实）" : "（Mock）"}`}>
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "employee", label: "员工" },
            { key: "type", label: "类型", render: (r) => walletLedgerTypeLabel(r.type) },
            { key: "amount", label: "金额", align: "right", mono: true, render: (r) => ledgerSignedAmount(r.amount) },
            { key: "balance", label: "变动后余额", align: "right", mono: true, render: (r) => money(r.balance) },
            { key: "orderNo", label: "关联订单", render: (r) => <OrderNoPreview orderNo={r.orderNo} orderId={r.orderId} orders={orders} /> },
            { key: "partner", label: "协作", render: (r) => <LedgerPartners orderId={r.orderId} currentEmployeeId={r.employeeId} orders={orders} /> },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={walletLedgers}
        />
      </Panel>

      <Panel title="客户钱包流水（已保存）" meta={`customer_wallet_ledger${real ? "（真实）" : "（Mock）"}`}>
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "customer", label: "客户" },
            { key: "type", label: "类型", mono: true, render: (r) => customerLedgerTypeLabel(r.type, r.amount) },
            { key: "amount", label: "金额", align: "right", mono: true, render: (r) => ledgerSignedAmount(r.amount) },
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
          <p className="font-mono text-xs text-muted">工资统一在工资结算页处理；成功后凭证可独立补传。</p>
          <BossOnly fallback={<span className="font-mono text-[11px] text-muted">仅老板可操作</span>}><Link href="/payroll" className="border border-line px-3 py-2 text-sm">进入工资结算</Link></BossOnly>
        </div>
      </Panel>


    </div>
  );
}