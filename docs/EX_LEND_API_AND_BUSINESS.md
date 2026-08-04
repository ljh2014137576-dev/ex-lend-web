# Ex-Lend 接口与业务逻辑文档

> 适用范围：Ex-Lend（员工提成与客户账户管理系统）
> 数据层：Supabase（PostgreSQL + PL/pgSQL + RLS + Auth + Storage + Realtime）
> 项目地址：E:\GLM-Z\ex-lend；备份副本：G:\new-ui\ALL_IN_ONE.sql
> 线上项目：https://gmfylevxrrdweuwzbumt.supabase.co
> 生成日期：2026-08-01（基于线上数据库导出与全部迁移文件整理）

---

## 1. 项目概述

Ex-Lend 是面向小型门店/团队的管理系统，核心业务：

- **员工**：档案、等级、钱包余额、欠款/坏账标记、工资发放
- **客户**：会员（VIP）、本金/赠送/预收三类余额、充值、透支额度
- **商品**：分类、价格、提成规则（固定比例 / 按员工等级）
- **订单**：多商品下单、VIP 折扣、钱包质押或现金预收、审核后发放提成
- **财务**：员工钱包流水、客户流水、工资批次、毛利统计

角色：`boss`（老板，全权）、`manager`（管理岗，受限）。权限由 PostgreSQL RLS + 函数内部 `is_boss()/is_manager()/is_staff()` 双重控制。

## 2. 访问方式

所有接口都挂在 Supabase 项目域名下（`${SUPABASE_URL}` = `https://gmfylevxrrdweuwzbumt.supabase.co`）：

| 服务 | 地址 | 说明 |
|---|---|---|
| PostgREST（表/RPC） | `${SUPABASE_URL}/rest/v1` | `supabase.from()` / `supabase.rpc()` |
| Auth | `${SUPABASE_URL}/auth/v1` | 邮箱密码登录、会话 |
| Storage | `${SUPABASE_URL}/storage/v1` | 头像、支付凭证 |
| Realtime | `${SUPABASE_URL}/realtime/v1` | 通知、协作看板 |

请求头：

```http
apikey: <anon key>
Authorization: Bearer <access token>
Content-Type: application/json
```

除登录外所有业务接口要求已登录。**RPC 调用约定**：`POST /rest/v1/rpc/<函数名>`，请求体字段名必须与参数名一致；业务成功/失败都以 JSONB 返回，调用方必须同时检查 HTTP `error` 和返回的 `success` 字段。

## 3. Auth 接口

| 操作 | 调用 | 返回 |
|---|---|---|
| 登录 | `supabase.auth.signInWithPassword({email, password})` | `{session, user}` |
| 退出 | `supabase.auth.signOut()` | `{error}` |
| 取会话 | `supabase.auth.getSession()` | `{data:{session}, error}` |
| 取用户 | `supabase.auth.getUser()` | `{data:{user}, error}` |
| 监听变化 | `supabase.auth.onAuthStateChange(cb)` | 事件回调 |

## 4. RPC 接口清单（线上库共 37 个函数）

### 4.1 客户与会员

| 函数 | 参数 | 返回 | 权限 |
|---|---|---|---|
| `recharge_wallet` | `p_customer_id uuid, p_package_id uuid[, p_proof_path text]` | `{success, new_balance}`；按套餐增加本金+赠送，写两条流水 | staff |
| `recharge_custom` | `p_customer_id uuid, p_amount numeric, p_bonus numeric, p_remark text[, p_proof_path text]` | `{success, new_balance}`；自定义充值金额+赠送 | staff（28 版起） |
| `set_customer_vip_level` | `p_customer_id uuid, p_vip_level int, p_reason text` | `{success, old_level, vip_level}`；>0 转 vip，=0 恢复 normal | 仅 boss |
| `adjust_customer_consumption` | `p_customer_id uuid, p_delta numeric, p_reason text` | `{success, before_value, after_value}`；累计消费可正可负，结果不能 <0 | 仅 boss |
| `recalculate_customer_vip` | `p_customer_id uuid` | `{success, vip_level}`；按累计消费重算 VIP（只升不降） | 仅 boss |

