"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { CustomerSelect } from "@/components/business/CustomerSelect";
import { EmployeePicker } from "@/components/business/EmployeePicker";
import { ReceiptEditor } from "@/components/business/ReceiptEditor";
import {
  CUSTOMERS,
  EMPLOYEES,
  ORDERS,
  PRODUCTS,
  TOP_PRODUCTS,
  VIP_DISCOUNT_RULES,
  type Customer,
  type Employee,
  type Product,
  type PayMethod,
  type Order,
  type VipDiscountRule,
} from "@/lib/mock-data";
import { apiCustomers, apiEmployees, apiOrders, apiOrderDetail, apiProducts, apiTopProducts, apiVipDiscountRules, rpcCreateOrderMulti } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useResource } from "@/lib/data-store";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_FIELDS = "id,name,phone,type,vip_level,principal_balance,bonus_balance,pending_balance,total_consumption,status";
const finiteAmount = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
function confirmedCustomer(value: unknown): Customer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !UUID.test(row.id) || typeof row.name !== "string") return null;
  const vipLevel = finiteAmount(row.vip_level), principal = finiteAmount(row.principal_balance), bonus = finiteAmount(row.bonus_balance);
  const pending = finiteAmount(row.pending_balance), total = finiteAmount(row.total_consumption);
  if (vipLevel === null || principal === null || bonus === null || pending === null || total === null) return null;
  if ((row.type !== "normal" && row.type !== "vip") || (row.status !== "active" && row.status !== "blocked")) return null;
  return { id: row.id, name: row.name, phone: typeof row.phone === "string" ? row.phone : "—", type: row.type,
    vipLevel, principal, bonus, pending, total, status: row.status };
}

interface CartLine {
  productId: string;
  quantity: number;
}

interface CartLineCalc {
  productId: string;
  quantity: number;
  product: Product | undefined;
  original: number;
  rate: number;
  paid: number;
}

// 与后端 create_order_multi 的匹配优先级一致：同 vipLevel 内
// ① category_id 精确匹配 → ② category 文本匹配 → ③ 空串兜底（categoryId 为 null 且 category 为空串）；无匹配返回 1
function resolveVipRate(
  rules: VipDiscountRule[],
  vipLevel: number,
  categoryId: string | null | undefined,
  category: string,
): number {
  if (vipLevel <= 0) return 1;
  const level = rules.filter((r) => r.vipLevel === vipLevel);
  if (level.length === 0) return 1;
  const byId = level.find((r) => r.categoryId != null && categoryId != null && r.categoryId === categoryId);
  if (byId) return byId.discount;
  const byCategory = level.find(
    (r) => (r.categoryId == null || r.categoryId === "") && r.category !== "" && r.category === category,
  );
  if (byCategory) return byCategory.discount;
  const fallback = level.find((r) => (r.categoryId == null || r.categoryId === "") && r.category === "");
  return fallback ? fallback.discount : 1;
}

