"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { CUSTOMERS, CUSTOMER_LEDGERS, type Customer } from "@/lib/mock-data";
import { customerLedgerTypeLabel } from "@/lib/ledger";
import { apiCustomers } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { DataSourceBadge } from "@/lib/use-real-data";
import { supabase } from "@/lib/supabase";
import { rpcRechargeCustom, apiCustomerLedgers } from "@/lib/supabase-api";
import { useAuth } from "@/lib/auth";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

interface LedgerEntry {
  id: string;
  customer: string;
  type: string;
  amount: number;
  principal: number;
  bonus: number;
  at: string;
}

export default function CustomersPage() {
  const { data: customers, real, error, loading, mutate: setCustomers } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { data: ledgers, mutate: setLedgers } = useResource<LedgerEntry>("customerLedgers", apiCustomerLedgers, CUSTOMER_LEDGERS);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [rechargeTarget, setRechargeTarget] = useState<Customer | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<Customer | null>(null);

  const [form, setForm] = useState({ name: "", phone: "", type: "normal" });
  const [recharge, setRecharge] = useState({ mode: "package", amount: 500, bonus: 50 });

  const filtered = useMemo(
    () =>
      customers.filter(
        (c) => keyword === "" || c.name.includes(keyword) || c.phone.includes(keyword),
      ),
    [customers, keyword],
  );

  const [actionError, setActionError] = useState<string | null>(null);

  // 乐观更新：先本地显示，真实会话写库，失败回滚并提示重试
  const createCustomer = async () => {
    if (!form.name.trim()) return;
    const nc: Customer = {
      id: "c" + Date.now(),
      name: form.name.trim(),
      phone: form.phone.trim() || "—",
      type: form.type as "normal" | "vip",
      vipLevel: form.type === "vip" ? 1 : 0,
      principal: 0,
      bonus: 0,
      pending: 0,
      total: 0,
      status: "active",
    };
    const prev = customers;
    setActionError(null);
    setCustomers((p) => [nc, ...p]);
    if (session) {
      const { error } = await supabase.from("customer").insert({
        name: nc.name,
        phone: nc.phone === "—" ? null : nc.phone,
        type: nc.type,
        vip_level: nc.vipLevel,
      });
      if (error) {
        setCustomers(() => prev); // 失败回滚
        setActionError("创建失败，请重试：" + error.message);
        return;
      }
    }
    setCreateOpen(false);
    setForm({ name: "", phone: "", type: "normal" });
  };

  const { session } = useAuth();

  const doRecharge = async () => {
    if (!rechargeTarget) return;
    const amount = recharge.mode === "package" ? recharge.amount : Number(recharge.amount);
    const bonus = recharge.mode === "package" ? recharge.bonus : Number(recharge.bonus);
    if (!(amount > 0) || bonus < 0) return;

    const updated = customers.map((c) =>
      c.id === rechargeTarget.id ? { ...c, principal: c.principal + amount, bonus: c.bonus + bonus } : c,
    );
    const prev = customers;
    setActionError(null);
    setCustomers(() => updated); // 乐观更新
    if (session) {
      const { data, error } = await rpcRechargeCustom({
        p_customer_id: rechargeTarget.id,
        p_amount: amount,
        p_bonus: bonus,
        p_remark: "前端充值",
        p_proof_path: null,
      });
      if (error || data?.success === false) {
        setCustomers(() => prev); // 失败回滚
        setActionError("充值失败，请重试：" + (error?.message ?? data?.message ?? "未知错误"));
        return;
      }
    }
    const nc = updated.find((c) => c.id === rechargeTarget.id)!;
    setLedgers((p) => [
      { id: "cl" + Date.now(), customer: nc.name, type: "recharge_principal", amount, principal: nc.principal, bonus: nc.bonus, at: new Date().toLocaleString("zh-CN") },
      ...p,
    ]);
    setRechargeTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="客户" meta={`/customers · ${customers.length} 人${real ? " · 真实数据" : "（Mock）"}`} />
        <DataSourceBadge real={real} error={error} />`n        <Button size="sm" onClick={() => setCreateOpen(true)}>新建客户</Button>
      </div>

      <div className="max-w-sm">
        <Input placeholder="搜索姓名 / 手机号…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>

      <Panel title="客户列表" meta="行内可充值 · 查看流水">
        <DataTable<Customer>
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "姓名", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "phone", label: "手机", mono: true },
            { key: "type", label: "类型", mono: true, render: (r) => (r.type === "vip" ? `VIP${r.vipLevel}` : "普通") },
            { key: "principal", label: "本金余额", align: "right", mono: true, render: (r) => money(r.principal) },
            { key: "bonus", label: "赠送余额", align: "right", mono: true, render: (r) => money(r.bonus) },
            { key: "pending", label: "待结", align: "right", mono: true, render: (r) => money(r.pending) },
            { key: "total", label: "累计消费", align: "right", mono: true, render: (r) => money(r.total) },
            { key: "status", label: "状态", render: (r) => (r.status === "active" ? <StatusDot tone="active" label="正常" /> : <StatusDot tone="danger" label="停用" />) },
            { key: "actions", label: "操作", render: (r) => (
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setRechargeTarget(r)}>充值</Button>
                <Button size="sm" variant="ghost" onClick={() => setLedgerTarget(r)}>流水</Button>
              </div>
            ) },
          ]}
          rows={filtered}
          empty={loading ? "加载中…" : "暂无数据"}
        />
      </Panel>

      <Modal open={createOpen} title="新建客户" onClose={() => setCreateOpen(false)}>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">姓名 *</span>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="客户姓名" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">手机号</span>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="138****0000" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">类型</span>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="h-[var(--control-h)] w-full rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
            >
              <option value="normal">普通客户</option>
              <option value="vip">VIP 客户</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={createCustomer}>创建</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!rechargeTarget} title={`充值 — ${rechargeTarget?.name ?? ""}`} onClose={() => setRechargeTarget(null)}>
        <div className="space-y-3">
          <div className="flex gap-1">
            {(["package", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRecharge({ ...recharge, mode: m })}
                aria-pressed={recharge.mode === m}
                className={[
                  "flex-1 rounded-md px-3 py-2 text-xs transition-colors",
                  recharge.mode === m ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2",
                ].join(" ")}
              >
                {m === "package" ? "套餐充值" : "自定义充值"}
              </button>
            ))}
          </div>
          {recharge.mode === "package" ? (
            <div className="grid grid-cols-2 gap-2">
              {[
                { amount: 500, bonus: 50 },
                { amount: 1000, bonus: 150 },
                { amount: 2000, bonus: 400 },
                { amount: 5000, bonus: 1200 },
              ].map((pkg) => (
                <button
                  key={pkg.amount}
                  type="button"
                  onClick={() => setRecharge({ ...recharge, amount: pkg.amount, bonus: pkg.bonus })}
                  className={[
                    "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                    recharge.amount === pkg.amount && recharge.bonus === pkg.bonus ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-surface2",
                  ].join(" ")}
                >
                  <span className="block font-mono">充值 {money(pkg.amount)}</span>
                  <span className="block font-mono text-[11px] opacity-70">赠送 {money(pkg.bonus)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">本金金额</span>
                <Input type="number" value={recharge.amount} onChange={(e) => setRecharge({ ...recharge, amount: Number(e.target.value) })} />
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">赠送金额</span>
                <Input type="number" value={recharge.bonus} onChange={(e) => setRecharge({ ...recharge, bonus: Number(e.target.value) })} />
              </label>
            </div>
          )}
          <p className="font-mono text-[11px] text-muted">
            当前余额：本金 {money(rechargeTarget?.principal ?? 0)} · 赠送 {money(rechargeTarget?.bonus ?? 0)}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setRechargeTarget(null)}>取消</Button>
            <Button onClick={doRecharge}>确认充值</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!ledgerTarget} title={`钱包流水 — ${ledgerTarget?.name ?? ""}`} onClose={() => setLedgerTarget(null)} wide>
        <div className="max-h-[60vh] overflow-y-auto">
          <DataTable<LedgerEntry>
            rowKey={(r) => r.id}
            columns={[
{ key: "type", label: "类型", mono: true, render: (r) => customerLedgerTypeLabel(r.type) },
              { key: "amount", label: "金额", align: "right", mono: true, render: (r) => money(r.amount) },
              { key: "principal", label: "本金余额", align: "right", mono: true, render: (r) => money(r.principal) },
              { key: "bonus", label: "赠送余额", align: "right", mono: true, render: (r) => money(r.bonus) },
              { key: "at", label: "时间", mono: true },
            ]}
            rows={ledgers.filter((l) => l.customer === ledgerTarget?.name)}
            empty="暂无流水"
          />
        </div>
      </Modal>
    </div>
  );
}