### 4.2 员工与钱包

| 函数 | 参数 | 返回 | 权限 |
|---|---|---|---|
| `batch_create_employees` | `p_employees jsonb`（数组，字段见下） | `{success, count}`；整批事务化，失败整体回滚 | staff |
| `adjust_employee_wallet` | `p_employee_id uuid, p_amount numeric, p_remark text` | `{success, new_balance}`；调整后余额不能 <0，必须填备注 | 仅 boss |

`p_employees` 每项字段：`nickname, name, phone, gender(male/female/other), alipay_account, id_card, bank_card, bank_name, deposit, wechat_id, remark, grade, status, bio`。

### 4.3 订单

| 函数 | 参数 | 返回 | 权限 |
|---|---|---|---|
| `create_order_multi` | `p_customer_id uuid, p_items jsonb, p_employee_ids uuid[], p_pay_method pay_method, p_paid_amount numeric` | `{success, order_id, order_no, original_amount, paid_amount, discount, item_count}` | staff |
| `create_order`（旧版） | `p_customer_id, p_product_id, p_employee_ids, p_pay_method[, p_paid_amount][, p_quantity]` | `{success, order_id, order_no, paid_amount, discount[, pending_amount]}` | staff（兼容保留） |
| `assign_order_employees` | `p_order_id uuid, p_employee_ids uuid[]` | `{success, message}`；0~2 名员工，仅审核前可改 | staff |
| `batch_start_orders` | `p_order_ids uuid[]` | `{success, count}`；批量 booking→in_progress，须每单已有员工 | staff |
| `update_order_proof` | `p_order_id uuid, p_proof_path text` | `{success}`；订单开始后才能传支付凭证 | staff |
| `list_order_creator_profiles` | 无 | 表：`(id uuid, username text, name text, role user_role)` | authenticated |

`create_order_multi.p_items` 为数组：`[{product_id uuid, quantity int}, ...]`，最多 50 种；`p_employee_ids` 只能 0 或 2 个。

### 4.4 提成与审核

| 函数 | 参数 | 返回 | 权限 |
|---|---|---|---|
| `approve_commission` | `p_order_id uuid` | `{success, message, total_commission, real_income, gross_profit}`；计算提成、员工钱包入账、确认消费、订单置 approved | 仅 boss |
| `batch_approve_orders` | `p_order_ids uuid[]` | `{success, count}`；批量逐单调用 approve_commission | 仅 boss |
| `set_pending_order_commissions` | `p_order_id uuid, p_commissions jsonb` | `{success, count}`；审核前覆盖提成金额（数组 `[{employee_id, amount}]`，须属于该订单、金额≥0、不重复） | staff |
| `reject_order_audit` | `p_order_id uuid` | `{success, message}`；撤销已审核订单，冲回提成与消费 | 仅 boss |

### 4.5 退款与删除

| 函数 | 参数 | 返回 | 权限 |
|---|---|---|---|
| `refund_order` | `p_order_id uuid, p_refund_method text('wallet'/'cash')` | `{success, order_id, refund_method, refund_amount}`；待审核单须按原支付方式退；已审核单先冲提成再退 | staff（已审核单仅 boss） |
| `delete_order` | `p_order_id uuid[, p_reason text]` | `{success, order_no}`；仅 booking+待审核+未产生提成的单 | 仅 boss |

### 4.6 工资发放

| 函数 | 参数 | 返回 | 权限 |
|---|---|---|---|
| `payout_salary` | `p_items jsonb, p_batch_no text` | `{success, batch_id, total_amount, detail_count}`；建批次、扣钱包、写流水与明细；非欠款员工余额不足会中断 | 仅 boss |

`p_items`：`[{employee_id uuid, amount numeric}, ...]`。

### 4.7 个人与系统

| 函数 | 参数 | 返回 | 权限 |
|---|---|---|---|
| `update_self_profile` | `p_name text, p_bio text, p_shortcut text` | `{success}`；更新本人姓名/简介/下单快捷键 | 本人 |
| `update_self_avatar` | `p_avatar_path text` | `{success}`；更新本人头像路径 | 本人 |
| `update_system_logo` | `p_logo_path text` | `{success}`；写入 system_setting(`system_logo_path`) | 仅 boss |

