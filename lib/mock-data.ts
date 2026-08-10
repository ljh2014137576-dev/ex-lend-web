// ============================================================
// Mock 数据（测试用，结构与线上 Supabase 表一致）
// 后续接真实数据时按同结构替换 lib/api
// ============================================================

export type OrderStatus = "booking" | "in_progress" | "completed" | "cancelled";
export type AuditStatus = "pending" | "approved" | "rejected";
export type PayMethod = "wallet" | "cash";
export type CommissionType = "fixed" | "grade";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  type: "normal" | "vip";
  vipLevel: number;
  principal: number;
  bonus: number;
  pending: number;
  total: number;
  status: "active" | "blocked";
}

export interface Employee {
  id: string;
  name: string;
  realName?: string;
  alipay?: string;
  bankCard?: string;
  grade: number;
  status: "active" | "resigned";
  wallet: number;
  isDebt: boolean;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  categoryId?: string | null;
  price: number;
  commissionType: CommissionType;
  fixedRate: number | null;
  status: "on_sale" | "off_shelf";
  deletedAt?: string | null; // 软删除时间（NULL 表示未隐藏，向后兼容：mock 数据无需填写）
}

export interface OrderMember {
  employeeId: string;
  name: string;
  realName?: string;
  grade: number;
  base: number;
  rate: number;
  commission: number;
  override?: number | null;
}

export interface OrderItem {
  productName: string;
  category: string;
  unitPrice: number;
  quantity: number;
  original: number;
  discount: number;
  paid: number;
  commissionType: CommissionType;
}

export interface Order {
  id: string;
  orderNo: string;
  customerName: string;
  customerType: "normal" | "vip";
  vipLevel: number;
  payMethod: PayMethod;
  original: number;
  paid: number;
  discount: number;
  commission: number;
  grossProfit: number;
  pending?: number;
  status: OrderStatus;
  auditStatus: AuditStatus;
  operator: string;
  // 创建人用户 id，用于判断是否本人可删
  operatorId?: string | null;
    // 原始 ISO 时间（created_at），用于排序（createdAt 是格式化字符串不可比较）
    createdAtRaw?: string;
  createdAt: string;
  proofPath?: string | null;
  proofPaths?: string[];
  items: OrderItem[];
  members: OrderMember[];
}

export const CUSTOMERS: Customer[] = [
  { id: "c1", name: "张三", phone: "138****1201", type: "vip", vipLevel: 3, principal: 3280.5, bonus: 560, pending: 1280, total: 48260, status: "active" },
  { id: "c2", name: "李四", phone: "139****3302", type: "vip", vipLevel: 1, principal: 1500, bonus: 120, pending: 0, total: 18600, status: "active" },
  { id: "c3", name: "王五", phone: "137****5503", type: "normal", vipLevel: 0, principal: 800, bonus: 0, pending: 350, total: 9200, status: "active" },
  { id: "c4", name: "赵六", phone: "136****7804", type: "normal", vipLevel: 0, principal: 200, bonus: 0, pending: 0, total: 3100, status: "blocked" },
  { id: "c5", name: "钱七", phone: "135****9905", type: "vip", vipLevel: 2, principal: 6100, bonus: 880, pending: 2400, total: 35100, status: "active" },
];

export const EMPLOYEES: Employee[] = [
  { id: "e1", name: "阿明", realName: "马明", alipay: "alipay-13800001201", bankCard: "6222 0202 0000 1201", grade: 2, status: "active", wallet: 4860, isDebt: false },
  { id: "e2", name: "小芳", realName: "林芳", alipay: "alipay-13900003302", bankCard: "6217 0000 0000 3302", grade: 1, status: "active", wallet: 1290, isDebt: false },
  { id: "e3", name: "大刘", realName: "刘强", alipay: "alipay-13700005503", bankCard: "6228 4800 0000 5503", grade: 3, status: "active", wallet: 8800, isDebt: false },
  { id: "e4", name: "小丽", realName: "陈丽", alipay: "alipay-13600007704", bankCard: "6215 0000 0000 7704", grade: 1, status: "active", wallet: 750, isDebt: false },
  { id: "e5", name: "老周", realName: "周国平", alipay: "alipay-13500009905", bankCard: "6217 0000 0000 9905", grade: 2, status: "active", wallet: 5320, isDebt: true },
  { id: "e6", name: "阿强", realName: "黄强", alipay: "alipay-13000001106", bankCard: "6228 0000 0000 1106", grade: 1, status: "resigned", wallet: -320, isDebt: true },
];

