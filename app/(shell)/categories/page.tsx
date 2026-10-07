"use client";

import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { CATEGORIES, PRODUCTS, type Product, type ProductCategory } from "@/lib/mock-data";
import { apiCategories, apiProducts, apiCreateCategory, apiUpdateCategoryStatus } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { DataSourceBadge } from "@/lib/use-real-data";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";

export default function CategoriesPage() {
  const { session, mockRole } = useAuth();
  const canWrite = !!session || (MOCK_LOGIN_ENABLED && !!mockRole);
  const { data: categories, real, error, loading, mutate: setCategories } = useResource<ProductCategory>("categories", apiCategories, CATEGORIES);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const createRequest = useRef(false);
  const statusRequests = useRef(new Set<string>());

  const { data: products } = useResource<Product>("products", apiProducts, PRODUCTS);
  const productCount = useMemo(() => {
    const map: Record<string, number> = {};
    products.forEach((p) => (map[p.category] = (map[p.category] || 0) + 1));
    return map;
  }, [products]);

  const create = async () => {
    if (!canWrite) return setActionError("登录状态已失效，请重新登录后操作");
    if (createRequest.current || !form.name.trim()) return;
    createRequest.current = true;
    setCreating(true);
    setActionError(null);
    try {
      const input = { name: form.name.trim(), description: form.description.trim() };
      const saved: ProductCategory = session ? await apiCreateCategory(input) : { ...input, id: "tmp-" + Date.now(), status: "enabled" };
      setCategories((previous) => [...previous.filter((category) => category.id !== saved.id), saved]);
      setOpen(false);
      setForm({ name: "", description: "" });
    } catch (error) {
      setActionError("创建失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      createRequest.current = false;
      setCreating(false);
    }
  };

  const toggle = async (id: string) => {
    if (!canWrite) return setActionError("登录状态已失效，请重新登录后操作");
    if (statusRequests.current.has(id)) return;
    const current = categories.find((category) => category.id === id);
    if (!current) return;
    if (session && !real) return setActionError("分类数据未加载，请刷新后重试");
    const status: ProductCategory["status"] = current.status === "enabled" ? "disabled" : "enabled";
    statusRequests.current.add(id);
    setSaving((previous) => ({ ...previous, [id]: true }));
    setActionError(null);
    try {
      const saved = session ? await apiUpdateCategoryStatus(id, status) : { ...current, status };
      setCategories((previous) => previous.map((category) => category.id === id ? saved : category));
    } catch (error) {
      setActionError("分类状态保存失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      statusRequests.current.delete(id);
      setSaving((previous) => ({ ...previous, [id]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="商品分类" meta={`/categories · ${categories.length} 个${real ? " · 真实数据" : "（Mock）"}`} />
        <DataSourceBadge real={real} error={error} />
        <Button size="sm" disabled={creating || !canWrite} onClick={() => { setActionError(null); setOpen(true); }}>新建分类</Button>
      </div>
      {!open && actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}

      <Panel title="分类列表" meta="商品分类独立管理 · 停用后不影响历史订单">
        <DataTable<ProductCategory>
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "分类名称", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "description", label: "描述", render: (r) => r.description || <span className="text-muted">—</span> },
            { key: "count", label: "商品数", align: "right", mono: true, render: (r) => productCount[r.name] || 0 },
            { key: "status", label: "状态", render: (r) => (r.status === "enabled" ? <StatusDot tone="active" label="启用" /> : <StatusDot tone="neutral" label="停用" />) },
            { key: "actions", label: "操作", render: (r) => (
              <Button size="sm" variant="secondary" disabled={saving[r.id] || !canWrite} onClick={() => toggle(r.id)}>
                {saving[r.id] ? "保存中…" : r.status === "enabled" ? "停用" : "启用"}
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

      <Modal open={open} title="新建分类" onClose={() => { if (!createRequest.current) setOpen(false); }}>
        <div className="space-y-3">
          {actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">分类名称 *</span>
            <Input value={form.name} disabled={creating} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：手游大于300" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">描述</span>
            <Input value={form.description} disabled={creating} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="分类说明" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" disabled={creating} onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={creating} onClick={create}>{creating ? "创建中…" : "创建"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
