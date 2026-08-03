# new-ui

## 当前状态

Ex-Lend 前端（Next.js 15 + TypeScript + Tailwind 4）**脚手架已搭建**，皮肤系统（editorial/monochrome/modern 三套可切换）已生效。

- 启动：`npm install` → `npm run dev` → http://localhost:3000
- 页面规划见 [docs/FE_PLAN.md](docs/FE_PLAN.md)；接口与业务逻辑见 [docs/EX_LEND_API_AND_BUSINESS.md](docs/EX_LEND_API_AND_BUSINESS.md)
- 营业额口径：/finance 按日期范围筛选（默认本周），名义收入=字面金额、真实收入=实付且不含已取消；详见 [docs/EX_LEND_API_AND_BUSINESS.md §13](docs/EX_LEND_API_AND_BUSINESS.md)
- 规划进度：脚手架 ✓ → 登录/角色守卫 → 订单闭环（收银/订单/审核）→ 财务+目录 → 设置
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

- [Ex-Lend 接口与业务逻辑文档](docs/EX_LEND_API_AND_BUSINESS.md)
- [前端规划 v0.1](docs/FE_PLAN.md)：页面清单/布局骨架/黑白 token/数据闭环（待确认）：全部 RPC/表/Storage/Realtime 接口、返回内容与完整业务逻辑
- [操作日志](logs/INDEX.md)：每次操作记录，每 100 条一个文件
- [数据库备份](ALL_IN_ONE.sql)：Ex-Lend 一键初始化脚本（重建版）


## SQL 模块化索引（Ex-Lend）

- [模块索引](sql/README.md)：按业务域切分的 11 个 SQL 模块（schema/rls/triggers/customer/employee/order/commission/refund/system/auth/seed），查什么读什么，不用读全量。

## 操作日志

- 日志目录：`logs/`；每条操作一条记录，每 100 条切分一个文件，索引见 `logs/INDEX.md`。