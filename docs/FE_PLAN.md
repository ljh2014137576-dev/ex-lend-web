# Ex-Lend 前端规划 v0.1（草案）

> 状态：待用户确认后进入 UI 实现
> ⚠ 风格变更（2026-08-01）：黑白数据库功能主义经测试不适合，**已废弃**；下文 §4 token 映射作废，新风格待定
> 技术栈：Next.js 15 + TypeScript + Tailwind CSS（App Router）
> 数据：Supabase 线上库 gmfylevxrrdweuwzbumt（直连）
> 风格：~~黑白数据库功能主义~~（已废弃，新风格待定）
> 范围：MVP 核心资金闭环（下单 → 指派员工 → 完成 → 审核提成 → 财务）
> 部署位置：G:\new-ui

## 1. 设计决策（已确认）

| 项 | 决定 |
|---|---|
| 重做/改造 | G:\new-ui 从零重写 |
| 技术栈 | Next.js 15 + TypeScript + Tailwind |
| 设备 | 双端合一（响应式：桌面目录式管理 + 移动收银流） |
| 数据库 | 直连线上库 gmfylevxrrdweuwzbumt（真实数据，谨慎操作） |
| 范围 | MVP 核心资金闭环，协作/二期模块后置 |

## 2. 页面清单（10 个路由，MVP）

| # | 路由 | 页面 | 核心任务 | 数据/接口 | 角色 |
|---|---|---|---|---|---|
| 01 | `/login` | 登录 | 邮箱密码登录（Supabase Auth） | auth.signInWithPassword | 所有人 |
| 02 | `/` | 工作台 | 当日统计：订单数/收入/待审核/待办；快捷入口 | order/customer/employee 统计查询 | staff |
| 03 | `/cashier` | 收银台 | 选客户 → 加商品 → VIP 折扣预览 → 支付方式 → 选 0/2 员工 → 下单 | create_order_multi + product/customer 查询 | staff |
| 04 | `/orders` | 订单目录 | 状态/审核状态筛选、批量开始、批量审核、编号目录行 | order/order_item + batch_start_orders/batch_approve_orders | staff（审核仅 boss） |
| 05 | `/orders/[id]` | 订单详情 | 明细快照、参与员工、凭证、状态流转（开始/完成/审核/覆盖提成/撤销/退款/删除） | order 系列 RPC + order_member | staff / boss |
| 06 | `/audit` | 提成审核台 | 待审核队列、逐单审核、审核前覆盖提成、撤销审核 | approve_commission / set_pending_order_commissions / reject_order_audit | boss |
| 07 | `/finance` | 财务 | 收入/提成/毛利汇总、员工钱包与流水、客户钱包流水、工资发放 | wallet_ledger / customer_wallet_ledger / payout_salary | boss 全功能；manager 只读 |
| 08 | `/customers` | 客户目录 | 客户列表/新建/充值（套餐+自定义）/钱包流水/VIP 调整 | customer + recharge_wallet/recharge_custom/set_customer_vip_level | staff |
| 09 | `/employees` | 员工目录 | 员工列表/新建/钱包流水（下单指派的前置数据） | employee + batch_create_employees | staff |
| 10 | `/products` | 商品目录 | 商品列表/新建/上下架/分类（下单前置数据） | product + product_category | staff |
| 11 | `/settings` | 设置 | 个人资料/下单快捷键/头像 | update_self_profile/update_self_avatar | 本人 |

> 二期（MVP 后）：协作模块（待办/公告/笔记/通知）、商品分类管理深化、订单模板、常用商品收藏、订单删除审计查看、打款批次管理深化。

## 3. 整体布局骨架（App Shell）

### 桌面（≥1024px）：目录式管理台
```
┌──────────────────────────────────────────────────────────┐
│ 顶部工具栏：[☰ 目录]  Ex-Lend / 当前路径    [B] [设置]     │  ← 黑底白字反白条
├────────────┬─────────────────────────────────────────────┤
│ 左侧目录     │  主内容区（12 栏网格）                        │
│ 01 工作台    │  页面标题（大号无衬线，独立一行）               │
│ 02 收银台    │  路径/元数据行（等宽小字：更新时间/计数）       │
│ 03 订单      │  ─────────────────────────────────        │
│ 04 审核台    │  内容区：目录行 / 表格 / 表单流               │
│ 05 财务      │  细线分隔，反白表示选中/激活                  │
│ 06 客户      │                                             │
│ 07 员工      │                                             │
│ 08 商品      │                                             │
│ 09 设置      │                                             │
├────────────┴─────────────────────────────────────────────┤
│ 页脚：等宽小字（版本/数据源/最后同步时间）                    │
└──────────────────────────────────────────────────────────┘
```

### 移动（<1024px）：收银优先的单列流
```
┌─────────────────────────┐
│ [☰]  Ex-Lend / 路径  [B] │  ← 顶部工具栏（吸顶）
├─────────────────────────┤
│ 主内容单列               │
│ 标题 → 路径 → 内容流      │
│ （收银台为分步流：        │
│  客户 → 商品 → 支付 → 员工→ 提交）│
└─────────────────────────┘
目录：左侧滑出抽屉（编号导航行，反白当前项）
```

### 特殊页面布局

- **收银台 `/cashier`**
  - 桌面：左右分栏 = 左（商品目录列表，可筛分类）| 右（订单篮：客户/数量/金额/VIP 折扣/支付方式/员工/提交）
  - 移动：分步向导单列流
- **审核台 `/audit`**
  - 桌面：左右分栏 = 左（待审核订单编号队列）| 右（选中订单详情 + 提成明细行 + 覆盖/审核操作）
  - 移动：单列（队列 → 展开详情）

