# new-ui

## 当前状态

Ex-Lend 前端（Next.js 15 + TypeScript + Tailwind 4）**脚手架已搭建**，皮肤系统（editorial/monochrome/modern 三套可切换）已生效。

- 启动：`npm install` → `npm run dev` → http://localhost:3000
- 页面规划见 [docs/FE_PLAN.md](docs/FE_PLAN.md)；接口与业务逻辑见 [docs/EX_LEND_API_AND_BUSINESS.md](docs/EX_LEND_API_AND_BUSINESS.md)
- 工资结算：老板专用 /payroll，汇总员工工资（累计佣金/已发/结余）并可导出 Excel
- 小票生成：收银台和订单详情均可一键生成小票并导出 PNG/JPEG/PDF，支持复制 PNG；导出时跳过全局大字体嵌入，避免浏览器资源加载失败（迁移自 img-cre Receipt Studio）
- 营业额口径：/finance 按日期范围筛选（默认本周），名义收入=字面金额、真实收入=实付且不含已取消；详见 [docs/EX_LEND_API_AND_BUSINESS.md §13](docs/EX_LEND_API_AND_BUSINESS.md)
- 规划进度：脚手架 ✓ → 登录/角色守卫 → 订单闭环（收银/订单/审核）→ 财务+目录 → 设置
- 待办 /todos：新建待办真实会话下乐观插入 + 写库 todo_item（失败回滚提示，刷新不丢失）；提及暂仅本地展示，真实映射后续再做
- 工作台：新增“我创建的订单”区域，支持按日期范围和订单状态筛选；订单列表新增“创建用户”列，显示订单创建人。
## 数据库备份（Ex-Lend）

- `ALL_IN_ONE.sql`：Ex-Lend（员工提成与客户账户管理系统）Supabase 一键初始化脚本（重建版）。
- 来源：`E:\GLM-Z\ex-lend\supabase\ALL_IN_ONE.sql`，2026-08-01 从线上 Supabase 数据库（gmfylevxrrdweuwzbumt）逆向导回，包含建表、枚举、RPC 函数、RLS、种子数据与全部增量迁移（01_schema + 02_rpcs + 03_seed + 04_employee_ext + 07~31）。
- 用途：Ex-Lend 数据库备份与重建；可在 Supabase SQL Editor 中直接执行。

## 开发约定

- 协作规则见 [AGENTS.md](AGENTS.md)。
- 代码发现优先使用 codebase-memory-mcp，读取源码时只读取必要的符号或局部片段。
- 每次代码改动后提交 Git，并在完成代码编写后刷新 code-memory-mcp 索引。
- 项目用途、目录结构、启动命令和验证命令将在源码加入后持续补充。

## 后续入口

添加第一批源码后，请同步补充以下内容：

1. 项目用途与主要用户流程
2. 技术栈、依赖和目录结构
3. 本地启动、测试和构建命令
4. code-memory-mcp 索引项目名称与刷新方式（当前索引项目名：new-ui；Ex-Lend 索引项目名：ex-lend）

## 文档索引

- [系统功能全景（2026-10-10）](docs/SYSTEM_FUNCTION_MAP_20261010.md)：现有页面、业务流程、角色权限、资金口径、占位入口与恢复限制

- [Ex-Lend 接口与业务逻辑文档](docs/EX_LEND_API_AND_BUSINESS.md)
- [前端规划 v0.1](docs/FE_PLAN.md)：页面清单/布局骨架/黑白 token/数据闭环（待确认）：全部 RPC/表/Storage/Realtime 接口、返回内容与完整业务逻辑
- [操作日志](logs/INDEX.md)：每次操作记录，每 100 条一个文件
- [订单操作修复（2026-10-08）](docs/ORDER_ACTION_REPAIR_20261008.md)：完成按钮、批量真实结果、审核台与提交确认，以及保留的历史财务限制
- [数据库备份](ALL_IN_ONE.sql)：Ex-Lend 一键初始化脚本（重建版）


## SQL 模块化索引（Ex-Lend）

- [模块索引](sql/README.md)：按业务域切分的 11 个 SQL 模块（schema/rls/triggers/customer/employee/order/commission/refund/system/auth/seed），查什么读什么，不用读全量。

## 操作日志

- 日志目录：`logs/`；每条操作一条记录，每 100 条切分一个文件，索引见 `logs/INDEX.md`。
## P0 修复记录（2026-08-06，分支 fix-error）

### SQL 安全加固（脚本：sql/p0_security_fixes.sql，线上需执行，幂等）
- is_boss/is_manager/is_staff 改为实时读库校验（原 JWT claim 存在角色变更过期窗口）。
- 修复 recharge_wallet 无权限校验漏洞（原为 SECURITY DEFINER + 无角色检查 + 默认 PUBLIC 可执行，任意登录用户可给任意客户充值）。
- payment-proofs 读策略收紧为 is_staff()（老板/管理员）；update/add/remove_order_proof 新增 is_proof_path_valid 校验（仅允许引用 payment-proofs 桶内真实存在的对象）。
- 关闭未显式授权函数的默认 PUBLIC EXECUTE（create_order、legacy assign_order_employees、set_customer_vip_level、adjust_customer_consumption、gen_order_no），batch_start_orders/batch_approve_orders 显式授权 authenticated。
- 重建库：ALL_IN_ONE.sql 已含同等变更（追加于文件末尾）。

### 前端数据层（已提交）
- lib/data-store.tsx：新增 dirty 标记——后台刷新不覆盖本地修改；真实会话 fetch 失败不再回退 mock 数据。
- lib/auth.tsx：mock 登录加 NEXT_PUBLIC_ENABLE_MOCK_LOGIN 编译期开关（生产默认关闭；本地 .env.local 已设 1 保持演示可用）。
- lib/use-real-data.tsx：真实会话 fetch 失败时 data 置空。
- components/shell/PrefetchAll.tsx：启动预取 17→7 个高频资源，删除 5 分钟全量轮询。
