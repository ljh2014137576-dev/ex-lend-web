# SQL 模块索引（Ex-Lend）

> 用途：把 2476 行的 ALL_IN_ONE.sql 按业务域切成 11 个模块，**需要查什么只读对应文件**，不用读全量。
> 来源：G:\new-ui\ALL_IN_ONE.sql（2026-08-01 去重重建版）按业务域自动切分。
> 模块文件内语句顺序与 ALL_IN_ONE 一致；完整可执行版仍以 ALL_IN_ONE.sql 为准。

## 快速导航（按主题找文件）

| 想查什么 | 读哪个文件 |
|---|---|
| 表结构 / 字段 / 枚举 / 索引 / 约束 | `schema.sql` |
| 权限 / RLS 策略 / 谁能读写什么 | `rls.sql` |
| 自动行为（时间戳、VIP 升级、分类同步、通知触发） | `triggers.sql` |
| 充值、VIP 调整 | `customer.sql` |
| 员工批量导入、钱包调整、工资发放 | `employee.sql` |
| 下单、指派员工、开始订单、凭证 | `order.sql` |
| 提成审核、覆盖、撤销审核 | `commission.sql` |
| 退款、删除订单 | `refund.sql` |
| 个人资料/头像/Logo、Storage 存储桶 | `system.sql` |
| JWT 角色注入钩子 | `auth.sql` |
| 初始规则/分类/账号数据 | `seed.sql` |

## 模块清单

| 文件 | 内容 |
|---|---|
| schema.sql | 扩展、15 枚举、25 张表 DDL、索引、约束、数据回填 |
| rls.sql | RLS 启用、全部策略、is_boss/is_manager/is_staff |
| triggers.sql | updated_at、VIP 自动升级、分类同步、协作 touch、@提及通知（含 12 个触发器） |
| customer.sql | recharge_wallet×3、recharge_custom×4、set_customer_vip_level、adjust_customer_consumption、recalculate_customer_vip |
| employee.sql | batch_create_employees、adjust_employee_wallet、payout_salary |
| order.sql | gen_order_no、create_order×2、create_order_multi、assign_order_employees×2、batch_start_orders、update_order_proof、list_order_creator_profiles |
| commission.sql | approve_commission、batch_approve_orders、set_pending_order_commissions、reject_order_audit（含 29 号动态补丁） |
| refund.sql | refund_order、delete_order |
| system.sql | update_self_profile/avatar/system_logo、avatars/payment-proofs 存储桶与策略、realtime 发布 |
| auth.sql | custom_access_token_hook |
| seed.sql | 等级规则 3 条、分类 4 个、用户 4 个 |
| product.sql | 商品软删除（隐藏）：hide_product、restore_product |
| p0_security_fixes.sql | P0 安全加固（幂等）：实时读库角色校验、recharge_wallet 权限修复、凭证路径校验、payment-proofs 读策略收紧、revoke/grant 卫生 |

## 备注

- 函数存在合理重载/重定义（如 recharge_custom 4 个版本：02 旧版 4 参、02 新版 5 参、09、28），模块内保留全部版本，执行顺序与迁移链一致。
- 若需恢复数据库，直接用 ALL_IN_ONE.sql（含 01-04 与 07-31 全部内容）。
## P0 安全加固（2026-08-06，分支 fix-error）

- `is_boss/is_manager/is_staff` 已由 JWT claim 改为**实时读库校验**（`security definer` 读 users 表），权限变更即时生效；RLS 与 RPC 均自动受益。
- `recharge_wallet(p_customer_id, p_package_id, p_proof_path)` 原为 SECURITY DEFINER 且**无任何角色校验**（任意登录用户可充值），已补 `is_staff()` 校验。
- `update/add/remove_order_proof` 新增 `is_proof_path_valid()` 校验：仅允许引用 payment-proofs 桶内真实存在的对象（防跨桶/伪造路径）。
- `payment_proofs_authenticated_read` 由全员可读收紧为 **is_staff()（老板/管理员）** 可读（当前角色仅有 boss/manager，功能不受影响；为未来低权限角色留门）。
- 关闭未显式授权函数的默认 PUBLIC EXECUTE（create_order、legacy assign_order_employees、set_customer_vip_level、adjust_customer_consumption、gen_order_no、batch_start_orders、batch_approve_orders 等）。
- 应用方式：线上库直接执行 `sql/p0_security_fixes.sql`（幂等）；重建库用 `ALL_IN_ONE.sql`（已含同等变更，追加于文件末尾）。
## 商品软删除（2026-08-06）

- `product.deleted_at timestamptz`（NULL=未隐藏）；列表查询过滤 `deleted_at is null`。
- `hide_product(uuid)` / `restore_product(uuid)`：仅老板（is_boss），SECURITY DEFINER，幂等。
- 应用：线上执行 `sql/product_hide.sql`（幂等）；重建库用 ALL_IN_ONE.sql。
## 订单接单员工 0/1/2（2026-08-07）

- create_order_multi / edit_order 原强制「0 或 2 名」，现改为「最多 2 名」（允许 0/1/2，单人可完成订单）。
- assign_order_employees 本就允许 0/1/2，未改。
- 应用：线上执行 `sql/order_member_123.sql`（幂等，仅重新定义两个函数）；重建库用 ALL_IN_ONE.sql（已含同等变更）。