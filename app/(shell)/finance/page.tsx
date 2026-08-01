import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { DASHBOARD_STATS, WALLET_LEDGERS, CUSTOMER_LEDGERS, EMPLOYEES } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

const GROSS_TREND = [
  { day: "07-26", v: 620 },
  { day: "07-27", v: 410 },
  { day: "07-28", v: 880 },
  { day: "07-29", v: 730 },
  { day: "07-30", v: 1050 },
  { day: "07-31", v: 940 },
  { day: "08-01", v: 1230 },
];

const PAYOUTS = [
  { id: "pa1", batchNo: "PB20260731", operator: "灰晨", total: 3200, count: 3, status: "completed", at: "2026-07-31 20:00" },
  { id: "pa2", batchNo: "PB20260715", operator: "灰晨", total: 2800, count: 2, status: "completed", at: "2026-07-15 20:00" },
];

export default function FinancePage() {
  const totalWallet = EMPLOYEES.filter((e) => e.status === "active").reduce((s, e) => s + e.wallet, 0);
  const maxTrend = Math.max(...GROSS_TREND.map((g) => g.v));

  return (
    <div className="space-y-6">
      <PageHeader title="财务" meta="/finance · Mock 数据 · 老板可操作，管理岗只读" />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {[
          { label: "今日收入", value: money(DASHBOARD_STATS.todayIncome) },
          { label: "今日提成", value: money(DASHBOARD_STATS.todayCommission) },
          { label: "员工钱包合计", value: money(totalWallet) },
          { label: "待审核佣金", value: money(199.5) },
        ].map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{s.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <Panel title="毛利趋势（近 7 日）" meta="元 · Mock">
        <div className="flex h-40 items-end gap-3 border-b border-line pb-0">
          {GROSS_TREND.map((g) => (
            <div key={g.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[10px] text-muted">{g.v}</span>
              <div
                className="w-full bg-accent/70"
                style={{ height: Math.max(8, (g.v / maxTrend) * 120) + "px" }}
              />
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
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "batchNo", label: "批次号", mono: true },
            { key: "operator", label: "操作人" },
            { key: "total", label: "总额", align: "right", mono: true, render: (r) => money(r.total) },
            { key: "count", label: "明细数", align: "right", mono: true },
            { key: "status", label: "状态", mono: true },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={PAYOUTS}
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
          rows={WALLET_LEDGERS}
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
          rows={CUSTOMER_LEDGERS}
        />
      </Panel>

      <Panel title="工资发放" meta="payout_salary（Mock）">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-xs text-muted">按批次扣减员工钱包，非欠款员工余额不足将整体中断</p>
          <Button variant="secondary">发起工资发放（待实现）</Button>
        </div>
      </Panel>
    </div>
  );
}