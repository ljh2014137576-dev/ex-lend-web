# 2026-10-07 公告与规则真实保存修复

本次修改位于隔离分支 `codex/restore-business-writes`，用于恢复后的正常写入通路。没有修改原工作区、环境文件或账号凭据。

## 行为

- 公告发布：真实会话调用 `apiCreateAnnouncement`，仅收到数据库返回的实际公告 ID 后加入列表并关闭表单。请求期间禁止重复发布、修改表单或关闭弹窗；失败保留原输入并显示错误。
- 公告置顶：`apiUpdateAnnouncementPin` 保存 `is_pinned` 后才更新列表，请求期间锁定同一条操作；失败保留原状态。发布和置顶入口均通过 `BossOnly` 对老板显示，处理函数也检查 isBoss；数据库仍负责最终授权。
- 等级提成比例：输入先保留为字符串草稿，不在每次按键时写库；点击“保存”发送最新值。仅接受有限的 0–1 数字，保存期间锁定该行；失败保留草稿和旧的已保存值，成功后使用服务器返回值更新缓存。
- 套餐启停：`apiUpdateRechargePackageStatus` 获得保存成功响应后才切换状态；重复点击受请求锁保护，失败显示行内错误且不改变原状态。
- 无真实会话的既有 Mock 演示继续只修改本地状态，比例提示明确为“已更新本地演示”。真实会话不会把没有返回记录的更新当作成功。

## 入口与数据库对应

| 页面 | 数据层 helper | 表 / 写列 |
|---|---|---|
| app/(shell)/announcements/page.tsx | apiCreateAnnouncement | announcement INSERT(title,content,is_pinned) |
| app/(shell)/announcements/page.tsx | apiUpdateAnnouncementPin | announcement UPDATE(is_pinned) WHERE id |
| app/(shell)/rules/page.tsx | apiUpdateGradeRate | grade_commission_rule UPDATE(rate) WHERE grade |
| app/(shell)/rules/page.tsx | apiUpdateRechargePackageStatus | recharge_package UPDATE(status) WHERE id |

四个 helper 位于 `lib/supabase-api.ts`，使用显式返回列和 `.single()`；网络/权限错误与未返回记录均作为失败传给页面。公告表的 created_by/updated_by 使用数据库默认值和 `announcement_touch` 触发器，不由客户端伪造。

本次恢复的独立 SQL 候选在 `G:\recovery-new-ui-20261007\restore-plan\business-enable\permissions`：

- `20-table-write-candidate.sql` 只给 active boss 对应列级 INSERT/UPDATE 和 RLS，不开放密码、角色、余额或任意表写。
- 公告 UPDATE 必须保留触发器 `announcement_touch` 设置 updated_by/updated_at。
- 等级 rate、套餐 amount/bonus 等新增直接写路径有有限数值检查，拒绝 PostgreSQL numeric NaN/Infinity。
- `30-rpc-allowlist-candidate.sql` 仍只有原本 21 个业务 RPC + 3 个角色 helper，本次四个 helper 是受 RLS 保护的表操作，不增加数据库 RPC。

## 验证

- `npm run typecheck`：通过。
- `npm run build`：22 页生成通过。隔离目录没有真实环境配置，因此构建使用当前进程内的 `https://build-only.invalid` 和非真实 key 占位值；没有创建 `.env`，该构建不代表生产配置或线上登录验证。
- `test-frontend-writes.cjs`：29 项行为/数据层检查通过，覆盖失败保留草稿、真实返回 ID、保存最后编辑值、只在显式保存时写库、重复点击锁、失败不切换状态、非老板无置顶入口、空结果不能假成功和 NaN 预先拒绝。测试是受控 hooks/resource/transport harness，不是浏览器端到端测试。
- `test-permissions.mjs`：80 项真实 RPC/触发器 + RLS/列授权组合检查通过，使用纯虚构数据；包括公告 created_by/updated_by、老板规则更新、管理员/停用账号拒绝和有限数值限制。Storage HTTP 使用本地 metadata 模拟，不涉及真实文件上传。
- 已按 React 最佳实践复核：Hooks 位于条件返回前；草稿与已确认缓存分离；函数式状态更新；失败路径有 finally 释放请求锁；没有在键击/渲染中发请求；输入有可访问名称，错误/完成提示使用 alert/status。

没有通过本次操作验证真实浏览器交互、生产部署或真实用户密码登录；这些应由集成步骤独立确认。不要将上述占位构建产物用于生产服务。

## 交付状态

业务代码由受派子代理修改。按主代理明确分工，本代理不创建 Git 提交或推送；主代理完成审查后统一提交、推送并刷新提交后的索引。当前代码已经在 `recovery-frontend-worktree` 索引中刷新，提交后仍应再次确认索引覆盖最新提交。
