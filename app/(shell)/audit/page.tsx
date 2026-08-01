import { PageHeader } from "@/components/ui/PageHeader";

export default function auditPage() {
  return (
    <div>
      <PageHeader title="提成审核台" meta="/audit · 待实现" />
      <p className="font-mono text-sm text-muted">待审核队列 · 覆盖提成 · 通过/撤销审核（仅老板）</p>
    </div>
  );
}