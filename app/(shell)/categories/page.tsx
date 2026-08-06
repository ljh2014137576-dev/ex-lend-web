"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { CATEGORIES, PRODUCTS, type Product, type ProductCategory } from "@/lib/mock-data";
import { apiCategories, apiProducts } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { DataSourceBadge } from "@/lib/use-real-data";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export default function CategoriesPage() {
  const { session } = useAuth();
  const { data: categories, real, error, loading, mutate: setCategories } = useResource<ProductCategory>("categories", apiCategories, CATEGORIES);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const { data: products } = useResource<Product>("products", apiProducts, PRODUCTS);
  const productCount = useMemo(() => {
    const map: Record<string, number> = {};
    products.forEach((p) => (map[p.category] = (map[p.category] || 0) + 1));
    return map;
  }, [products]);

  const create = async () => {
    if (!form.name.trim()) return;
    const optimisticId = "tmp-" + Date.now();
    const optimistic: ProductCategory = {
      id: optimisticId,
      name: form.name.trim(),
      description: form.description.trim(),
      status: "enabled",
    };
    // 先入缓存展示，后台写库；失败回滚并提示
    setCategories((p) => [...p, optimistic]);
    setOpen(false);
    setForm({ name: "", description: "" });

    if (session) {
      const { data, error } = await supabase
        .from("product_category")
        .insert([
          {
            name: optimistic.name,
            description: optimistic.description,
            status: optimistic.status,
          },
        ])
        .select("id")
        .single();
      if (error || !data) {
        setCategories((prev) => prev.filter((x) => x.id !== optimisticId));
        window.alert("创建失败：" + (error?.message ?? "未知错误"));
        return;
      }
      setCategories((prev) => prev.map((x) => (x.id === optimisticId ? { ...x, id: data.id } : x)));
    }
  };

  const toggle = (id: string) =>
    setCategories((p) => p.map((c) => (c.id === id ? { ...c, status: c.status === "enabled" ? "disabled" : "enabled" } : c)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="商品分类" meta={`/categories · ${categories.length} 个${real ? " · 真实数据" : "（Mock）"}`} />
        <DataSourceBadge real={real} error={error} />
        <Button size="sm" onClick={() => setOpen(true)}>新建分类</Button>
      </div>

      <Panel title="分类列表" meta="商品分类独立管理 · 停用后不影响历史订单">
        <DataTable<ProductCategory>
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "分类名称", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "description", label: "描述", render: (r) => r.description || <span className="text-muted">—</span> },
            { key: "count", label: "商品数", align: "right", mono: true, render: (r) => productCount[r.name] || 0 },
            { key: "status", label: "状态", render: (r) => (r.status === "enabled" ? <StatusDot tone="active" label="启用" /> : <StatusDot tone="neutral" label="停用" />) },
            { key: "actions", label: "操作", render: (r) => (
              <Button size="sm" variant="secondary" onClick={() => toggle(r.id)}>
                {r.status === "enabled" ? "停用" : "启用"}
              </Button>
            ) },
          ]}
          rows={categories}
          empty={loading ? "加载中…" : "暂无数据"}
        />
      </Panel>

      <p className="font-mono text-[11px] text-muted">
        <a href="/products" className="underline underline-offset-2 hover:text-accent">→ 去商品页按分类管理商品</a>
      </p>

      <Modal open={open} title="新建分类" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">分类名称 *</span>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：手游大于300" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">描述</span>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="分类说明" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create}>创建</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}