export default function CashierPage() {
  const [category, setCategory] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [catalogMode, setCatalogMode] = useState<"popular" | "all">("popular"); // 商品目录默认「常用」
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<PayMethod>("cash"); // 默认现金；customer 就绪后按余额自动选择（余额>0→钱包，=0→现金）
  const [walletModal, setWalletModal] = useState(false);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ no: string; paid: number; discount: number; at: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [paidOverride, setPaidOverride] = useState("");
  // 最近一次下单成功的订单：驱动右侧小票摘要与 ReceiptEditor
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const submission = useRef(false);
  const needsVerification = useRef(false);

  const { data: customers, real, mutate: setCustomers, invalidate: invalidateCustomers } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { mutate: setOrders, invalidate: invalidateOrders } = useResource<Order>("orders", apiOrders, ORDERS);
  const { data: employees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: products, real: productsReal } = useResource<Product>("products", apiProducts, PRODUCTS);
  const { data: topProducts } = useResource<Product>("topProducts", apiTopProducts, TOP_PRODUCTS);
  const { data: vipDiscounts } = useResource<VipDiscountRule>("vipDiscounts", apiVipDiscountRules, VIP_DISCOUNT_RULES);
  const { session, mockRole } = useAuth();
  const canSubmit = !!session || (MOCK_LOGIN_ENABLED && !!mockRole);

  const customer = customers.find((c) => c.id === customerId) ?? customers[0] ?? null;

  // 购物车按 productId 存储，渲染/提交时从当前商品数据实时解析，避免 Mock 占位商品（非 UUID id）被提交到后端
  const resolveProduct = (id: string) => products.find((p) => p.id === id);
  const cartLines = cart.map((l) => ({ ...l, product: resolveProduct(l.productId) }));
  const missingProducts = cartLines.filter((l) => !l.product);

  // 支付方式智能选择：钱包有余额→优先钱包；钱包为0→默认现金（依赖客户变化）
  useEffect(() => {
    setPayMethod(customer && customer.principal + customer.bonus > 0 ? "wallet" : "cash");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  useEffect(() => {
    if (customers.length === 0) return;
    if (!customerId || !customers.some((c) => c.id === customerId)) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return [{ id: "all", label: "全部" }, ...[...set].map((c) => ({ id: c, label: c }))];
  }, [products]);

  const filteredProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          p.status === "on_sale" &&
          (category === "all" || p.category === category) &&
          (keyword === "" || p.name.includes(keyword) || p.category.includes(keyword)),
      ),
    [category, keyword, products],
  );

  // 「常用」模式：展示历史下单最多的商品（同样应用分类/搜索过滤）；未加载成功或为空时回退显示全部在售商品，避免目录空白
  const popularProducts = useMemo(
    () =>
      topProducts.filter(
        (p) =>
          p.status === "on_sale" &&
          (category === "all" || p.category === category) &&
          (keyword === "" || p.name.includes(keyword) || p.category.includes(keyword)),
      ),
    [topProducts, category, keyword],
  );
  const catalogProducts =
    catalogMode === "popular" ? (popularProducts.length > 0 ? popularProducts : filteredProducts) : filteredProducts;

  const add = (p: Product) => {
    setReceipt(null);
    setHint(null);
    setCart((prev) => {
      const found = prev.find((l) => l.productId === p.id);
      if (found) return prev.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { productId: p.id, quantity: 1 }];
    });
  };

  const setQty = (id: string, qty: number) => {
    if (qty <= 0) return setCart((prev) => prev.filter((l) => l.productId !== id));
    setCart((prev) => prev.map((l) => (l.productId === id ? { ...l, quantity: qty } : l)));
  };

  // VIP 折扣改为读 vip_discount_rule 表：每一行商品独立计算折扣率
  // linePaid = round(lineOriginal × lineRate, 2)；autoPaid = Σ linePaid；autoDiscount = original - autoPaid
  const lineCalcs: CartLineCalc[] = cartLines.map((l) => {
    const original = l.product ? l.product.price * l.quantity : 0;
    const rate =
      l.product && customer && customer.type === "vip"
        ? resolveVipRate(vipDiscounts, customer.vipLevel, l.product.categoryId, l.product.category)
        : 1;
    return { productId: l.productId, quantity: l.quantity, product: l.product, original, rate, paid: round2(original * rate) };
  });
  const original = lineCalcs.reduce((s, l) => s + l.original, 0);
  const autoPaid = lineCalcs.reduce((s, l) => s + l.paid, 0);
  const autoDiscount = original - autoPaid;

  // 折扣展示：多行商品折扣率不同时只显示“VIP 折扣”；无折扣则不显示
  const discountLines = lineCalcs.filter((l) => l.product && l.rate < 1);
  const distinctRates = [...new Set(discountLines.map((l) => l.rate))];
  const vipDiscountLabel =
    discountLines.length > 0 && distinctRates.length === 1
      ? `VIP${Math.round(distinctRates[0] * 100) / 10}折（${customer?.name}）`
      : `VIP 折扣（${customer?.name}）`;

  // 钱包余额：待创建的新客户尚未入账，视为 0
  const walletTotal = !newCustomerName && customer ? customer.principal + customer.bonus : 0;

  // 实际收款：留空 = 跟随系统应收（autoPaid）；可手动覆盖，范围 0 ~ 原价
  const paidText = paidOverride.trim();
  const effectivePaid = paidText === "" ? autoPaid : Number(paidText);
  const paidValid = Number.isFinite(effectivePaid) && Number.isFinite(original) && effectivePaid >= 0 && effectivePaid <= original;
  const paidDiff = effectivePaid - autoPaid; // >0 多收 / <0 额外优惠
  const orderDiscount = original - effectivePaid;
  const fmtPaid = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "");

  const doSubmit = async (pay: PayMethod) => {
    if (submission.current || needsVerification.current) return;
    setHint(null);
    setFail(null);
    if (!canSubmit) return setHint("登录状态已失效，请重新登录后下单");
    if (!customer && !newCustomerName) return setHint("请选择或新建客户");
    if (cart.length === 0) return setHint("请先添加商品");
    if (session && !productsReal) return setHint("商品数据未加载成功，请稍后刷新重试");
    if (missingProducts.length > 0) return setHint("部分商品未加载或已失效，请移除后重试");
    if (!paidValid) return setHint("实际收款需在 0 与订单原价之间");
    // 钱包余额不足：弹窗提醒，不静默切换
    if (pay === "wallet" && walletTotal < effectivePaid) {
      setWalletModal(true);
      return;
    }

    submission.current = true;
    setSubmitting(true);
    setReceipt(null);
    setLastOrder(null);
    setReceiptOpen(false);
    let requestedCustomer = false;
    let requestedOrder = false;
    let acknowledged = false;
    const requireVerification = (message: string) => {
      needsVerification.current = true;
      setVerificationMessage(message);
      setFail(message);
      invalidateOrders();
      invalidateCustomers();
    };
    try {
    // 新客户确认真实单行后才可用于下单。
    let finalCustomerId = customer ? customer.id : "";
    let orderCustomerName = customer ? customer.name : "";
    let orderCustomerType: Customer["type"] = customer ? customer.type : "normal";
    let orderVipLevel = customer ? customer.vipLevel : 0;

    if (newCustomerName) {
      let finalName = newCustomerName;
      // 同名老客户：追加创建时间后缀，避免重名
      if (customers.some((c) => c.name === finalName)) {
        finalName = finalName + " " + new Date().toLocaleString("zh-CN").replace(/[/: ]/g, "-");
      }
      let created: Customer;
      if (session) {
        requestedCustomer = true;
        const response = await supabase.from("customer")
          .insert([{ name: finalName, type: "normal", status: "active" }]).select(CUSTOMER_FIELDS).single();
        if (response.error) {
          if (/^[0-9A-Z]{5}$/.test(response.error.code ?? "")) setFail("创建客户被拒绝：" + response.error.message);
          else requireVerification("客户创建结果未确认，请先到客户列表核对，勿直接重复创建或下单。");
          return;
        }
        const confirmed = confirmedCustomer(response.data);
        if (!confirmed) {
          requireVerification("客户创建返回的信息不完整，请先到客户列表核对，勿直接重复创建或下单。");
          return;
        }
        created = confirmed;
      } else {
        created = { id: "mock-c-" + Date.now(), name: finalName, phone: "—", type: "normal", vipLevel: 0,
          principal: 0, bonus: 0, pending: 0, total: 0, status: "active" };
      }
      setCustomers((previous) => [...previous.filter((row) => row.id !== created.id), created]);
      setNewCustomerName(null);
      setCustomerId(created.id);
      finalCustomerId = created.id;
      orderCustomerName = created.name;
      orderCustomerType = created.type;
      orderVipLevel = created.vipLevel;
    }

    if (!finalCustomerId) return setHint("请选择或新建客户");
    if (session && (!UUID.test(finalCustomerId) || employeeIds.some((id) => !UUID.test(id)))) return setHint("客户或员工资料未完整加载，请刷新后重试");

    // 此预览只用于显式 Mock；真实订单不以本地临时 ID 入缓存。
    const optimisticId = "tmp-" + Date.now();
    const optimistic: Order = {
      id: optimisticId,
      orderNo: "ORD" + new Date().toISOString().replace(/\D/g, "").slice(0, 14),
      customerName: orderCustomerName,
      customerType: orderCustomerType,
      vipLevel: orderVipLevel,
      payMethod: pay,
      original,
      paid: effectivePaid,
      discount: orderDiscount,
      commission: 0,
      grossProfit: 0,
      pending: effectivePaid,
      status: "booking",
      auditStatus: "pending",
      operator: "—",
      createdAt: new Date().toLocaleString("zh-CN"),
      proofPath: null,
      proofPaths: [],
      items: lineCalcs.map((l) => ({
        productName: l.product!.name,
        category: l.product!.category,
        unitPrice: l.product!.price,
        quantity: l.quantity,
        original: l.original,
        discount: l.original - l.paid,
        paid: l.paid,
        commissionType: l.product!.commissionType,
      })),
      members: [],
    };
    let finalOrder: Order = optimistic;

    if (session) {
      // 真实会话：调用 create_order_multi RPC
      requestedOrder = true;
      const { data, error } = await rpcCreateOrderMulti({
        p_customer_id: finalCustomerId,
        p_items: cartLines.map((l) => ({ product_id: l.product!.id, quantity: l.quantity })),
        p_employee_ids: [...employeeIds],
        p_pay_method: pay,
        p_paid_amount: paidText === "" ? null : effectivePaid,
      });
      if (error || data?.success !== true) {
        const definiteRejection = !error?.uncertain && (data?.success === false
          || (error?.uncertain === false && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code ?? "")));
        if (!definiteRejection) requireVerification("下单结果未确认，订单可能已生成或已扣款，请先到订单列表核对，勿重复提交。");
        else setFail("下单被拒绝：" + (error?.message ?? data?.message ?? "请检查订单信息"));
        return;
      }
      const orderId = data.order_id;
      if (typeof orderId !== "string" || !UUID.test(orderId)) {
        requireVerification("收到下单成功响应，但订单标识未确认，请到订单列表核对，勿重复提交。");
        return;
      }
      acknowledged = true;
      const paid = finiteAmount(data.paid_amount), discount = finiteAmount(data.discount), serverOriginal = finiteAmount(data.original_amount);
      if (typeof data.order_no !== "string" || !data.order_no.trim() || paid === null || discount === null || serverOriginal === null) {
        requireVerification("订单已创建，但返回信息不完整，请到订单列表核对，勿再次提交。");
        return;
      }
      const [detail, refreshedCustomers] = await Promise.all([apiOrderDetail(orderId), apiCustomers()]);
      if (!detail || detail.order.id !== orderId || detail.order.orderNo !== data.order_no || detail.order.paid !== paid
          || detail.order.discount !== discount || detail.order.original !== serverOriginal || !refreshedCustomers) {
        requireVerification("订单已创建，但详情或余额刷新未完成，请到订单列表核对，勿再次提交。");
        return;
      }
      finalOrder = detail.order;
      setCustomers(() => refreshedCustomers);
    }
    setOrders((previous) => [finalOrder, ...previous.filter((order) => order.id !== finalOrder.id)]);
    setReceipt({ no: finalOrder.orderNo, paid: finalOrder.paid, discount: finalOrder.discount, at: finalOrder.createdAt });
    setLastOrder(finalOrder);
    setReceiptOpen(true);
    setCart([]);
    setEmployeeIds([]);
    setPaidOverride("");
    } catch (error) {
      if (acknowledged) requireVerification("订单已创建，但刷新结果未确认，请先到订单列表核对，勿再次提交。");
      else if (requestedOrder) requireVerification("下单请求的结果未确认，订单可能已生成或已扣款，请先核对，勿重复提交。");
      else if (requestedCustomer) requireVerification("客户创建结果未确认，请先到客户列表核对后再下单。");
      else setFail(error instanceof Error ? error.message : "提交未完成，请检查输入后重试");
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  };

  const submit = () => doSubmit(payMethod);

  return (
    <div className="space-y-6">
      <PageHeader title="新建订单" meta={`/cashier · 收银台 · ${real ? "真实下单交互" : "Mock 下单交互"}`} />
      {verificationMessage && <div role="alert" className="rounded-md border border-line bg-paper p-3 text-sm text-danger">
        <p>{verificationMessage}</p><a href="/orders" className="mt-2 inline-block underline">查看订单列表核对</a>
      </div>}

      {receipt && (
        <div className="border border-line bg-surface p-4">
          <p className="text-sm font-medium">下单成功{real ? "" : "（Mock）"}</p>
          <p className="mt-1 font-mono text-xs text-muted">
            订单号 {receipt.no} · 实付 {money(receipt.paid)} · 折扣 {money(receipt.discount)} · {receipt.at}
          </p>
        </div>
      )}

      <fieldset disabled={submitting || !!verificationMessage} className="m-0 grid min-w-0 gap-6 border-0 p-0 lg:grid-cols-5" aria-busy={submitting}>
        {/* 左侧（lg:col-span-3）：创建订单的全部信息 */}
        <div className="space-y-6 lg:col-span-3">
          <Panel title="商品目录" meta={`${catalogProducts.length} 项在售`}>
            <div className="mb-4 space-y-3">
              <div className="flex gap-1">
                {([["popular", "常用"], ["all", "全部"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCatalogMode(m)}
                    aria-pressed={catalogMode === m}
                    className={[
                      "flex-1 rounded-md px-3 py-2 text-xs transition-colors",
                      catalogMode === m ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Input placeholder="搜索商品名称 / 分类…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <FilterTabs tabs={categories} active={category} onChange={setCategory} />
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {catalogProducts.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2.5 text-left transition-colors hover:bg-surface2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{p.name}</span>
                      <span className="block font-mono text-[11px] text-muted">
                        {p.category} · {p.commissionType === "grade" ? "按等级提成" : "固定提成"}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-sm tabular-nums">{money(p.price)}</span>
                  </button>
                </li>
              ))}
              {catalogProducts.length === 0 && <li className="col-span-full px-3 py-6 text-center font-mono text-xs text-muted">无匹配商品</li>}
            </ul>
          </Panel>

          <Panel title="订单篮" meta={`${cart.reduce((s, l) => s + l.quantity, 0)} 件`}>
            {cart.length === 0 ? (
              <p className="py-6 text-center font-mono text-xs text-muted">点击左侧商品加入</p>
            ) : (
              <ul className="divide-y divide-line">
                {cartLines.map((l) => (
                  <li key={l.productId} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      {l.product ? (
                        <>
                          <p className="truncate text-sm">{l.product.name}</p>
                          <p className="font-mono text-[11px] text-muted">{money(l.product.price)} × {l.quantity}</p>
                        </>
                      ) : (
                        <p className="text-sm text-danger">商品未加载或已失效</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {l.product ? (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setQty(l.productId, l.quantity - 1)}>−</Button>
                          <span className="w-8 text-center font-mono text-xs tabular-nums">{l.quantity}</span>
                          <Button size="sm" variant="secondary" onClick={() => setQty(l.productId, l.quantity + 1)}>+</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="danger" onClick={() => setQty(l.productId, 0)}>移除</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-1 border-t border-line pt-3 font-mono text-xs">
              <div className="flex justify-between"><span className="text-muted">原价</span><span>{money(original)}</span></div>
              {autoDiscount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">{vipDiscountLabel}</span>
                  <span className="text-danger">-{money(autoDiscount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 border-t border-line pt-1 text-sm font-semibold">
                <span>实际收款</span>
                <div className="flex items-center gap-1">
                  {paidText !== "" && (
                    <button
                      type="button"
                      onClick={() => setPaidOverride("")}
                      className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted transition-colors hover:bg-surface2"
                      title="恢复为系统自动应收"
                    >
                      跟随自动
                    </button>
                  )}
                  <span className="font-mono text-xs text-muted">¥</span>
                  <input
                    value={paidText}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^\d+(\.\d{0,2})?$/.test(v)) setPaidOverride(v);
                    }}
                    inputMode="decimal"
                    placeholder={fmtPaid(autoPaid)}
                    aria-label="实际收款金额"
                    className="h-7 w-24 rounded-md border border-line bg-paper px-2 text-right font-mono text-xs tabular-nums outline-none focus:border-ink"
                  />
                </div>
              </div>
              {paidText !== "" && paidDiff !== 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">{paidDiff > 0 ? "多收" : "额外优惠"}</span>
                  <span className={paidDiff > 0 ? "text-success" : "text-danger"}>
                    {paidDiff > 0 ? "+" : "-"}{money(Math.abs(paidDiff))}
                  </span>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="客户与支付">
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="font-mono text-[11px] text-muted">客户（输入名称搜索，可顺带新建）</span>
                <CustomerSelect
                  value={customerId}
                  onChange={(id) => {
                    setCustomerId(id);
                    setNewCustomerName(null);
                  }}
                  customers={customers}
                  onCreate={(name) => setNewCustomerName(name)}
                  pendingNewName={newCustomerName}
                />
              </div>

              <div className="space-y-1">
                <span className="font-mono text-[11px] text-muted">支付方式</span>
                <div className="flex gap-1">
                  {(["wallet", "cash"] as PayMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMethod(m)}
                      aria-pressed={payMethod === m}
                      className={[
                        "flex-1 rounded-md px-3 py-2 text-xs transition-colors",
                        payMethod === m ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2",
                      ].join(" ")}
                    >
                      {m === "wallet" ? "钱包（质押）" : "现金（预收）"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="接单员工" meta="0–2 人 · 可搜索">
            <EmployeePicker value={employeeIds} onChange={setEmployeeIds} employees={employees} />
          </Panel>

          {hint && <p className="rounded-md border border-line bg-paper p-2 font-mono text-xs text-danger">{hint}</p>}

          <Button className="w-full" disabled={cart.length === 0 || submitting || !!verificationMessage || !canSubmit} onClick={submit}>
            {submitting ? "正在确认下单…" : verificationMessage ? "请先核对订单" : "提交订单"} {cart.length > 0 ? `（${money(effectivePaid)}）` : ""}
          </Button>
        </div>

        {/* 右侧（lg:col-span-2）：小票系统 */}
        <Panel title="小票系统" meta="下单后自动生成" className="lg:col-span-2">
          {lastOrder ? (
            <div className="space-y-4">
              <div className="rounded-md border border-line bg-paper p-3 font-mono text-xs">
                <div className="flex justify-between"><span className="text-muted">订单号</span><span>{lastOrder.orderNo}</span></div>
                <div className="flex justify-between"><span className="text-muted">客户</span><span>{lastOrder.customerName}</span></div>
                <div className="flex justify-between">
                  <span className="text-muted">支付方式</span>
                  <span>{lastOrder.payMethod === "wallet" ? "钱包（质押）" : "现金（预收）"}</span>
                </div>
                <div className="flex justify-between"><span className="text-muted">实付</span><span>{money(lastOrder.paid)}</span></div>
                {lastOrder.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">折扣</span>
                    <span className="text-danger">-{money(lastOrder.discount)}</span>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1 font-mono text-[11px] text-muted">商品清单</p>
                <ul className="divide-y divide-line rounded-md border border-line bg-paper font-mono text-xs">
                  {lastOrder.items.map((it, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="min-w-0 truncate">{it.productName} × {it.quantity}</span>
                      <span className="tabular-nums">{money(it.paid)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button className="w-full" onClick={() => setReceiptOpen(true)}>生成小票</Button>
            </div>
          ) : (
            <p className="py-10 text-center font-mono text-xs text-muted">下单成功后小票将在这里生成</p>
          )}
        </Panel>
      </fieldset>

      {/* 下单失败弹窗 */}
      <Modal open={!!fail} title={verificationMessage ? "请核对下单结果" : "下单未完成"} onClose={() => setFail(null)}>
        <div className="space-y-4">
          <p className="text-sm text-danger">{fail}</p>
          <p className="font-mono text-[11px] text-muted">{verificationMessage ? "当前页面已暂停提交。请先查看客户或订单记录，确认结果后再继续。" : "请根据错误提示检查订单信息后再提交。"}</p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setFail(null)}>关闭</Button>
          </div>
        </div>
      </Modal>

      {/* 钱包余额不足弹窗：可切换现金（预收）继续下单 */}
      <Modal open={walletModal} title="钱包余额不足" onClose={() => setWalletModal(false)}>
        <div className="space-y-4">
          <p className="text-sm">
            客户钱包余额（本金+赠送）为 {money(walletTotal)}，不足以支付 {money(effectivePaid)}。是否切换为现金（预收）？
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setWalletModal(false)}>取消</Button>
            <Button
              disabled={submitting || !!verificationMessage || !canSubmit}
              onClick={() => {
                setPayMethod("cash");
                setWalletModal(false);
                doSubmit("cash");
              }}
            >
              切换现金
            </Button>
          </div>
        </div>
      </Modal>

      {/* 小票编辑器：下单成功后自动弹出 */}
      <ReceiptEditor order={lastOrder} open={receiptOpen} onClose={() => setReceiptOpen(false)} />
    </div>
  );
}
