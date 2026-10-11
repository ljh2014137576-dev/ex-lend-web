"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiPayoutById, apiUpdatePayoutProof, uploadPayoutProof } from "@/lib/supabase-api";
import { useAuth } from "@/lib/auth";
import { browserPayoutEnvironment, type PayoutScope } from "@/lib/payout-request";
import { payoutProofKey, readPayoutProofDraft, savePayoutProof, type PayoutProofDraft } from "@/lib/payout-proof";

export function PayoutProofEditor({ payoutId, scope, initialFile = null, revision = 0, disabled = false, onSaved }: {
  payoutId: string; scope: PayoutScope; initialFile?: File | null; revision?: number; disabled?: boolean; onSaved?: () => void;
}) {
  const { session, isBoss } = useAuth();
  const actorRef = useRef(session?.user.id ?? null);
  actorRef.current = session?.user.id ?? null;
  const selectedRef = useRef(payoutId);
  selectedRef.current = payoutId;
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { actorRef.current = null; }, []);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(initialFile);
  const [draft, setDraft] = useState<PayoutProofDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const key = payoutProofKey(scope, payoutId);

  useEffect(() => {
    setFile(initialFile);
    setMessage(null);
    const read = () => {
      if (actorRef.current !== scope.actorId) { setDraft(null); return; }
      try { setDraft(readPayoutProofDraft(browserPayoutEnvironment(() => actorRef.current), scope, payoutId)); }
      catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    };
    read();
    const changed = (event: StorageEvent) => { if (event.key === key) read(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key, payoutId, scope.actorId, scope.project, initialFile, revision]);

  const submitProof = async () => {
    if (busyRef.current || disabled || !isBoss || actorRef.current !== scope.actorId) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const target = payoutId, actor = scope.actorId;
    try {
      const outcome = await savePayoutProof(browserPayoutEnvironment(() => actorRef.current), scope, target, file, {
        upload: uploadPayoutProof, attach: apiUpdatePayoutProof, read: apiPayoutById,
      });
      if (actorRef.current !== actor || selectedRef.current !== target) return;
      setDraft(outcome.draft);
      setMessage(outcome.message);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onSaved?.();
    } catch (error) {
      if (actorRef.current !== actor || selectedRef.current !== target) return;
      try { setDraft(readPayoutProofDraft(browserPayoutEnvironment(() => actorRef.current), scope, target)); } catch { /* Keep visible failure. */ }
      setMessage("工资已记账，凭证尚未确认：" + (error instanceof Error ? error.message : String(error)) + " 可在此补传/重试绑定，不会重新结算。");
    } finally { busyRef.current = false; setBusy(false); }
  };

  const awaitingBinding = !!draft?.path && draft.phase !== "attached";
  return <div className="space-y-2 border-t border-line pt-3" data-testid="payout-proof-editor">
    <p className="font-mono text-xs text-muted">凭证独立处理：工资已记账，上传或重试附件不会再次扣款。</p>
    {draft?.path && <p className="break-all font-mono text-[10px] text-muted">{draft.phase === "attached" ? "已确认文件：" : "待核对文件（固定路径已保留）："}{draft.path}</p>}
    <input ref={inputRef} type="file" accept="image/*,.xlsx,.xls,.csv,.pdf" disabled={busy || disabled || (awaitingBinding && draft?.uploadConfirmed)} onChange={e => setFile(e.target.files?.[0] ?? null)} className="max-w-full text-xs" />
    {file && <p className="text-xs text-muted">已选择：{file.name}</p>}
    {message && <p role="status" className="font-mono text-xs text-muted">{message}</p>}
    <Button size="sm" disabled={busy || disabled || !isBoss || actorRef.current !== scope.actorId || (!file && !draft?.path)} onClick={() => void submitProof()}>{busy ? "凭证处理中…" : awaitingBinding ? "核对/重试原凭证绑定（不扣款）" : "仅上传凭证（不扣款）"}</Button>
  </div>;
}