### 4.8 角色判断与内部函数/触发器

| 函数 | 返回/说明 |
|---|---|
| `is_boss()` / `is_manager()` / `is_staff()` | boolean；从 JWT claim `user_role.role` 读取（由 custom_access_token_hook 注入） |
| `gen_order_no()` | text；`'ORD' + YYYYMMDDHH24MISS + 毫秒取模3位` |
| `trigger_set_updated_at()` | 触发器函数；4 张表自动更新 updated_at |
| `auto_upgrade_customer_vip()` | 触发器；累计消费增加后查 vip_upgrade_rule 自动升级（只升不降）+ 全员通知 |
| `sync_product_category_name()` / `sync_discount_category_name()` | 触发器；按 category_id 同步分类文本 |
| `touch_collaboration_record()` | 触发器；待办/公告/笔记更新 updated_at/updated_by |
| `notify_todo_mentions()` | 触发器；待办 @提及 时给被提及人发通知 |
| `custom_access_token_hook(event jsonb)` | Auth Hook；登录时把 users.role 写入 JWT claims（需在 Dashboard→Auth→Hooks 配置） |

## 5. 数据表接口（PostgREST，共 25 张表）

直接通过 `supabase.from('<表名>').select(...)` 访问，RLS 决定可见/可写范围：

| 业务域 | 表 | 权限 |
|---|---|---|
| 基础规则 | `grade_commission_rule`、`vip_discount_rule`、`vip_upgrade_rule`、`recharge_package` | staff 读，boss 写 |
| 主体 | `users`、`employee`、`product`、`product_category`、`customer` | staff 读写；users 仅 boss 全读/本人读自己 |
| 订单 | `order`、`order_item`、`order_member`、`order_template` | staff 读写；order_template 仅本人或 boss |
| 资金 | `wallet_ledger`、`customer_wallet_ledger` | staff 读；wallet_ledger 写入仅走 RPC/boss |
| 发放 | `payout`、`payout_detail` | 仅 boss |
| 审计 | `customer_account_adjustment`、`order_delete_log` | staff 读；调整写入仅 boss |
| 协作 | `todo_item`、`announcement`、`note`、`notification` | 待办 staff 读写；公告 staff 读/boss 写；笔记发布或本人；通知仅本人 |
| 个人/系统 | `user_favorite_product`、`system_setting` | 本人或 boss；system_setting 全员可读 |

## 6. Storage 接口

| Bucket | 用途 | 权限 | 前端有效期 |
|---|---|---|---|
| `avatars` | 用户/员工/客户头像 | 私有；路径第一段 = 当前用户 UID；上传/读取需登录 | signed URL 900s |
| `payment-proofs` | 充值/订单支付凭证 | 私有；同上 | signed URL 300s |

## 7. Realtime 接口

- `public.notification`：用户通知与未读数量实时刷新
- `public.todo_item`、`public.announcement`、`public.note`：协作看板刷新

## 8. 业务逻辑

### 8.1 角色权限模型

| 操作 | boss | manager |
|---|---|---|
| 下单/充值/指派员工/改待办 | ✅ | ✅ |
| 审核提成、打款、删订单、调钱包、调规则、发公告 | ✅ | ❌ |
| 员工钱包流水写入 | ✅（走 RPC） | ❌（只读） |

### 8.2 客户钱包（三账户模型）

- **本金 principal_balance**：充值所得、可退
- **赠送 bonus_balance**：充值赠送、可退
- **预收 pending_balance**：下单时扣款暂存，审核通过后转为消费
- 每次变动写 `customer_wallet_ledger`（不可变流水，含变动后余额与凭证）

### 8.3 订单生命周期

```
booking(待接单/待开始) → in_progress(进行中) → completed(已完成)
    → 审核 pending → approved(提成入账) / rejected(被撤销或退款)
```

