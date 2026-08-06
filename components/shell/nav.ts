import type { Role } from "@/lib/auth";

export type NavItem = { id: string; num: string; label: string; href: string; roles?: Role[] };

export const NAV_ITEMS: NavItem[] = [
  { id: "home", num: "01", label: "工作台", href: "/" },
  { id: "cashier", num: "02", label: "新建订单", href: "/cashier" },
  { id: "orders", num: "03", label: "订单", href: "/orders" },
  { id: "audit", num: "04", label: "审核台", href: "/audit", roles: ["boss"] },
  { id: "finance", num: "05", label: "财务", href: "/finance", roles: ["boss"] },
  { id: "payroll", num: "06", label: "工资结算", href: "/payroll", roles: ["boss"] },
  { id: "payouts", num: "07", label: "结算记录", href: "/payouts", roles: ["boss"] },
  { id: "customers", num: "08", label: "客户", href: "/customers" },
  { id: "employees", num: "09", label: "员工", href: "/employees" },
  { id: "products", num: "10", label: "商品", href: "/products" },
  { id: "products-hidden", num: "10b", label: "已隐藏商品", href: "/products/hidden", roles: ["boss"] },
  { id: "categories", num: "11", label: "商品分类", href: "/categories" },
  { id: "rules", num: "12", label: "规则配置", href: "/rules", roles: ["boss"] },
  { id: "todos", num: "13", label: "待办", href: "/todos" },
  { id: "announcements", num: "14", label: "公告", href: "/announcements" },
  { id: "notes", num: "15", label: "笔记", href: "/notes" },
  { id: "notifications", num: "16", label: "通知", href: "/notifications" },
  { id: "settings", num: "17", label: "设置", href: "/settings" },
];
