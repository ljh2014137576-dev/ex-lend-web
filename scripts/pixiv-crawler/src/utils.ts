let lastRequestAt = 0;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 打印带本地时间戳的日志 */
export function log(msg: string): void {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  console.log(`[${ts}] ${msg}`);
}

/** 相邻请求节流：保证任意两次请求至少间隔 delayMs */
export async function throttle(delayMs: number): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, delayMs - (now - lastRequestAt));
  lastRequestAt = now;
  if (wait > 0) {
    await sleep(wait);
    lastRequestAt = Date.now();
  }
}

/** 指数退避等待：attempt=0 -> 1s, 1 -> 2s, 2 -> 4s */
export function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

/** 把任意抛错对象转成可读消息 */
export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
