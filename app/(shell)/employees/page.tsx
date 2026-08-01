import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/StatusDot";
import { EMPLOYEES } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function EmployeesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader title="员工" meta={`/employees · ${EMPLOYEES.length} 人（Mock）`} />
        <div className="flex gap-2">
          <Button size="sm" variant="secondary">批量导入</Button>
          <Button size="sm">新建员工</Button>
        </div>
      </div>

      <Panel title="员工列表">
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "姓名", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "grade", label: "等级", align: "right", mono: true, render: (r) => `Lv${r.grade}` },
            { key: "wallet", label: "钱包余额", align: "right", mono: true, render: (r) => money(r.wallet) },
            { key: "status", label: "状态", render: (r) => (r.status === "active" ? <StatusDot tone="active" label="在职" /> : <StatusDot tone="danger" label="离职" />) },
            { key: "isDebt", label: "欠款", render: (r) => (r.isDebt ? <StatusDot tone="danger" label="欠款" /> : <StatusDot tone="neutral" label="无" />) },
          ]}
          rows={EMPLOYEES}
        />
      </Panel>
    </div>
  );
}