"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { CUSTOMERS, EMPLOYEES, PRODUCTS, type Product, type PayMethod } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

interface CartLine {
  product: Product;
  quantity: number;
}

export default function CashierPage() {
  const [category, setCategory] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState(CUSTOMERS[0].id);
  const [payMethod, setPayMethod] = useState<PayMethod>("wallet");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ no: string; paid: number; discount: number; at: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const customer = CUSTOMERS.find((c) => c.id === customerId)!;

  const categories = useMemo(() => {
    const set = new Set(PRODUCTS.map((p) => p.category));
    return [{ id: "all", label: "全部" }, ...[...set].map((c) => ({ id: c, label: c }))];
  }, []);

  const filteredProducts = useMemo(
    () =>
      PRODUCTS.filter(
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

  const toggleEmployee = (id: string) =>
    setEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : prev));

  const submit = () => {
    setHint(null);
    if (cart.length === 0) return setHint("请先添加商品");
    if (employeeIds.length === 1) return setHint("接单员工需选 0 或 2 名");
    if (payMethod === "wallet" && walletTotal < paid) return setHint("客户钱包余额不足（本金+赠送）");
    const no = "ORD" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    setReceipt({ no, paid, discount, at: new Date().toLocaleString("zh-CN") });
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

          <Panel title="下单信息">
            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="font-mono text-[11px] text-muted">客户（钱包：{money(customer.principal + customer.bonus)}）</span>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="h-[var(--control-h)] w-full rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
                >
                  {CUSTOMERS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.type === "vip" ? `（VIP${c.vipLevel}）` : ""}
                    </option>
                  ))}
                </select>
              </label>

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

              <div className="space-y-1">
                <span className="font-mono text-[11px] text-muted">接单员工（0–2 人）</span>
                <div className="grid grid-cols-2 gap-1">
                  {EMPLOYEES.filter((e) => e.status === "active").map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => toggleEmployee(e.id)}
                      aria-pressed={employeeIds.includes(e.id)}
                      className={[
                        "rounded-md px-2 py-1.5 text-xs transition-colors",
                        employeeIds.includes(e.id) ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2",
                      ].join(" ")}
                    >
                      {e.name} · Lv{e.grade}
                    </button>
                  ))}
                </div>
              </div>

              {hint && <p className="rounded-md border border-line bg-paper p-2 font-mono text-xs text-danger">{hint}</p>}

              <Button className="w-full" disabled={cart.length === 0} onClick={submit}>
                提交订单 {cart.length > 0 ? `（${money(paid)}）` : ""}
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}