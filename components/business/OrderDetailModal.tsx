"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { apiOrderDetail, rpcUpdateOrderProof, uploadProof } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { ORDERS, type Order, type OrderItem, type OrderMember } from "@/lib/mock-data";

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
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofMsg, setProofMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!orderId) return;
    setDetail(null);
    setMockOrder(null);
    setProofUrl(null);
    setProofMsg(null);
    if (session) {
      apiOrderDetail(orderId).then((d) => {
        if (d) setDetail(d);
      });
    } else {
      setMockOrder(ORDERS.find((o) => o.id === orderId) ?? null);
    }
  }, [orderId, session]);

  // 真实凭证：私有桶 → 签名 URL 展示
  useEffect(() => {
    let mounted = true;
    const path = detail?.order.proofPath;
    if (session && path) {
      supabase.storage
        .from("payment-proofs")
        .createSignedUrl(path, 300)
        .then(({ data }) => {
          if (mounted && data?.signedUrl) setProofUrl(data.signedUrl);
        });
    }
    return () => {
      mounted = false;
    };
  }, [detail, session]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setProofMsg(null);
    try {
      if (session && detail) {
        const path = await uploadProof(file, session.user.id, detail.order.id);
        const { error } = await rpcUpdateOrderProof(detail.order.id, path);
        if (error) throw new Error(error.message);
        setDetail({ ...detail, order: { ...detail.order, proofPath: path } });
        setProofMsg("凭证已上传并保存");
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          setProofUrl(String(reader.result));
          setProofMsg("Mock 模式：凭证仅本地预览");
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      setProofMsg("上传失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const o = detail?.order ?? mockOrder;
  const items = detail?.items ?? o?.items ?? [];
  const members = detail?.members ?? o?.members ?? [];

  return (
    <Modal open={!!orderId} title={o ? `订单 ${o.orderNo}` : "订单详情"} onClose={onClose} wide>
      {o ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusTag status={o.status} />
            <AuditStatusTag status={o.auditStatus} />
            <span className="font-mono text-[11px] text-muted">{o.createdAt}</span>
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

          <div className="border border-line bg-paper p-3">
            <p className="mb-2 font-mono text-[11px] text-muted">支付凭证</p>
            {proofUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proofUrl} alt="支付凭证" className="max-h-48 border border-line bg-surface object-contain" />
            ) : (
              <p className="font-mono text-xs text-muted">暂无凭证</p>
            )}
            {proofMsg && <p className="mt-2 font-mono text-[11px] text-danger">{proofMsg}</p>}
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? "上传中…" : "上传支付凭证"}
              </Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              <span className="font-mono text-[10px] text-muted">支持 jpg/png；真实模式下保存至 payment-proofs</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="py-8 text-center font-mono text-xs text-muted">订单不存在</p>
      )}
    </Modal>
  );
}