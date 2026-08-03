"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DASHBOARD_STATS, WALLET_LEDGERS, CUSTOMER_LEDGERS, EMPLOYEES, DELETE_LOGS, ORDERS, CUSTOMERS, type Employee, type Order, type Customer } from "@/lib/mock-data";
import { apiEmployees, apiOrders, apiCustomers, apiWalletLedgers, apiCustomerLedgers, apiPayouts, apiDeleteLogs } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { BossOnly } from "@/components/business/RequireRole";
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

const GROSS_TREND = [
  { day: "07-26", v: 620 }, { day: "07-27", v: 410 }, { day: "07-28", v: 880 },
  { day: "07-29", v: 730 }, { day: "07-30", v: 1050 }, { day: "07-31", v: 940 }, { day: "08-01", v: 1230 },
];

const INITIAL_PAYOUTS: PayoutRow[] = [
  { id: "pa1", batchNo: "PB20260731", operator: "灰晨", total: 3200, count: 3, status: "completed", at: "2026-07-31 20:00" },
  { id: "pa2", batchNo: "PB20260715", operator: "灰晨", total: 2800, count: 2, status: "completed", at: "2026-07-15 20:00" },
];

export default function FinancePage() {
  const totalWallet = EMPLOYEES.filter((e) => e.status === "active").reduce((s, e) => s + e.wallet, 0);
  const maxTrend = Math.max(...GROSS_TREND.map((g) => g.v));

  const { data: employees, mutate: setEmployees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: payouts, mutate: setPayouts } = useResource<PayoutRow>("payouts", apiPayouts, INITIAL_PAYOUTS);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);

  const openPayout = () => {
    const init: Record<string, string> = {};
    EMPLOYEES.filter((e) => e.status === "active").forEach((e) => (init[e.id] = ""));
    setAmounts(init);
    setHint(null);
    setPayoutOpen(true);
  };

  const { session } = useAuth();
  const { data: orders } = useResource<Order>("orders", apiOrders, ORDERS);
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
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((o) => o.createdAt.startsWith(today));
  const todayIncome = todayOrders.reduce((s, o) => s + o.paid, 0);
  const todayCommission = todayOrders
    .filter((o) => o.auditStatus === "approved")
    .reduce((s, o) => s + o.commission, 0);
  const pendingAuditCommission = orders
    .filter((o) => o.auditStatus === "pending")
    .reduce((s, o) => s + o.commission, 0);


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
    setPayouts((p) => [{ id: "pa" + Date.now(), batchNo, operator: "灰晨", total, count: rows.length, status: "completed", at: new Date().toLocaleString("zh-CN") }, ...p]);
    setPayoutOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="财务" meta="/finance · Mock 数据 · 老板可操作，管理岗只读" />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {[
          { label: "今日收入", value: money(todayIncome) },
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

      <Panel title="毛利趋势（近 7 日）" meta="元 · Mock">
        <div className="flex h-40 items-end gap-3 border-b border-line">
          {GROSS_TREND.map((g) => (
            <div key={g.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[10px] text-muted">{g.v}</span>
              <div className="w-full bg-accent/70" style={{ height: Math.max(8, (g.v / maxTrend) * 120) + "px" }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-3">
          {GROSS_TREND.map((g) => (
            <span key={g.day} className="flex-1 text-center font-mono text-[10px] text-muted">{g.day}</span>
          ))}
        </div>
      </Panel>

      <Panel title="打款批次" meta="payout（Mock）">
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

      <Panel title="员工钱包流水" meta="wallet_ledger（Mock）">
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "employee", label: "员工" },
            { key: "type", label: "类型", mono: true },
            { key: "amount", label: "金额", align: "right", mono: true, render: (r) => money(r.amount) },
            { key: "balance", label: "变动后余额", align: "right", mono: true, render: (r) => money(r.balance) },
            { key: "orderNo", label: "关联", mono: true },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={walletLedgers}
        />
      </Panel>

      <Panel title="客户钱包流水" meta="customer_wallet_ledger（Mock）">
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

      <Panel title="订单删除审计" meta="order_delete_log（Mock）">
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

      <Panel title="工资发放" meta="payout_salary（Mock）">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-xs text-muted">按批次扣减员工钱包；非欠款员工余额不足将整体中断</p>
          <BossOnly fallback={<span className="font-mono text-[11px] text-muted">仅老板可操作</span>}><Button onClick={openPayout}>发起工资发放</Button></BossOnly>
        </div>
      </Panel>

      <Modal open={payoutOpen} title="工资发放（Mock）" onClose={() => setPayoutOpen(false)} wide>
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