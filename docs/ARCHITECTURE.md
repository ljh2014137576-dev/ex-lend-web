# Ex-Lend 运行时架构

## 产物

- 交互式架构图：[docs/architecture/runtime-architecture.html](./architecture/runtime-architecture.html)
- 图谱快照：2026-08-30；1,094 nodes / 2,220 edges；TypeScript 62 files、SQL 26 files、CSS 1 file。

## 运行时主链路

`Browser route → RootLayout → Skin/Auth/Data/Boot/Profile providers → (shell)/layout → RequireAuth → AppShell + PrefetchAll + BootLoading → page entry`

认证页面 `/login` 独立于 shell。`RequireAuth` 等待 `AuthProvider` 获取 Supabase session；未认证时重定向到 `/login`。`AuthProvider` 通过 `users.role`、JWT claim 和受控 mock role 计算当前角色。

## 数据与写入边界

- 页面通过 `useResource` 注册 fetcher，并由 `DataProvider` 管理共享缓存、并行首载、dirty keys、失效和后台刷新。
- `lib/supabase-api.ts` 是页面到 Supabase 的薄适配层，封装 PostgREST 查询、Storage 上传和 RPC 写入。
- 订单下单链路为 `CashierPage.doSubmit → optimistic orders cache → rpcCreateOrderMulti → create_order_multi → order/order_item/order_member + ledger-derived state`。
- SQL 层承载 RLS helper、角色守卫、事务式 RPC 与 triggers；因此前端可见的页面权限不是唯一安全边界。

## 图的阅读方式

“全局架构”显示所有运行时边界；“启动链路”突出 session、预取和 boot gate；“下单写入”突出乐观 UI 到数据库事务的写入路径。点击节点可查看对应的代码证据摘要，右上角可导出 SVG/PNG。

## 维护索引

本图由 codebase-memory 图谱中的 `RootLayout`、`ShellLayout`、`RequireAuth`、`PrefetchAll`、`DataProvider`、`apiOrders`、`apiOrderDetail`、`rpcCreateOrderMulti` 与 SQL `create_order_multi` 关系整理。代码或 SQL 结构改变后，应重新刷新图谱并更新本文件中的快照日期与统计。
