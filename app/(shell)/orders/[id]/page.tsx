"use client";

import { useEffect, useRef, useState } from "react";
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
import { ReceiptEditor } from "@/components/business/ReceiptEditor";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";
import { orderActionMessage } from "@/lib/order-actions";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: orders, real, loading: ordersLoading, mutate: setOrders } = useResource<Order>("orders", apiOrders, ORDERS);
  const cachedOrder = orders.find((o) => o.id === params.id) ?? null;
  const [localOrder, setLocalOrder] = useState<Order | null>(null);
  const [realDetail, setRealDetail] = useState<Awaited<ReturnType<typeof apiOrderDetail>>>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { session, isBoss, isManager, mockRole } = useAuth();
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncRequired, setSyncRequired] = useState(false);
  const syncRequiredRef = useRef(false);
  const readVersion = useRef(0);
  const markSyncRequired = (value: boolean) => { syncRequiredRef.current = value; setSyncRequired(value); };
  const busyRef = useRef(false);
  const requestVersion = useRef(0);
  const activeId = useRef(params.id);
  activeId.current = params.id;

  useEffect(() => {
    let mounted = true;
    const version = ++requestVersion.current;
    const read = ++readVersion.current;
    setLocalOrder(null);
    setRealDetail(null);
    setDeletedId(null);
    setDetailError(null);
    markSyncRequired(false);
    if (session && params.id) {
      setDetailLoading(true);
      apiOrderDetail(params.id, true).then((r) => {
        if (!mounted || version !== requestVersion.current || read !== readVersion.current) return;
        setRealDetail(r);
        setLocalOrder(r?.order ?? null);
        if (!r) { setDetailError("未找到当前账号可读取的订单，请刷新列表核对。"); markSyncRequired(true); }
      }).catch(err => {
        if (!mounted || version !== requestVersion.current || read !== readVersion.current) return;
        setDetailError("订单详情读取失败：" + orderActionMessage(err));
        markSyncRequired(true);
      }).finally(() => { if (mounted && version === requestVersion.current && read === readVersion.current) setDetailLoading(false); });
    } else {
      setDetailLoading(false);
    }
    return () => {
      mounted = false;
    };
  }, [session, params.id]);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundMethod, setRefundMethod] = useState<"wallet" | "cash">("wallet");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const o = deletedId === params.id ? null : localOrder?.id === params.id ? localOrder : cachedOrder;
  const items = realDetail?.order.id === params.id ? realDetail.items : o?.items ?? [];
  const members = realDetail?.order.id === params.id ? realDetail.members : o?.members ?? [];

  const refreshOrder = async (id = params.id) => {
    if (activeId.current !== id) return null;
    const version = requestVersion.current;
    const read = ++readVersion.current;
    const fresh = await apiOrderDetail(id, true);
    if (activeId.current !== id || version !== requestVersion.current || read !== readVersion.current) return null;
    if (!fresh) throw new Error("未找到当前账号可读取的订单，请刷新列表核对。");
    setDetailLoading(false);
    setRealDetail(fresh);
    setLocalOrder(fresh.order);
    setOrders(prev => prev.map(order => order.id === id ? fresh.order : order));
    setDetailError(null);
    markSyncRequired(false);
    return fresh;
  };

  const refreshManually = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await refreshOrder(); setNotice("订单已刷新。"); }
    catch (err) { setDetailError(orderActionMessage(err)); }
    finally { busyRef.current = false; setBusy(false); }
  };

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
        <PageHeader title={deletedId === params.id ? "订单已删除" : detailError ? "订单详情暂时不可读取" : "未找到可读取的订单"} meta="/orders/[id]" />
        {detailError && <p role="alert" className="text-sm text-danger">{detailError}</p>}
        {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
        <Link href="/orders" className="font-mono text-xs underline underline-offset-2">← 返回订单列表</Link>
      </div>
    );
  }

  const setStatus = async (status: "booking" | "in_progress" | "completed") => {
    if (busyRef.current || syncRequiredRef.current) return;
    if (!session && !(MOCK_LOGIN_ENABLED && mockRole)) return setNotice("请先登录后操作订单。");
    const id = o.id;
    const version = requestVersion.current;
    const current = () => activeId.current === id && requestVersion.current === version;
    busyRef.current = true;
    ++readVersion.current;
    setDetailLoading(false);
    setBusy(true);
    setNotice(null);
    let confirmed = false;
    try {
      if (session) {
        const { data, error } = await updateOrderStatus(id, status);
        if (!current()) return;
        if (error || data?.success !== true) {
          if (error?.uncertain) markSyncRequired(true);
          return setNotice("状态未更新：" + orderActionMessage(error ?? data?.message));
        }
        confirmed = true;
        // Only apply the status explicitly confirmed for this UUID by the server.
        setLocalOrder({ ...o, status });
        setOrders(prev => prev.map(order => order.id === id ? { ...order, status } : order));
        await refreshOrder(id);
        if (current()) setNotice(data.unchanged ? "订单已处于目标状态，本次未重复更新。" : "订单状态已由服务器确认。");
      } else setLocalOrder({ ...o, status });
    } catch (err) {
      if (current()) { markSyncRequired(!!session); setNotice((confirmed ? "状态已保存，但详情刷新失败，请刷新核对：" : "状态结果未确认，请刷新核对：") + orderActionMessage(err)); }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const refund = async () => {
    if (busyRef.current || syncRequiredRef.current) return;
    if (!session && !(MOCK_LOGIN_ENABLED && mockRole)) return setNotice("请先登录后操作订单。");
    const id = o.id;
    const version = requestVersion.current;
    const current = () => activeId.current === id && requestVersion.current === version;
    busyRef.current = true;
    ++readVersion.current;
    setDetailLoading(false);
    setBusy(true);
    setNotice(null);
    let confirmed = false;
    try {
      if (session) {
        const { data, error } = await rpcRefundOrder(id, refundMethod);
        if (!current()) return;
        if (error || data?.success !== true) {
          if (error?.uncertain) markSyncRequired(true);
          return setNotice("退款未完成：" + orderActionMessage(error ?? data?.message));
        }
        confirmed = true;
        setRefundOpen(false);
        await refreshOrder(id);
      } else setLocalOrder({ ...o, status: "cancelled", auditStatus: "rejected", commission: 0, grossProfit: 0 });
      if (current()) { setRefundOpen(false); setNotice("退款已确认，订单状态已刷新。"); }
    } catch (err) {
      if (current()) { markSyncRequired(!!session); setNotice((confirmed ? "退款已确认，但详情刷新失败，勿重复退款：" : "退款结果未确认，请刷新核对：") + orderActionMessage(err)); }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const removeOrder = async () => {
    if (busyRef.current || syncRequiredRef.current) return;
    if (!session && !(MOCK_LOGIN_ENABLED && mockRole)) return setNotice("请先登录后操作订单。");
    const id = o.id;
    const version = requestVersion.current;
    const current = () => activeId.current === id && requestVersion.current === version;
    busyRef.current = true;
    ++readVersion.current;
    setDetailLoading(false);
    setBusy(true);
    setNotice(null);
    try {
      if (session) {
        const { data, error } = await rpcDeleteOrder(id, "前端删除");
        if (!current()) return;
        if (error || data?.success !== true) {
          if (error?.uncertain) markSyncRequired(true);
          return setNotice("删除未完成：" + orderActionMessage(error ?? data?.message));
        }
      }
      setOrders(prev => prev.filter(order => order.id !== id));
      if (!current()) return;
      setDeleteOpen(false);
      setDeletedId(id);
      setRealDetail(null);
      setLocalOrder(null);
      setNotice(`订单 ${o.orderNo} 已确认删除。`);
    } catch (err) {
      if (current()) { markSyncRequired(!!session); setNotice("删除结果未确认，请刷新列表核对：" + orderActionMessage(err)); }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div role="status" className="border border-line bg-surface p-3 font-mono text-xs text-muted">{notice}</div>
      )}
      {detailError && <p role="alert" className="text-sm text-danger">{detailError}</p>}

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
          <Button size="sm" variant="secondary" disabled title="订单状态只向前推进，不退回待开始">待开始</Button>
          <Button size="sm" variant="secondary" onClick={() => setStatus("in_progress")} disabled={busy || syncRequired || o.status !== "booking" || o.auditStatus === "rejected"}>开始</Button>
          <Button size="sm" variant="secondary" onClick={() => setStatus("completed")} disabled={busy || syncRequired || !["booking", "in_progress"].includes(o.status) || o.auditStatus === "rejected"}>完成</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void refreshManually(); }}>刷新详情</Button>
          <Button size="sm" variant="secondary" onClick={() => setReceiptOpen(true)}>生成小票</Button>
          <Link href="/audit"><Button size="sm">去审核</Button></Link>
          {(isBoss || (isManager && o.auditStatus !== "approved")) && <Button size="sm" variant="danger" onClick={() => { setRefundMethod(o.payMethod); setRefundOpen(true); }} disabled={busy || syncRequired || o.status === "cancelled" || o.auditStatus === "rejected"}>退款</Button>}
          {(isBoss || (isManager && o.operatorId === session?.user?.id)) && <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)} disabled={busy || syncRequired}>删除</Button>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="商品明细" meta={`${items.length} 项`}>
          <DataTable<OrderItem>
            rowKey={(r, i) => r.productName + i}
            columns={[
              { key: "productName", label: "商品", render: (r) => r.productName },
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
              { key: "name", label: "员工", render: (r) => (r.realName && r.realName !== r.name ? `${r.name}（${r.realName}）` : r.name) },
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
            <Button variant="secondary" disabled={busy} onClick={() => setRefundOpen(false)}>取消</Button>
            <Button variant="danger" disabled={busy || syncRequired} onClick={refund}>确认退款（{money(o.paid)}）</Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteOpen} title={`删除订单 — ${o.orderNo}`} onClose={() => setDeleteOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm">服务器会校验删除权限并处理关联资金与审计；恢复旧单仍维持财务保护。</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="danger" disabled={busy || syncRequired} onClick={removeOrder}>确认删除</Button>
          </div>
        </div>
      </Modal>

      <p className="font-mono text-[11px] text-muted">
        <Link href="/orders" className="underline underline-offset-2 hover:text-accent">← 返回订单列表</Link>
        {real ? " · 订单状态以服务器确认为准（支持待开始直接完成）" : " · 状态/退款/删除为本地 Mock 交互"}
      </p>
      <ReceiptEditor order={o} open={receiptOpen} onClose={() => setReceiptOpen(false)} />
    </div>
  );
}
