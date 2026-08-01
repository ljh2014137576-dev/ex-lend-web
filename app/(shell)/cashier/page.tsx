import { PageHeader } from "@/components/ui/PageHeader";

export default function cashierPage() {
  return (
    <div>
      <PageHeader title="收银台" meta="/cashier · 待实现" />
      <p className="font-mono text-sm text-muted">客户 → 商品 → VIP 折扣 → 支付 → 员工 → 下单</p>
    </div>
  );
}