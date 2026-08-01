import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { DASHBOARD_STATS, ORDERS, type Order } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function WorkbenchPage() {
  const recent = [...ORDERS].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const pendingAudit = ORDERS.filter((o) => o.auditStatus === "pending");

  const stats = [
    { label: "今日订单", value: DASHBOARD_STATS.todayOrders, note: "单" },
    { label: "今日收入", value: money(DASHBOARD_STATS.todayIncome), note: "已收+预收" },
    { label: "待审核提成", value: DASHBOARD_STATS.pendingAudit, note: "笔" },
    { label: "在职员工", value: DASHBOARD_STATS.activeEmployees, note: "人" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="工作台" meta="/ · Mock 数据测试版" />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="font-mono text-[10px] text-muted">{s.note}</p>
          </div>
        ))}
      </div>

      <Panel title="最近订单" meta="最近 5 笔">
        <DataTable<Order>
          rowKey={(r) => r.id}
          columns={[
            { key: "orderNo", label: "订单号", mono: true, render: (r) => <Link className="underline decoration-line underline-offset-2 hover:text-accent" href={`/orders/${r.id}`}>{r.orderNo}</Link> },
            { key: "customer", label: "客户", render: (r) => `${r.customerName}${r.customerType === "vip" ? ` · VIP${r.vipLevel}` : ""}` },
            { key: "paid", label: "实付", align: "right", mono: true, render: (r) => money(r.paid) },
            { key: "status", label: "状态", render: (r) => <OrderStatusTag status={r.status} /> },
            { key: "audit", label: "审核", render: (r) => <AuditStatusTag status={r.auditStatus} /> },
            { key: "createdAt", label: "时间", mono: true, render: (r) => r.createdAt },
          ]}
          rows={recent}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="待审核提成" meta="仅老板可操作">
          <ul className="divide-y divide-line">
            {pendingAudit.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="font-mono text-xs">{o.orderNo}</p>
                  <p className="font-mono text-[11px] text-muted">{o.customerName} · {money(o.commission)} 佣金</p>
                </div>
                <Link href="/audit">
                  <Button size="sm" variant="secondary">去审核</Button>
                </Link>
              </li>
            ))}
            {pendingAudit.length === 0 && <li className="py-4 font-mono text-xs text-muted">暂无待审核</li>}
          </ul>
        </Panel>

        <Panel title="快捷入口" meta="Mock 页面导航">
          <div className="grid grid-cols-2 gap-2">
            {[
              { href: "/cashier", label: "收银台 /cashier" },
              { href: "/orders", label: "订单 /orders" },
              { href: "/audit", label: "审核台 /audit" },
              { href: "/finance", label: "财务 /finance" },
              { href: "/customers", label: "客户 /customers" },
              { href: "/employees", label: "员工 /employees" },
              { href: "/products", label: "商品 /products" },
              { href: "/settings", label: "设置 /settings" },
            ].map((x) => (
              <Link key={x.href} href={x.href} className="border border-line bg-paper px-3 py-2 font-mono text-xs transition-colors hover:bg-surface2">
                {x.label}
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}