"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { CustomerSelect } from "@/components/business/CustomerSelect";
import { EmployeePicker } from "@/components/business/EmployeePicker";
import { CUSTOMERS, EMPLOYEES, PRODUCTS, type Customer, type Employee, type Product, type PayMethod } from "@/lib/mock-data";
import { apiCustomers, apiEmployees, apiProducts, rpcCreateOrderMulti } from "@/lib/supabase-api";
import { useRealData } from "@/lib/use-real-data";
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

  const { data: customers } = useRealData<Customer>(apiCustomers, CUSTOMERS);
  const { data: employees } = useRealData<Employee>(apiEmployees, EMPLOYEES);
  const { data: products } = useRealData<Product>(apiProducts, PRODUCTS);
  const { session } = useAuth();

  const customer = customers.find((c) => c.id === customerId) ?? customers[0];

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return [{ id: "all", label: "全部" }, ...[...set].map((c) => ({ id: c, label: c }))];
  }, []);

  const filteredProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          p.status === "on_sale" &&
          (category === "all" || p.category === category) &&
          (keyword === "" || p.name.includes(keyword) || p.category.includes(keyword)),
      ),
    [category, keyword],
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
  const vipRate = customer.type === "vip" ? (customer.vipLevel >= 3 ? 0.85 : 0.9) : 1;
  const discount = customer.type === "vip" ? original * (1 - vipRate) : 0;
  const paid = original - discount;
  const walletTotal = customer.principal + customer.bonus;

  const submit = async () => {
    setHint(null);
    if (!customer) return setHint("请选择客户");
    if (cart.length === 0) return setHint("请先添加商品");
    if (employeeIds.length === 1) return setHint("接单员工需选 0 或 2 名");
    if (payMethod === "wallet" && walletTotal < paid) return setHint("客户钱包余额不足（本金+赠送）");

    if (session) {
      // 真实会话：调用 create_order_multi RPC
      const { data, error } = await rpcCreateOrderMulti({
        p_customer_id: customer.id,
        p_items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        p_employee_ids: employeeIds,
        p_pay_method: payMethod,
        p_paid_amount: null,
      });
      if (error || data?.success === false) {
        return setHint("下单失败：" + (error?.message ?? data?.message ?? "未知错误"));
      }
      setReceipt({ no: data.order_no, paid: Number(data.paid_amount), discount: Number(data.discount ?? 0), at: new Date().toLocaleString("zh-CN") });
    } else {
      const no = "ORD" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
      setReceipt({ no, paid, discount, at: new Date().toLocaleString("zh-CN") });
    }
    setCart([]);
    setEmployeeIds([]);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="新建订单" meta="/cashier · 收银台 · Mock 下单交互" />

      {receipt && (
        <div className="border border-line bg-surface p-4">
          <p className="text-sm font-medium">下单成功（Mock）</p>
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
              {customer.type === "vip" && (
                <div className="flex justify-between">
                  <span className="text-muted">VIP{vipRate * 10}折（{customer.name}）</span>
                  <span className="text-danger">-{money(discount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-1 text-sm font-semibold">
                <span>实付</span><span>{money(paid)}</span>
              </div>
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
            提交订单 {cart.length > 0 ? `（${money(paid)}）` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}