export const PRODUCTS: Product[] = [
  { id: "p1", name: "王者荣耀代练 100星", category: "手游大于300", categoryId: "g2", price: 480, commissionType: "grade", fixedRate: null, status: "on_sale" },
  { id: "p2", name: "原神代肝 45级", category: "手游小于300", categoryId: "g3", price: 260, commissionType: "fixed", fixedRate: 0.08, status: "on_sale" },
  { id: "p3", name: "王者荣耀代练 50星", category: "手游小于300", categoryId: "g3", price: 180, commissionType: "fixed", fixedRate: 0.08, status: "on_sale" },
  { id: "p4", name: "梦幻西游跑环", category: "正常单", categoryId: "g4", price: 120, commissionType: "fixed", fixedRate: 0.1, status: "on_sale" },
  { id: "p5", name: "英雄联盟排位 大师", category: "手游大于300", categoryId: "g2", price: 520, commissionType: "grade", fixedRate: null, status: "on_sale" },
  { id: "p6", name: "体验单-咨询", category: "体验单", categoryId: "g1", price: 30, commissionType: "fixed", fixedRate: 0.05, status: "on_sale" },
  { id: "p7", name: "穿越火线 枪王段位", category: "手游小于300", categoryId: "g3", price: 220, commissionType: "fixed", fixedRate: 0.08, status: "on_sale" },
  { id: "p8", name: "和平精英 王牌", category: "正常单", categoryId: "g4", price: 300, commissionType: "grade", fixedRate: null, status: "off_shelf" },
];

// 收银台「常用」商品：按历史下单频率从 PRODUCTS 里挑选，顺序即常用度排序（模拟 Top 12）
export const TOP_PRODUCTS: Product[] = [
  { id: "p1", name: "王者荣耀代练 100星", category: "手游大于300", categoryId: "g2", price: 480, commissionType: "grade", fixedRate: null, status: "on_sale" },
  { id: "p5", name: "英雄联盟排位 大师", category: "手游大于300", categoryId: "g2", price: 520, commissionType: "grade", fixedRate: null, status: "on_sale" },
  { id: "p6", name: "体验单-咨询", category: "体验单", categoryId: "g1", price: 30, commissionType: "fixed", fixedRate: 0.05, status: "on_sale" },
  { id: "p2", name: "原神代肝 45级", category: "手游小于300", categoryId: "g3", price: 260, commissionType: "fixed", fixedRate: 0.08, status: "on_sale" },
  { id: "p3", name: "王者荣耀代练 50星", category: "手游小于300", categoryId: "g3", price: 180, commissionType: "fixed", fixedRate: 0.08, status: "on_sale" },
  { id: "p4", name: "梦幻西游跑环", category: "正常单", categoryId: "g4", price: 120, commissionType: "fixed", fixedRate: 0.1, status: "on_sale" },
  { id: "p7", name: "穿越火线 枪王段位", category: "手游小于300", categoryId: "g3", price: 220, commissionType: "fixed", fixedRate: 0.08, status: "on_sale" },
];

