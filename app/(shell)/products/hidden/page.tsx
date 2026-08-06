"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { BossOnly } from "@/components/business/RequireRole";
import { apiDeletedProducts, rpcRestoreProduct } from "@/lib/supabase-api";
import { useResource, useDataStore } from "@/lib/data-store";
import { DataSourceBadge } from "@/lib/use-real-data";
import { useAuth } from "@/lib/auth";
import type { Product } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function HiddenProductsPage() {
  const { session } = useAuth();
  const dataStore = useDataStore();
  const { data: hidden, real, error, loading, mutate: setHidden } = useResource<Product>("deletedProducts", apiDeletedProducts, []);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  // 页面内弹窗提示：成功/失败共用，自动消失
  const showToast = (text: string, tone: "ok" | "error") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 2600);
  };

  const restore = async (item: Product) => {
    // 先乐观从列表移除，后台调 RPC；失败再加回列表并提示
    setHidden((p) => p.filter((x) => x.id !== item.id));
    if (session) {
      const { data, error } = await rpcRestoreProduct(item.id);
      if (error || (data as { success?: boolean })?.success === false) {
        // 失败：把该商品加回列表（放最前）并提示
        setHidden((p) => [item, ...p]);
        showToast("恢复失败：" + (error?.message ?? (data as { message?: string })?.message ?? "未知错误"), "error");
        return;
      }
      // 恢复成功：让商品列表下次重拉时包含它
      dataStore.invalidate("products");
      showToast(`已恢复商品 ${item.name}`, "ok");
    } else {
      // mock 模式（无真实会话）：乐观移除即视为成功
      showToast(`已恢复商品 ${item.name}`, "ok");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="已隐藏商品" meta={`/products/hidden · ${hidden.length} 项${real ? " · 真实数据" : "（Mock）"}`} />
        <DataSourceBadge real={real} error={error} />
      </div>

      <p className="font-mono text-[11px] text-muted">
        <a href="/products" className="underline underline-offset-2 hover:text-accent">← 返回商品列表</a>
      </p>

      <Panel title="已隐藏商品列表" meta="仅老板可见 · 恢复后重新出现在商品列表/收银台">
        <DataTable<Product>
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "商品", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "category", label: "分类", mono: true },
            { key: "price", label: "价格", align: "right", mono: true, render: (r) => money(r.price) },
            { key: "deletedAt", label: "隐藏时间", mono: true, render: (r) => (r.deletedAt ? new Date(r.deletedAt).toLocaleString("zh-CN") : "—") },
            { key: "actions", label: "操作", render: (r) => (
              <BossOnly>
                <Button size="sm" variant="secondary" onClick={() => restore(r)}>恢复</Button>
              </BossOnly>
            ) },
          ]}
          rows={hidden}
          empty={loading ? "加载中…" : error ? "加载失败：" + error : "没有已隐藏的商品"}
        />
      </Panel>

      {toast && (<div className="toast" role="status" style={toast.tone === "error" ? { background: "rgba(180,40,40,0.92)" } : undefined}>{toast.text}</div>)}
    </div>
  );
}
