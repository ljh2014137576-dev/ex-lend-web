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

## 备注

- 函数存在合理重载/重定义（如 recharge_custom 4 个版本：02 旧版 4 参、02 新版 5 参、09、28），模块内保留全部版本，执行顺序与迁移链一致。
- 若需恢复数据库，直接用 ALL_IN_ONE.sql（含 01-04 与 07-31 全部内容）。