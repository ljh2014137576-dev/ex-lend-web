import { PageHeader } from "@/components/ui/PageHeader";

export default function customersPage() {
  return (
    <div>
      <PageHeader title="客户" meta="/customers · 待实现" />
      <p className="font-mono text-sm text-muted">客户列表 · 充值 · 钱包流水 · VIP 调整</p>
    </div>
  );
}