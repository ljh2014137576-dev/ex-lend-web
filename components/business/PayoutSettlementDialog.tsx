"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import type { Employee } from "@/lib/mock-data";
import { apiEmployees, apiPayoutByBatch, rpcPayoutSalary } from "@/lib/supabase-api";
import { ledgerMoney } from "@/lib/ledger";
import { browserPayoutEnvironment, canonicalPayoutItems, payoutCents, payoutJournalKey, preparePayoutDraft, readPayoutJournal, reconcilePayoutRequest, startNewPayoutDraft, submitPayoutRequest, type PayoutDependencies, type PayoutJournal, type PayoutScope } from "@/lib/payout-request";
import { PayoutProofEditor } from "./PayoutProofEditor";

export function payoutProjectScope(actorId: string | undefined): PayoutScope | null {
  if (!actorId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try { return { actorId: actorId.toLowerCase(), project: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname }; } catch { return null; }
}
export function shortPayoutBatch(batch: string): string { return batch.startsWith("PB2:") ? "结算 " + batch.split(":").at(-1)!.slice(0, 8) : batch; }

export function PayoutSettlementDialog({ open, onClose, employeeIds, onEmployees, onRecorded }: {
  open: boolean; onClose: () => void; employeeIds?: string[]; onEmployees: (employees: Employee[]) => void; onRecorded: () => void;
}) {
  const { session, isBoss } = useAuth();
  const actor = session?.user.id.toLowerCase() ?? null;
  const actorRef = useRef(actor); actorRef.current = actor;
  const callbacks = useRef({ onEmployees, onRecorded }); callbacks.current = { onEmployees, onRecorded };
  const idsRef = useRef(employeeIds); idsRef.current = employeeIds;
  const scope = payoutProjectScope(actor ?? undefined);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const freshEmployees = useRef<Employee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [journal, setJournal] = useState<PayoutJournal | null>(null);
  const [epoch, setEpoch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { checked: boolean; amount: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const current = (target: PayoutScope) => actorRef.current === target.actorId;
  useEffect(() => () => { actorRef.current = null; generation.current++; }, []);

  function dependencies(target: PayoutScope): PayoutDependencies {
    return {
      submit: async (items, batchNo) => {
        const { data, error } = await rpcPayoutSalary(items, batchNo);
        if (data?.success === true) return { kind: "confirmed", receipt: data };
        return { kind: error?.uncertain === false ? "rejected" : "unknown", message: error?.message ?? "结算结果未确认，请核对原批次。", code: error?.code };
      },
      lookup: apiPayoutByBatch,
      refreshBalances: async () => {
        if (!current(target)) throw new Error("登录账号已变化");
        const next = await apiEmployees();
        if (!next || !current(target)) throw new Error("员工余额未能确认，或登录账号已变化");
        freshEmployees.current = next;
        setEmployees(next);
        callbacks.current.onEmployees(next);
      },
    };
  }
  function fillDrafts(ids?: string[]) {
    const next: typeof drafts = {};
    for (const employee of freshEmployees.current) {
      if (employee.status === "active") next[employee.id] = { checked: (!ids?.length || ids.includes(employee.id)) && employee.wallet > 0, amount: Number.isFinite(employee.wallet) ? String(employee.wallet) : "" };
    }
    setDrafts(next);
    setFile(null);
  }
  useEffect(() => {
    const turn = ++generation.current;
    setJournal(null); setEpoch(""); setFile(null); setMessage(null);
    if (!open || !scope || !isBoss) return;
    const target = scope;
    const env = () => browserPayoutEnvironment(() => actorRef.current);
    const read = () => {
      if (!current(target) || turn !== generation.current) return;
      try { setJournal(readPayoutJournal(env(), target)); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    };
    const storage = (event: StorageEvent) => { if (event.key === payoutJournalKey(target)) read(); };
    window.addEventListener("storage", storage);
    busyRef.current = true; setBusy(true);
    void (async () => {
      try {
        const outcome = await preparePayoutDraft(env(), target, dependencies(target));
        if (!current(target) || turn !== generation.current) return;
        setJournal(outcome.journal); setEpoch(outcome.journal.epoch); setMessage(outcome.message);
        if (!outcome.journal.request) fillDrafts(idsRef.current);
      } catch (error) { if (current(target) && turn === generation.current) setMessage(error instanceof Error ? error.message : String(error)); }
      finally { if (turn === generation.current) { busyRef.current = false; setBusy(false); } }
    })();
    return () => window.removeEventListener("storage", storage);
    // A new opening or actor starts a view; draft edits do not reinitialize it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, actor, isBoss, scope?.project]);

  const visibleJournal = journal?.actorId === actor && journal.project === scope?.project ? journal : null;
  const request = visibleJournal?.request;
  const stale = !!visibleJournal && epoch !== visibleJournal.epoch;
  const run = async (action: "submit" | "reconcile" | "new") => {
    if (busyRef.current || !scope || !isBoss || !epoch) return;
    busyRef.current = true; setBusy(true); setMessage(null);
    const target = scope, turn = generation.current;
    try {
      const env = browserPayoutEnvironment(() => actorRef.current), deps = dependencies(target);
      let outcome;
      if (action === "new") outcome = await startNewPayoutDraft(env, target, epoch, deps);
      else if (action === "reconcile") outcome = await reconcilePayoutRequest(env, target, deps);
      else {
        const items = request?.items ?? canonicalPayoutItems(Object.entries(drafts).filter(([, value]) => value.checked).map(([employee_id, value]) => ({ employee_id, amount: payoutCents(value.amount, true) / 100 })));
        outcome = await submitPayoutRequest(env, target, epoch, items, deps);
      }
      if (!current(target) || turn !== generation.current) return;
      setJournal(outcome.journal); setEpoch(outcome.journal.epoch); setMessage(outcome.message);
      if (!outcome.journal.request) fillDrafts();
      if (outcome.journal.request?.phase === "confirmed") callbacks.current.onRecorded();
    } catch (error) {
      if (!current(target) || turn !== generation.current) return;
      try { setJournal(readPayoutJournal(browserPayoutEnvironment(() => actorRef.current), target)); } catch { /* Keep the primary error; do not invent a new request. */ }
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { if (turn === generation.current) { busyRef.current = false; setBusy(false); } }
  };

  return <Modal open={open} title="工资结算" onClose={() => { if (!busyRef.current) onClose(); }} xwide>
    <div className="space-y-4" data-testid="payout-settlement">
      {!scope && <p role="alert">请使用已登录的真实账号进行结算。</p>}
      {message && <p role="status" className="border border-line p-3 text-sm">{message}</p>}
      {stale && <p role="alert">另一标签已切换结算，请关闭后重新打开并核对余额。这份旧草稿不会提交。</p>}
      {request ? <>
        <p className="font-semibold">{request.phase === "confirmed" ? "结算已成功" : request.phase === "rejected" ? "原请求已被拒绝" : "结果待核对"} · {shortPayoutBatch(request.batchNo)}</p>
        <p className="text-xs text-muted">本批次员工和金额已固定；核对或重试始终使用原标识。</p>
        <ul className="max-h-48 overflow-auto text-sm">{request.items.map(item => <li key={item.employee_id} className="flex justify-between gap-3"><span>{employees.find(employee => employee.id === item.employee_id)?.name ?? item.employee_id}</span><span>{ledgerMoney(item.amount)}</span></li>)}</ul>
        {request.receipt && <>
          <p>{request.receipt.count} 人 · {ledgerMoney(request.receipt.total)}{request.receipt.createdAt ? " · " + new Date(request.receipt.createdAt).toLocaleString("zh-CN") : ""}</p>
          <Link className="underline" href={"/payouts?payoutId=" + encodeURIComponent(request.receipt.id)}>查看本次结算记录</Link>
          {scope && <PayoutProofEditor key={request.receipt.id} payoutId={request.receipt.id} scope={scope} initialFile={file} disabled={busy} onSaved={() => { setFile(null); callbacks.current.onRecorded(); }} />}
        </>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} variant="secondary" onClick={() => void run("reconcile")}>核对原批次</Button>
          {request.phase !== "confirmed" && <Button disabled={busy || stale} onClick={() => void run("submit")}>用原标识重试</Button>}
          {["confirmed", "rejected"].includes(request.phase) && <Button disabled={busy || stale} variant="secondary" onClick={() => void run("new")}>开始新的结算（重新读取余额）</Button>}
        </div>
      </> : <>
        <p className="text-xs text-muted">请核对服务器余额后结算。资金确认后，凭证单独上传；上传失败不会重新扣款。</p>
        <div className="max-h-[45vh] overflow-auto"><table className="w-full text-sm"><thead><tr><th>选择</th><th className="text-left">员工</th><th>当前结余</th><th>结算金额</th></tr></thead><tbody>
          {employees.filter(employee => employee.status === "active").map(employee => <tr key={employee.id}><td><input type="checkbox" disabled={busy || stale} checked={!!drafts[employee.id]?.checked} onChange={event => setDrafts(prev => ({ ...prev, [employee.id]: { ...prev[employee.id], checked: event.target.checked } }))} /></td><td>{employee.name}</td><td className="text-right">{ledgerMoney(employee.wallet)}</td><td className="p-1 text-right"><input aria-label={employee.name + "结算金额"} type="text" inputMode="decimal" disabled={busy || stale} value={drafts[employee.id]?.amount ?? ""} onChange={event => setDrafts(prev => ({ ...prev, [employee.id]: { ...prev[employee.id], amount: event.target.value } }))} className="w-28 border border-line bg-paper p-1 text-right" /></td></tr>)}
        </tbody></table></div>
        <label className="block text-xs">支付凭证（可在成功后独立补传）<input type="file" disabled={busy} accept="image/*,.xlsx,.xls,.csv,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} className="mt-2 block" /></label>
        <Button disabled={busy || stale || !scope || !epoch} onClick={() => void run("submit")}>{busy ? "处理中…" : "确认结算"}</Button>
      </>}
      <Button variant="secondary" disabled={busy} onClick={onClose}>关闭</Button>
    </div>
  </Modal>;
}