- 审核前可加/改接单员工（0~2 人）
- 只有 boss 能审核（approve_commission）与撤销审核（reject_order_audit）
- 退款后订单置 `cancelled` + `rejected`

### 8.4 下单流程（create_order_multi）

1. 校验：staff 权限、1~50 种商品、0 或 2 名在职员工、客户启用中
2. **服务端权威算价**：每行 `单价×数量`；VIP 客户按 `vip_discount_rule`（`category_id` 精确匹配优先）打折；实付可覆盖但须在 0~原价之间
3. 生成订单号 `gen_order_no()`，写订单 + `order_item` 明细快照（商品名/品类/单价/折扣/提成规则快照）+ `order_member`
4. **钱包支付**：按本金/赠送余额比例扣款，全部计入 `pending_balance`（质押）
5. **现金支付**：记 `cash_received` 流水，同样进 `pending_balance`（预收）
6. 尾差调整到最后一笔明细

### 8.5 提成计算（approve_commission，审核时一次性计算）

1. 校验：boss、订单 completed 且待审核、有参与员工、有明细、员工等级已配置规则
2. 每人基础额 = `实付 ÷ 员工数`
3. 逐商品明细：**fixed** → `行实付/人数 × fixed_rate_snapshot`；**grade** → `行实付/人数 × 该员工等级规则率`
4. 写 `order_member` 快照（等级/基数/实际比例/佣金/类型），**员工钱包 +提成**，写 `wallet_ledger`（type=commission）
5. 客户侧：`pending_balance` 扣回、`total_consumption` 增加（触发 VIP 自动升级）；钱包单按 `consume_principal` 记真实收入
6. 毛利 = 真实收入 − 总提成；订单置 approved

### 8.6 提成人工覆盖

- 已完成且待审核的订单可调用 `set_pending_order_commissions` 临时改每人提成（存 `commission_override_*` 字段，不覆盖计算快照）
- 审核瞬间若存在 override，以 override 金额入账

### 8.7 充值

- **套餐充值** `recharge_wallet`：本金 + amount、赠送 + bonus，各写一条流水，可带凭证
- **自定义充值** `recharge_custom`：老板/管理岗自定义金额与赠送（28 版放宽）

### 8.8 工资发放（payout_salary）

- 仅 boss；按批次发放：建 `payout` 批次 → 逐员工扣钱包（`type=payout` 流水）→ 写 `payout_detail`（前后余额）
- 非欠款员工余额不足会**整体中断回滚**；欠款员工（is_debt=true）允许扣到负数

### 8.9 退款（refund_order）

- **待审核单**：必须按原支付方式退——钱包单退回本金/赠送（按消费流水比例），现金单记 `cash_refund`；扣回 pending
- **已审核单**：仅 boss；先 `reject_order_audit` 冲回已发提成（员工钱包扣回，可转欠款/坏账），再按原方式退款
- 退款后订单 `cancelled + rejected`，清空 pending/佣金/毛利，保留 override 字段做审计

### 8.10 删除订单（delete_order）

- 仅 boss；仅 booking + 待审核 + 未产生提成的订单
- 钱包单先回滚本金/赠送、扣回 pending；写 `order_delete_log` 审计，再级联删除明细/流水/员工关系/订单

### 8.11 VIP 机制

- **自动升级**：触发器 `auto_upgrade_customer_vip` 在 `total_consumption` 增加后查升级表，达标自动升级（只升不降），写调整记录 + 全员通知
- **手动调整**：`set_customer_vip_level`（仅 boss，须填原因）
- **重算**：`recalculate_customer_vip`（仅 boss）

### 8.12 协作模块

- **待办 todo_item**：全员读写，@提及触发 `notify_todo_mentions` 通知
- **公告 announcement**：全员读，仅 boss 写，可置顶
- **笔记 note**：发布后全员可读可改；未发布仅创建者可见可改，仅创建者可删
- **通知 notification**：仅本人读/标记已读；类型 `todo_mention`、`customer_vip_upgrade`

### 8.13 审计与一致性

