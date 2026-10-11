"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DataSourceBadge } from "@/lib/use-real-data";
import { useResource } from "@/lib/data-store";
import { apiPayouts, apiPayoutDetails, apiPayoutById } from "@/lib/supabase-api";
import type { PayoutRow, PayoutDetailRow } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { NoPermission } from "@/components/business/RequireRole";

import { ledgerMoney as money } from "@/lib/ledger";
import { PayoutProofEditor } from "@/components/business/PayoutProofEditor";
import { payoutProjectScope, shortPayoutBatch } from "@/components/business/PayoutSettlementDialog";

export default function PayoutsPage() {
  const { isBoss, session } = useAuth();
  const { data: payouts, real, mutate: setPayouts } = useResource("payouts", apiPayouts, []);
  const [detail, setDetail] = useState<PayoutRow | null>(null);
  const [details, setDetails] = useState<PayoutDetailRow[] | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  const [detailError, setDetailError] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const actorRef = useRef(session?.user.id ?? null); actorRef.current = session?.user.id ?? null;
  const readVersion = useRef(0);
  const scope = payoutProjectScope(session?.user.id);
  const selectedId = useRef<string | null>(null);

  const openDetail = async (row: PayoutRow) => {
    const version = ++readVersion.current, actor = actorRef.current;
    selectedId.current = row.id;
    const current = () => version === readVersion.current && actorRef.current === actor && selectedId.current === row.id;
    setDetail(row); setDetails(null); setProofUrl(null); setDetailError(null); setProofError(null);
    try {
      const rows = await apiPayoutDetails(row.id);
      if (current()) setDetails(rows ?? []);
    } catch (error) { if (current()) setDetailError("明细读取失败：" + (error instanceof Error ? error.message : String(error))); }
    if (!current() || !actor || !row.proofPath) return;
    try {
      const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(row.proofPath, 300);
      if (!current()) return;
      if (error || !data?.signedUrl) setProofError("凭证链接读取失败；原记录仍保留，可稍后重试或补传。");
      else setProofUrl(data.signedUrl);
    } catch { if (current()) setProofError("凭证链接未确认；原记录仍保留。"); }
  };
  const refreshDetail = async (id: string) => {
    const version = readVersion.current, actor = actorRef.current;
    try {
      const row = await apiPayoutById(id);
      if (version !== readVersion.current || actorRef.current !== actor || selectedId.current !== id) return;
      if (!row) { setDetailError("暂未读取到该结算，不能据此重新扣款。"); return; }
      setPayouts(previous => previous.map(value => value.id === id ? row : value));
      await openDetail(row);
    } catch (error) { if (version === readVersion.current && actorRef.current === actor && selectedId.current === id) setDetailError("凭证已处理，但记录刷新未确认：" + (error instanceof Error ? error.message : String(error))); }
  };
  useEffect(() => {
    const version = ++readVersion.current, actor = actorRef.current;
    selectedId.current = null; setDetail(null); setDetails(null); setProofUrl(null); setDetailError(null);
    if (!isBoss || !actor) return;
    const id = new URLSearchParams(window.location.search).get("payoutId");
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
    void apiPayoutById(id).then(row => {
      if (version !== readVersion.current || actorRef.current !== actor) return;
      if (row) void openDetail(row); else setDetailError("暂未读取到指定结算记录。");
    }).catch(error => { if (version === readVersion.current && actorRef.current === actor) setDetailError("结算记录读取失败：" + (error instanceof Error ? error.message : String(error))); });
    return () => { readVersion.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, isBoss]);

  if (!isBoss) return <NoPermission />;

  const isImage = (path?: string | null) => {
    if (!path) return false;
    return /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="结算记录" meta="/payouts · 老板专用 · 工资结算批次与支付凭证" />
      <div><DataSourceBadge real={real} /></div>
      {!detail && detailError && <p role="alert">{detailError}</p>}

      <Panel title="结算批次" meta={payouts.length + " 批 · 双击查看明细与凭证"}>
        <DataTable<PayoutRow>
          rowKey={(r) => r.id}
          empty="暂无结算记录"
          columns={[
            { key: "batchNo", label: "批次号", mono: true, render: r => shortPayoutBatch(r.batchNo) }
            , { key: "at", label: "结算时间", mono: true }
            , { key: "operator", label: "操作人" }
            , { key: "count", label: "员工数", align: "right", mono: true }
            , { key: "total", label: "结算总额", align: "right", mono: true, render: (r) => money(r.total) }
            , { key: "status", label: "状态", mono: true, render: (r) => (r.status === "completed" ? "已完成" : r.status) }
            , {
              key: "proof", label: "凭证",
              render: (r) => (r.proofPath ? (
                isImage(r.proofPath)
                  ? <span className="font-mono text-[11px] text-accent">图片 ✓</span>
                  : <span className="font-mono text-[11px] text-accent">文件 ✓</span>
              ) : (
                <span className="font-mono text-[11px] text-muted">—</span>
              )),
            },
          ]}
          rows={payouts}
          onRowDoubleClick={(r) => void openDetail(r)}
        />
      </Panel>

      <Modal open={!!detail} title={detail ? shortPayoutBatch(detail.batchNo) : "结算记录"} onClose={() => { readVersion.current++; selectedId.current = null; setDetail(null); }} xwide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[11px] text-muted">结算时间</span>
              <span className="font-mono text-xs">{detail.at}</span>
              <span className="font-mono text-[11px] text-muted">操作人</span>
              <span className="font-mono text-xs">{detail.operator}</span>
              <span className="font-mono text-[11px] text-muted">员工数</span>
              <span className="font-mono text-xs">{detail.count ?? "未知"}</span>
              <span className="font-mono text-[11px] text-muted">结算总额</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{money(detail.total)}</span>
            </div>

            {detailError && <p role="alert">{detailError}</p>}
            <Panel title="结算明细" meta={details ? details.length + " 条" : detailError ? "未确认" : "加载中…"}>
              {details?.length === 0 && <p className="text-xs text-muted">此批次没有已保存的员工明细，不能据此推算每人金额或余额。</p>}
              <DataTable<PayoutDetailRow>
                rowKey={(r) => r.id}
                empty="暂无明细"
                columns={[
                  { key: "employee", label: "员工" },
                  { key: "amount", label: "结算金额", align: "right", mono: true, render: (r) => money(r.amount) },
                  { key: "balanceBefore", label: "结算前余额", align: "right", mono: true, render: (r) => money(r.balanceBefore) },
                  { key: "balanceAfter", label: "结算后余额", align: "right", mono: true, render: (r) => money(r.balanceAfter) },
                ]}
                rows={details ?? []}
              />
            </Panel>

            <Panel title="支付凭证" meta={detail.proofPath ? "已上传" : "未上传"}>
              {proofUrl ? (
                isImage(detail.proofPath) ? (
                  <div className="space-y-3">
                    <img src={proofUrl} alt="支付凭证" className="max-h-64 border border-line bg-surface object-contain" />
                    <a href={proofUrl} target="_blank" rel="noreferrer" className="inline-block underline underline-offset-2">打开 / 下载</a>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="font-mono text-xs text-muted">凭证为文件类型（Excel 等），请下载查看</p>
                    <a href={proofUrl} target="_blank" rel="noreferrer"><Button size="sm">下载凭证</Button></a>
                  </div>
                )
              ) : (
                <p className="font-mono text-xs text-muted">{proofError ?? (detail.proofPath ? "正在生成查看链接…" : "该批次未上传支付凭证")}</p>
              )}
              {scope && detail.status === "completed" && <PayoutProofEditor key={detail.id + ":" + scope.actorId} payoutId={detail.id} scope={scope} onSaved={() => void refreshDetail(detail.id)} />}
            </Panel>
          </div>
        )}
      </Modal>
    </div>
  );
}
