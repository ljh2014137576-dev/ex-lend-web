"use client";

import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { StatusDot } from "@/components/ui/StatusDot";
import { PRODUCTS, type Product } from "@/lib/mock-data";
import { apiProducts, rpcHideProduct } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { DataSourceBadge } from "@/lib/use-real-data";
import { supabase } from "@/lib/supabase";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";
import { BossOnly } from "@/components/business/RequireRole";

import { commissionRateFromPercent, commissionPercentText, DEFAULT_COMMISSION_PERCENT } from "@/lib/commission-policy";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

// 状态筛选：全部 / 在售 / 下架
const STATUS_TABS = [
  { id: "all", label: "全部" },
  { id: "on_sale", label: "在售" },
  { id: "off_shelf", label: "下架" },
];

export default function ProductsPage() {
  const { session, mockRole } = useAuth();
  const { data: products, real, error, loading, mutate: setProducts } = useResource<Product>("products", apiProducts, PRODUCTS);
  const [category, setCategory] = useState("all");
  const [statusTab, setStatusTab] = useState<"all" | "on_sale" | "off_shelf">("all");
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "正常单", price: 100, commissionType: "fixed", fixedPercent: DEFAULT_COMMISSION_PERCENT });
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [hideTarget, setHideTarget] = useState<Product | null>(null);
  const [hiding, setHiding] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const cats = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return [{ id: "all", label: "全部" }, ...[...set].map((c) => ({ id: c, label: c }))];
  }, [products]);

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (category === "all" || p.category === category) &&
          (statusTab === "all" || p.status === statusTab) &&
          (keyword === "" || p.name.includes(keyword)),
      ),
    [products, category, statusTab, keyword],
  );

  // 页面内弹窗提示：成功/失败共用，自动消失
  const showToast = (text: string, tone: "ok" | "error") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 2600);
  };

  const create = async () => {
    if (creatingRef.current) return;
    setCreateError(null);
    if (!session && !(MOCK_LOGIN_ENABLED && mockRole)) return setCreateError("请重新登录后创建商品");
    if (!form.name.trim()) return setCreateError("请填写商品名称");
    let fixedRate: number | null = null;
    try {
      if (form.commissionType === "fixed") fixedRate = commissionRateFromPercent(form.fixedPercent);
      else if (form.commissionType !== "grade") throw new Error("请选择有效的提成方式");
    } catch (error) { return setCreateError(error instanceof Error ? error.message : "提成比例无效"); }
    if (!Number.isFinite(form.price) || form.price < 0) return setCreateError("价格必须是大于等于 0 的有效数字");
    const product: Product = { id: "mock-p-" + Date.now(), name: form.name.trim(), category: form.category,
      price: form.price, commissionType: form.commissionType as "fixed" | "grade", fixedRate, status: "on_sale" };
    creatingRef.current = true; setCreating(true);
    try {
      if (session) {
        const { data, error } = await supabase.from("product").insert([{ name: product.name, category: product.category,
          price: product.price, commission_type: product.commissionType, fixed_rate: product.fixedRate, status: product.status }]).select("id").single();
        if (error || !data?.id) throw new Error(error?.message ?? "未收到创建结果，请先刷新核对商品列表");
        product.id = data.id;
      }
      setProducts(previous => [product, ...previous.filter(row => row.id !== product.id)]);
      setOpen(false);
      setForm({ name: "", category: "正常单", price: 100, commissionType: "fixed", fixedPercent: DEFAULT_COMMISSION_PERCENT });
      showToast(`已成功创建商品 ${product.name}`, "ok");
    } catch (error) { setCreateError("创建商品未完成：" + (error instanceof Error ? error.message : "请刷新核对后重试")); }
    finally { creatingRef.current = false; setCreating(false); }
  };

  const toggleStatus = async (id: string) => {
    const item = products.find((x) => x.id === id);
    if (!item) return;
    const newStatus = item.status === "on_sale" ? "off_shelf" : "on_sale";
    // 先乐观更新本地，后台写库；失败回滚并提示
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, status: newStatus } : x)));
    if (session) {
      const { error } = await supabase.from("product").update({ status: newStatus }).eq("id", id);
      if (error) {
        // 失败：回滚本地并提示
        setProducts((p) => p.map((x) => (x.id === id ? { ...x, status: item.status } : x)));
        showToast("设置失败：" + (error?.message ?? "未知错误"), "error");
        return;
      }
      // 防并发请求覆盖：幂等，保证即使被在途刷新覆盖也保持新状态
      setProducts((p) => p.map((x) => (x.id === id ? { ...x, status: newStatus } : x)));
      showToast(`已${newStatus === "on_sale" ? "上架" : "下架"} ${item.name}`, "ok");
    } else {
      // mock 模式（无真实会话）：乐观更新即视为成功
      showToast(`已${newStatus === "on_sale" ? "上架" : "下架"} ${item.name}`, "ok");
    }
  };

  const confirmHide = async () => {
    const target = hideTarget;
    if (!target) return;
    setHiding(true);
    // 先乐观从列表移除，后台调 RPC；失败再加回列表并提示
    setProducts((p) => p.filter((x) => x.id !== target.id));
    if (session) {
      const { data, error } = await rpcHideProduct(target.id);
      if (error || (data as { success?: boolean })?.success === false) {
        // 失败：把该商品加回列表（放最前）并提示
        setProducts((p) => [target, ...p]);
        showToast("隐藏失败：" + (error?.message ?? (data as { message?: string })?.message ?? "未知错误"), "error");
      } else {
        showToast(`已隐藏商品 ${target.name}`, "ok");
      }
    } else {
      // mock 模式（无真实会话）：乐观移除即视为成功
      showToast(`已隐藏商品 ${target.name}`, "ok");
    }
    setHideTarget(null);
    setHiding(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="商品" meta={`/products · ${products.length} 项${real ? " · 真实数据" : "（Mock）"}`} />
        <DataSourceBadge real={real} error={error} />
        <Button size="sm" onClick={() => setOpen(true)}>新建商品</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <Input placeholder="搜索商品…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
        <FilterTabs tabs={cats} active={category} onChange={setCategory} />
        <FilterTabs tabs={STATUS_TABS} active={statusTab} onChange={(id) => setStatusTab(id as "all" | "on_sale" | "off_shelf")} />
      </div>

      <p className="font-mono text-[11px] text-muted"><a href="/categories" className="underline underline-offset-2 hover:text-accent">→ 管理商品分类</a><span className="mx-2">·</span><BossOnly><a href="/products/hidden" className="underline underline-offset-2 hover:text-accent">→ 已隐藏商品</a></BossOnly></p>

      <Panel title="商品列表" meta="行内可上下架">
        <DataTable<Product>
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "商品", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "category", label: "分类", mono: true },
            { key: "price", label: "价格", align: "right", mono: true, render: (r) => money(r.price) },
            { key: "commission", label: "提成", mono: true, render: (r) => (r.commissionType === "grade" ? "按等级" : (commissionPercentText(r.fixedRate) ? `${commissionPercentText(r.fixedRate)}%` : "比例未知")) },
            { key: "status", label: "状态", render: (r) => (r.status === "on_sale" ? <StatusDot tone="active" label="在售" /> : <StatusDot tone="neutral" label="下架" />) },
            { key: "actions", label: "操作", render: (r) => (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => toggleStatus(r.id)}>
                  {r.status === "on_sale" ? "下架" : "上架"}
                </Button>
                <BossOnly>
                  <Button size="sm" variant="danger" onClick={() => setHideTarget(r)}>隐藏</Button>
                </BossOnly>
              </div>
            ) },
          ]}
          rows={filtered}
          empty={loading ? "加载中…" : "暂无数据"}
        />
      </Panel>

      <Modal open={open} title="新建商品" onClose={() => { if (!creatingRef.current) setOpen(false); }}>
        <fieldset disabled={creating} className="m-0 space-y-3 border-0 p-0">
          {createError && <p role="alert" className="text-sm text-danger">{createError}</p>}
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">名称 *</span>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="商品名称" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">分类</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="h-[var(--control-h)] w-full rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
            >
              {cats.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="font-mono text-[11px] text-muted">价格</span>
              <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
            </label>
            <label className="block space-y-1">
              <span className="font-mono text-[11px] text-muted">提成方式</span>
              <select
                value={form.commissionType}
                onChange={(e) => setForm({ ...form, commissionType: e.target.value })}
                className="h-[var(--control-h)] w-full rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
              >
                <option value="fixed">固定比例</option>
                <option value="grade">按等级</option>
              </select>
            </label>
          </div>
          {form.commissionType === "fixed" && <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">固定提成比例（80%–100%，填写百分数）</span>
            <Input type="number" min="80" max="100" step="0.01" value={form.fixedPercent} onChange={event => setForm({ ...form, fixedPercent: event.target.value })} placeholder="80 表示 80%" />
          </label>}
          <p className="text-xs text-muted">新订单提成比例不得低于 80%；按等级商品使用所选员工的等级规则。</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" disabled={creating} onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={creating} onClick={create}>{creating ? "创建中…" : "创建"}</Button>
          </div>
        </fieldset>
      </Modal>

      <Modal open={!!hideTarget} title={hideTarget ? `隐藏商品 — ${hideTarget.name}` : ""} onClose={() => setHideTarget(null)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">隐藏后不再出现在商品列表/收银台/订单商品选择中，数据保留，可在「已隐藏商品」中恢复。</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setHideTarget(null)}>取消</Button>
            <Button variant="danger" disabled={hiding} onClick={confirmHide}>{hiding ? "隐藏中…" : "确认隐藏"}</Button>
          </div>
        </div>
      </Modal>

      {toast && (<div className="toast" role="status" style={toast.tone === "error" ? { background: "rgba(180,40,40,0.92)" } : undefined}>{toast.text}</div>)}
    </div>
  );
}