- 所有资金变动走**不可变流水表**（wallet_ledger / customer_wallet_ledger），记录变动后余额、操作人、关联单号
- 撤销审核/退款用**补偿流水**（refund_deduct / consume_from_pending 等）而非删除，保证财务历史可追溯
- 订单/明细/参与员工均保存**业务快照**（价格、折扣、品类、提成规则、员工等级），后续改规则不影响历史单

## 9. 关键枚举（15 个）

| 枚举 | 取值 |
|---|---|
| user_role | boss, manager |
| user_status | active, disabled |
| employee_status | active, resigned |
| gender | male, female, other |
| product_status | on_sale, off_shelf |
| commission_type | fixed, grade |
| customer_type | normal, vip |
| customer_status | active, blocked |
| package_status | enabled, disabled |
| order_status | booking, in_progress, completed, cancelled |
| audit_status | pending, approved, rejected |
| pay_method | wallet, cash |
| wallet_ledger_type | commission, payout, refund_deduct, adjust |
| customer_ledger_type | recharge_principal, recharge_bonus, consume_principal, consume_bonus, refund, adjust, consume_from_pending, cash_received, cash_refund |
| payout_status | processing, completed |

## 10. 种子数据（线上现状）

- `grade_commission_rule`：等级 1→80%、2→85%、3→90%
- `product_category`：体验单、手游大于300、手游小于300、正常单
- `users`：boss（灰晨）+ 3 个 manager（密码由 Supabase Auth 管理，`password_hash='auth-managed'`）
- `vip_discount_rule` / `vip_upgrade_rule` / `recharge_package`：线上为空（未配置）

## 11. 注意事项

1. `custom_access_token_hook` 需在 Supabase Dashboard → **Auth → Hooks** 配置为 Access Token Hook，否则 JWT 无 `user_role` claim，RLS 角色判断失效
2. `recharge_wallet` / `recharge_custom` 存在旧版重载（无 `p_proof_path`），新代码用带凭证版本
3. 全新环境初始化优先执行 `ALL_IN_ONE.sql`（含 01~04 与 07~31）；`19_clear_test_business_data.sql` 等清理脚本**不要**混入初始化
4. 不要把 service_role key 放进浏览器端；前端只用 anon key + RLS
5. 涉及余额/提成/退款/工资的金额计算只允许在数据库事务函数中做，不要在前端算

## 12. 附录：前端页面与数据流入口

| 路径 | 页面 |
|---|---|
| `/login` | 登录 |
| `/dashboard` | 首页统计（员工/客户/订单/收入/提成/毛利） |
| `/dashboard/employees` | 员工管理（含批量导入、钱包流水） |
| `/dashboard/products` | 产品管理 |
| `/dashboard/product-categories` | 商品分类 |
| `/dashboard/customers` | 客户管理（充值、账户调整） |
| `/dashboard/orders` | 订单管理（新建/指派/审核/退款/删除） |
| `/dashboard/finance` | 财务看板（仅 boss） |
| `/dashboard/notes`、`/dashboard/settings`、`/dashboard/profile` 等 | 协作与个人设置 |

## 13. 前端营业额口径（new-ui）

| 入口 | 说明 |
|---|---|
| `/finance`（财务） | "营业额"面板：默认本周（周一~今天），可切换 今日/本周/上周/本月/近7天/近30天/全部，或自定义起止日期 |
| `/`（工作台） | "今日收入"卡片 = 今日非取消订单 paid 合计（实付，不含已取消） |

**营业额双口径（按订单 createdAt 日期区间筛选）：**
- **名义收入** = 区间内全部订单 `original`（订单字面金额）合计，未减折扣，含已取消订单。
- **真实收入** = 区间内非取消订单 `paid`（实付）合计，已去折扣，排除已取消订单。
- 辅助指标：折扣金额（非取消订单 discount 合计）、已取消订单单数。

**真实数据一致性（2026-08-03 复查）：** 商品分类筛选、工资发放弹窗、订单详情路由均已切换为缓存/真实 API；页面中仍出现的 Mock 仅为无真实会话时的 fallback（测试模式），不会在真实登录后显示。

> 注：若"名义收入"也应排除已取消订单，仅需在 finance/page.tsx 的 nominalRevenue 前加 `status !== "cancelled"` 过滤，一行改动。

