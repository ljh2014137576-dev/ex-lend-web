import { join, resolve } from "node:path";
import type { Config } from "./config";
import { loadConfig } from "./config";
import { fetchIllustDetail, fetchWorkIds } from "./api";
import { collectImageUrls, downloadImage } from "./download";
import { log, message, throttle } from "./utils";

const CRAWLER_DIR = resolve(__dirname, "..");

export function printHelp(): void {
  console.log(
    [
      "Pixiv 爬虫：下载指定用户的所有作品原图",
      "",
      "用法：",
      "  npm run start -- <userId>",
      "  node dist/index.js <userId>",
      "",
      "参数：",
      "  <userId>  Pixiv 用户 ID（纯数字）",
      "",
      "可选环境变量：",
      "  PIXIV_COOKIE      完整 Cookie 字符串（优先级低于 cookie.txt）",
      "  PIXIV_DELAY_MS    相邻请求间隔毫秒，默认 900",
      "  PIXIV_TIMEOUT_MS  单次请求超时毫秒，默认 30000",
      "  PIXIV_MAX_RETRIES 失败重试次数，默认 3",
      "",
      "示例：",
      "  npm run build && npm run start -- 1234567",
    ].join("\n")
  );
}

/** 解析命令行参数：返回 userId，遇到 --help/-h/参数错误返回 null */
export function parseArgs(argv: string[]): string | null {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return null;
  }
  const userId = args[0];
  if (!/^\d+$/.test(userId)) {
    return null;
  }
  return userId;
}

interface Stats {
  worksTotal: number;
  downloaded: number;
  skipped: number;
  failed: number;
  failures: string[];
}

function printStats(stats: Stats, startedAt: number): void {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("----------------------------------------");
  const imagesTotal = stats.downloaded + stats.skipped + stats.failed;
  console.log(
    `统计：成功 ${stats.downloaded}，已存在 ${stats.skipped}，失败 ${stats.failed}，图片总数 ${imagesTotal}，作品数 ${stats.worksTotal}，耗时 ${elapsed}s`
  );
  if (stats.failures.length > 0) {
    console.log("失败明细：");
    for (const f of stats.failures) {
      console.log(`  - ${f}`);
    }
  }
}

async function runCrawl(userId: string, config: Config): Promise<void> {
  const startedAt = Date.now();
  const userDir = join(config.downloadsDir, userId);
  log(`开始爬取用户 ${userId}，Cookie 来源：${config.cookieSource === "file" ? "cookie.txt" : "环境变量 PIXIV_COOKIE"}`);
  log(`下载目录：${userDir}`);

  let ids: string[];
  try {
    ids = await fetchWorkIds(userId, config);
  } catch (err) {
    log(`获取作品列表失败，已放弃：${message(err)}`);
    printStats({ worksTotal: 0, downloaded: 0, skipped: 0, failed: 0, failures: [] }, startedAt);
    return;
  }

  const stats: Stats = { worksTotal: ids.length, downloaded: 0, skipped: 0, failed: 0, failures: [] };
  if (ids.length === 0) {
    log("该用户没有可下载的作品");
    printStats(stats, startedAt);
    return;
  }

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    try {
      await throttle(config.delayMs);
      const detail = await fetchIllustDetail(id, config);
      const images = collectImageUrls(detail);
      if (images.length === 0) {
        throw new Error("未找到任何原图 URL");
      }
      const workDir = join(userDir, id);
      for (const img of images) {
        try {
          const result = await downloadImage(img.url, workDir, config);
          if (result === "exists") {
            skipped++;
          } else {
            downloaded++;
          }
        } catch (err) {
          failed++;
          stats.failures.push(`${id}/${img.name}：${message(err)}`);
          log(`  [失败] ${id}/${img.name}：${message(err)}`);
        }
      }
      log(`[${i + 1}/${ids.length}] 作品 ${id}：新增 ${downloaded}，已存在 ${skipped}，失败 ${failed}`);
    } catch (err) {
      failed++;
      stats.failures.push(`${id}：${message(err)}`);
      log(`[${i + 1}/${ids.length}] 作品 ${id}：失败（${message(err)}）`);
    }
    stats.downloaded += downloaded;
    stats.skipped += skipped;
    stats.failed += failed;
  }

  printStats(stats, startedAt);
}

/** 程序入口：解析参数、加载配置、执行爬取 */
export async function main(argv: string[]): Promise<void> {
  const userId = parseArgs(argv);
  if (userId === null) {
    printHelp();
    return;
  }

  let config: Config;
  try {
    config = loadConfig(CRAWLER_DIR);
  } catch (err) {
    console.error(`[错误] ${message(err)}`);
    console.error("提示：在 " + join(CRAWLER_DIR, "cookie.txt") + "（utf-8）写入完整 Cookie，或设置环境变量 PIXIV_COOKIE。");
    process.exitCode = 1;
    return;
  }

  try {
    await runCrawl(userId, config);
  } catch (err) {
    console.error(`[错误] 爬取中断：${message(err)}`);
    process.exitCode = 1;
  }
}
