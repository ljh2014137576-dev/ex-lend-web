import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Config } from "./config";
import type { PixivIllustBody } from "./api";
import { backoffMs, log, message, sleep, throttle } from "./utils";

export interface ImageUrl {
  url: string;
  name: string;
}

/** 从作品详情中提取所有原图 URL（优先 meta_pages，其次 urls.original） */
export function collectImageUrls(detail: PixivIllustBody): ImageUrl[] {
  if (detail.meta_pages && detail.meta_pages.length > 0) {
    return detail.meta_pages
      .map((p) => p.urls?.original)
      .filter((u): u is string => !!u)
      .map((u) => ({ url: u, name: safeName(u) }));
  }
  if (detail.urls?.original) {
    return [{ url: detail.urls.original, name: safeName(detail.urls.original) }];
  }
  return [];
}

/** 文件名取自 URL 最后一段路径，并防路径穿越 */
function safeName(url: string): string {
  let name: string;
  try {
    name = decodeURIComponent(url.split("/").pop() ?? "");
  } catch {
    name = url.split("/").pop() ?? "";
  }
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    return "unknown";
  }
  return name;
}

/**
 * 下载单张图片到 destDir。已存在则跳过（断点续爬）。
 * 失败自动重试（指数退避），耗尽后抛错由调用方记录。
 */
export async function downloadImage(
  url: string,
  destDir: string,
  config: Config
): Promise<"downloaded" | "exists"> {
  const filePath = join(destDir, safeName(url));
  if (existsSync(filePath)) {
    return "exists";
  }
  mkdirSync(destDir, { recursive: true });

  for (let attempt = 0; ; attempt++) {
    try {
      await throttle(config.delayMs);
      const res = await fetch(url, {
        headers: {
          Cookie: config.cookie,
          "User-Agent": config.userAgent,
          Referer: "https://www.pixiv.net/",
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const tmp = `${filePath}.part`;
      const stream = res.body as WebReadableStream<Uint8Array>;
      await pipeline(Readable.fromWeb(stream), createWriteStream(tmp));
      renameSync(tmp, filePath);
      return "downloaded";
    } catch (err) {
      if (attempt >= config.maxRetries) throw err;
      const wait = backoffMs(attempt);
      log(`图片下载失败（${message(err)}），${wait / 1000}s 后重试（${attempt + 1}/${config.maxRetries}）`);
      await sleep(wait);
    }
  }
}