export const ORDERS: Order[] = [
  {
    id: "o1", orderNo: "ORD20260801103001", customerName: "张三", customerType: "vip", vipLevel: 3,
    payMethod: "wallet", original: 960, paid: 816, discount: 144, commission: 122.4, grossProfit: 693.6,
    status: "completed", auditStatus: "pending", operator: "灰晨", createdAt: "2026-08-01 10:30",
    items: [
      { productName: "王者荣耀代练 100星", category: "手游大于300", unitPrice: 480, quantity: 2, original: 960, discount: 144, paid: 816, commissionType: "grade" },
    ],
    members: [
      { employeeId: "e1", name: "阿明", grade: 2, base: 408, rate: 0.2, commission: 81.6 },
      { employeeId: "e3", name: "大刘", grade: 3, base: 408, rate: 0.1, commission: 40.8 },
    ],
  },
  {
    id: "o2", orderNo: "ORD20260801104502", customerName: "钱七", customerType: "vip", vipLevel: 2,
    payMethod: "cash", original: 540, paid: 540, discount: 0, commission: 27, grossProfit: 513,
    status: "in_progress", auditStatus: "pending", operator: "张三", createdAt: "2026-08-01 10:45",
    items: [
      { productName: "原神代肝 45级", category: "手游小于300", unitPrice: 260, quantity: 1, original: 260, discount: 0, paid: 260, commissionType: "fixed" },
      { productName: "王者荣耀代练 50星", category: "手游小于300", unitPrice: 180, quantity: 1, original: 180, discount: 0, paid: 180, commissionType: "fixed" },
      { productName: "体验单-咨询", category: "体验单", unitPrice: 30, quantity: 1, original: 30, discount: 0, paid: 30, commissionType: "fixed" },
      { productName: "梦幻西游跑环", category: "正常单", unitPrice: 120, quantity: 1, original: 120, discount: 0, paid: 120, commissionType: "fixed" },
    ],
    members: [
      { employeeId: "e2", name: "小芳", grade: 1, base: 270, rate: 0.05, commission: 13.5 },
      { employeeId: "e4", name: "小丽", grade: 1, base: 270, rate: 0.05, commission: 13.5 },
    ],
  },
  {
    id: "o3", orderNo: "ORD20260801093003", customerName: "李四", customerType: "vip", vipLevel: 1,
    payMethod: "wallet", original: 520, paid: 520, discount: 0, commission: 78, grossProfit: 442,
    status: "booking", auditStatus: "pending", operator: "灰晨", createdAt: "2026-08-01 09:30",
    items: [
      { productName: "英雄联盟排位 大师", category: "手游大于300", unitPrice: 520, quantity: 1, original: 520, discount: 0, paid: 520, commissionType: "grade" },
    ],
    members: [{ employeeId: "e5", name: "老周", grade: 2, base: 520, rate: 0.15, commission: 78 }],
  },
  {
    id: "o4", orderNo: "ORD20260731182004", customerName: "王五", customerType: "normal", vipLevel: 0,
    payMethod: "cash", original: 300, paid: 300, discount: 0, commission: 30, grossProfit: 270,
    status: "completed", auditStatus: "approved", operator: "李四", createdAt: "2026-07-31 18:20",
    items: [
      { productName: "和平精英 王牌", category: "正常单", unitPrice: 300, quantity: 1, original: 300, discount: 0, paid: 300, commissionType: "grade" },
    ],
    members: [
      { employeeId: "e1", name: "阿明", grade: 2, base: 150, rate: 0.1, commission: 15 },
      { employeeId: "e2", name: "小芳", grade: 1, base: 150, rate: 0.1, commission: 15 },
    ],
  },
  {
    id: "o5", orderNo: "ORD20260731160005", customerName: "张三", customerType: "vip", vipLevel: 3,
    payMethod: "wallet", original: 440, paid: 374, discount: 66, commission: 0, grossProfit: 0,
    status: "cancelled", auditStatus: "rejected", operator: "王五", createdAt: "2026-07-31 16:00",
    items: [
      { productName: "穿越火线 枪王段位", category: "手游小于300", unitPrice: 220, quantity: 2, original: 440, discount: 66, paid: 374, commissionType: "fixed" },
    ],
    members: [{ employeeId: "e3", name: "大刘", grade: 3, base: 0, rate: 0, commission: 0 }],
  },
  {
    id: "o6", orderNo: "ORD20260731145006", customerName: "钱七", customerType: "vip", vipLevel: 2,
    payMethod: "wallet", original: 1500, paid: 1425, discount: 75, commission: 199.5, grossProfit: 1225.5,
    status: "completed", auditStatus: "approved", operator: "灰晨", createdAt: "2026-07-31 14:50",
    items: [
      { productName: "王者荣耀代练 100星", category: "手游大于300", unitPrice: 480, quantity: 2, original: 960, discount: 48, paid: 912, commissionType: "grade" },
      { productName: "英雄联盟排位 大师", category: "手游大于300", unitPrice: 520, quantity: 1, original: 520, discount: 26, paid: 494, commissionType: "grade" },
      { productName: "体验单-咨询", category: "体验单", unitPrice: 30, quantity: 1, original: 30, discount: 1, paid: 29, commissionType: "fixed" },
    ],
    members: [
      { employeeId: "e3", name: "大刘", grade: 3, base: 712.5, rate: 0.2, commission: 142.5 },
      { employeeId: "e5", name: "老周", grade: 2, base: 712.5, rate: 0.08, commission: 57 },
    ],
  },
];

