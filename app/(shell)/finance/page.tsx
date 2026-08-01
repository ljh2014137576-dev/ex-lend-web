import { PageHeader } from "@/components/ui/PageHeader";

export default function financePage() {
  return (
    <div>
      <PageHeader title="财务" meta="/finance · 待实现" />
      <p className="font-mono text-sm text-muted">收入/提成/毛利汇总 · 双钱包流水 · 工资发放</p>
    </div>
  );
}