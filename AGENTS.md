# AGENTS.md

## 工作方式

- 使用 ADHD 友好的协作方式：先给出当前下一步，采用少量编号步骤，持续标明进度，并在结束时给出一个明确的下一步。
- 除非用户明确说"stop adhd mode"或"normal mode"，以上输出方式持续生效。

## Git 规则

- 本项目必须使用 Git 管理。
- 开始工作前确认 Git 状态。
- 每次产生任何改动（代码、文档、配置）后，立即创建一次本地 Git 提交；提交信息应说明改动内容。
- 不覆盖或丢弃用户已有改动；执行破坏性 Git 操作（reset、revert、force push、删除分支等）前必须获得明确授权。

## 代码发现与读取

- 发现代码优先使用 codebase-memory-mcp：`search_graph`、`trace_path`、`get_code_snippet`、`query_graph`、`get_architecture`。
- 查找字符串字面量、配置、脚本和非代码文件时，才使用 `rg` 或其他文件搜索工具作为补充。
- 不直接读取整个源码文件；先定位到相关符号，再读取必要的函数、类或局部片段。

## 索引规则（codebase-memory-mcp）

- 每次写完代码后，必须重新运行 codebase-memory-mcp 为本仓库建立或刷新索引；索引应覆盖最新一次 Git 提交。
- 若索引失败，记录失败原因，并在后续工作中重试。
- 索引完成后，确认索引项目名称与刷新时间，并在最终回复中说明。
- 智能排除（建立/刷新索引时排除以下内容，避免污染知识图谱、拖慢索引）：
  1. 版本控制与工具目录：`.git`、`.gitignore`、`.github`、`.codex`、`.agents`、`.idea`、`.vscode`
  2. 依赖与构建产物：`node_modules`、`dist`、`build`、`out`、`coverage`、`target`、`__pycache__`、`*.pyc`、`vendor`
  3. 生成/缓存文件：`package-lock.json`、`yarn.lock`、`pnpm-lock.yaml`、`*.lock`、`*.min.js`、`*.map`、`*.log`、`.cache`、`tmp`、`temp`
  4. 媒体与二进制大文件：`*.png`、`*.jpg`、`*.jpeg`、`*.gif`、`*.webp`、`*.mp4`、`*.mp3`、`*.exe`、`*.dll`、`*.so`、`*.dylib`、压缩包（`*.zip`、`*.tar*`）
  5. 环境与密钥文件：`.env*`、`*.pem`、`*.key`、`*secret*`、`*credential*`
  6. 可视化/临时输出目录：`visualizations` 输出目录及其他一次性生成物
- 若确有需要索引的文件被误排除，可单独对指定路径重新索引。

## 文档规则

- 为项目的用途、结构、启动方式、开发约定和验证方式维护文档。
- 每次修改完代码后，同步编写或更新对应文档（README、设计/接口/模块文档等），并在相关文档中维护索引条目：本次改动涉及的功能、模块、入口与调用关系。
- 新增功能或改变使用方式时，同步更新相关文档。
- 当前项目为空基线时，只记录已确认的事实，不虚构业务功能。