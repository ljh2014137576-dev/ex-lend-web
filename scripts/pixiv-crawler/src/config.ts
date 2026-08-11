import { resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";

export interface Config {
  cookie: string;
  cookieSource: "file" | "env";
  delayMs: number;
  timeoutMs: number;
  maxRetries: number;
  userAgent: string;
  downloadsDir: string;
  cookieFile: string;
}

export const DEFAULT_DELAY_MS = 900;
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_RETRIES = 3;

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 读取 Cookie 与运行配置。baseDir 为项目目录（scripts/pixiv-crawler） */
export function loadConfig(baseDir: string): Config {
  const cookieFile = resolve(baseDir, "cookie.txt");
  const cookieFromFile = readTextFile(cookieFile)?.trim();
  const cookieFromEnv = process.env.PIXIV_COOKIE?.trim();

  let cookie: string;
  let cookieSource: Config["cookieSource"];
  if (cookieFromFile) {
    cookie = cookieFromFile;
    cookieSource = "file";
  } else if (cookieFromEnv) {
    cookie = cookieFromEnv;
    cookieSource = "env";
  } else {
    throw new Error(
      "未找到 Cookie：请在 " +
        cookieFile +
        "（utf-8 编码）写入完整 Cookie 字符串，或设置环境变量 PIXIV_COOKIE。"
    );
  }

  const delayMs = parsePositiveInt(process.env.PIXIV_DELAY_MS, DEFAULT_DELAY_MS);
  const timeoutMs = parsePositiveInt(process.env.PIXIV_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const maxRetries = parsePositiveInt(process.env.PIXIV_MAX_RETRIES, DEFAULT_MAX_RETRIES);

  const downloadsDir = resolve(baseDir, "downloads");
  mkdirSync(downloadsDir, { recursive: true });

  return { cookie, cookieSource, delayMs, timeoutMs, maxRetries, userAgent: USER_AGENT, downloadsDir, cookieFile };
}
