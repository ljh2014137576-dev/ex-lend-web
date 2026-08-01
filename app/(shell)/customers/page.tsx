import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/StatusDot";
import { CUSTOMERS } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader title="客户" meta={`/customers · ${CUSTOMERS.length} 人（Mock）`} />
        <Button size="sm">新建客户</Button>
      </div>

      <Panel title="客户列表">
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "姓名", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "phone", label: "手机", mono: true },
            { key: "type", label: "类型", mono: true, render: (r) => (r.type === "vip" ? `VIP${r.vipLevel}` : "普通") },
            { key: "principal", label: "本金余额", align: "right", mono: true, render: (r) => money(r.principal) },
            { key: "bonus", label: "赠送余额", align: "right", mono: true, render: (r) => money(r.bonus) },
            { key: "pending", label: "待结", align: "right", mono: true, render: (r) => money(r.pending) },
            { key: "total", label: "累计消费", align: "right", mono: true, render: (r) => money(r.total) },
            { key: "status", label: "状态", render: (r) => (r.status === "active" ? <StatusDot tone="active" label="正常" /> : <StatusDot tone="danger" label="停用" />) },
          ]}
          rows={CUSTOMERS}
        />
      </Panel>
    </div>
  );
}