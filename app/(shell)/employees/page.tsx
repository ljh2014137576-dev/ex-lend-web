import { PageHeader } from "@/components/ui/PageHeader";

export default function employeesPage() {
  return (
    <div>
      <PageHeader title="员工" meta="/employees · 待实现" />
      <p className="font-mono text-sm text-muted">员工列表 · 新建 · 钱包流水</p>
    </div>
  );
}