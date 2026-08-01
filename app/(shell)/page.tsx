import { PageHeader } from "@/components/ui/PageHeader";

const STATS = [
  { label: "今日订单", value: "—" },
  { label: "今日收入", value: "—" },
  { label: "待审核提成", value: "—" },
  { label: "在职员工", value: "—" },
];

export default function WorkbenchPage() {
  return (
    <div>
      <PageHeader title="工作台" meta="/ · 数据接入待实现" />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <p className="mt-8 font-mono text-xs text-muted">
        下一步：接入线上 Supabase 数据（订单/收入/待审核统计）
      </p>
    </div>
  );
}