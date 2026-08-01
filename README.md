# new-ui

## 当前状态

这是 `G:\new-ui` 的项目基线。当前目录尚未包含应用源码、依赖清单或运行入口，因此暂时没有可执行的业务功能。

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
## 操作日志

- 日志目录：`logs/`；每条操作一条记录，每 100 条切分一个文件，索引见 `logs/INDEX.md`。