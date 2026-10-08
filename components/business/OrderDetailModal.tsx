"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { apiOrderDetail, apiCustomers, apiEmployees, apiProducts, rpcAddOrderProof, rpcRemoveOrderProof, rpcSetPendingOrderCommissions, rpcRejectOrderAudit, rpcEditOrder, rpcCorrectOrder, rpcDeleteOrder, rpcAdjustOrderPrice, uploadProof } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";
import { commissionChanges, orderActionMessage, RECOVERY_HISTORY_MESSAGE, type OrderActionResult } from "@/lib/order-actions";
import { compressPaymentProof } from "@/lib/image-compression";
import { useResource } from "@/lib/data-store";
import { CustomerSelect } from "@/components/business/CustomerSelect";
import { ProductSelect } from "@/components/business/ProductSelect";
import { EmployeePicker } from "@/components/business/EmployeePicker";
import { ORDERS, CUSTOMERS, EMPLOYEES, PRODUCTS, type Order, type OrderItem, type OrderMember, type Customer, type Employee, type Product } from "@/lib/mock-data";
import { ReceiptEditor } from "@/components/business/ReceiptEditor";

type ActionToken = { selection: string | null; version: number; confirmed: boolean };

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export function OrderDetailModal({
  orderId,
  onClose,
  onDeleted,
  onChanged,
}: {
  orderId: string | null;
  onClose: () => void;
  onDeleted?: (orderId: string) => void;
  onChanged?: () => void;
}) {
  const { session, isBoss, isManager, mockRole } = useAuth();
  const { data: products } = useResource<Product>("products", apiProducts, PRODUCTS);
  const { data: customers } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { data: employees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const [editOpen, setEditOpen] = useState(false);
  const [editCust, setEditCust] = useState("");
  const [editPay, setEditPay] = useState<"wallet" | "cash">("wallet");
  const [editItems, setEditItems] = useState<{ product_id: string; quantity: number }[]>([]);
  const [editEmps, setEditEmps] = useState<string[]>([]);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [editPaid, setEditPaid] = useState("");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof apiOrderDetail>>>(null);
  const [mockOrder, setMockOrder] = useState<Order | null>(null);
  const [proofs, setProofs] = useState<{ path: string; url: string }[]>([]);
  const [proofMsg, setProofMsg] = useState<string | null>(null);
  const [previewProof, setPreviewProof] = useState<string | null>(null);
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
  const [actionBusy, setActionBusy] = useState(false);
  const [syncRequired, setSyncRequired] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadedSelection, setLoadedSelection] = useState<string | null>(null);
  const [pendingProofPaths, setPendingProofPaths] = useState<string[]>([]);
  const actionRef = useRef(false);
  const syncRef = useRef(false);
  const viewVersion = useRef(0);
  const readVersion = useRef(0);
  const selectionRef = useRef(orderId);
  selectionRef.current = orderId;
  const visibleDetail = loadedSelection === orderId ? detail : null;
  const markSync = (value: boolean) => { syncRef.current = value; setSyncRequired(value); };
  const currentView = (token: ActionToken) => token.selection === selectionRef.current && token.version === viewVersion.current;

  useEffect(() => {
    let mounted = true;
    const version = ++viewVersion.current;
    const read = ++readVersion.current;
    setLoadedSelection(orderId);
    markSync(false);
    setPendingProofPaths([]);
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
    setEditPaid("");
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
    if (!orderId) { setDetailLoading(false); return; }
    if (session) {
      setDetailLoading(true);
      apiOrderDetail(orderId, true).then(d => {
        if (!mounted || version !== viewVersion.current || read !== readVersion.current) return;
        if (d) setDetail(d);
        else { setModalMsg("未找到当前账号可读取的订单。"); markSync(true); }
      }).catch(err => {
        if (!mounted || version !== viewVersion.current || read !== readVersion.current) return;
        setModalMsg("订单详情读取失败：" + orderActionMessage(err)); markSync(true);
      }).finally(() => { if (mounted && version === viewVersion.current && read === readVersion.current) setDetailLoading(false); });
    } else {
      setDetailLoading(false);
      if (MOCK_LOGIN_ENABLED && mockRole) setMockOrder(ORDERS.find(o => o.id === orderId) ?? null);
    }
    return () => { mounted = false; };
  }, [orderId, session, mockRole]);

  // 真实凭证：私有桶 → 签名 URL 展示（支持多张）
  useEffect(() => {
    let mounted = true;
    const paths =
      visibleDetail?.order.proofPaths && visibleDetail.order.proofPaths.length > 0
        ? visibleDetail.order.proofPaths
        : visibleDetail?.order.proofPath
          ? [visibleDetail.order.proofPath]
          : [];
    setProofs([]);
    if (session && paths.length > 0) {
      Promise.all(
        paths.map(async (path) => {
          const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 300);
          return data?.signedUrl ? { path, url: data.signedUrl } : null;
        }),
      ).then((list) => {
        if (mounted) {
          setProofs(list.filter(Boolean) as { path: string; url: string }[]);
          if (list.some(item => !item)) setProofMsg("部分凭证引用存在，但文件不可读取或签名失败。");
        }
      }).catch(err => { if (mounted) setProofMsg("凭证读取失败：" + orderActionMessage(err)); });
    }
    return () => {
      mounted = false;
    };
  }, [visibleDetail, session, orderId]);

  const o = visibleDetail?.order ?? (mockOrder?.id === orderId ? mockOrder : null);
  const items = visibleDetail?.items ?? o?.items ?? [];
  const members = visibleDetail?.members ?? o?.members ?? [];
  const canEditCommission = o?.status === "completed" && o?.auditStatus === "pending" && members.length > 0;
  const incompleteAssociations = !!session && !!o && (!o.customerId || items.length === 0 || items.some(item => !item.productId));

  const loadDetail = async (id: string, token: ActionToken) => {
    if (!currentView(token)) return null;
    const read = ++readVersion.current;
    const fresh = await apiOrderDetail(id, true);
    if (!currentView(token) || read !== readVersion.current) return null;
    if (!fresh) throw new Error("未找到当前账号可读取的订单，请刷新列表核对。");
    setDetail(fresh);
    setLoadedSelection(token.selection);
    setDetailLoading(false);
    markSync(false);
    return fresh;
  };

  const runAction = async (task: (token: ActionToken) => Promise<void>, report = setModalMsg, allowRefresh = false) => {
    if (actionRef.current || (!allowRefresh && syncRef.current)) return;
    if (!session && !(MOCK_LOGIN_ENABLED && mockRole)) return report("请先登录后操作订单。");
    actionRef.current = true;
    ++readVersion.current;
    setDetailLoading(false);
    setActionBusy(true);
    const token: ActionToken = { selection: orderId, version: viewVersion.current, confirmed: false };
    try { await task(token); }
    catch (err) {
      if (currentView(token)) {
        markSync(!!session);
        report((token.confirmed ? "操作已确认，但详情刷新未完成，请刷新核对，勿重复提交：" : "操作结果未确认，请刷新核对：") + orderActionMessage(err));
      }
    } finally {
      actionRef.current = false;
      setActionBusy(false);
      setUploading(false);
      setPricing(false);
      setDeleting(false);
    }
  };

  const acceptResult = (result: OrderActionResult, token: ActionToken, report = setModalMsg): boolean => {
    if (!currentView(token)) return false;
    if (result.error || result.data?.success !== true) {
      if (result.error?.uncertain) markSync(true);
      report(orderActionMessage(result.error ?? result.data?.message));
      return false;
    }
    token.confirmed = true;
    return true;
  };

  const refreshModal = () => runAction(async token => {
    const target = o?.id ?? orderId;
    if (session && target) await loadDetail(target, token);
    if (currentView(token)) setModalMsg("订单详情已刷新，请按当前结果操作。");
  }, setModalMsg, true);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !o) return;
    if (session && !visibleDetail) return setProofMsg("请先读取真实订单详情再上传凭证。");
    const target = o.id;
    await runAction(async token => {
      setUploading(true);
      setProofMsg(null);
      if (!session) {
        const reader = new FileReader();
        reader.onload = () => { if (currentView(token)) { setProofs([{ path: "", url: String(reader.result) }]); setProofMsg("Mock 模式：凭证仅本地预览"); } };
        reader.readAsDataURL(files[0]);
        return;
      }
      const uploaded: string[] = [];
      let confirmedCount = 0;
      let incomplete = "";
      let uncertain = false;
      for (const file of files) {
        try {
          const compressed = await compressPaymentProof(file);
          const uploadFile = compressed ? new File([compressed.blob], "proof." + compressed.extension, { type: compressed.contentType }) : file;
          const path = await uploadProof(uploadFile, session.user.id, target);
          uploaded.push(path);
          if (currentView(token)) setPendingProofPaths(uploaded);
          const result = await rpcAddOrderProof(target, path);
          if (result.error || result.data?.success !== true) {
            incomplete = orderActionMessage(result.error ?? result.data?.message);
            uncertain = result.error?.uncertain ?? true;
            // A lost RPC response may follow a committed reference: never delete the object here.
            break;
          }
          confirmedCount++;
          token.confirmed = true;
        } catch (err) { incomplete = orderActionMessage(err); uncertain = true; break; }
      }
      onChanged?.();
      const fresh = await loadDetail(target, token);
      if (!currentView(token) || !fresh) return;
      const paths = new Set(fresh.order.proofPaths?.length ? fresh.order.proofPaths : fresh.order.proofPath ? [fresh.order.proofPath] : []);
      const verified = uploaded.filter(path => paths.has(path));
      const pending = uploaded.filter(path => !paths.has(path));
      setPendingProofPaths(pending);
      if (uncertain && pending.length) markSync(true);
      const count = Math.max(confirmedCount, verified.length);
      setProofMsg(incomplete ? "已确认关联 " + count + " 张凭证；其余未完成：" + incomplete + "。已上传文件保留，请刷新核对。" : "已确认关联 " + count + " 张凭证。");
    }, setProofMsg);
  };

  const removeProof = async (path: string) => {
    if (!visibleDetail || !session) return;
    const target = visibleDetail.order.id;
    await runAction(async token => {
      setProofMsg(null);
      const result = await rpcRemoveOrderProof(target, path);
      if (!acceptResult(result, token, setProofMsg)) return;
      onChanged?.();
      let storageError: string | null = null;
      try {
        const removal = await supabase.storage.from("payment-proofs").remove([path]);
        if (removal.error) storageError = removal.error.message;
      } catch (err) { storageError = orderActionMessage(err); }
      await loadDetail(target, token);
      if (currentView(token)) setProofMsg(storageError ? "订单凭证引用已移除，但文件删除未确认：" + storageError : "订单凭证引用和文件已删除。");
    }, setProofMsg);
  };

  const openCommissionEditor = () => {
    if (actionRef.current || syncRef.current) return;
    if (incompleteAssociations) return setModalMsg(RECOVERY_HISTORY_MESSAGE);
    setDrafts(Object.fromEntries(members.map(member => [member.employeeId, member.override == null ? "" : String(member.override)])));
    setEditCommissions(true);
    setModalMsg(null);
  };

  const saveCommissions = async () => {
    if (!visibleDetail) return;
    let commissions: ReturnType<typeof commissionChanges>;
    try { commissions = commissionChanges(members, drafts); }
    catch (err) { return setModalMsg(orderActionMessage(err)); }
    const target = visibleDetail.order.id;
    await runAction(async token => {
      if (session) {
        const result = await rpcSetPendingOrderCommissions(target, commissions);
        if (!acceptResult(result, token)) return;
        onChanged?.();
        await loadDetail(target, token);
      }
      if (currentView(token)) { setEditCommissions(false); setModalMsg("提成覆盖已保存；留空的员工恢复自动计算。"); }
    });
  };

  const rejectAudit = async () => {
    if (!visibleDetail || !isBoss) return;
    const target = visibleDetail.order.id;
    await runAction(async token => {
      const result = await rpcRejectOrderAudit(target);
      if (!acceptResult(result, token)) return;
      onChanged?.();
      await loadDetail(target, token);
      if (currentView(token)) setModalMsg("已撤销审核，服务器状态已刷新为待审核。");
    });
  };

  const adjustPrice = async () => {
    if (!o) return;
    const newPaid = Number(priceValue);
    if (!priceValue.trim() || !Number.isFinite(newPaid) || newPaid < 0 || newPaid > o.original) return setModalMsg("实际收款须为 0 与订单原价之间的有限金额。");
    const target = o.id;
    await runAction(async token => {
      setPricing(true);
      if (session) {
        const result = await rpcAdjustOrderPrice(target, newPaid, priceReason.trim() || null);
        if (!acceptResult(result, token)) return;
        onChanged?.();
        await loadDetail(target, token);
      } else if (mockOrder && currentView(token)) setMockOrder({ ...mockOrder, paid: newPaid, discount: o.original - newPaid, pending: newPaid });
      if (currentView(token)) { setPriceOpen(false); setModalMsg("价格修改已确认，订单已刷新。"); }
    });
  };

  const confirmDelete = async () => {
    if (!o) return;
    const target = o.id;
    await runAction(async token => {
      setDeleting(true);
      if (session) {
        const result = await rpcDeleteOrder(target, deleteReason.trim() || null);
        if (!acceptResult(result, token)) return;
      }
      if (currentView(token)) { setDeleteOpen(false); onDeleted?.(target); onClose(); }
    });
  };

  const openEdit = () => {
    if (!o || actionRef.current || syncRef.current) return;
    if (!o.customerId || !items.length || items.some(item => !item.productId)) return setModalMsg(RECOVERY_HISTORY_MESSAGE);
    if (!customers.some(customer => customer.id === o.customerId) || items.some(item => !products.some(product => product.id === item.productId))) return setModalMsg("原客户或商品尚不可读取，请刷新详情和列表；不会按名称替换关联对象。");
    setEditCust(o.customerId);
    setEditPay(o.payMethod);
    setEditItems(items.map(item => ({ product_id: item.productId!, quantity: item.quantity })));
    setEditEmps(members.map(member => member.employeeId));
    setEditPaid(String(o.paid));
    setEditMsg(null);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!o) return;
    setEditMsg(null);
    if (!editItems.length || editItems.some(item => !item.product_id || !Number.isInteger(item.quantity) || item.quantity <= 0)) return setEditMsg("请保留有效商品和正整数数量。");
    if (!editCust) return setEditMsg("请选择客户。");
    const editPaidAmount = editPaid.trim() === "" ? null : Number(editPaid);
    if (editPaidAmount !== null && (!Number.isFinite(editPaidAmount) || editPaidAmount < 0)) return setEditMsg("实际收款须为有限的非负金额。");
    const target = o.id;
    const isBooking = o.status === "booking";
    await runAction(async token => {
      if (!session) { if (currentView(token)) { setEditOpen(false); setModalMsg("Mock 模式：本地演示，不写数据库。"); } return; }
      const args = { p_order_id: target, p_customer_id: editCust, p_items: editItems, p_employee_ids: editEmps, p_pay_method: editPay, p_paid_amount: editPaidAmount };
      const result = await (isBooking ? rpcEditOrder(args) : rpcCorrectOrder(args));
      if (!acceptResult(result, token, setEditMsg)) return;
      const targetId = isBooking ? target : result.data?.order_id;
      if (!targetId) throw new Error("更正已确认，但新订单 ID 未返回，请刷新列表核对。");
      onChanged?.();
      await loadDetail(targetId, token);
      if (currentView(token)) {
        setEditOpen(false);
        setEditMsg(null);
        setModalMsg(isBooking ? "订单修改已确认，服务器数据已刷新。" : "更正已确认，当前显示新订单；原单已取消。");
      }
    }, setEditMsg);
  };

  return (
    <>
    <Modal open={!!orderId} title={o ? `订单 ${o.orderNo}` : "订单详情"} onClose={() => { if (!actionRef.current) onClose(); }} xxl>
      {modalMsg && <p role="status" className="rounded-md border border-line bg-paper p-2 font-mono text-xs text-ink">{modalMsg}</p>}
      <Button size="sm" variant="secondary" disabled={actionBusy} onClick={() => void refreshModal()}>刷新详情</Button>
      {o ? (editOpen ? (
        <div className="space-y-4">
          {editMsg && <p className="rounded-md border border-line bg-paper p-2 font-mono text-xs text-danger">{editMsg}</p>}

          {/* 原单概览 */}
          <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "原实付", value: money(o.paid) },
              { label: "原折扣", value: money(o.discount) },
              { label: "原待结算", value: money(o.pending ?? 0) },
              { label: "商品 / 打手", value: `${o.items.length} 项 / ${o.members.length} 人` },
            ].map((x) => (
              <div key={x.label} className="bg-paper p-3">
                <p className="font-mono text-[10px] text-muted">{x.label}</p>
                <p className="mt-0.5 text-sm font-medium tabular-nums">{x.value}</p>
              </div>
            ))}
          </div>

          {o.status !== "booking" && (
            <p className="rounded-md border border-line bg-paper p-2 font-mono text-[11px] text-muted">
              保存将对原单执行退款冲正（客户钱包/员工提成回退，可能产生欠款），并以新内容重建一张更正单（新订单号）。
            </p>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {/* 左栏：客户 / 支付 / 实际收款 / 员工 */}
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="font-mono text-[11px] text-muted">客户（可搜索）</span>
                <CustomerSelect value={editCust} onChange={setEditCust} customers={customers} />
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
                <span className="font-mono text-[11px] text-muted">实际收款（留空 = 系统按商品/VIP 自动计算）</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">¥</span>
                  <Input
                    value={editPaid}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^\d+(\.\d{0,2})?$/.test(v)) setEditPaid(v);
                    }}
                    inputMode="decimal"
                    placeholder="留空=系统计算"
                    aria-label="实际收款金额"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <span className="font-mono text-[11px] text-muted">接单员工（0–2 人，可搜索）</span>
                <EmployeePicker value={editEmps} onChange={setEditEmps} employees={employees} />
              </div>
            </div>

            {/* 右栏：商品明细 */}
            <div className="space-y-2">
              <span className="font-mono text-[11px] text-muted">商品明细（{editItems.length} 项）</span>
              {editItems.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_5rem_auto] items-center gap-2">
                  <ProductSelect
                    value={it.product_id}
                    onChange={(pid) => setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, product_id: pid } : x)))}
                    products={products}
                  />
                  <div className="w-20">
                    <Input type="number" min={1} value={it.quantity}
                      onChange={(e) => setEditItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))}
                      aria-label="数量" />
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setEditItems((prev) => prev.filter((_, i) => i !== idx))}>×</Button>
                </div>
              ))}
              <Button size="sm" variant="secondary"
                onClick={() => setEditItems((prev) => [...prev, { product_id: products.find((p) => p.status === "on_sale")?.id ?? "", quantity: 1 }])}>
                ＋ 添加商品
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="secondary" disabled={actionBusy} onClick={() => { setEditOpen(false); setEditMsg(null); }}>取消</Button>
            <Button disabled={actionBusy || syncRequired} onClick={() => void saveEdit()}>保存修改</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ① 头部：状态 + 时间 + 下单人 + 生成小票 */}
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusTag status={o.status} />
            <AuditStatusTag status={o.auditStatus} />
            <span className="font-mono text-[11px] text-muted">{o.createdAt}</span>
            <span className="font-mono text-[11px] text-muted">下单人：{o.operator || "—"}</span>
            <div className="ml-auto">
              <Button size="sm" variant="secondary" onClick={() => setReceiptOpen(true)}>生成小票</Button>
            </div>
          </div>

          {/* ② 金额/订单概览（8 项） */}
          <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "客户", value: `${o.customerName}${o.customerType === "vip" ? ` · VIP${o.vipLevel}` : ""}` },
              { label: "支付方式", value: o.payMethod === "wallet" ? "钱包（质押）" : "现金（预收）" },
              { label: "原价", value: money(o.original) },
              { label: "实付", value: money(o.paid) },
              { label: "折扣", value: money(o.discount) },
              { label: "待结算", value: money(o.pending ?? 0) },
              { label: "佣金", value: money(o.commission) },
              { label: "毛利", value: money(o.grossProfit) },
            ].map((x) => (
              <div key={x.label} className="bg-surface p-3">
                <p className="font-mono text-[10px] text-muted">{x.label}</p>
                <p className="mt-0.5 text-sm font-medium tabular-nums">{x.value}</p>
              </div>
            ))}
          </div>

          {/* ③ 客户钱包（真实客户数据） */}
          {(() => {
            const c = customers.find((c) => c.name === o.customerName);
            return c ? (
              <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "本金余额", value: money(c.principal) },
                  { label: "赠送余额", value: money(c.bonus) },
                  { label: "待结算（预收）", value: money(c.pending) },
                  { label: "累计消费", value: money(c.total) },
                ].map((x) => (
                  <div key={x.label} className="bg-paper p-3">
                    <p className="font-mono text-[10px] text-muted">{x.label}</p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums">{x.value}</p>
                  </div>
                ))}
              </div>
            ) : null;
          })()}

          {/* ④ 主体两栏：商品明细 | 打手 */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="font-mono text-[11px] text-muted">商品明细{items.length > 0 ? ` · ${items.length} 项` : ""}</p>
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
            </div>
            <div className="space-y-2">
              <p className="font-mono text-[11px] text-muted">打手（接单员工）{members.length > 0 ? ` · ${members.length} 人` : ""}</p>
              {members.length > 0 ? (
                <DataTable<OrderMember>
                  rowKey={(r) => r.employeeId}
                  columns={[
                    { key: "name", label: "员工", render: (r) => (r.realName && r.realName !== r.name ? `${r.name}（${r.realName}）` : r.name) },
                    { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
                    { key: "base", label: "基数", align: "right", mono: true, render: (r) => money(r.base) },
                    { key: "rate", label: "比例", align: "right", mono: true, render: (r) => (r.rate * 100).toFixed(1) + "%" },
                    { key: "commission", label: "佣金", align: "right", mono: true, render: (r) => money(r.commission) },
                    { key: "override", label: "覆盖", align: "right", mono: true, render: (r) => (r.override != null ? money(r.override) : <span className="text-muted">—</span>) },
                  ]}
                  rows={members}
                />
              ) : (
                <p className="rounded-md border border-line bg-paper p-3 font-mono text-xs text-muted">未指派打手</p>
              )}
            </div>
          </div>

          {/* ⑤ 操作区（底部工具条） */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="mr-auto font-mono text-[11px] text-muted">订单操作</span>
            {(o.status === "booking" ? isBoss : (isBoss || isManager) && ["in_progress", "completed"].includes(o.status) && (o.auditStatus !== "approved" || isBoss)) && o.auditStatus !== "rejected" && (
              <Button size="sm" variant="secondary" disabled={actionBusy || syncRequired} onClick={openEdit}>
                {o.status === "booking" ? "编辑订单" : "更正订单"}
              </Button>
            )}
            {(isBoss || isManager) && o.status !== "cancelled" && o.auditStatus !== "rejected" && (o.auditStatus !== "approved" || isBoss) && (
              <Button size="sm" variant="secondary" disabled={actionBusy || syncRequired} onClick={() => { setPriceValue(String(o.paid)); setPriceReason(""); setPriceOpen(true); }}>修改价格</Button>
            )}
            {canEditCommission && <Button size="sm" variant="secondary" disabled={actionBusy || syncRequired} onClick={openCommissionEditor}>修改提成</Button>}
            {isBoss && o.status === "completed" && o.auditStatus === "approved" && <Button size="sm" variant="danger" disabled={actionBusy || syncRequired} onClick={rejectAudit}>驳回审核</Button>}
            {(isBoss || (isManager && o.operatorId === session?.user?.id)) && <Button size="sm" variant="danger" disabled={actionBusy || syncRequired} onClick={() => setDeleteOpen(true)}>删除订单</Button>}
          </div>

          {/* ⑥ 面板：提成 / 改价 / 删除（统一在底部展开，不打断内容流） */}
          {editCommissions && (
            <div className="space-y-2 border border-line bg-paper p-3">
              <p className="font-mono text-[11px] text-muted">修改提成（留空恢复自动计算；0 表示明确覆盖为零）</p>
              {members.map((m) => (
                <label key={m.employeeId} className="flex items-center gap-2">
                  <span className="w-20 font-mono text-[11px] text-muted">{m.name}</span>
                  <Input
                    type="number"
                    disabled={actionBusy}
                    value={drafts[m.employeeId] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [m.employeeId]: e.target.value })}
                  />
                </label>
              ))}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditCommissions(false)}>取消</Button>
                <Button size="sm" disabled={actionBusy || syncRequired} onClick={saveCommissions}>保存提成</Button>
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
                <Button size="sm" onClick={() => void adjustPrice()} disabled={actionBusy || syncRequired || pricing}>
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
                <Button size="sm" variant="danger" onClick={() => void confirmDelete()} disabled={actionBusy || syncRequired || deleting}>
                  {deleting ? "删除中…" : "确认删除"}
                </Button>
              </div>
            </div>
          )}


          {/* ⑦ 支付凭证 */}
          <div className="border border-line bg-paper p-3">
            <p className="mb-2 font-mono text-[11px] text-muted">支付凭证（{proofs.length} 张）</p>
            {proofs.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {proofs.map((pr) => (
                  <div key={pr.url} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pr.url}
                      alt="支付凭证"
                      title="双击预览"
                      onDoubleClick={() => setPreviewProof(pr.url)}
                      className="max-h-40 w-full cursor-zoom-in border border-line bg-surface object-contain"
                    />
                    {pr.path && session && (
                      <button
                        type="button"
                        disabled={actionBusy || syncRequired}
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
            {pendingProofPaths.length > 0 && <p className="break-all font-mono text-[10px] text-muted">待核对文件（已保留）：{pendingProofPaths.join("；")}</p>}
            {proofMsg && <p role="status" className="mt-2 font-mono text-[11px] text-danger">{proofMsg}</p>}
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={actionBusy || syncRequired || uploading}>
                {uploading ? "上传中…" : "上传支付凭证"}
              </Button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
              <span className="font-mono text-[10px] text-muted">支持多张 jpg/png；真实模式下保存至 payment-proofs</span>
            </div>
          </div>
        </div>
        ))
      : (
        <p className="py-8 text-center font-mono text-xs text-muted">{detailLoading ? "正在读取订单详情…" : "订单详情暂不可用，请查看提示并刷新。"}</p>
      )}
      <ReceiptEditor order={o} open={receiptOpen} onClose={() => setReceiptOpen(false)} />
    </Modal>
    <Modal open={!!previewProof} title="支付凭证预览" onClose={() => setPreviewProof(null)} wide>
      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewProof ?? ""} alt="支付凭证预览" className="mx-auto max-h-[80vh] max-w-full object-contain" />
        <p className="text-center font-mono text-[11px] text-muted">双击任意凭证可放大查看</p>
      </div>
    </Modal>
    </>
  );
}
