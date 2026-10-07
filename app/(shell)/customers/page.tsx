"use client";

import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { CUSTOMERS, CUSTOMER_LEDGERS, RECHARGE_PACKAGES, type Customer, type RechargePackage } from "@/lib/mock-data";
import { customerLedgerTypeLabel } from "@/lib/ledger";
import { apiCustomers, apiRechargePackages, rpcRechargeCustom, apiCustomerLedgers } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { DataSourceBadge } from "@/lib/use-real-data";
import { supabase } from "@/lib/supabase";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";

const money = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "—" : "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_FIELDS = "id,name,phone,type,vip_level,principal_balance,bonus_balance,pending_balance,total_consumption,status";
const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function savedCustomer(row: Record<string, unknown> | null): Customer | null {
  if (!row || typeof row.id !== "string" || !UUID.test(row.id) || typeof row.name !== "string") return null;
  const vipLevel = finiteNumber(row.vip_level);
  const principal = finiteNumber(row.principal_balance);
  const bonus = finiteNumber(row.bonus_balance);
  const pending = finiteNumber(row.pending_balance);
  const total = finiteNumber(row.total_consumption);
  if (vipLevel === null || principal === null || bonus === null || pending === null || total === null) return null;
  if ((row.type !== "normal" && row.type !== "vip") || (row.status !== "active" && row.status !== "blocked")) return null;
  return { id: row.id, name: row.name, phone: typeof row.phone === "string" ? row.phone : "—", type: row.type, vipLevel, principal, bonus, pending, total, status: row.status };
}

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
  const { session, mockRole } = useAuth();
  const { data: customers, real, error, loading, mutate: setCustomers } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { data: ledgers, mutate: setLedgers } = useResource<LedgerEntry>("customerLedgers", apiCustomerLedgers, CUSTOMER_LEDGERS);
  const { data: packages, loading: packagesLoading } = useResource<RechargePackage>("rechargePackages", apiRechargePackages, RECHARGE_PACKAGES);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [rechargeTarget, setRechargeTarget] = useState<Customer | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<Customer | null>(null);

  const [form, setForm] = useState({ name: "", phone: "", type: "normal" });
  const [recharge, setRecharge] = useState({ mode: "package", amount: "500", bonus: "50" });
  const creatingRef = useRef(false);
  const rechargingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [recharging, setRecharging] = useState(false);
  const [createNeedsRefresh, setCreateNeedsRefresh] = useState(false);
  const [rechargeNeedsRefresh, setRechargeNeedsRefresh] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      customers.filter(
        (c) => keyword === "" || c.name.includes(keyword) || c.phone.includes(keyword),
      ),
    [customers, keyword],
  );

  const [actionError, setActionError] = useState<string | null>(null);

  // A real customer enters the cache only after the server confirms its UUID and balances.
  const createCustomer = async () => {
    if (creatingRef.current || createNeedsRefresh || !form.name.trim()) return;
    if (!session && !(MOCK_LOGIN_ENABLED && mockRole)) {
      setActionError("请先登录后再创建客户。");
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    setActionError(null);
    setActionNotice(null);
    try {
      let created: Customer;
      if (session) {
        const { data, error: createError } = await supabase.from("customer").insert({
          name: form.name.trim(), phone: form.phone.trim() || null,
          type: form.type, vip_level: form.type === "vip" ? 1 : 0,
        }).select(CUSTOMER_FIELDS).single();
        if (createError) {
          if (!createError.code) setCreateNeedsRefresh(true);
          setActionError("创建未确认：" + createError.message + (!createError.code ? "；请先刷新列表核对，勿重复创建。" : ""));
          return;
        }
        const saved = savedCustomer(data);
        if (!saved) {
          setCreateNeedsRefresh(true);
          setActionError("服务端未返回完整客户信息，请先刷新列表核对，勿重复创建或充值。");
          return;
        }
        created = saved;
      } else {
        created = { id: "c" + Date.now(), name: form.name.trim(), phone: form.phone.trim() || "—", type: form.type as "normal" | "vip", vipLevel: form.type === "vip" ? 1 : 0, principal: 0, bonus: 0, pending: 0, total: 0, status: "active" };
      }
      setCustomers((prev) => [created, ...prev.filter((customer) => customer.id !== created.id)]);
      setCreateOpen(false);
      setForm({ name: "", phone: "", type: "normal" });
    } catch (err) {
      if (session) setCreateNeedsRefresh(true);
      setActionError("创建结果未确认，请刷新列表核对后再操作：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const doRecharge = async () => {
    if (!rechargeTarget || rechargingRef.current || rechargeNeedsRefresh) return;
    if (!session && !(MOCK_LOGIN_ENABLED && mockRole)) {
      setActionError("请先登录后再充值。");
      return;
    }
    if (session && !UUID.test(rechargeTarget.id)) {
      setActionError("客户尚未取得已保存的 ID，请刷新列表后充值。");
      return;
    }
    const amount = finiteNumber(recharge.amount);
    const bonus = finiteNumber(recharge.bonus);
    if (amount === null || amount <= 0 || bonus === null || bonus < 0) {
      setActionError("请输入大于 0 的本金和不小于 0 的赠送金额。");
      return;
    }
    rechargingRef.current = true;
    setRecharging(true);
    setActionError(null);
    setActionNotice(null);
    const target = rechargeTarget;
    let confirmed = false;
    try {
      if (session) {
        const { data, error: rechargeError } = await rpcRechargeCustom({
          p_customer_id: target.id, p_amount: amount, p_bonus: bonus,
          p_remark: "前端充值", p_proof_path: null,
        });
        if (rechargeError || data?.success !== true) {
          const uncertain = rechargeError ? !rechargeError.code : data?.success !== false;
          if (uncertain) setRechargeNeedsRefresh(true);
          setActionError((uncertain ? "充值结果未确认，请先刷新流水核对，勿重复提交：" : "充值失败：") + String(rechargeError?.message ?? data?.message ?? "服务端未确认成功"));
          return;
        }
        confirmed = true;
        setRechargeTarget(null);
        const [customerResult, ledgerResult] = await Promise.allSettled([
          supabase.from("customer").select(CUSTOMER_FIELDS).eq("id", target.id).single(),
          apiCustomerLedgers(),
        ]);
        const fresh = customerResult.status === "fulfilled" && !customerResult.value.error ? savedCustomer(customerResult.value.data) : null;
        const freshLedgers = ledgerResult.status === "fulfilled" && Array.isArray(ledgerResult.value) ? ledgerResult.value : null;
        if (fresh) setCustomers((prev) => prev.map((customer) => customer.id === target.id ? fresh : customer));
        if (freshLedgers) setLedgers(() => freshLedgers);
        if (!fresh || !freshLedgers) {
          setRechargeNeedsRefresh(true);
          setActionNotice("充值已成功，但余额或流水刷新未完成。请刷新页面核对，勿重复充值。");
        } else {
          setActionNotice("充值成功，余额和流水已刷新。");
        }
        return;
      }
      const current = customers.find((customer) => customer.id === target.id);
      if (!current || !Number.isFinite(current.principal) || !Number.isFinite(current.bonus)) {
        setActionError("客户余额不完整，无法计算测试充值。");
        return;
      }
      const updated = { ...current, principal: current.principal + amount, bonus: current.bonus + bonus };
      setCustomers((prev) => prev.map((customer) => customer.id === target.id ? updated : customer));
      setLedgers((prev) => [{ id: "cl" + Date.now(), customer: updated.name, type: "recharge_principal", amount, principal: updated.principal, bonus: updated.bonus, at: new Date().toLocaleString("zh-CN") }, ...prev]);
      setRechargeTarget(null);
    } catch (err) {
      if (session) setRechargeNeedsRefresh(true);
      const detail = err instanceof Error ? err.message : String(err);
      if (confirmed) {
        setRechargeTarget(null);
        setActionNotice("充值已成功，但刷新未完成，请刷新页面核对，勿重复充值：" + detail);
      } else {
        setActionError("充值结果未确认，请先刷新流水核对，勿重复提交：" + detail);
      }
    } finally {
      rechargingRef.current = false;
      setRecharging(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="客户" meta={`/customers · ${customers.length} 人${real ? " · 真实数据" : "（Mock）"}`} />
        <DataSourceBadge real={real} error={error} />
        <Button size="sm" disabled={creating || createNeedsRefresh} onClick={() => { setActionError(null); setCreateOpen(true); }}>新建客户</Button>
      </div>
      {actionNotice && <p role="status" className="text-sm text-muted">{actionNotice}</p>}
      {actionError && !createOpen && !rechargeTarget && <p role="alert" className="text-sm text-danger">{actionError}</p>}

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
                <Button size="sm" variant="secondary" disabled={recharging || rechargeNeedsRefresh || (!!session && !UUID.test(r.id))} onClick={() => { setActionError(null); setRechargeTarget(r); }}>充值</Button>
                <Button size="sm" variant="ghost" onClick={() => setLedgerTarget(r)}>流水</Button>
              </div>
            ) },
          ]}
          rows={filtered}
          empty={loading ? "加载中…" : "暂无数据"}
        />
      </Panel>

      <Modal open={createOpen} title="新建客户" onClose={() => { if (!creatingRef.current) setCreateOpen(false); }}>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">姓名 *</span>
            <Input disabled={creating} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="客户姓名" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">手机号</span>
            <Input disabled={creating} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="138****0000" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">类型</span>
            <select
              value={form.type}
              disabled={creating}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="h-[var(--control-h)] w-full rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
            >
              <option value="normal">普通客户</option>
              <option value="vip">VIP 客户</option>
            </select>
          </label>
          {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" disabled={creating} onClick={() => setCreateOpen(false)}>取消</Button>
            <Button disabled={creating || createNeedsRefresh || !form.name.trim()} onClick={createCustomer}>{creating ? "创建中…" : "创建"}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!rechargeTarget} title={`充值 — ${rechargeTarget?.name ?? ""}`} onClose={() => { if (!rechargingRef.current) setRechargeTarget(null); }}>
        <div className="space-y-3">
          <div className="flex gap-1">
            {(["package", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={recharging}
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
              {packagesLoading ? (
                <p className="col-span-2 py-2 text-center font-mono text-[11px] text-muted">套餐加载中…</p>
              ) : (
                packages.map((pkg) => (
                  <button
                    key={pkg.id ?? pkg.amount}
                    type="button"
                    disabled={recharging}
                    onClick={() => setRecharge({ ...recharge, amount: String(pkg.amount), bonus: String(pkg.bonus) })}
                    className={[
                      "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                      finiteNumber(recharge.amount) === pkg.amount && finiteNumber(recharge.bonus) === pkg.bonus ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-surface2",
                    ].join(" ")}
                  >
                    <span className="block font-mono">充值 {money(pkg.amount)}</span>
                    <span className="block font-mono text-[11px] opacity-70">赠送 {money(pkg.bonus)}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">本金金额</span>
                <Input disabled={recharging} type="number" value={recharge.amount} onChange={(e) => setRecharge({ ...recharge, amount: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">赠送金额</span>
                <Input disabled={recharging} type="number" value={recharge.bonus} onChange={(e) => setRecharge({ ...recharge, bonus: e.target.value })} />
              </label>
            </div>
          )}
          <p className="font-mono text-[11px] text-muted">
            当前余额：本金 {money(rechargeTarget?.principal)} · 赠送 {money(rechargeTarget?.bonus)}
          </p>
          {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" disabled={recharging} onClick={() => setRechargeTarget(null)}>取消</Button>
            <Button disabled={recharging || rechargeNeedsRefresh} onClick={doRecharge}>{recharging ? "充值中…" : "确认充值"}</Button>
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