## 14. 小票生成（集成自 img-cre / Receipt Studio）

| 入口 | 说明 |
|---|---|
| 订单列表双击行弹窗（OrderDetailModal） | "生成小票"按钮 |
| 订单详情页 /orders/[id] | "生成小票"按钮 |

**行为：** 打开后按订单预填：客户名→消费者、orderNo→票号/条码（CODE128）、createdAt→生成时间、订单明细→商品行、订单号→二维码内容；可编辑文字图层/购买明细/画布（58/80mm、密度、纹理、水印），实时预览并缩放。

**导出：** 复制 PNG（剪贴板）、下载 PNG/JPEG（html-to-image，pixelRatio 3）、PDF（jsPDF，按纸宽换算高度）。资源位于 public/receipt/，样式位于 app/globals.css（.receipt 系列），字体复用 YouSheBiaoTiHei。

**字体：** 票面字体固定为优设标题黑（YouSheBiaoTiHei）堆栈并用 !important 锁定，不随皮肤/全局字体变化；编辑器表单控件仍随应用主题。

**布局：** 默认 80mm 纸宽；票码区左锚定：二维码靠左 → 分割线 → 条形码按剩余宽度自适应加长（高度与二维码一致，不超宽），条码下方不显示编号（订单号在小票头部 #编号 处）。

**注意：** 小票含"样例水印"默认值（SAMPLE / 样例），如需正式小票请自行确认合规后再去除。

## 15. 工资结算（老板专用 /payroll）

- 汇总每个员工的：累计佣金（wallet_ledger type=commission 累计）、已发放（type=payout 绝对值累计）、调整/扣减、当前工资结余（employee.wallet_balance）。
- 统计卡：在职员工数 / 工资总额 / 累计佣金合计 / 已发放合计 / 欠款员工数。
- 导出 Excel：SheetJS，含“工资结算”与“发放批次”两个 sheet；工资结算明细带 员工(昵称)/真实姓名/支付宝账号/银行卡号（取自 employee.name/alipay_account/bank_card）。
- 双击员工行：弹窗展示其参与订单（订单号/客户/金额/该员工提成/状态/审核/时间）与底部汇总（订单数/已完成/订单总额/提成合计）。
- 排除无工资员工（结余/累计佣金/已发/调整全为 0 且无欠款）。
- 权限：仅老板；侧边栏入口位于财务之后。
- 系统 Logo：顶栏应用头像读 system_setting.system_logo_path → avatars 桶签名 URL，无则回退 ✦。
- 下单乐观更新：收银台提交先入缓存展示，成功用真实ID替换，失败回滚+弹窗。
- 工作台按身份：老板见全局（待审核提成+老板入口）；管理员见日常（进行中订单，无老板入口）。
- 顶栏头像：左侧应用头像（logo 占位 ✦）、右侧用户头像（替换 +新建订单，点击进设置）；AppShell 常驻 + 签名 URL 缓存，跨页不闪。
- 启动加载：BootProvider + BootLoading（进度条+动效预留区）；常用 7 类数据优先加载，其余后台续载；10s 安全超时。
- 个人信息：设置页从 users 表读取/保存当前用户姓名与头像（avatars 桶），真实登录生效；测试模式回退本机。
- 订单支付凭证支持多张：order.proof_paths 数组，add_order_proof/remove_order_proof RPC（需执行对应 SQL）；前端多选上传、网格展示、单张删除。

## 16. 结算记录（老板专用 /payouts）

- /payroll“结算工资”：勾选在职员工并填金额（默认=当前结余）→ payout_salary 扣钱包、写 wallet_ledger(type=payout) 与 payout_detail，生成批次；可同时上传支付凭证（Excel/图片/PDF）到批次。
- /payouts：结算批次列表（批次号/时间/操作人/员工数/总额/状态/凭证），双击查看明细（员工/金额/结算前/结算后）与凭证（图片预览或文件下载）。
- payout 表新增 proof_path 列（需执行：alter table public.payout add column if not exists proof_path text;）。
