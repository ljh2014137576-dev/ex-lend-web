# Pixiv 爬虫（pixiv-crawler）

独立的 Pixiv 用户作品原图下载工具。输入用户 ID，把该用户所有插图与漫画的原图（original 分辨率）下载到本地，**只下载图片，不生成任何 JSON 元数据**。支持断点续爬、失败重试、请求节流。

- 技术栈：Node.js（>= 18）+ TypeScript，零第三方运行时依赖（仅用 Node 内置模块与全局 `fetch`）。
- 独立目录，不依赖、不修改仓库其他部分。

## 安装

```bash
cd scripts/pixiv-crawler
npm install
```

只安装 `typescript` 与 `@types/node` 两个 devDependencies。

## 配置 Cookie（二选一）

访问 pixiv.net / i.pximg.net 必须携带有效 Cookie，否则会 403。

1. **文件方式（优先级最高）**：在 `scripts/pixiv-crawler/` 下创建 `cookie.txt`（utf-8 编码），内容为完整 Cookie 字符串，例如：
   ```
   PHPSESSID=xxxxxxxxxxxxxxxx; other_key=value
   ```
2. **环境变量方式**：设置环境变量 `PIXIV_COOKIE` 为完整 Cookie 字符串。

两者都没有时，程序会明确报错并提示配置方式后退出。

> 注意：`cookie.txt` 已被 `.gitignore` 忽略，不会被提交。

## 用法

```bash
npm run build
npm run start -- <userId>
# 示例
npm run start -- 1234567
```

直接运行编译产物亦可：

```bash
node dist/index.js <userId>
node dist/index.js --help   # 查看用法
```

### 可选环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PIXIV_DELAY_MS` | `900` | 相邻请求间隔（毫秒），请求频繁被限流时调大 |
| `PIXIV_TIMEOUT_MS` | `30000` | 单次请求超时（毫秒） |
| `PIXIV_MAX_RETRIES` | `3` | 单次请求失败重试次数（指数退避 1s / 2s / 4s） |

## 输出目录结构

```
scripts/pixiv-crawler/
└── downloads/
    └── {userId}/
        └── {作品id}/
            ├── {作品id}_p0.jpg      # 多页作品的第 0 页
            ├── {作品id}_p1.jpg      # 多页作品的第 1 页
            └── ...
```

- 单页作品直接落到 `{作品id}/{作品id}_p0.jpg`。
- 重新运行同一命令即可续爬：已存在的图片自动跳过。

## 常见问题

- **403 Forbidden**：图片服务器 i.pximg.net 强制要求 Cookie 与 `Referer: https://www.pixiv.net/`（本工具已自动携带）。若仍 403，多为 Cookie 失效，请重新登录 Pixiv 后更新 `cookie.txt` 或 `PIXIV_COOKIE`。
- **被限流 / 请求大量失败**：调大 `PIXIV_DELAY_MS`（如 `2000` 或更大）降低请求频率。
- **个别作品失败**：单次请求失败会最多重试 3 次（指数退避），耗尽后记录失败原因并继续下一个作品，不会中断整个爬取；结束后打印失败明细，重新运行同一命令即可补齐。
- **无法访问 pixiv**：请确保网络环境可直连 pixiv.net（可能需要代理）。
