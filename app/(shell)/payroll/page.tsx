"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DataSourceBadge } from "@/lib/use-real-data";
import { useResource } from "@/lib/data-store";
import { apiEmployees, apiOrders, apiWalletLedgers, apiPayouts } from "@/lib/supabase-api";
import { EMPLOYEES, ORDERS, WALLET_LEDGERS, type Employee, type Order } from "@/lib/mock-data";
import type { WalletLedgerRow } from "@/lib/supabase-api";
import { employeeLedgerTotals, ledgerMoney } from "@/lib/ledger";
import { PayoutSettlementDialog, shortPayoutBatch } from "@/components/business/PayoutSettlementDialog";
import { useAuth } from "@/lib/auth";
import { NoPermission } from "@/components/business/RequireRole";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { dateKey } from "@/lib/date";
import { compareOrderCreatedDesc } from "@/lib/order-sort";

const money = ledgerMoney;
const sumKnown = (values: (number | null)[]): number | null => values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + value!, 0);
const exportNumber = (value: number | null) => value === null ? "未知" : Number(value.toFixed(2));

interface PayrollRow {
  id: string;
  name: string;
  realName?: string;
  alipay?: string;
  bankCard?: string;
  grade: number;
  status: "active" | "resigned";
  wallet: number;
  isDebt: boolean;
  commission: number | null;
  payout: number | null;
  other: number | null;
}

