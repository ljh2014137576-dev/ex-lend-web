import { PageHeader } from "@/components/ui/PageHeader";

export default function productsPage() {
  return (
    <div>
      <PageHeader title="商品" meta="/products · 待实现" />
      <p className="font-mono text-sm text-muted">商品列表 · 新建 · 上下架 · 分类</p>
    </div>
  );
}