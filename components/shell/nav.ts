export type NavItem = { id: string; num: string; label: string; href: string };

export const NAV_ITEMS: NavItem[] = [
  { id: "home", num: "01", label: "工作台", href: "/" },
  { id: "cashier", num: "02", label: "收银台", href: "/cashier" },
  { id: "orders", num: "03", label: "订单", href: "/orders" },
  { id: "audit", num: "04", label: "审核台", href: "/audit" },
  { id: "finance", num: "05", label: "财务", href: "/finance" },
  { id: "customers", num: "06", label: "客户", href: "/customers" },
  { id: "employees", num: "07", label: "员工", href: "/employees" },
  { id: "products", num: "08", label: "商品", href: "/products" },
  { id: "settings", num: "09", label: "设置", href: "/settings" },
];