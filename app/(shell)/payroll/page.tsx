"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DataSourceBadge } from "@/lib/use-real-data";
import { useResource } from "@/lib/data-store";
import { apiEmployees, apiOrders, apiWalletLedgers, apiPayouts, rpcPayoutSalary, uploadPayoutProof, apiUpdatePayoutProof } from "@/lib/supabase-api";
import { EMPLOYEES, ORDERS, WALLET_LEDGERS, type Employee, type Order } from "@/lib/mock-data";
import type { WalletLedgerRow } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { NoPermission } from "@/components/business/RequireRole";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { dateKey } from "@/lib/date";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

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
  commission: number;
  payout: number;
  other: number;
}

export default function PayrollPage() {
  const { isBoss, session } = useAuth();
  const { data: employees, real, mutate: setEmployees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: ledgers, invalidate: invalidateLedgers } = useResource<WalletLedgerRow>("walletLedgers", apiWalletLedgers, WALLET_LEDGERS);
  const { data: payouts, invalidate: invalidatePayouts } = useResource("payouts", apiPayouts, []);
  const { data: orders } = useResource<Order>("orders", apiOrders, ORDERS);
  const [hint, setHint] = useState<string | null>(null);
  const [detailEmp, setDetailEmp] = useState<PayrollRow | null>(null);

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
        return { id: e.id, name: e.name, realName: e.realName, alipay: e.alipay, bankCard: e.bankCard, grade: e.grade, status: e.status, wallet: e.wallet, isDebt: e.isDebt, ...g };
      }),
    [employees, ledgerByEmployee],
  );

  // 排除没有工资的员工（结余/累计佣金/已发/调整全为 0 且无欠款）
  const visibleRows = rows.filter((r) => r.wallet !== 0 || r.commission !== 0 || r.payout !== 0 || r.other !== 0 || r.isDebt);
  const active = visibleRows.filter((r) => r.status === "active");
  const totalWallet = active.reduce((s, r) => s + r.wallet, 0);
  const totalCommission = active.reduce((s, r) => s + r.commission, 0);
  const totalPayout = active.reduce((s, r) => s + r.payout, 0);
  const debtRows = active.filter((r) => r.isDebt || r.wallet < 0);

  // 选中员工的订单明细
  const empOrders = useMemo(() => {
    if (!detailEmp) return [];
    return orders
      .filter((o) => o.members.some((m) => m.employeeId === detailEmp.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [detailEmp, orders]);
  const empOrderTotal = empOrders.reduce((s, o) => s + o.paid, 0);
  const empCommissionTotal = empOrders.reduce(
    (s, o) => s + (o.members.find((m) => m.employeeId === detailEmp?.id)?.commission ?? 0),
    0,
  );
  const empCompleted = empOrders.filter((o) => o.status === "completed").length;

  const [settleOpen, setSettleOpen] = useState(false);
  const [settleDrafts, setSettleDrafts] = useState<Record<string, { checked: boolean; amount: string }>>({});
  const [settleProof, setSettleProof] = useState<File | null>(null);
  const [settleMsg, setSettleMsg] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  const openSettle = (employeeId?: string) => {
    const drafts: Record<string, { checked: boolean; amount: string }> = {};
    if (employeeId) {
      const emp = employees.find((e) => e.id === employeeId);
      if (emp) drafts[emp.id] = { checked: true, amount: String(emp.wallet) };
    } else {
      for (const e of employees) {
        if (e.status === "active") drafts[e.id] = { checked: true, amount: String(e.wallet) };
      }
    }
    setSettleDrafts(drafts);
    setSettleProof(null);
    setSettleMsg(null);
    setSettleOpen(true);
  };

  const settleSelectedNames = active.filter((e) => settleDrafts[e.id]?.checked).map((e) => e.name);
  const settleTitle =
    settleSelectedNames.length === 1
      ? settleSelectedNames[0] + " 结算"
      : settleSelectedNames.length > 1
        ? "批量结算"
        : "结算工资";
  const settleItems = active
    .filter((e) => settleDrafts[e.id]?.checked && Number(settleDrafts[e.id]?.amount || 0) > 0)
    .map((e) => ({ employee_id: e.id, amount: Number(settleDrafts[e.id].amount) }));
  const settleTotal = settleItems.reduce((s2, i) => s2 + i.amount, 0);

  const submitSettle = async () => {
    setSettleMsg(null);
    if (settleItems.length === 0) return setSettleMsg("请至少勾选一名员工并填写结算金额");
    for (const it of settleItems) {
      const emp = employees.find((x) => x.id === it.employee_id);
      if (emp && !emp.isDebt && emp.wallet < it.amount) return setSettleMsg("员工 " + emp.name + " 余额不足（当前 " + money(emp.wallet) + "）");
    }
    const batchNo = "PB" + new Date().toISOString().replace(/\D/g, "").slice(0, 8) + "-" + String(Date.now()).slice(-4);
    setSettling(true);
    try {
      const { data, error } = await rpcPayoutSalary(settleItems, batchNo);
      if (error || data?.success === false) {
        setSettleMsg((error?.message ?? (data as { message?: string })?.message) || "结算失败");
        return;
      }
      if (settleProof && session) {
        const path = await uploadPayoutProof(settleProof, session.user.id, batchNo);
        await apiUpdatePayoutProof(String(data?.batch_id ?? ""), path);
      }
      setEmployees((prev) =>
        prev.map((e) => {
          const it = settleItems.find((x) => x.employee_id === e.id);
          return it ? { ...e, wallet: +(e.wallet - it.amount).toFixed(2) } : e;
        }),
      );
      invalidateLedgers();
      invalidatePayouts();
      setSettleOpen(false);
      setHint("已结算批次 " + batchNo + " · " + settleItems.length + " 人 · " + money(settleTotal));
      window.setTimeout(() => setHint(null), 3000);
    } catch (err) {
      setSettleMsg("结算失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSettling(false);
    }
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
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
      const header = ["员工(昵称)", "真实姓名", "支付宝账号", "银行卡号", "等级", "状态", "累计佣金", "已发放", "调整/扣减", "当前工资结余", "欠款"];
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
        Number(r.commission.toFixed(2)),
        Number(r.payout.toFixed(2)),
        Number(r.other.toFixed(2)),
        Number(r.wallet.toFixed(2)),
        r.isDebt ? "是" : "否",
      ]);
      const ws = XLSX.utils.aoa_to_sheet([...sumRows, [], header, ...body]);
      ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 22 }, { wch: 6 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 8 }];
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
          <Button onClick={() => openSettle()}>全部结算</Button>
          <Button onClick={exportExcel} disabled={visibleRows.length === 0}>导出 Excel</Button>
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

      <Panel title="员工工资汇总" meta={visibleRows.length + " 人（已排除无工资）" + (real ? " · 真实数据" : " · Mock") + " · 双击查看订单明细"}>
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
            { key: "ops", label: "操作", render: (r) => <Button size="sm" variant="secondary" onClick={() => openSettle(r.id)}>扣款</Button> },
          ]}
          rows={visibleRows}
          onRowDoubleClick={(r) => setDetailEmp(r)}
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

      <Modal open={!!detailEmp} title={detailEmp ? detailEmp.name + " 的订单与提成" : "订单明细"} onClose={() => setDetailEmp(null)} xwide>
        {detailEmp && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{detailEmp.name}</span>
              <span className="font-mono text-[11px] text-muted">Lv{detailEmp.grade} · {detailEmp.status === "active" ? "在职" : "离职"}</span>
              <span className="font-mono text-[11px] text-muted">当前工资结余</span>
              <span className={"font-mono text-sm tabular-nums " + (detailEmp.wallet < 0 ? "text-danger" : "")}>{money(detailEmp.wallet)}</span>
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

      <Modal open={settleOpen} title={settleTitle} onClose={() => setSettleOpen(false)} xwide>
        <div className="space-y-4">
          {settleMsg && <p className="rounded-md border border-line bg-paper p-2 font-mono text-xs text-danger">{settleMsg}</p>}
          <p className="font-mono text-[11px] text-muted">勾选员工并填写结算金额（默认=当前工资结余）。确认后将扣减钱包余额、写入员工流水，并生成一条结算批次记录。</p>
          <div className="max-h-[45vh] overflow-y-auto">
            <DataTable<Employee>
              rowKey={(r) => r.id}
              columns={[
                {
                  key: "check", label: "", render: (r) => (
                    <input
                      type="checkbox"
                      checked={!!settleDrafts[r.id]?.checked}
                      onChange={(e) => setSettleDrafts((d) => ({ ...d, [r.id]: { ...(d[r.id] ?? { amount: String(r.wallet) }), checked: e.target.checked } }))}
                    />
                  ),
                },
                { key: "name", label: "员工" },
                { key: "wallet", label: "当前结余", align: "right", mono: true, render: (r) => money(r.wallet) },
                {
                  key: "amount", label: "结算金额", align: "right",
                  render: (r) => (
                    <input
                      type="number" min={0} step="0.01"
                      value={settleDrafts[r.id]?.amount ?? ""}
                      onChange={(e) => setSettleDrafts((d) => ({ ...d, [r.id]: { ...(d[r.id] ?? { checked: true }), amount: e.target.value } }))}
                      className="w-24 rounded-md border border-line bg-paper px-2 py-1 text-right font-mono text-xs outline-none focus:border-ink"
                    />
                  ),
                },
              ]}
              rows={employees.filter((e) => e.status === "active")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[11px] text-muted">合计：{settleItems.length} 人 · {money(settleTotal)}</span>
            <label className="ml-auto flex cursor-pointer items-center gap-2">
              <span className="font-mono text-[11px] text-muted">支付凭证（Excel/图片）：</span>
              <input type="file" accept="image/*,.xlsx,.xls,.csv,.pdf" onChange={(e) => setSettleProof(e.target.files?.[0] ?? null)} className="max-w-[220px] text-xs" />
            </label>
          </div>
          {settleProof && <p className="font-mono text-[11px] text-muted">已选择凭证：{settleProof.name}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSettleOpen(false)}>取消</Button>
            <Button onClick={() => void submitSettle()} disabled={settling}>{settling ? "结算中…" : "确认结算"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
