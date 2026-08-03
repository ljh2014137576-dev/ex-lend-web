"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { apiOrderDetail, rpcAddOrderProof, rpcRemoveOrderProof, rpcSetPendingOrderCommissions, rpcRejectOrderAudit, uploadProof } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { compressPaymentProof } from "@/lib/image-compression";
import { ORDERS, type Order, type OrderItem, type OrderMember } from "@/lib/mock-data";
import { ReceiptEditor } from "@/components/business/ReceiptEditor";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export function OrderDetailModal({
  orderId,
  onClose,
}: {
  orderId: string | null;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof apiOrderDetail>>>(null);
  const [mockOrder, setMockOrder] = useState<Order | null>(null);
  const [proofs, setProofs] = useState<{ path: string; url: string }[]>([]);
  const [proofMsg, setProofMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editCommissions, setEditCommissions] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [modalMsg, setModalMsg] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setDetail(null);
    setMockOrder(null);
    setProofs([]);
    setProofMsg(null);
    if (session) {
      apiOrderDetail(orderId).then((d) => {
        if (d) setDetail(d);
      });
    } else {
      setMockOrder(ORDERS.find((o) => o.id === orderId) ?? null);
    }
  }, [orderId, session]);

  // 真实凭证：私有桶 → 签名 URL 展示（支持多张）
  useEffect(() => {
    let mounted = true;
    const paths =
      detail?.order.proofPaths && detail.order.proofPaths.length > 0
        ? detail.order.proofPaths
        : detail?.order.proofPath
          ? [detail.order.proofPath]
          : [];
    setProofs([]);
    if (session && paths.length > 0) {
      Promise.all(
        paths.map(async (path) => {
          const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 300);
          return data?.signedUrl ? { path, url: data.signedUrl } : null;
        }),
      ).then((list) => {
        if (mounted) setProofs(list.filter(Boolean) as { path: string; url: string }[]);
      });
    }
    return () => {
      mounted = false;
    };
  }, [detail, session]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setProofMsg(null);
    try {
      if (session && detail) {
        // 逐张压缩上传（HEIC/过小/无法解码时原样上传），一个订单可挂多张凭证
        const added: string[] = [];
        for (const file of files) {
          const compressed = await compressPaymentProof(file);
          const uploadFile = compressed
            ? new File([compressed.blob], "proof." + compressed.extension, { type: compressed.contentType })
            : file;
          const path = await uploadProof(uploadFile, session.user.id, detail.order.id);
          const { data: rpcData, error } = await rpcAddOrderProof(detail.order.id, path);
          if (error || rpcData?.success === false) {
            // 数据库未写入：清理已上传的孤儿文件（尽力而为），并显示真实原因
            await supabase.storage.from("payment-proofs").remove([path]).catch(() => undefined);
            throw new Error(error?.message ?? (rpcData as { message?: string })?.message ?? "更新凭证失败");
          }
          added.push(path);
        }
        const existing =
          detail.order.proofPaths && detail.order.proofPaths.length > 0
            ? detail.order.proofPaths
            : detail.order.proofPath
              ? [detail.order.proofPath]
              : [];
        setDetail({ ...detail, order: { ...detail.order, proofPath: added[added.length - 1], proofPaths: [...existing, ...added] } });
        setProofMsg("已上传 " + added.length + " 张凭证");
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          setProofs([{ path: "", url: String(reader.result) }]);
          setProofMsg("Mock 模式：凭证仅本地预览");
        };
        reader.readAsDataURL(files[0]);
      }
    } catch (err) {
      setProofMsg("上传失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeProof = async (path: string) => {
    if (!detail || !session) return;
    setProofMsg(null);
    const { data: rpcData, error } = await rpcRemoveOrderProof(detail.order.id, path);
    if (error || rpcData?.success === false) {
      return setProofMsg(error?.message ?? (rpcData as { message?: string })?.message ?? "删除凭证失败");
    }
    await supabase.storage.from("payment-proofs").remove([path]).catch(() => undefined);
    const prev =
      detail.order.proofPaths && detail.order.proofPaths.length > 0
        ? detail.order.proofPaths
        : detail.order.proofPath
          ? [detail.order.proofPath]
          : [];
    const next = prev.filter((x) => x !== path);
    setDetail({ ...detail, order: { ...detail.order, proofPaths: next, proofPath: next.length ? next[next.length - 1] : null } });
    setProofs((list) => list.filter((x) => x.path !== path));
    setProofMsg("已删除一张凭证");
  };

  const o = detail?.order ?? mockOrder;
  const items = detail?.items ?? o?.items ?? [];
  const members = detail?.members ?? o?.members ?? [];

  const canEditCommission = o?.status === "completed" && o?.auditStatus === "pending" && members.length > 0;

  const openCommissionEditor = () => {
    const init: Record<string, string> = {};
    members.forEach((m) => (init[m.employeeId] = String(m.commission)));
    setDrafts(init);
    setEditCommissions(true);
    setModalMsg(null);
  };

  const saveCommissions = async () => {
    if (!detail) return;
    const commissions = members.map((m) => ({ employee_id: m.employeeId, amount: Number(drafts[m.employeeId]) || 0 }));
    if (session) {
      const { data, error } = await rpcSetPendingOrderCommissions(detail.order.id, commissions);
      if (error || data?.success === false) {
        return setModalMsg("修改失败：" + (error?.message ?? (data as { message?: string })?.message ?? "未知错误"));
      }
    }
    setDetail({
      ...detail,
      members: members.map((m) => ({ ...m, commission: Number(drafts[m.employeeId]) || 0 })),
      order: { ...detail.order, commission: commissions.reduce((s, c) => s + c.amount, 0) },
    });
    setEditCommissions(false);
    setModalMsg("提成已修改（审核时将按此入账）");
  };

  const rejectAudit = async () => {
    if (!detail) return;
    if (session) {
      const { data, error } = await rpcRejectOrderAudit(detail.order.id);
      if (error || data?.success === false) {
        return setModalMsg("驳回失败：" + (error?.message ?? (data as { message?: string })?.message ?? "未知错误"));
      }
    }
    setDetail({ ...detail, order: { ...detail.order, auditStatus: "pending", commission: 0, grossProfit: 0 } });
    setModalMsg("已驳回审核，订单恢复为待审核");
  };

  return (
    <Modal open={!!orderId} title={o ? `订单 ${o.orderNo}` : "订单详情"} onClose={onClose} xwide>
      {o ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusTag status={o.status} />
            <AuditStatusTag status={o.auditStatus} />
            <span className="font-mono text-[11px] text-muted">{o.createdAt}</span>
            <div className="ml-auto">
              <Button size="sm" variant="secondary" onClick={() => setReceiptOpen(true)}>生成小票</Button>
            </div>
          </div>

          <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "客户", value: `${o.customerName}${o.customerType === "vip" ? ` · VIP${o.vipLevel}` : ""}` },
              { label: "支付方式", value: o.payMethod === "wallet" ? "钱包" : "现金" },
              { label: "实付 / 折扣", value: `${money(o.paid)} / ${money(o.discount)}` },
              { label: "佣金 / 毛利", value: `${money(o.commission)} / ${money(o.grossProfit)}` },
            ].map((x) => (
              <div key={x.label} className="bg-surface p-3">
                <p className="font-mono text-[10px] text-muted">{x.label}</p>
                <p className="mt-0.5 text-sm font-medium">{x.value}</p>
              </div>
            ))}
          </div>

          <DataTable<OrderItem>
            rowKey={(r, i) => r.productName + i}
            columns={[
              { key: "name", label: "商品" },
              { key: "category", label: "分类", mono: true },
              { key: "qty", label: "数量", align: "right", mono: true, render: (r) => r.quantity },
              { key: "unit", label: "单价", align: "right", mono: true, render: (r) => money(r.unitPrice) },
              { key: "paid", label: "实付", align: "right", mono: true, render: (r) => money(r.paid) },
            ]}
            rows={items}
          />

          {members.length > 0 && (
            <DataTable<OrderMember>
              rowKey={(r) => r.employeeId}
              columns={[
                { key: "name", label: "员工" },
                { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
                { key: "base", label: "基数", align: "right", mono: true, render: (r) => money(r.base) },
                { key: "rate", label: "比例", align: "right", mono: true, render: (r) => (r.rate * 100).toFixed(1) + "%" },
                { key: "commission", label: "佣金", align: "right", mono: true, render: (r) => money(r.commission) },
              ]}
              rows={members}
            />
          )}

          {(canEditCommission || o?.auditStatus === "approved") && (
            <div className="flex flex-wrap items-center gap-2">
              {canEditCommission && (
                <Button size="sm" variant="secondary" onClick={openCommissionEditor}>修改提成</Button>
              )}
              {o?.auditStatus === "approved" && (
                <Button size="sm" variant="danger" onClick={rejectAudit}>驳回审核</Button>
              )}
            </div>
          )}

          {editCommissions && (
            <div className="space-y-2 border border-line bg-paper p-3">
              <p className="font-mono text-[11px] text-muted">修改提成（审核时将按此入账）</p>
              {members.map((m) => (
                <label key={m.employeeId} className="flex items-center gap-2">
                  <span className="w-20 font-mono text-[11px] text-muted">{m.name}</span>
                  <Input
                    type="number"
                    value={drafts[m.employeeId] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [m.employeeId]: e.target.value })}
                  />
                </label>
              ))}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditCommissions(false)}>取消</Button>
                <Button size="sm" onClick={saveCommissions}>保存提成</Button>
              </div>
            </div>
          )}

          {modalMsg && <p className="font-mono text-[11px] text-danger">{modalMsg}</p>}

          <div className="border border-line bg-paper p-3">
            <p className="mb-2 font-mono text-[11px] text-muted">支付凭证（{proofs.length} 张）</p>
            {proofs.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {proofs.map((pr) => (
                  <div key={pr.url} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pr.url} alt="支付凭证" className="max-h-40 w-full border border-line bg-surface object-contain" />
                    {pr.path && session && (
                      <button
                        type="button"
                        onClick={() => void removeProof(pr.path)}
                        className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80"
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-mono text-xs text-muted">暂无凭证</p>
            )}
            {proofMsg && <p className="mt-2 font-mono text-[11px] text-danger">{proofMsg}</p>}
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? "上传中…" : "上传支付凭证"}
              </Button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
              <span className="font-mono text-[10px] text-muted">支持多张 jpg/png；真实模式下保存至 payment-proofs</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="py-8 text-center font-mono text-xs text-muted">订单不存在</p>
      )}
      <ReceiptEditor order={o} open={receiptOpen} onClose={() => setReceiptOpen(false)} />
    </Modal>
  );
}