export const WALLET_LEDGERS = [
  { id: "w1", employee: "阿明", type: "commission", amount: 81.6, balance: 4860, orderNo: "ORD20260801103001", at: "2026-08-01 11:02" },
  { id: "w2", employee: "大刘", type: "commission", amount: 40.8, balance: 8800, orderNo: "ORD20260801103001", at: "2026-08-01 11:02" },
  { id: "w3", employee: "阿明", type: "payout", amount: -1000, balance: 3860, orderNo: "批次 PB20260731", at: "2026-07-31 20:00" },
  { id: "w4", employee: "老周", type: "adjust", amount: 500, balance: 5320, orderNo: "手动调整", at: "2026-07-31 15:30" },
];

export const CUSTOMER_LEDGERS = [
  { id: "cl1", customer: "张三", type: "recharge_principal", amount: 2000, principal: 3280.5, bonus: 560, at: "2026-07-30 14:00" },
  { id: "cl2", customer: "张三", type: "consume_principal", amount: -693.6, principal: 2586.9, bonus: 560, at: "2026-08-01 10:30" },
  { id: "cl3", customer: "钱七", type: "recharge_bonus", amount: 300, principal: 6100, bonus: 880, at: "2026-07-29 09:12" },
];


export interface ProductCategory {
  id: string;
  name: string;
  description: string;
  status: "enabled" | "disabled";
}

export const CATEGORIES: ProductCategory[] = [
  { id: "g1", name: "体验单", description: "引流/咨询类体验项目", status: "enabled" },
  { id: "g2", name: "手游大于300", description: "手游代练单价 300 以上", status: "enabled" },
  { id: "g3", name: "手游小于300", description: "手游代练单价 300 以下", status: "enabled" },
  { id: "g4", name: "正常单", description: "端游及其他正常订单", status: "enabled" },
];

export interface GradeRule {
  id?: string;
  grade: number;
  rate: number;
}

export interface VipDiscountRule {
  id: string;
  vipLevel: number;
  category: string;
  categoryId?: string | null;
  discount: number;
}

export interface VipUpgradeRule {
  id?: string;
  vipLevel: number;
  threshold: number;
}

export interface RechargePackage {
  id: string;
  amount: number;
  bonus: number;
  status: "enabled" | "disabled";
}

export interface Todo {
  id: string;
  title: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  mentions: string[];
  createdBy: string;
  updatedAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdBy: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  published: boolean;
  createdBy: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  recipient: string;
  type: "todo_mention" | "customer_vip_upgrade";
  title: string;
  content: string;
  read: boolean;
  at: string;
}

export interface DeleteLog {
  id: string;
  orderNo: string;
  deletedBy: string;
  paid: number;
  status: string;
  auditStatus: string;
  reason: string;
  at: string;
}

export const GRADE_RULES: GradeRule[] = [
  { grade: 1, rate: 0.05 },
  { grade: 2, rate: 0.08 },
  { grade: 3, rate: 0.1 },
];

