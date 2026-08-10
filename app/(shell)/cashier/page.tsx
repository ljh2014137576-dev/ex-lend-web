"use client";

import { useEffect, useMemo, useState } from "react";
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
import { apiCustomers, apiEmployees, apiOrders, apiProducts, apiTopProducts, apiVipDiscountRules, rpcCreateOrderMulti } from "@/lib/supabase-api";
import { supabase } from "@/lib/supabase";
import { useResource } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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

  const { data: customers, real, mutate: setCustomers } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { mutate: setOrders } = useResource<Order>("orders", apiOrders, ORDERS);
  const { data: employees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: products, real: productsReal } = useResource<Product>("products", apiProducts, PRODUCTS);
  const { data: topProducts } = useResource<Product>("topProducts", apiTopProducts, TOP_PRODUCTS);
  const { data: vipDiscounts } = useResource<VipDiscountRule>("vipDiscounts", apiVipDiscountRules, VIP_DISCOUNT_RULES);
  const { session } = useAuth();

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
  const paidValid = !Number.isNaN(effectivePaid) && effectivePaid >= 0 && effectivePaid <= original;
  const paidDiff = effectivePaid - autoPaid; // >0 多收 / <0 额外优惠
  const orderDiscount = original - effectivePaid;
  const fmtPaid = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "");

  const doSubmit = async (pay: PayMethod) => {
    setHint(null);
    setFail(null);
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

    // 订单-客户一体化：新客户先创建再下单
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
      const { data: created, error: cErr } = await supabase
        .from("customer")
        .insert([{ name: finalName, type: "normal", status: "active" }])
        .select("id")
        .single();
      if (cErr || !created) {
        setFail("创建客户失败：" + (cErr?.message ?? "未知错误"));
        return;
      }
      // 构造乐观客户入缓存，前端立即展示
      setCustomers((prev) => [
        ...prev,
        { id: created.id, name: finalName, phone: "", type: "normal", vipLevel: 0, principal: 0, bonus: 0, pending: 0, total: 0, status: "active" },
      ]);
      setNewCustomerName(null);
      setCustomerId(created.id);
      finalCustomerId = created.id;
      orderCustomerName = finalName;
      orderCustomerType = "normal";
      orderVipLevel = 0;
    }

    if (!finalCustomerId) return setHint("请选择或新建客户");

    // 先构造乐观订单入缓存，前端立即展示；同时后台提交；失败则回滚并弹窗
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
    setOrders((prev) => [optimistic, ...prev]);
    setReceipt(null);

    let finalOrder: Order = optimistic;

    if (session) {
      // 真实会话：调用 create_order_multi RPC
      const { data, error } = await rpcCreateOrderMulti({
        p_customer_id: finalCustomerId,
        p_items: cartLines.map((l) => ({ product_id: l.product!.id, quantity: l.quantity })),
        p_employee_ids: employeeIds,
        p_pay_method: pay,
        p_paid_amount: paidText === "" ? null : effectivePaid,
      });
      if (error || data?.success === false) {
        // 失败：从缓存删除该条，并弹窗提醒
        setOrders((prev) => prev.filter((o) => o.id !== optimisticId));
        setFail("下单失败：" + (error?.message ?? data?.message ?? "未知错误"));
        return;
      }
      // 成功：用真实 order_id/order_no 替换乐观条目（后续后台刷新会同步完整数据）
      finalOrder = {
        ...optimistic,
        id: data.order_id ?? optimistic.id,
        orderNo: data.order_no ?? optimistic.orderNo,
        paid: Number(data.paid_amount ?? optimistic.paid),
        discount: Number(data.discount ?? optimistic.discount),
      };
      setOrders((prev) => prev.map((o) => (o.id === optimisticId ? finalOrder : o)));
      setReceipt({ no: data.order_no, paid: Number(data.paid_amount), discount: Number(data.discount ?? 0), at: new Date().toLocaleString("zh-CN") });
    } else {
      setReceipt({ no: optimistic.orderNo, paid: effectivePaid, discount: orderDiscount, at: new Date().toLocaleString("zh-CN") });
    }
    setLastOrder(finalOrder);
    setReceiptOpen(true);
    setCart([]);
    setEmployeeIds([]);
    setPaidOverride("");
  };

  const submit = () => doSubmit(payMethod);

  return (
    <div className="space-y-6">
      <PageHeader title="新建订单" meta={`/cashier · 收银台 · ${real ? "真实下单交互" : "Mock 下单交互"}`} />

      {receipt && (
        <div className="border border-line bg-surface p-4">
          <p className="text-sm font-medium">下单成功{real ? "" : "（Mock）"}</p>
          <p className="mt-1 font-mono text-xs text-muted">
            订单号 {receipt.no} · 实付 {money(receipt.paid)} · 折扣 {money(receipt.discount)} · {receipt.at}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
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

          <Button className="w-full" disabled={cart.length === 0} onClick={submit}>
            提交订单 {cart.length > 0 ? `（${money(effectivePaid)}）` : ""}
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
      </div>

      {/* 下单失败弹窗 */}
      <Modal open={!!fail} title="下单失败" onClose={() => setFail(null)}>
        <div className="space-y-4">
          <p className="text-sm text-danger">{fail}</p>
          <p className="font-mono text-[11px] text-muted">该订单已从列表中移除，请重试。</p>
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
