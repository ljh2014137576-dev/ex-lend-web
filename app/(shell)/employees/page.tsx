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
import { LedgerPartners, LedgerProofLink } from "@/components/business/LedgerPartners";
import { apiOrders } from "@/lib/supabase-api";
import { DataSourceBadge } from "@/lib/use-real-data";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

import { ledgerMoney as money, ledgerSignedAmount, walletLedgerTypeLabel, employeeLedgerTotals, employeeCommissionReferences, type EmployeeCommissionReference } from "@/lib/ledger";

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
  const { data: ledgers, loading: ledgersLoading, error: ledgersError, real: ledgersReal, invalidate: reloadLedgers } = useResource<WalletLedgerRow>("walletLedgers", apiWalletLedgers, WALLET_LEDGERS);
  const { data: orders, loading: ordersLoading, error: ordersError, real: ordersReal, invalidate: reloadOrders } = useResource<Order>("orders", apiOrders, ORDERS);

  const filtered = useMemo(
    () => employees.filter((e) => keyword === "" || e.name.includes(keyword)),
    [employees, keyword],
  );

  const ledgerReady = !ledgersLoading && !ledgersError && (!session || ledgersReal);
  const ordersReady = !ordersLoading && !ordersError && (!session || ordersReal);
  const ledgerByEmployee = useMemo(() => employeeLedgerTotals(ledgers), [ledgers]);
  const detailLedger = detailEmp && ledgerReady
    ? ledgerByEmployee.get(detailEmp.id) ?? { commission: 0, payout: 0, other: 0 }
    : { commission: null, payout: null, other: null };
  const visibleLedgers = ledgerEmployee && ledgerReady ? ledgers.filter(row => row.employeeId === ledgerEmployee.id) : [];
  const commissionReferences = useMemo(() => ledgerEmployee && ledgerReady && ordersReady
    ? employeeCommissionReferences(ledgerEmployee.id, orders, ledgers) : [], [ledgerEmployee, ledgerReady, ordersReady, orders, ledgers]);

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

  const create = async () => {
    if (!form.name.trim()) return;
    const optimisticId = "tmp-" + Date.now();
    const optimistic: Employee = {
      id: optimisticId,
      name: form.name.trim(),
      grade: Math.max(1, form.grade),
      status: "active",
      wallet: 0,
      isDebt: false,
    };
    // 先入缓存展示，后异步写库；失败回滚并提示
    setEmployees((p) => [...p, optimistic]);
    setOpen(false);
    setForm({ name: "", grade: 1, phone: "" });

    if (session) {
      const { data, error } = await supabase
        .from("employee")
        .insert([
          {
            name: optimistic.name,
            // nickname 必填，取昵称兜底（防线上列无默认值报错）
            nickname: optimistic.name,
            phone: form.phone.trim() || null,
            grade: optimistic.grade,
            status: optimistic.status,
          },
        ])
        .select("id")
        .single();
      if (error || !data) {
        setEmployees((prev) => prev.filter((x) => x.id !== optimisticId));
        window.alert("创建失败：" + (error?.message ?? "未知错误"));
        return;
      }
      setEmployees((prev) => prev.map((x) => (x.id === optimisticId ? { ...x, id: data.id } : x)));
    }
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
                { label: "已保存流水·佣金净额", value: money(detailLedger.commission) },
                { label: "已保存流水·工资净变动", value: money(detailLedger.payout) },
                { label: "已保存流水·其他净变动", value: money(detailLedger.other) },
              ].map((x) => (
                <div key={x.label} className="bg-surface p-3">
                  <p className="font-mono text-[10px] text-muted">{x.label}</p>
                  <p className="mt-1 text-sm font-medium break-all">{x.value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">仅统计已保存的钱包流水，历史流水缺失时不代表累计收入；订单提成参考不计入此处。{!ledgerReady && " 流水尚未完整读取，金额未知。"}</p>
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
          <p className="text-xs text-muted">已保存的钱包资金变动。缺失的历史流水、订单关联或余额不会推算补齐。</p>
          {ledgersLoading && <p role="status">正在读取流水…</p>}
          {ledgersError && <p role="alert" className="text-danger">流水读取失败：{ledgersError}</p>}
          {(ledgersError || (!ledgersLoading && !ledgerReady)) && <Button size="sm" onClick={reloadLedgers}>重新读取流水</Button>}
          {ledgerReady && <div className="max-h-[40vh] overflow-y-auto">
            <DataTable<WalletLedgerRow>
              rowKey={r => r.id}
              columns={[
                { key: "type", label: "类型", render: r => walletLedgerTypeLabel(r.type) },
                { key: "amount", label: "变动金额", align: "right", mono: true, render: r => ledgerSignedAmount(r.amount) },
                { key: "balance", label: "变动后余额", align: "right", mono: true, render: r => money(r.balance) },
                { key: "orderNo", label: "关联订单 / 批次", render: r => r.payoutId ? <a className="text-accent underline" href={`/payouts?payoutId=${encodeURIComponent(r.payoutId)}`}>{r.batchNo || "查看工资批次"}</a> : <OrderNoPreview orderId={r.orderId} orderNo={r.orderNo} orders={ordersReady ? orders : []} /> },
                { key: "partner", label: "协作", render: r => <LedgerPartners orderId={r.orderId} currentEmployeeId={ledgerEmployee?.id} orders={ordersReady ? orders : []} /> },
                { key: "operator", label: "操作人", render: r => r.operator || "未知" },
                { key: "remark", label: "备注", render: r => r.remark || "—" },
                { key: "proof", label: "凭证", render: r => <LedgerProofLink path={r.proofPath} /> },
                { key: "at", label: "流水时间", mono: true },
              ]}
              rows={visibleLedgers}
              empty="此员工没有现存钱包流水；这不表示没有历史订单或收入。可查看下方订单提成参考。"
            />
          </div>}
          <div className="border-t border-line pt-3">
            <h3 className="text-sm font-medium">已保存订单提成参考</h3>
            <p className="my-2 text-xs text-muted">用于核对，不代表钱包流水。仅列出此员工已审核、且未找到对应提成流水的订单快照；不参与钱包余额或累计流水统计。日期为订单日期，历史入账时间和变动后余额未知。</p>
            {!ledgerReady && <p className="text-xs text-muted">需先完整读取钱包流水，才能核对未关联流水的订单参考。</p>}
            {ordersLoading && <p role="status">正在读取订单参考…</p>}
            {ordersError && <p role="alert" className="text-danger">订单参考读取失败：{ordersError}</p>}
            {(ordersError || (!ordersLoading && !ordersReady)) && <Button size="sm" onClick={reloadOrders}>重新读取订单参考</Button>}
            {ledgerReady && ordersReady && <DataTable<EmployeeCommissionReference> rowKey={r => r.id} columns={[
              { key: "orderNo", label: "订单", render: r => <OrderNoPreview orderId={r.orderId} orderNo={r.orderNo} orders={orders} /> },
              { key: "amount", label: "已审核提成快照", render: r => money(r.amount), align: "right", mono: true },
              { key: "orderDate", label: "订单日期", mono: true },
              { key: "postedAt", label: "历史入账时间", render: () => "未知" },
              { key: "balance", label: "变动后余额", render: () => "未知" },
            ]} rows={commissionReferences} empty="已读取订单中没有可列出的未关联提成参考。" />}
          </div>
        </div>
      </Modal>
    </div>
  );
}
