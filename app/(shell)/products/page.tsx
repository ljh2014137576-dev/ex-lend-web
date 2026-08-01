import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/StatusDot";
import { PRODUCTS } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function ProductsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <PageHeader title="商品" meta={`/products · ${PRODUCTS.length} 项（Mock）`} />
        <Button size="sm">新建商品</Button>
      </div>

      <Panel title="商品列表">
        <DataTable
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "商品", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "category", label: "分类", mono: true },
            { key: "price", label: "价格", align: "right", mono: true, render: (r) => money(r.price) },
            { key: "commission", label: "提成", mono: true, render: (r) => (r.commissionType === "grade" ? "按等级" : `${(r.fixedRate ?? 0) * 100}%`) },
            { key: "status", label: "状态", render: (r) => (r.status === "on_sale" ? <StatusDot tone="active" label="在售" /> : <StatusDot tone="neutral" label="下架" />) },
          ]}
          rows={PRODUCTS}
        />
      </Panel>
    </div>
  );
}