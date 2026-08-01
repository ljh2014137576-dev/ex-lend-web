import { PageHeader } from "@/components/ui/PageHeader";

export default function ordersPage() {
  return (
    <div>
      <PageHeader title="订单" meta="/orders · 待实现" />
      <p className="font-mono text-sm text-muted">状态筛选 · 批量开始/审核 · 编号目录行</p>
    </div>
  );
}