export const VIP_DISCOUNT_RULES: VipDiscountRule[] = [
  { id: "vd4", vipLevel: 4, category: "", categoryId: null, discount: 0.99 },
  { id: "vd5", vipLevel: 5, category: "", categoryId: null, discount: 0.98 },
  { id: "vd6", vipLevel: 6, category: "", categoryId: null, discount: 0.97 },
];

export const VIP_UPGRADE_RULES: VipUpgradeRule[] = [
  { vipLevel: 1, threshold: 5000 },
  { vipLevel: 2, threshold: 20000 },
  { vipLevel: 3, threshold: 50000 },
];

export const RECHARGE_PACKAGES: RechargePackage[] = [
  { id: "rp1", amount: 500, bonus: 10, status: "enabled" },
  { id: "rp2", amount: 1000, bonus: 50, status: "enabled" },
  { id: "rp3", amount: 1000, bonus: 25, status: "enabled" },
  { id: "rp4", amount: 3000, bonus: 100, status: "enabled" },
  { id: "rp5", amount: 5000, bonus: 200, status: "enabled" },
  { id: "rp6", amount: 10000, bonus: 500, status: "enabled" },
];

export const TODOS: Todo[] = [
  { id: "t1", title: "核对本周提成明细", content: "周三前完成上周订单提成核对", status: "in_progress", mentions: ["灰晨", "阿明"], createdBy: "灰晨", updatedAt: "2026-08-01 18:00" },
  { id: "t2", title: "补录支付凭证", content: "订单 ORD20260801104502 缺凭证", status: "pending", mentions: ["小芳"], createdBy: "灰晨", updatedAt: "2026-08-01 17:30" },
  { id: "t3", title: "跟进大客户钱七充值", content: "到期提醒充值套餐", status: "completed", mentions: [], createdBy: "张三", updatedAt: "2026-07-31 11:00" },
];

export const ANNOUNCEMENTS: Announcement[] = [
  { id: "a1", title: "7 月工资发放时间调整", content: "本月工资发放提前至 7 月 30 日，请各员工确认银行信息。", pinned: true, createdBy: "灰晨", updatedAt: "2026-07-28 10:00" },
  { id: "a2", title: "新商品分类上线", content: "新增「手游小于300」分类，请在商品管理中选择对应分类。", pinned: false, createdBy: "灰晨", updatedAt: "2026-07-26 15:00" },
];

export const NOTES: Note[] = [
  { id: "n1", title: "交接说明", content: "老板灰晨负责审核与财务；张三负责日常运营。", published: true, createdBy: "灰晨", updatedAt: "2026-07-30 09:00" },
  { id: "n2", title: "个人备忘", content: "明天跟进 VIP 客户回访。", published: false, createdBy: "张三", updatedAt: "2026-08-01 20:00" },
];

export const NOTIFICATIONS: NotificationItem[] = [
  { id: "nt1", recipient: "小芳", type: "todo_mention", title: "你被提及了一条待办", content: "@小芳：补录支付凭证", read: false, at: "2026-08-01 17:30" },
  { id: "nt2", recipient: "小芳", type: "customer_vip_upgrade", title: "客户 VIP 自动升级", content: "客户「钱七」已从 VIP 1 自动升级为 VIP 2。", read: false, at: "2026-07-29 10:00" },
  { id: "nt3", recipient: "灰晨", type: "todo_mention", title: "你被提及了一条待办", content: "@灰晨：核对本周提成明细", read: true, at: "2026-08-01 18:00" },
];

export const DELETE_LOGS: DeleteLog[] = [
  { id: "dl1", orderNo: "ORD20260730120001", deletedBy: "灰晨", paid: 320, status: "booking", auditStatus: "pending", reason: "客户下错单", at: "2026-07-30 13:00" },
];
export const DASHBOARD_STATS = {
  todayOrders: 12,
  todayIncome: 8642,
  pendingAudit: 5,
  activeEmployees: 5,
  totalCustomers: 23,
  todayCommission: 731.4,
};
