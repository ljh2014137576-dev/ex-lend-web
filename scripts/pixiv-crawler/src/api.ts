import type { Config } from "./config";
import { log, sleep, throttle, message, backoffMs } from "./utils";

/** Pixiv ajax 接口返回的通用包装 */
interface PixivResponse<T> {
  error?: boolean;
  message?: string;
  body?: T;
}

/** GET /ajax/user/{userId}/profile/all 的 body */
export interface PixivProfileAllBody {
  illusts?: Record<string, { id?: number } | null>;
  manga?: Record<string, { id?: number } | null>;
}

/** 多页作品的单页信息 */
export interface PixivMetaPage {
  urls: { original: string };
}

/** GET /ajax/illust/{id} 的 body */
export interface PixivIllustBody {
  urls?: { original: string };
  meta_pages?: PixivMetaPage[];
  title?: string;
}

const profileAllUrl = (userId: string): string =>
  `https://www.pixiv.net/ajax/user/${userId}/profile/all?lang=zh`;

const illustUrl = (id: string): string => `https://www.pixiv.net/ajax/illust/${id}?lang=zh`;

function requestHeaders(config: Config): Record<string, string> {
  return {
    Cookie: config.cookie,
    "User-Agent": config.userAgent,
    Referer: "https://www.pixiv.net/",
    Accept: "application/json, text/plain, */*",
  };
}

async function requestJson<T>(url: string, config: Config): Promise<PixivResponse<T>> {
  await throttle(config.delayMs);
  const res = await fetch(url, {
    headers: requestHeaders(config),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as PixivResponse<T>;
}

/** 拉取用户全部作品 id（插图 + 漫画），失败自动重试，耗尽后抛错 */
export async function fetchWorkIds(userId: string, config: Config): Promise<string[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await requestJson<PixivProfileAllBody>(profileAllUrl(userId), config);
      if (data.error || !data.body) {
        throw new Error(data.message || "profile/all 返回异常");
      }
      const ids = [
        ...Object.keys(data.body.illusts ?? {}),
        ...Object.keys(data.body.manga ?? {}),
      ];
      log(`获取到 ${ids.length} 个作品（插图 ${Object.keys(data.body.illusts ?? {}).length}，漫画 ${Object.keys(data.body.manga ?? {}).length}）`);
      return ids;
    } catch (err) {
      if (attempt >= config.maxRetries) throw err;
      const wait = backoffMs(attempt);
      log(`作品列表请求失败（${message(err)}），${wait / 1000}s 后重试（${attempt + 1}/${config.maxRetries}）`);
      await sleep(wait);
    }
  }
}

/** 拉取单个作品详情，失败自动重试，耗尽后抛错 */
export async function fetchIllustDetail(id: string, config: Config): Promise<PixivIllustBody> {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await requestJson<PixivIllustBody>(illustUrl(id), config);
      if (data.error || !data.body) {
        throw new Error(data.message || "作品详情返回异常");
      }
      return data.body;
    } catch (err) {
      if (attempt >= config.maxRetries) throw err;
      const wait = backoffMs(attempt);
      log(`作品 ${id} 详情请求失败（${message(err)}），${wait / 1000}s 后重试（${attempt + 1}/${config.maxRetries}）`);
      await sleep(wait);
    }
  }
}
