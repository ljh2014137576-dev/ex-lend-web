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
import { CUSTOMERS, EMPLOYEES, ORDERS, PRODUCTS, type Customer, type Employee, type Product, type PayMethod, type Order } from "@/lib/mock-data";
import { apiCustomers, apiEmployees, apiOrders, apiProducts, rpcCreateOrderMulti } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

interface CartLine {
  product: Product;
  quantity: number;
}

export default function CashierPage() {
  const [category, setCategory] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("wallet");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ no: string; paid: number; discount: number; at: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [paidOverride, setPaidOverride] = useState("");

  const { data: customers, real } = useResource<Customer>("customers", apiCustomers, CUSTOMERS);
  const { mutate: setOrders } = useResource<Order>("orders", apiOrders, ORDERS);
  const { data: employees } = useResource<Employee>("employees", apiEmployees, EMPLOYEES);
  const { data: products } = useResource<Product>("products", apiProducts, PRODUCTS);
  const { session } = useAuth();

  const customer = customers.find((c) => c.id === customerId) ?? customers[0] ?? null;

  useEffect(() => {
    if (!customerId && customers.length > 0) setCustomerId(customers[0].id);
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

  const add = (p: Product) => {
    setReceipt(null);
    setHint(null);
    setCart((prev) => {
      const found = prev.find((l) => l.product.id === p.id);
      if (found) return prev.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { product: p, quantity: 1 }];
    });
  };

  const setQty = (id: string, qty: number) => {
    if (qty <= 0) return setCart((prev) => prev.filter((l) => l.product.id !== id));
    setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, quantity: qty } : l)));
  };

  const original = cart.reduce((s, l) => s + l.product.price * l.quantity, 0);
  const vipRate = customer ? (customer.type === "vip" ? (customer.vipLevel >= 3 ? 0.85 : 0.9) : 1) : 1;
  const autoDiscount = customer && customer.type === "vip" ? original * (1 - vipRate) : 0;
  const autoPaid = original - autoDiscount;
  const walletTotal = customer ? customer.principal + customer.bonus : 0;

  // 实际收款：留空 = 跟随系统应收（autoPaid）；可手动覆盖，范围 0 ~ 原价
  const paidText = paidOverride.trim();
  const effectivePaid = paidText === "" ? autoPaid : Number(paidText);
  const paidValid = !Number.isNaN(effectivePaid) && effectivePaid >= 0 && effectivePaid <= original;
  const paidDiff = effectivePaid - autoPaid; // >0 多收 / <0 额外优惠
  const orderDiscount = original - effectivePaid;
  const fmtPaid = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "");

  const submit = async () => {
    setHint(null);
    setFail(null);
    if (!customer) return setHint("请选择客户");
    if (cart.length === 0) return setHint("请先添加商品");
    if (employeeIds.length === 1) return setHint("接单员工需选 0 或 2 名");
    if (!paidValid) return setHint("实际收款需在 0 与订单原价之间");
    if (payMethod === "wallet" && walletTotal < effectivePaid) return setHint("客户钱包余额不足（本金+赠送）");

    // 先构造乐观订单入缓存，前端立即展示；同时后台提交；失败则回滚并弹窗
    const optimisticId = "tmp-" + Date.now();
    const optimistic: Order = {
      id: optimisticId,
      orderNo: "ORD" + new Date().toISOString().replace(/\D/g, "").slice(0, 14),
      customerName: customer.name,
      customerType: customer.type,
      vipLevel: customer.vipLevel,
      payMethod,
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
      items: cart.map((l) => ({
        productName: l.product.name,
        category: l.product.category,
        unitPrice: l.product.price,
        quantity: l.quantity,
        original: l.product.price * l.quantity,
        discount: 0,
        paid: l.product.price * l.quantity,
        commissionType: l.product.commissionType,
      })),
      members: [],
    };
    setOrders((prev) => [optimistic, ...prev]);
    setReceipt(null);

    if (session) {
      // 真实会话：调用 create_order_multi RPC
      const { data, error } = await rpcCreateOrderMulti({
        p_customer_id: customer.id,
        p_items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        p_employee_ids: employeeIds,
        p_pay_method: payMethod,
        p_paid_amount: paidText === "" ? null : effectivePaid,
      });
      if (error || data?.success === false) {
        // 失败：从缓存删除该条，并弹窗提醒
        setOrders((prev) => prev.filter((o) => o.id !== optimisticId));
        setFail("下单失败：" + (error?.message ?? data?.message ?? "未知错误"));
        return;
      }
      // 成功：用真实 order_id/order_no 替换乐观条目（后续后台刷新会同步完整数据）
      setOrders((prev) =>
        prev.map((o) =>
          o.id === optimisticId
            ? {
                ...o,
                id: data.order_id ?? o.id,
                orderNo: data.order_no ?? o.orderNo,
                paid: Number(data.paid_amount ?? o.paid),
                discount: Number(data.discount ?? o.discount),
              }
            : o,
        ),
      );
      setReceipt({ no: data.order_no, paid: Number(data.paid_amount), discount: Number(data.discount ?? 0), at: new Date().toLocaleString("zh-CN") });
    } else {
      setReceipt({ no: optimistic.orderNo, paid: effectivePaid, discount: orderDiscount, at: new Date().toLocaleString("zh-CN") });
    }
    setCart([]);
    setEmployeeIds([]);
    setPaidOverride("");
  };

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
        <Panel title="商品目录" meta={`${filteredProducts.length} 项在售`} className="lg:col-span-3">
          <div className="mb-4 space-y-3">
            <Input placeholder="搜索商品名称 / 分类…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            <FilterTabs tabs={categories} active={category} onChange={setCategory} />
          </div>
          <ul className="divide-y divide-line border border-line bg-surface">
            {filteredProducts.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => add(p)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface2"
                >
                  <span>
                    <span className="block text-sm">{p.name}</span>
                    <span className="block font-mono text-[11px] text-muted">
                      {p.category} · {p.commissionType === "grade" ? "按等级提成" : "固定提成"}
                    </span>
                  </span>
                  <span className="font-mono text-sm tabular-nums">{money(p.price)}</span>
                </button>
              </li>
            ))}
            {filteredProducts.length === 0 && <li className="px-3 py-6 font-mono text-xs text-muted">无匹配商品</li>}
          </ul>
        </Panel>

        <div className="space-y-6 lg:col-span-2">
          <Panel title="订单篮" meta={`${cart.reduce((s, l) => s + l.quantity, 0)} 件`}>
            {cart.length === 0 ? (
              <p className="py-6 text-center font-mono text-xs text-muted">点击左侧商品加入</p>
            ) : (
              <ul className="divide-y divide-line">
                {cart.map((l) => (
                  <li key={l.product.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{l.product.name}</p>
                      <p className="font-mono text-[11px] text-muted">{money(l.product.price)} × {l.quantity}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setQty(l.product.id, l.quantity - 1)}>−</Button>
                      <span className="w-8 text-center font-mono text-xs tabular-nums">{l.quantity}</span>
                      <Button size="sm" variant="secondary" onClick={() => setQty(l.product.id, l.quantity + 1)}>+</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-1 border-t border-line pt-3 font-mono text-xs">
              <div className="flex justify-between"><span className="text-muted">原价</span><span>{money(original)}</span></div>
              {customer?.type === "vip" && (
                <div className="flex justify-between">
                  <span className="text-muted">VIP{vipRate * 10}折（{customer?.name}）</span>
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
                <span className="font-mono text-[11px] text-muted">客户（可搜索）</span>
                <CustomerSelect value={customerId || customers[0]?.id || ""} onChange={setCustomerId} customers={customers} />
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
    </div>
  );
}