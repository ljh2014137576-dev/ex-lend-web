"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { StatusDot } from "@/components/ui/StatusDot";
import { PRODUCTS, type Product } from "@/lib/mock-data";
import { apiProducts } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { DataSourceBadge } from "@/lib/use-real-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function ProductsPage() {
  const { data: products, real, error, loading, mutate: setProducts } = useResource<Product>("products", apiProducts, PRODUCTS);
  const [category, setCategory] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "正常单", price: 100, commissionType: "fixed" });

  const cats = useMemo(() => {
    const set = new Set(PRODUCTS.map((p) => p.category));
    return [{ id: "all", label: "全部" }, ...[...set].map((c) => ({ id: c, label: c }))];
  }, []);

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (category === "all" || p.category === category) &&
          (keyword === "" || p.name.includes(keyword)),
      ),
    [products, category, keyword],
  );

  const create = () => {
    if (!form.name.trim()) return;
    setProducts((p) => [
      ...p,
      {
        id: "p" + Date.now(),
        name: form.name.trim(),
        category: form.category,
        price: Math.max(0, Number(form.price)),
        commissionType: form.commissionType as "fixed" | "grade",
        fixedRate: form.commissionType === "fixed" ? 0.08 : null,
        status: "on_sale",
      },
    ]);
    setOpen(false);
    setForm({ name: "", category: "正常单", price: 100, commissionType: "fixed" });
  };

  const toggleStatus = (id: string) =>
    setProducts((p) => p.map((x) => (x.id === id ? { ...x, status: x.status === "on_sale" ? "off_shelf" : "on_sale" } : x)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="商品" meta={`/products · ${products.length} 项（Mock）`} />
        <DataSourceBadge real={real} error={error} />
        <Button size="sm" onClick={() => setOpen(true)}>新建商品</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <Input placeholder="搜索商品…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
        <FilterTabs tabs={cats} active={category} onChange={setCategory} />
      </div>

      <p className="font-mono text-[11px] text-muted"><a href="/categories" className="underline underline-offset-2 hover:text-accent">→ 管理商品分类</a></p>

      <Panel title="商品列表" meta="行内可上下架">
        <DataTable<Product>
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "商品", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "category", label: "分类", mono: true },
            { key: "price", label: "价格", align: "right", mono: true, render: (r) => money(r.price) },
            { key: "commission", label: "提成", mono: true, render: (r) => (r.commissionType === "grade" ? "按等级" : `${(r.fixedRate ?? 0) * 100}%`) },
            { key: "status", label: "状态", render: (r) => (r.status === "on_sale" ? <StatusDot tone="active" label="在售" /> : <StatusDot tone="neutral" label="下架" />) },
            { key: "actions", label: "操作", render: (r) => (
              <Button size="sm" variant="secondary" onClick={() => toggleStatus(r.id)}>
                {r.status === "on_sale" ? "下架" : "上架"}
              </Button>
            ) },
          ]}
          rows={filtered}
          empty={loading ? "加载中…" : "暂无数据"}
        />
      </Panel>

      <Modal open={open} title="新建商品" onClose={() => setOpen(false)}>
        <div className="space-y-3">
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
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create}>创建</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}