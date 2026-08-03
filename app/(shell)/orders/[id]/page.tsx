"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { ORDERS, type Order, type OrderItem, type OrderMember } from "@/lib/mock-data";
import { apiOrders, apiOrderDetail, rpcRefundOrder, rpcDeleteOrder, updateOrderStatus } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { BossOnly } from "@/components/business/RequireRole";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: orders, real, loading: ordersLoading } = useResource<Order>("orders", apiOrders, ORDERS);
  const cachedOrder = orders.find((o) => o.id === params.id) ?? null;
  const [localOrder, setLocalOrder] = useState<Order | null>(null);
  const [realDetail, setRealDetail] = useState<Awaited<ReturnType<typeof apiOrderDetail>>>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { session } = useAuth();

  // 优先用缓存订单立即渲染；真实详情（含明细/成员）异步到达后合并
  useEffect(() => {
    if (!localOrder && cachedOrder) setLocalOrder(cachedOrder);
  }, [localOrder, cachedOrder]);
  useEffect(() => {
    if (realDetail?.order) setLocalOrder((prev) => prev ?? realDetail.order);
  }, [realDetail]);

  useEffect(() => {
    let mounted = true;
    if (session && params.id) {
      setDetailLoading(true);
      apiOrderDetail(params.id).then((r) => {
        if (!mounted) return;
        setRealDetail(r);
        setDetailLoading(false);
      });
    }
    return () => {
      mounted = false;
    };
  }, [session, params.id]);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundMethod, setRefundMethod] = useState<"wallet" | "cash">("wallet");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const o = localOrder;
  const items = realDetail?.items ?? o?.items ?? [];
  const members = realDetail?.members ?? o?.members ?? [];

  if (!o) {
    if (ordersLoading || (session && detailLoading)) {
      return (
        <div className="space-y-6">
          <PageHeader title="加载中…" meta="/orders/[id]" />
          <Link href="/orders" className="font-mono text-xs underline underline-offset-2">← 返回订单列表</Link>
        </div>
      );
    }
    return (
      <div>
        <PageHeader title="订单不存在或已删除" meta="/orders/[id]" />
        <Link href="/orders" className="font-mono text-xs underline underline-offset-2">← 返回订单列表</Link>
      </div>
    );
  }

  const setStatus = async (status: "booking" | "in_progress" | "completed") => {
    setNotice(null);
    if (session && o.id) {
      const { error } = await updateOrderStatus(o.id, status);
      if (error) return setNotice("状态更新失败：" + error.message);
    }
    setLocalOrder({ ...o, status });
  };

  const refund = async () => {
    setNotice(null);
    if (session && o.id) {
      const { data, error } = await rpcRefundOrder(o.id, refundMethod);
      if (error || data?.success === false) {
        return setNotice("退款失败：" + (error?.message ?? data?.message ?? "未知错误"));
      }
    }
    setLocalOrder({ ...o, status: "cancelled", auditStatus: "rejected", commission: 0, grossProfit: 0 });
    setRefundOpen(false);
    setNotice(`已退款（${refundMethod === "wallet" ? "钱包" : "现金"}），订单置为已取消/已拒绝`);
  };

  const removeOrder = async () => {
    setDeleteOpen(false);
    if (session && o.id) {
      const { data, error } = await rpcDeleteOrder(o.id, "前端删除");
      if (error || data?.success === false) {
        return setNotice("删除失败：" + (error?.message ?? data?.message ?? "未知错误"));
      }
    }
    setNotice(`订单 ${o.orderNo} 已删除（已写入删除审计）`);
    setLocalOrder(null);
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className="border border-line bg-surface p-3 font-mono text-xs text-muted">{notice}</div>
      )}

      <PageHeader title={o.orderNo} meta={`/orders/${o.id} · ${real ? "真实数据" : "Mock 数据"} · ${o.createdAt}`} />

      <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "客户", value: `${o.customerName}${o.customerType === "vip" ? ` · VIP${o.vipLevel}` : ""}` },
          { label: "支付方式", value: o.payMethod === "wallet" ? "钱包（本金/赠送质押）" : "现金（预收）" },
          { label: "原价 / 实付 / 折扣", value: `${money(o.original)} / ${money(o.paid)} / ${money(o.discount)}` },
          { label: "佣金 / 毛利", value: `${money(o.commission)} / ${money(o.grossProfit)}` },
        ].map((x) => (
          <div key={x.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{x.label}</p>
            <p className="mt-1 text-sm font-medium">{x.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <OrderStatusTag status={o.status} />
          <AuditStatusTag status={o.auditStatus} />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setStatus("booking")} disabled={o.status === "booking"}>待开始</Button>
          <Button size="sm" variant="secondary" onClick={() => setStatus("in_progress")} disabled={o.status === "in_progress"}>开始</Button>
          <Button size="sm" variant="secondary" onClick={() => setStatus("completed")} disabled={o.status === "completed"}>完成</Button>
          <Link href="/audit"><Button size="sm">去审核</Button></Link>
          <BossOnly><Button size="sm" variant="danger" onClick={() => setRefundOpen(true)} disabled={o.status === "cancelled"}>退款</Button></BossOnly>
          <BossOnly><Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)} disabled={o.status !== "booking" || o.auditStatus !== "pending"}>删除</Button></BossOnly>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="商品明细" meta={`${o.items.length} 项`}>
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
        </Panel>

        <Panel title="参与员工与提成" meta={`${o.members.length} 人`}>
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
        </Panel>
      </div>

      <Modal open={refundOpen} title={`退款 — ${o.orderNo}`} onClose={() => setRefundOpen(false)}>
        <div className="space-y-4">
          <p className="font-mono text-[11px] text-muted">
            待审核单须按原支付方式退款（{o.payMethod === "wallet" ? "钱包" : "现金"}）；已审核单仅老板可退。
          </p>
          <div className="flex gap-1">
            {(["wallet", "cash"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRefundMethod(m)}
                aria-pressed={refundMethod === m}
                className={[
                  "flex-1 rounded-md px-3 py-2 text-xs transition-colors",
                  refundMethod === m ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2",
                ].join(" ")}
              >
                {m === "wallet" ? "钱包退回" : "现金退回"}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRefundOpen(false)}>取消</Button>
            <Button variant="danger" onClick={refund}>确认退款（{money(o.paid)}）</Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteOpen} title={`删除订单 — ${o.orderNo}`} onClose={() => setDeleteOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm">仅「待开始 + 未审核 + 未产生提成」的订单可删除；删除后写入审计日志。</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="danger" onClick={removeOrder}>确认删除</Button>
          </div>
        </div>
      </Modal>

      <p className="font-mono text-[11px] text-muted">
        <Link href="/orders" className="underline underline-offset-2 hover:text-accent">← 返回订单列表</Link>
        {real ? " · 状态/退款/删除直连数据库 RPC" : " · 状态/退款/删除为本地 Mock 交互"}
      </p>
    </div>
  );
}