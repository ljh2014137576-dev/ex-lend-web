"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { DataSourceBadge } from "@/lib/use-real-data";
import { useResource } from "@/lib/data-store";
import { apiEmployees, apiWalletLedgers, apiPayouts } from "@/lib/supabase-api";
import { EMPLOYEES, WALLET_LEDGERS, type Employee } from "@/lib/mock-data";
import type { WalletLedgerRow } from "@/lib/supabase-api";
import { useAuth } from "@/lib/auth";
import { NoPermission } from "@/components/business/RequireRole";
import { dateKey } from "@/lib/date";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

interface PayrollRow {
  id: string;
  name: string;
  grade: number;
  status: "active" | "resigned";
  wallet: number;
  isDebt: boolean;
  commission: number;
  payout: number;
  other: number;
}

export default function PayrollPage() {
  const { isBoss } = useAuth();
  const { data: employees, real } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: ledgers } = useResource<WalletLedgerRow>("walletLedgers", apiWalletLedgers, WALLET_LEDGERS);
  const { data: payouts } = useResource("payouts", apiPayouts, []);
  const [hint, setHint] = useState<string | null>(null);

  if (!isBoss) return <NoPermission />;

  const ledgerByEmployee = useMemo(() => {
    const map = new Map<string, { commission: number; payout: number; other: number }>();
    for (const l of ledgers) {
      const key = l.employeeId || l.employee;
      const g = map.get(key) ?? { commission: 0, payout: 0, other: 0 };
      if (l.type === "commission") g.commission += l.amount;
      else if (l.type === "payout") g.payout += Math.abs(l.amount);
      else g.other += Math.abs(l.amount);
      map.set(key, g);
    }
    return map;
  }, [ledgers]);

  const rows: PayrollRow[] = useMemo(
    () =>
      employees.map((e) => {
        const g = ledgerByEmployee.get(e.id) ?? ledgerByEmployee.get(e.name) ?? { commission: 0, payout: 0, other: 0 };
        return { id: e.id, name: e.name, grade: e.grade, status: e.status, wallet: e.wallet, isDebt: e.isDebt, ...g };
      }),
    [employees, ledgerByEmployee],
  );

  const active = rows.filter((r) => r.status === "active");
  const totalWallet = active.reduce((s, r) => s + r.wallet, 0);
  const totalCommission = active.reduce((s, r) => s + r.commission, 0);
  const totalPayout = active.reduce((s, r) => s + r.payout, 0);
  const debtRows = active.filter((r) => r.isDebt || r.wallet < 0);

  const exportExcel = () => {
    try {
      const sumRows: (string | number)[][] = [
        ["工资结算汇总", ""],
        ["生成时间", new Date().toLocaleString("zh-CN")],
        ["数据来源", real ? "真实数据" : "Mock 数据"],
        ["在职员工数", active.length],
        ["工资总额（在职结余合计）", Number(totalWallet.toFixed(2))],
        ["累计佣金合计", Number(totalCommission.toFixed(2))],
        ["已发放合计", Number(totalPayout.toFixed(2))],
        ["欠款员工数", debtRows.length],
      ];
      const header = ["员工", "等级", "状态", "累计佣金", "已发放", "调整/扣减", "当前工资结余", "欠款"];
      const body = rows.map((r) => [
        r.name,
        r.grade,
        r.status === "active" ? "在职" : "离职",
        Number(r.commission.toFixed(2)),
        Number(r.payout.toFixed(2)),
        Number(r.other.toFixed(2)),
        Number(r.wallet.toFixed(2)),
        r.isDebt ? "是" : "否",
      ]);
      const ws = XLSX.utils.aoa_to_sheet([...sumRows, [], header, ...body]);
      ws["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 8 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "工资结算");
      const ws2 = XLSX.utils.aoa_to_sheet([
        ["批次号", "发放总额", "人数", "状态", "时间"],
        ...payouts.map((p: { batchNo: string; total: number; count: number; status: string; at: string }) => [p.batchNo, p.total, p.count, p.status, p.at]),
      ]);
      ws2["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws2, "发放批次");
      XLSX.writeFile(wb, "工资结算_" + dateKey(new Date()) + ".xlsx");
      setHint("已导出 Excel");
      window.setTimeout(() => setHint(null), 2200);
    } catch (err) {
      setHint("导出失败：" + (err instanceof Error ? err.message : String(err)));
      window.setTimeout(() => setHint(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="工资结算" meta="/payroll · 老板专用 · 汇总员工工资与发放记录" />
        <div className="flex items-center gap-3">
          <DataSourceBadge real={real} />
          <Button onClick={exportExcel} disabled={rows.length === 0}>导出 Excel</Button>
        </div>
      </div>

      {hint && <div className="border border-line bg-surface p-3 font-mono text-xs text-muted">{hint}</div>}

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5">
        {[
          { label: "在职员工", value: active.length + " 人" },
          { label: "工资总额（在职结余）", value: money(totalWallet) },
          { label: "累计佣金合计", value: money(totalCommission) },
          { label: "已发放合计", value: money(totalPayout) },
          { label: "欠款员工", value: debtRows.length + " 人" },
        ].map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{s.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <Panel title="员工工资汇总" meta={rows.length + " 人" + (real ? " · 真实数据" : " · Mock") + " · 当前工资结余 = 员工钱包余额"}>
        <DataTable<PayrollRow>
          rowKey={(r) => r.id}
          empty="暂无员工"
          columns={[
            { key: "name", label: "员工" },
            { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
            { key: "status", label: "状态", mono: true, render: (r) => (r.status === "active" ? "在职" : "离职") },
            { key: "commission", label: "累计佣金", align: "right", mono: true, render: (r) => money(r.commission) },
            { key: "payout", label: "已发放", align: "right", mono: true, render: (r) => money(r.payout) },
            { key: "other", label: "调整/扣减", align: "right", mono: true, render: (r) => money(r.other) },
            { key: "wallet", label: "当前工资结余", align: "right", mono: true, render: (r) => <span className={r.wallet < 0 ? "text-danger" : ""}>{money(r.wallet)}</span> },
            { key: "isDebt", label: "欠款", mono: true, render: (r) => (r.isDebt || r.wallet < 0 ? "是" : "否") },
          ]}
          rows={rows}
        />
      </Panel>

      <Panel title="工资发放批次" meta={payouts.length + " 批 · 仅老板可发放（见财务页）"}>
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "batchNo", label: "批次号", mono: true },
            { key: "total", label: "发放总额", align: "right", mono: true, render: (r) => money(r.total) },
            { key: "count", label: "人数", align: "right", mono: true },
            { key: "status", label: "状态", mono: true },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={payouts}
        />
      </Panel>
    </div>
  );
}
