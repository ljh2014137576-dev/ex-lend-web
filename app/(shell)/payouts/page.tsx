"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DataSourceBadge } from "@/lib/use-real-data";
import { useResource } from "@/lib/data-store";
import { apiPayouts, apiPayoutDetails } from "@/lib/supabase-api";
import type { PayoutRow, PayoutDetailRow } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { NoPermission } from "@/components/business/RequireRole";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function PayoutsPage() {
  const { isBoss, session } = useAuth();
  const { data: payouts, real } = useResource("payouts", apiPayouts, []);
  const [detail, setDetail] = useState<PayoutRow | null>(null);
  const [details, setDetails] = useState<PayoutDetailRow[] | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  if (!isBoss) return <NoPermission />;

  const openDetail = async (row: PayoutRow) => {
    setDetail(row);
    setDetails(null);
    setProofUrl(null);
    const rows = await apiPayoutDetails(row.id).catch(() => null);
    if (rows) setDetails(rows);
    if (session && row.proofPath) {
      const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(row.proofPath, 300).catch(() => ({ data: null }));
      if (data?.signedUrl) setProofUrl(data.signedUrl);
    }
  };

  const isImage = (path?: string | null) => {
    if (!path) return false;
    return /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="结算记录" meta="/payouts · 老板专用 · 工资结算批次与支付凭证" />
      <div><DataSourceBadge real={real} /></div>

      <Panel title="结算批次" meta={payouts.length + " 批 · 双击查看明细与凭证"}>
        <DataTable<PayoutRow>
          rowKey={(r) => r.id}
          empty="暂无结算记录"
          columns={[
            { key: "batchNo", label: "批次号", mono: true }
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

      <Modal open={!!detail} title={detail ? "批次 " + detail.batchNo : "结算记录"} onClose={() => setDetail(null)} xwide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[11px] text-muted">结算时间</span>
              <span className="font-mono text-xs">{detail.at}</span>
              <span className="font-mono text-[11px] text-muted">操作人</span>
              <span className="font-mono text-xs">{detail.operator}</span>
              <span className="font-mono text-[11px] text-muted">员工数</span>
              <span className="font-mono text-xs">{detail.count}</span>
              <span className="font-mono text-[11px] text-muted">结算总额</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{money(detail.total)}</span>
            </div>

            <Panel title="结算明细" meta={details ? details.length + " 条" : "加载中…"}>
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
                <p className="font-mono text-xs text-muted">{detail.proofPath ? "正在生成查看链接…" : "该批次未上传支付凭证"}</p>
              )}
            </Panel>
          </div>
        )}
      </Modal>
    </div>
  );
}