## 4. 黑白 token 映射（stylekit → Tailwind）

| token | 值 | 用途 |
|---|---|---|
| paper | #D7D7D2 | 页面底色（暖灰纸面） |
| paper2 | #E7E7E2 | 交替行/悬停底色 |
| ink | #0B0B0B | 主文字、反白底、1px 线 |
| ink-muted | 中灰（如 #6E6E68） | 等宽元数据/次要文字 |
| font-sans | system-ui 无衬线 | 标题/正文层级 |
| font-mono + tabular-nums | 等宽 | 编号/金额/路径/时间戳 |
| rounded-none | 直角 | 全部控件 |
| 反白 | bg-ink text-paper | 激活/选中/主操作/状态高亮 |
| 状态点 | 4px 实心圆（黑/灰） | 订单状态、在线状态 |

- 禁止：彩色、渐变、阴影、圆角卡片、胶囊标签、玻璃态
- 密度：组内紧凑（表格行 32-36px），组间留白（48-64px），形成密-疏-密节奏

## 5. MVP 数据闭环（下单 → 财务）

```
收银台 create_order_multi(customer, items[], employees[], pay_method)
   │  服务端算价：数量×单价 + VIP 折扣；wallet=按本金/赠送比例质押进 pending；cash=预收
   ▼
订单列表（booking，pending 质押/预收）
   │  assign_order_employees（0-2 人，审核前可改）
   │  batch_start_orders → in_progress
   │  （前端直更 order.status='completed'，无专用 RPC）
   ▼
completed + audit_status=pending
   │
审核台（boss）：set_pending_order_commissions（可选覆盖提成）
   │  approve_commission：提成=Σ(行实付/人数×固定率或等级率)
   │  员工钱包+提成（wallet_ledger）；客户 pending→消费；毛利=真实收入−提成
   │  （错误时 reject_order_audit 冲回）
   ▼
approved → 财务页汇总（order.total_commission / gross_profit / 双钱包流水）
   │  工资发放 payout_salary（boss）：批次扣员工钱包
   ▼
钱包流水可追溯（wallet_ledger / customer_wallet_ledger）
```

### MVP 用到的接口（RPC）

| 功能 | RPC | 说明 |
|---|---|---|
| 下单 | create_order_multi | 多商品，0/2 员工，钱包质押/现金预收 |
| 指派 | assign_order_employees | 审核前 0-2 人 |
| 开始 | batch_start_orders | booking→in_progress |
| 完成 | （直更 order.status） | 无专用 RPC |
| 审核 | approve_commission / batch_approve_orders | 计算提成入账 |
| 覆盖 | set_pending_order_commissions | 审核前改提成 |
| 撤销 | reject_order_audit | 冲回已审核 |
| 凭证 | update_order_proof | 开始后传支付凭证 |
| 充值 | recharge_wallet / recharge_custom | 客户充值 |
| VIP | set_customer_vip_level / recalculate_customer_vip | 手动调整/重算 |
| 工资 | payout_salary | boss 发工资 |
| 创建人 | list_order_creator_profiles | 下单人显示 |
| 角色 | is_boss/is_manager/is_staff | RLS 用（前端按 JWT claims 显隐按钮） |

## 6. 目录结构草案

```
G:\new-ui\
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (shell)/layout.tsx          # 工具栏+侧栏+抽屉
│   ├── (shell)/page.tsx            # 工作台
│   ├── (shell)/cashier/page.tsx
│   ├── (shell)/orders/page.tsx
│   ├── (shell)/orders/[id]/page.tsx
│   ├── (shell)/audit/page.tsx
│   ├── (shell)/finance/page.tsx
│   ├── (shell)/customers/page.tsx
│   ├── (shell)/employees/page.tsx
│   ├── (shell)/products/page.tsx
│   ├── (shell)/settings/page.tsx
│   ├── layout.tsx
│   └── globals.css                 # 色板/字体/线宽 token
├── components/
│   ├── ui/         # 黑白基础件：DirectoryRow/DataTable/Field/InvertButton/StatusDot/EmptyState
│   ├── shell/      # Toolbar/Sidebar/Drawer/PageHeader
│   └── business/   # Cashier/CustomerPicker/ProductPicker/OrderActions/CommissionRows
├── lib/
│   ├── supabase.ts
│   ├── api/        # orders.ts / customers.ts / employees.ts / products.ts / finance.ts
│   └── auth.ts     # 角色判断（JWT claims）
├── types/          # Supabase 类型 + 业务类型
├── .env.local      # NEXT_PUBLIC_SUPABASE_URL / ANON_KEY
└── package.json
```

## 7. 风险与待确认点

1. **生产数据直连**：开发和演示会对线上库产生真实订单/流水；建议前端操作前二次确认弹层（尤其删除/退款/调钱包）。
2. **订单"完成"状态**：无专用 RPC，前端直更 order.status，需确认 RLS 允许（staff 写 ✓，函数内无校验）。
3. **角色按钮显隐**：前端读 JWT claims（user_role.role）；若 hook 未配置会导致 claims 缺失，需先确认线上 Auth → Hooks 已启用 custom_access_token_hook。
4. **金额计算只信服务端**：前端展示用，所有算价/扣款在 RPC 内完成。
5. **收银台快捷键**：users.order_create_shortcut（默认 Ctrl+Shift+O）可做全局快捷建单入口（二期）。

## 8. 实现顺序建议

1. 项目脚手架 + token/globals.css + App Shell（工具栏/侧栏/抽屉）
2. 登录页 + 角色守卫
3. 订单闭环：收银台 → 订单列表/详情 → 审核台
4. 财务页 + 客户/员工/商品三目录
5. 设置页 + 交互打磨（键盘、空态、反白态）