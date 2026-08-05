"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { apiOrderDetail, apiCustomers, apiEmployees, apiProducts, rpcAddOrderProof, rpcRemoveOrderProof, rpcSetPendingOrderCommissions, rpcRejectOrderAudit, rpcEditOrder, rpcCorrectOrder, rpcDeleteOrder, rpcAdjustOrderPrice, uploadProof } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { compressPaymentProof } from "@/lib/image-compression";
import { useResource } from "@/lib/data-store";
import { CustomerSelect } from "@/components/business/CustomerSelect";
import { EmployeePicker } from "@/components/business/EmployeePicker";
import { ORDERS, CUSTOMERS, EMPLOYEES, PRODUCTS, type Order, type OrderItem, type OrderMember, type Customer, type Employee, type Product } from "@/lib/mock-data";
import { ReceiptEditor } from "@/components/business/ReceiptEditor";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export function OrderDetailModal({
  orderId,
  onClose,
  onDeleted,
}: {
  orderId: string | null;
  onClose: () => void;
  onDeleted?: (orderId: string) => void;
}) {
  const { session, isBoss, isManager } = useAuth();
  const { data: products } = useResource<Product>("products", apiProducts, PRODUCTS);
  const { data: customers } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { data: employees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const [editOpen, setEditOpen] = useState(false);
  const [editCust, setEditCust] = useState("");
  const [editPay, setEditPay] = useState<"wallet" | "cash">("wallet");
  const [editItems, setEditItems] = useState<{ product_id: string; quantity: number }[]>([]);
  const [editEmps, setEditEmps] = useState<string[]>([]);
  const [editMsg, setEditMsg] = useState<string | null>(null);
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceValue, setPriceValue] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const [pricing, setPricing] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    setDetail(null);
    setMockOrder(null);
    setProofs([]);
    setProofMsg(null);
    // 切换订单时重置所有临时 UI 状态（编辑/删除确认/提成草稿/小票/提示），避免残留上一单布局
    setEditOpen(false);
    setEditCust("");
    setEditPay("wallet");
    setEditItems([]);
    setEditEmps([]);
    setEditMsg(null);
    setEditCommissions(false);
    setDrafts({});
    setModalMsg(null);
    setReceiptOpen(false);
    setDeleteOpen(false);
    setDeleteReason("");
    setDeleting(false);
    setPriceOpen(false);
    setPriceValue("");
    setPriceReason("");
    setPricing(false);
    setUploading(false);
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

  const adjustPrice = async () => {
    if (!o) return;
    const newPaid = Number(priceValue);
    setPricing(true);
    setModalMsg(null);
    if (Number.isNaN(newPaid) || newPaid < 0 || newPaid > o.original) {
      setPricing(false);
      return setModalMsg("实际收款需在 0 与订单原价之间");
    }
    if (session) {
      const { data, error } = await rpcAdjustOrderPrice(o.id, newPaid, priceReason.trim() || null);
      if (error || data?.success === false) {
        setPricing(false);
        return setModalMsg("改价失败：" + (error?.message ?? (data as { message?: string })?.message ?? "未知错误"));
      }
      const fresh = await apiOrderDetail(o.id);
      if (fresh) setDetail(fresh);
    } else {
      // Mock 模式：本地更新金额
      if (mockOrder) {
        setMockOrder({ ...mockOrder, paid: newPaid, discount: o.original - newPaid, pending: newPaid });
      }
    }
    setPriceOpen(false);
    setPricing(false);
    setModalMsg("价格已修改：实付 " + money(newPaid) + "（原价 " + money(o.original) + "）");
  };

  const confirmDelete = async () => {
    if (!o) return;
    setDeleting(true);
    setModalMsg(null);
    if (session && detail) {
      const { data, error } = await rpcDeleteOrder(detail.order.id, deleteReason.trim() || null);
      if (error || data?.success === false) {
        setDeleting(false);
        return setModalMsg("删除失败：" + (error?.message ?? (data as { message?: string })?.message ?? "未知错误"));
      }
    }
    onDeleted?.(o.id);
    setDeleting(false);
  };

  const openEdit = () => {
    if (!o) return;
    const cust = customers.find((c) => c.name === o.customerName);
    setEditCust(cust?.id ?? customers[0]?.id ?? "");
    setEditPay(o.payMethod);
    setEditItems(
      o.items
        .map((it) => {
          const prod = products.find((p) => p.name === it.productName);
          return { product_id: prod?.id ?? "", quantity: it.quantity };
        })
        .filter((x) => x.product_id),
    );
    setEditEmps(o.members.map((m) => m.employeeId));
    setEditMsg(null);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!detail) return;
    setEditMsg(null);
    if (editItems.length === 0) return setEditMsg("请至少保留一个商品");
    if (editEmps.length === 1) return setEditMsg("接单员工需选 0 或 2 名");
    if (!editCust) return setEditMsg("请选择客户");
    const isBooking = detail.order.status === "booking";
    const { data, error } = isBooking
      ? await rpcEditOrder({
          p_order_id: detail.order.id,
          p_customer_id: editCust,
          p_items: editItems,
          p_employee_ids: editEmps,
          p_pay_method: editPay,
        })
      : await rpcCorrectOrder({
          p_order_id: detail.order.id,
          p_customer_id: editCust,
          p_items: editItems,
          p_employee_ids: editEmps,
          p_pay_method: editPay,
        });
    if (error || data?.success === false) {
      return setEditMsg("保存失败：" + (error?.message ?? (data as { message?: string })?.message ?? "未知错误"));
    }
    const fresh = await apiOrderDetail(detail.order.id);
    if (fresh) setDetail(fresh);
    setEditOpen(false);
    setEditMsg(null);
    setModalMsg(
      isBooking
        ? "订单已更新（金额/客户/商品已按新口径重算）"
        : "已更正：原单已取消，新订单号 " + (data?.order_no ?? ""),
    );
  };

  return (
    <Modal open={!!orderId} title={o ? `订单 ${o.orderNo}` : "订单详情"} onClose={onClose} xwide>
      {o ? (editOpen ? (
        <div className="space-y-4">
          {editMsg && <p className="rounded-md border border-line bg-paper p-2 font-mono text-xs text-danger">{editMsg}</p>}
          {o && o.status !== "booking" && (
            <p className="rounded-md border border-line bg-paper p-2 font-mono text-[11px] text-muted">
              保存将对原单执行退款冲正（客户钱包/员工提成回退，可能产生欠款），并以新内容重建一张更正单。
            </p>
          )}
          <div className="space-y-1">
            <span className="font-mono text-[11px] text-muted">客户（可搜索）</span>
            <CustomerSelect value={editCust} onChange={setEditCust} customers={customers} />
          </div>
          <div className="space-y-1">
            <span className="font-mono text-[11px] text-muted">商品明细（{editItems.length} 项）</span>
            {editItems.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={it.product_id}
                  onChange={(e) => setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, product_id: e.target.value } : x)))}
                  className="h-[var(--control-h)] min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-ink"
                >
                  {products.filter((p) => p.status === "on_sale").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Input type="number" min={1} value={it.quantity}
                  onChange={(e) => setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))}
                  className="w-20" />
                <Button size="sm" variant="secondary" onClick={() => setEditItems((prev) => prev.filter((_, i) => i !== idx))}>×</Button>
              </div>
            ))}
            <Button size="sm" variant="secondary"
              onClick={() => setEditItems((prev) => [...prev, { product_id: products.find((p) => p.status === "on_sale")?.id ?? "", quantity: 1 }])}>
              ＋ 添加商品
            </Button>
          </div>
          <div className="space-y-1">
            <span className="font-mono text-[11px] text-muted">支付方式</span>
            <div className="flex gap-1">
              {(["wallet", "cash"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setEditPay(m)} aria-pressed={editPay === m}
                  className={["flex-1 rounded-md px-3 py-2 text-xs transition-colors", editPay === m ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2"].join(" ")}>
                  {m === "wallet" ? "钱包（质押）" : "现金（预收）"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <span className="font-mono text-[11px] text-muted">接单员工（0–2 人）</span>
            <EmployeePicker value={editEmps} onChange={setEditEmps} employees={employees} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setEditOpen(false); setEditMsg(null); }}>取消</Button>
            <Button onClick={() => void saveEdit()}>保存修改</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusTag status={o.status} />
            <AuditStatusTag status={o.auditStatus} />
            <span className="font-mono text-[11px] text-muted">{o.createdAt}</span>
            <div className="ml-auto">
              <Button size="sm" variant="secondary" onClick={() => setReceiptOpen(true)}>生成小票</Button>
              {(o.status === "booking" || o.status === "in_progress" || o.status === "completed") && (
                <Button size="sm" variant="secondary" onClick={openEdit}>
                  {o.status === "booking" ? "编辑订单" : "更正订单"}
                </Button>
              )}
              {isBoss && (
                <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>删除订单</Button>
              )}
              {(isBoss || isManager) && o.status !== "cancelled" && o.auditStatus !== "rejected" && (
                <Button size="sm" variant="secondary" onClick={() => { setPriceValue(String(o.paid)); setPriceReason(""); setPriceOpen(true); }}>修改价格</Button>
              )}
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

          <p className="mb-2 font-mono text-[11px] text-muted">商品明细{items.length > 0 ? ` · ${items.length} 项` : ""}</p>
          {items.length > 0 ? (
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
          ) : (
            <p className="rounded-md border border-line bg-paper p-3 font-mono text-xs text-muted">该订单暂无商品明细</p>
          )}

          <p className="mb-2 font-mono text-[11px] text-muted">打手（接单员工）{members.length > 0 ? ` · ${members.length} 人` : ""}</p>
          {members.length > 0 ? (
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
          ) : (
            <p className="rounded-md border border-line bg-paper p-3 font-mono text-xs text-muted">未指派打手</p>
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

          {priceOpen && (
            <div className="space-y-2 border border-line bg-paper p-3">
              <p className="font-mono text-[11px] text-muted">
                修改订单 {o.orderNo} 的实付金额（当前 {money(o.paid)} / 原价 {money(o.original)}）。已审核订单将自动冲回员工提成并按新价重算入账，客户余额/预收同步调整。
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">¥</span>
                <Input
                  value={priceValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d+(\.\d{0,2})?$/.test(v)) setPriceValue(v);
                  }}
                  inputMode="decimal"
                  placeholder={String(o.paid)}
                  aria-label="新实付金额"
                />
              </div>
              <Input
                placeholder="修改原因（可选）"
                value={priceReason}
                onChange={(e) => setPriceReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPriceOpen(false)}>取消</Button>
                <Button size="sm" onClick={() => void adjustPrice()} disabled={pricing}>
                  {pricing ? "保存中…" : "保存改价"}
                </Button>
              </div>
            </div>
          )}

          {deleteOpen && (
            <div className="space-y-2 border border-line bg-paper p-3">
              <p className="font-mono text-[11px] text-danger">
                确认删除订单 {o.orderNo}？删除后不可恢复：已发生的客户本金/赠金扣款与员工提成将自动冲正（已审核订单回滚员工提成并恢复客户余额，未结算订单释放预收）。
              </p>
              <Input
                placeholder="删除原因（可选）"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDeleteOpen(false)}>取消</Button>
                <Button size="sm" variant="danger" onClick={() => void confirmDelete()} disabled={deleting}>
                  {deleting ? "删除中…" : "确认删除"}
                </Button>
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
        ))
      : (
        <p className="py-8 text-center font-mono text-xs text-muted">订单不存在</p>
      )}
      <ReceiptEditor order={o} open={receiptOpen} onClose={() => setReceiptOpen(false)} />
    </Modal>
  );
}