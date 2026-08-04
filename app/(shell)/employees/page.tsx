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
import { apiEmployees, apiUpdateEmployee, apiWalletLedgers, type WalletLedgerRow } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { WALLET_LEDGERS, ORDERS, type Order } from "@/lib/mock-data";
import { OrderNoPreview } from "@/components/business/OrderPreview";
import { LedgerPartners } from "@/components/business/LedgerPartners";
import { apiOrders } from "@/lib/supabase-api";
import { DataSourceBadge } from "@/lib/use-real-data";
import { useAuth } from "@/lib/auth";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function EmployeesPage() {
  const { session } = useAuth();
  const { data: employees, real, error, loading, mutate: setEmployees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", grade: 1, phone: "" });
  const [ledgerEmployee, setLedgerEmployee] = useState<Employee | null>(null);
  const [detailEmp, setDetailEmp] = useState<Employee | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ realName: "", alipay: "", bankCard: "", grade: 1, status: "active" as "active" | "resigned" });
  const { data: ledgers } = useResource<WalletLedgerRow>("walletLedgers", apiWalletLedgers, WALLET_LEDGERS);
  const { data: orders } = useResource<Order>("orders", apiOrders, ORDERS);

  const filtered = useMemo(
    () => employees.filter((e) => keyword === "" || e.name.includes(keyword)),
    [employees, keyword],
  );

  const openDetail = (r: Employee) => {
    setDetailEmp(r);
    setEditMode(false);
    setEditMsg(null);
    setEditForm({
      realName: r.realName ?? "",
      alipay: r.alipay ?? "",
      bankCard: r.bankCard ?? "",
      grade: r.grade,
      status: r.status,
    });
  };

  const saveEdit = async () => {
    if (!detailEmp) return;
    setEditMsg(null);
    const fields = {
      name: editForm.realName.trim() || undefined,
      alipay_account: editForm.alipay.trim() || null,
      bank_card: editForm.bankCard.trim() || null,
      grade: Math.max(1, editForm.grade),
      status: editForm.status,
    };
    if (session) {
      const { error } = await apiUpdateEmployee(detailEmp.id, fields);
      if (error) return setEditMsg("保存失败：" + error.message);
    }
    setEmployees((prev) =>
      prev.map((e) =>
        e.id === detailEmp.id
          ? {
              ...e,
              realName: fields.name,
              alipay: fields.alipay_account ?? "",
              bankCard: fields.bank_card ?? "",
              grade: fields.grade,
              status: editForm.status,
            }
          : e,
      ),
    );
    setDetailEmp((prev) =>
      prev
        ? {
            ...prev,
            realName: fields.name ?? "",
            alipay: fields.alipay_account ?? "",
            bankCard: fields.bank_card ?? "",
            grade: fields.grade,
            status: editForm.status,
          }
        : prev,
    );
    setEditMode(false);
    setEditMsg("已保存");
    window.setTimeout(() => setEditMsg(null), 2000);
  };

  const create = () => {
    if (!form.name.trim()) return;
    setEmployees((p) => [...p, { id: "e" + Date.now(), name: form.name.trim(), grade: Math.max(1, form.grade), status: "active", wallet: 0, isDebt: false }]);
    setOpen(false);
    setForm({ name: "", grade: 1, phone: "" });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="员工" meta={`/employees · ${employees.length} 人${real ? " · 真实数据" : "（Mock）"}`} />
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
          onRowDoubleClick={openDetail}
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

      <Modal open={!!detailEmp} title={detailEmp ? `员工详情 — ${detailEmp.name}` : "员工详情"} onClose={() => setDetailEmp(null)} xwide>
        {detailEmp && !editMode && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
              {[
                { label: "昵称", value: detailEmp.name },
                { label: "真实姓名", value: detailEmp.realName || "—" },
                { label: "支付宝账号", value: detailEmp.alipay || "—" },
                { label: "银行卡号", value: detailEmp.bankCard || "—" },
                { label: "等级", value: "Lv" + detailEmp.grade },
                { label: "状态", value: detailEmp.status === "active" ? "在职" : "离职" },
                { label: "钱包余额", value: money(detailEmp.wallet) },
                { label: "欠款", value: detailEmp.isDebt ? "是" : "否" },
              ].map((x) => (
                <div key={x.label} className="bg-surface p-3">
                  <p className="font-mono text-[10px] text-muted">{x.label}</p>
                  <p className="mt-1 text-sm font-medium break-all">{x.value}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setLedgerEmployee(detailEmp)}>查看流水</Button>
              <Button size="sm" onClick={() => { setEditMsg(null); setEditMode(true); }}>修改信息</Button>
            </div>
          </div>
        )}
        {detailEmp && editMode && (
          <div className="space-y-3">
            {editMsg && <p className="font-mono text-[11px] text-muted">{editMsg}</p>}
            <label className="block space-y-1">
              <span className="font-mono text-[11px] text-muted">真实姓名</span>
              <Input value={editForm.realName} onChange={(e) => setEditForm({ ...editForm, realName: e.target.value })} placeholder="真实姓名" />
            </label>
            <label className="block space-y-1">
              <span className="font-mono text-[11px] text-muted">支付宝账号</span>
              <Input value={editForm.alipay} onChange={(e) => setEditForm({ ...editForm, alipay: e.target.value })} placeholder="支付宝账号" />
            </label>
            <label className="block space-y-1">
              <span className="font-mono text-[11px] text-muted">银行卡号</span>
              <Input value={editForm.bankCard} onChange={(e) => setEditForm({ ...editForm, bankCard: e.target.value })} placeholder="银行卡号" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">等级</span>
                <Input type="number" min={1} value={editForm.grade} onChange={(e) => setEditForm({ ...editForm, grade: Number(e.target.value) || 1 })} />
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">状态</span>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value as "active" | "resigned" })}
                  className="h-[var(--control-h)] w-full rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-ink"
                >
                  <option value="active">在职</option>
                  <option value="resigned">离职</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setEditMode(false); setEditMsg(null); }}>取消</Button>
              <Button onClick={() => void saveEdit()}>保存</Button>
            </div>
          </div>
        )}
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
                { key: "amount", label: "金额", align: "right", mono: true, render: (r) => money(r.amount) },
                { key: "balance", label: "变动后余额", align: "right", mono: true, render: (r) => money(r.balance) },
                { key: "orderNo", label: "关联订单", render: (r) => <OrderNoPreview orderNo={r.orderNo} orders={orders} /> },
                { key: "partner", label: "协作", render: (r) => <LedgerPartners orderNo={r.orderNo} currentEmployee={ledgerEmployee?.name} orders={orders} /> },
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