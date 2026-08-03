"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { EMPLOYEES, type Employee } from "@/lib/mock-data";
import { apiEmployees, apiWalletLedgers, type WalletLedgerRow } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { WALLET_LEDGERS, ORDERS, type Order } from "@/lib/mock-data";
import { OrderNoPreview } from "@/components/business/OrderPreview";
import { apiOrders } from "@/lib/supabase-api";
import { DataSourceBadge } from "@/lib/use-real-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function EmployeesPage() {
  const { data: employees, real, error, loading, mutate: setEmployees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", grade: 1, phone: "" });
  const [ledgerEmployee, setLedgerEmployee] = useState<Employee | null>(null);
  const { data: ledgers } = useResource<WalletLedgerRow>("walletLedgers", apiWalletLedgers, WALLET_LEDGERS);
  const { data: orders } = useResource<Order>("orders", apiOrders, ORDERS);

  const filtered = useMemo(
    () => employees.filter((e) => keyword === "" || e.name.includes(keyword)),
    [employees, keyword],
  );

  const create = () => {
    if (!form.name.trim()) return;
    setEmployees((p) => [...p, { id: "e" + Date.now(), name: form.name.trim(), grade: Math.max(1, form.grade), status: "active", wallet: 0, isDebt: false }]);
    setOpen(false);
    setForm({ name: "", grade: 1, phone: "" });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="员工" meta={`/employees · ${employees.length} 人（Mock）`} />
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>批量导入</Button>
          <DataSourceBadge real={real} error={error} />
          <Button size="sm" onClick={() => setOpen(true)}>新建员工</Button>
        </div>
      </div>

      <div className="max-w-sm">
        <Input placeholder="搜索员工姓名…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>

      <Panel title="员工列表">
        <DataTable<Employee>
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "昵称", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
            { key: "wallet", label: "钱包余额", align: "right", mono: true, render: (r) => money(r.wallet) },
            { key: "status", label: "状态", render: (r) => (r.status === "active" ? <StatusDot tone="active" label="在职" /> : <StatusDot tone="danger" label="离职" />) },
            { key: "isDebt", label: "欠款", render: (r) => (r.isDebt ? <StatusDot tone="danger" label="欠款" /> : <StatusDot tone="neutral" label="无" />) },
            { key: "actions", label: "操作", render: (r) => (
              <Button size="sm" variant="secondary" onClick={() => setLedgerEmployee(r)}>流水</Button>
            ) },
          ]}
          rows={filtered}
          empty={loading ? "加载中…" : "暂无数据"}
        />
      </Panel>

      <Modal open={open} title="新建员工" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">姓名 *</span>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="员工姓名" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">等级</span>
            <Input type="number" value={form.grade} onChange={(e) => setForm({ ...form, grade: Number(e.target.value) })} />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">手机号</span>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="138****0000" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create}>创建</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!ledgerEmployee}
        title={`钱包流水 — ${ledgerEmployee?.name ?? ""}`}
        onClose={() => setLedgerEmployee(null)}
        xwide
      >
        <div className="space-y-3">
          <p className="font-mono text-[11px] text-muted">
            当前钱包余额：{money(ledgerEmployee?.wallet ?? 0)}
          </p>
          <div className="max-h-[55vh] overflow-y-auto">
            <DataTable<WalletLedgerRow>
              rowKey={(r) => r.id}
              columns={[
                { key: "type", label: "类型", mono: true },
                { key: "amount", label: "金额", align: "right", mono: true, render: (r) => money(r.amount) },
                { key: "balance", label: "变动后余额", align: "right", mono: true, render: (r) => money(r.balance) },
                { key: "orderNo", label: "关联", render: (r) => <OrderNoPreview orderNo={r.orderNo} orders={orders} /> },
                { key: "at", label: "时间", mono: true },
              ]}
              rows={ledgers.filter((l) => l.employee === ledgerEmployee?.name)}
              empty="暂无流水"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}