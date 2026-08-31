"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { Input } from "@/components/ui/Input";
import { DataSourceBadge } from "@/lib/use-real-data";
import { dateKey } from "@/lib/date";
import { useResource } from "@/lib/data-store";
import { apiOrders, apiEmployees } from "@/lib/supabase-api";
import { ORDERS, EMPLOYEES, type Order } from "@/lib/mock-data";
import { OrderStatusTag, AuditStatusTag } from "@/components/business/OrderStatusTag";
import { useAuth } from "@/lib/auth";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export default function WorkbenchPage() {
  const { isBoss, session, name } = useAuth();
  const { data: orders, real, loading } = useResource<Order>("orders", apiOrders, ORDERS);
  const { data: employees } = useResource("employees", apiEmployees, EMPLOYEES);

  const [mineDateFrom, setMineDateFrom] = useState("");
  const [mineDateTo, setMineDateTo] = useState("");
  const [mineStatus, setMineStatus] = useState("all");

  const today = dateKey(new Date());
  const todayOrders = orders.filter((o) => dateKey(o.createdAt) === today);
  const todayIncome = todayOrders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.paid, 0);
  const pendingAudit = orders.filter((o) => o.auditStatus === "pending");
  const pendingCommission = pendingAudit.reduce((s, o) => s + o.commission, 0);
  const activeEmployees = employees.filter((e) => e.status === "active").length;
  const inProgressCount = orders.filter((o) => o.status === "in_progress").length;

  const recent = [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const myCreatedOrders = useMemo(() => {
    return orders
      .filter((o) => (session ? o.operatorId === session.user.id : name !== "" && o.operator === name))
      .filter((o) => {
        const day = dateKey(o.createdAt);
        if (mineDateFrom && day < mineDateFrom) return false;
        if (mineDateTo && day > mineDateTo) return false;
        if (mineStatus !== "all" && o.status !== mineStatus) return false;
        return true;
      })
      .sort((a, b) => (b.createdAtRaw || b.createdAt).localeCompare(a.createdAtRaw || a.createdAt));
  }, [orders, session, name, mineDateFrom, mineDateTo, mineStatus]);

  // 按身份展示：老板看全局（含待审核提成），管理员看日常（不含老板视角指标）
  const stats = isBoss
    ? [
        { label: "今日订单", value: todayOrders.length, note: "单" },
        { label: "今日收入", value: money(todayIncome), note: "实付合计 · 不含已取消" },
        { label: "待审核提成", value: money(pendingCommission), note: `${pendingAudit.length} 笔` },
        { label: "在职员工", value: activeEmployees, note: "人" },
      ]
    : [
        { label: "今日订单", value: todayOrders.length, note: "单" },
        { label: "今日收入", value: money(todayIncome), note: "实付合计 · 不含已取消" },
        { label: "进行中订单", value: inProgressCount, note: "单" },
        { label: "在职员工", value: activeEmployees, note: "人" },
      ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="工作台" meta={`/ · ${real ? "真实数据" : "Mock 数据"}${loading ? " · 加载中" : ""}`} />
        <DataSourceBadge real={real} />
      </div>

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <p className="font-mono text-[11px] text-muted">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="font-mono text-[10px] text-muted">{s.note}</p>
          </div>
        ))}
      </div>

      <Panel title="最近订单" meta={`最近 ${recent.length} 笔`}>
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
          empty={loading ? "加载中…" : "暂无订单"}
        />
      </Panel>

      <Panel title="我创建的订单" meta={`${myCreatedOrders.length} 笔`}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input type="date" value={mineDateFrom} onChange={(e) => setMineDateFrom(e.target.value)} className="w-36" aria-label="我创建的订单开始日期" />
          <span className="font-mono text-[10px] text-muted">至</span>
          <Input type="date" value={mineDateTo} onChange={(e) => setMineDateTo(e.target.value)} className="w-36" aria-label="我创建的订单结束日期" />
          <FilterTabs
            tabs={[
              { id: "all", label: "状态-全部" },
              { id: "booking", label: "待开始" },
              { id: "in_progress", label: "进行中" },
              { id: "completed", label: "已完成" },
              { id: "cancelled", label: "已取消" },
            ]}
            active={mineStatus}
            onChange={setMineStatus}
          />
        </div>
        <DataTable<Order>
          rowKey={(r) => r.id}
          columns={[
            { key: "orderNo", label: "订单号", mono: true, render: (r) => <Link className="underline decoration-line underline-offset-2 hover:text-accent" href={`/orders/${r.id}`}>{r.orderNo}</Link> },
            { key: "customer", label: "客户", render: (r) => `${r.customerName}${r.customerType === "vip" ? ` · VIP${r.vipLevel}` : ""}` },
            { key: "paid", label: "实付", align: "right", mono: true, render: (r) => money(r.paid) },
            { key: "status", label: "状态", render: (r) => <OrderStatusTag status={r.status} /> },
            { key: "createdAt", label: "时间", mono: true, render: (r) => r.createdAt },
          ]}
          rows={myCreatedOrders}
          empty={loading ? "加载中…" : "暂无符合条件的订单"}
        />
      </Panel>

      <div className={"grid gap-6 " + (isBoss ? "lg:grid-cols-2" : "")}>
        {isBoss && (
          <Panel title="待审核提成" meta={`${pendingAudit.length} 笔 · 仅老板可操作`}>
            <ul className="divide-y divide-line">
              {pendingAudit.slice(0, 6).map((o) => (
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
        )}

        <Panel title="快捷入口" meta="页面导航 · 按身份显示">
          <div className="grid grid-cols-2 gap-2">
            {[
              { href: "/cashier", label: "新建订单 /cashier" },
              { href: "/orders", label: "订单 /orders" },
              ...(isBoss
                ? [
                    { href: "/audit", label: "审核台 /audit" },
                    { href: "/finance", label: "财务 /finance" },
                    { href: "/payroll", label: "工资结算 /payroll" },
                    { href: "/payouts", label: "结算记录 /payouts" },
                    { href: "/rules", label: "规则配置 /rules" },
                  ]
                : []),
              { href: "/customers", label: "客户 /customers" },
              { href: "/employees", label: "员工 /employees" },
              { href: "/products", label: "商品 /products" },
              { href: "/categories", label: "商品分类 /categories" },
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