export default function PayrollPage() {
  const { isBoss } = useAuth();
  const { data: employees, real, mutate: setEmployees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: ledgers, invalidate: invalidateLedgers } = useResource<WalletLedgerRow>("walletLedgers", apiWalletLedgers, WALLET_LEDGERS);
  const { data: payouts, invalidate: invalidatePayouts } = useResource("payouts", apiPayouts, []);
  const { data: orders } = useResource<Order>("orders", apiOrders, ORDERS);
  const [hint, setHint] = useState<string | null>(null);
  const [detailEmp, setDetailEmp] = useState<PayrollRow | null>(null);

  const ledgerByEmployee = useMemo(() => employeeLedgerTotals(ledgers), [ledgers]);

  const rows: PayrollRow[] = useMemo(
    () =>
      employees.map((e) => {
        const g = ledgerByEmployee.get(e.id) ?? { commission: 0, payout: 0, other: 0 };
        return { id: e.id, name: e.name, realName: e.realName, alipay: e.alipay, bankCard: e.bankCard, grade: e.grade, status: e.status, wallet: e.wallet, isDebt: e.isDebt, ...g };
      }),
    [employees, ledgerByEmployee],
  );

  // 排除没有工资的员工（结余/已保存流水·提成/已发/调整全为 0 且无欠款）
  const visibleRows = rows
    .filter((r) => r.wallet !== 0 || r.commission !== 0 || r.payout !== 0 || r.other !== 0 || r.isDebt)
    // 按当前工资结余降序排列
    .sort((a, b) => b.wallet - a.wallet);
  const active = visibleRows.filter((r) => r.status === "active");
  const totalWallet = active.reduce((s, r) => s + r.wallet, 0);
  const totalCommission = sumKnown(active.map(r => r.commission));
  const totalPayout = sumKnown(active.map(r => r.payout));
  const debtRows = active.filter((r) => r.isDebt || r.wallet < 0);

  // 选中员工的订单明细
  const empOrders = useMemo(() => {
    if (!detailEmp) return [];
    return orders
      .filter((o) => o.members.some((m) => m.employeeId === detailEmp.id))
      .sort(compareOrderCreatedDesc);
  }, [detailEmp, orders]);
  const empOrderTotal = empOrders.reduce((s, o) => s + o.paid, 0);
  const empCommissionTotal = empOrders.reduce(
    (s, o) => s + (o.members.find((m) => m.employeeId === detailEmp?.id)?.commission ?? 0),
    0,
  );
  const empCompleted = empOrders.filter((o) => o.status === "completed").length;

  const [settleOpen, setSettleOpen] = useState(false);
  const [settleIds, setSettleIds] = useState<string[] | undefined>();
  const [selected, setSelected] = useState<string[]>([]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.includes(r.id));
  const toggleSelectAll = () => setSelected(allSelected ? [] : visibleRows.map((r) => r.id));

  const openSettle = (ids?: string[]) => { setSettleIds(ids); setSettleOpen(true); };

  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const sumRows: (string | number)[][] = [
        ["工资结算汇总", ""],
        ["生成时间", new Date().toLocaleString("zh-CN")],
        ["数据来源", real ? "真实数据" : "Mock 数据"],
        ["在职员工数", active.length],
        ["工资总额（在职结余合计）", Number(totalWallet.toFixed(2))],
        ["已保存流水·提成合计", exportNumber(totalCommission)],
        ["已保存流水·发放净额", exportNumber(totalPayout)],
        ["欠款员工数", debtRows.length],
      ];
      const header = ["员工(昵称)", "真实姓名", "支付宝账号", "银行卡号", "等级", "状态", "已保存流水·提成", "已保存流水·发放净额", "已保存流水·其他净额", "当前工资结余", "欠款"];
      // 导出排序：支付宝+姓名都填 > 只填支付宝 > 只填姓名 > 都没填（未填的留空排在后面）
      const sortScore = (r: PayrollRow) => {
        const a = r.alipay && r.alipay.trim() ? 1 : 0;
        const n = r.realName && r.realName.trim() ? 1 : 0;
        return a * 2 + n; // 都填=3，只支付宝=2，只姓名=1，都没=0
      };
      const sortedRows = [...visibleRows].sort((a, b) => sortScore(b) - sortScore(a));
      const body = sortedRows.map((r) => [
        r.name,
        r.realName ?? "",
        r.alipay ?? "",
        r.bankCard ?? "",
        r.grade,
        r.status === "active" ? "在职" : "离职",
        exportNumber(r.commission),
        exportNumber(r.payout),
        exportNumber(r.other),
        Number(r.wallet.toFixed(2)),
        r.isDebt ? "是" : "否",
      ]);
      const ws = XLSX.utils.aoa_to_sheet([...sumRows, [], header, ...body]);
      ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 22 }, { wch: 6 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 8 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "工资结算");
      const ws2 = XLSX.utils.aoa_to_sheet([
        ["批次号", "发放总额", "人数", "状态", "时间"],
        ...payouts.map(p => [p.batchNo, p.total ?? "未知", p.count ?? "未知", p.status, p.at]),
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

  if (!isBoss) return <NoPermission />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="工资结算" meta="/payroll · 老板专用 · 汇总员工工资与发放记录" />
        <div className="flex items-center gap-3">
          <DataSourceBadge real={real} />
          <Button onClick={() => openSettle()}>全部结算</Button>
          <Button onClick={exportExcel} disabled={visibleRows.length === 0}>导出 Excel</Button>
        </div>
      </div>

      {hint && <div className="border border-line bg-surface p-3 font-mono text-xs text-muted">{hint}</div>}

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5">
        {[
          { label: "在职员工", value: active.length + " 人" },
          { label: "工资总额（在职结余）", value: money(totalWallet) },
          { label: "已保存流水·提成合计", value: money(totalCommission) },
          { label: "已保存流水·发放净额", value: money(totalPayout) },
          { label: "欠款员工", value: debtRows.length + " 人" },
        ].map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{s.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <Panel title="员工工资汇总" meta={visibleRows.length + " 人（已排除无工资）" + (real ? " · 真实数据" : " · Mock") + " · 双击查看订单明细"}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            <span className="font-mono text-[11px] text-muted">全选（{visibleRows.length} 人）</span>
          </label>
          <Button size="sm" onClick={() => openSettle(selected)} disabled={selected.length === 0}>
            结算选中（{selected.length} 人）
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setSelected([])} disabled={selected.length === 0}>
            清空选择
          </Button>
        </div>
        <DataTable<PayrollRow>
          rowKey={(r) => r.id}
          empty="暂无员工"
          columns={[
            {
              key: "sel", label: "", render: (r) => (
                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} />
              ),
            },
            { key: "name", label: "员工" },
            { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
            { key: "status", label: "状态", mono: true, render: (r) => (r.status === "active" ? "在职" : "离职") },
            { key: "wallet", label: "当前工资结余", align: "right", mono: true, render: (r) => <span className={r.wallet < 0 ? "text-danger" : ""}>{money(r.wallet)}</span> },
            { key: "isDebt", label: "欠款", mono: true, render: (r) => (r.isDebt || r.wallet < 0 ? "是" : "否") },
            { key: "ops", label: "操作", render: (r) => <Button size="sm" variant="secondary" onClick={() => openSettle([r.id])}>扣款</Button> },
          ]}
          rows={visibleRows}
          onRowDoubleClick={(r) => setDetailEmp(r)}
        />
      </Panel>

      <Panel title="工资发放批次" meta={payouts.length + " 批 · 统一从本页结算"}>
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "batchNo", label: "批次号", mono: true, render: (r) => shortPayoutBatch(r.batchNo) },
            { key: "total", label: "发放总额", align: "right", mono: true, render: (r) => money(r.total) },
            { key: "count", label: "人数", align: "right", mono: true },
            { key: "status", label: "状态", mono: true },
            { key: "at", label: "时间", mono: true },
          ]}
          rows={payouts}
        />
      </Panel>

      <Modal open={!!detailEmp} title={detailEmp ? detailEmp.name + " 的订单与提成" : "订单明细"} onClose={() => setDetailEmp(null)} xwide>
        {detailEmp && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{detailEmp.name}</span>
              <span className="font-mono text-[11px] text-muted">Lv{detailEmp.grade} · {detailEmp.status === "active" ? "在职" : "离职"}</span>
            </div>

            <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
              {[
                { label: "已保存流水·提成", value: money(detailEmp.commission), danger: false },
                { label: "已保存流水·发放净额", value: money(detailEmp.payout), danger: false },
                { label: "已保存流水·其他净额", value: money(detailEmp.other), danger: false },
                { label: "当前工资结余", value: money(detailEmp.wallet), danger: detailEmp.wallet < 0 },
              ].map((s) => (
                <div key={s.label} className="bg-surface p-3">
                  <p className="font-mono text-[10px] text-muted">{s.label}</p>
                  <p className={"mt-1 text-base font-semibold tabular-nums" + (s.danger ? " text-danger" : "")}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="max-h-[55vh] overflow-y-auto">
              <DataTable<Order>
                rowKey={(r) => r.id}
                empty="该员工暂无参与订单"
                columns={[
                  { key: "orderNo", label: "订单号", mono: true },
                  { key: "customer", label: "客户", render: (r) => r.customerName },
                  { key: "paid", label: "金额", align: "right", mono: true, render: (r) => money(r.paid) },
                  { key: "commission", label: "该员工提成", align: "right", mono: true, render: (r) => money(r.members.find((m) => m.employeeId === detailEmp.id)?.commission ?? 0) },
                  { key: "status", label: "状态", render: (r) => <OrderStatusTag status={r.status} /> },
                  { key: "audit", label: "审核", render: (r) => <AuditStatusTag status={r.auditStatus} /> },
                  { key: "createdAt", label: "时间", mono: true, render: (r) => r.createdAt },
                ]}
                rows={empOrders}
              />
            </div>

            <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
              {[
                { label: "订单数", value: empOrders.length + " 笔" },
                { label: "已完成", value: empCompleted + " 笔" },
                { label: "订单总额", value: money(empOrderTotal) },
                { label: "提成合计", value: money(empCommissionTotal) },
              ].map((s) => (
                <div key={s.label} className="bg-surface p-3">
                  <p className="font-mono text-[10px] text-muted">{s.label}</p>
                  <p className="mt-1 text-base font-semibold tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <PayoutSettlementDialog open={settleOpen} onClose={() => setSettleOpen(false)} employeeIds={settleIds}
        onEmployees={next => setEmployees(() => next)} onRecorded={() => { invalidateLedgers(); invalidatePayouts(); }} />
    </div>
  );
}
