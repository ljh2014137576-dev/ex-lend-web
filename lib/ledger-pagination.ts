export type LedgerCursor = { id: string; createdAt: string | null };
export type CursorRow = { id: string; created_at: string | null };
export const LEDGER_PAGE_SIZE = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function timestampMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match) throw new Error("记录时间格式异常，无法确认流水完整性。");
  const zone = /^[+-]\d{2}$/.test(match[3]) ? match[3] + ":00" : match[3];
  const milliseconds = Date.parse(match[1].replace(" ", "T") + zone);
  if (!Number.isFinite(milliseconds)) throw new Error("记录时间无效，未返回不完整流水。");
  return BigInt(milliseconds) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function cursorOf(row: CursorRow): LedgerCursor {
  if (!row || typeof row.id !== "string" || !UUID.test(row.id)) throw new Error("记录 ID 无效，未返回不完整流水。");
  if (row.created_at !== null) {
    if (typeof row.created_at !== "string") throw new Error("记录缺少排序时间，无法确认读取完整性。");
    timestampMicros(row.created_at);
  }
  return { id: row.id.toLowerCase(), createdAt: row.created_at };
}

function isAfter(previous: LedgerCursor, next: LedgerCursor): boolean {
  if (previous.createdAt === null) return next.createdAt === null && next.id < previous.id;
  if (next.createdAt === null) return true;
  const a = timestampMicros(previous.createdAt), b = timestampMicros(next.createdAt);
  return b < a || (a === b && next.id < previous.id);
}

/** PostgREST raw OR syntax; both operands come from validated database cursors. */
export function ledgerCursorFilter(cursor: LedgerCursor): string {
  if (!UUID.test(cursor.id)) throw new Error("无效分页游标");
  if (cursor.createdAt === null) return `and(created_at.is.null,id.lt.${cursor.id})`;
  timestampMicros(cursor.createdAt);
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}),created_at.is.null`;
}

export async function readAllLedgerPages<T extends CursorRow>(
  fetchPage: (cursor: LedgerCursor | null, pageSize: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxPages = 2000,
): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>();
  let cursor: LedgerCursor | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor, LEDGER_PAGE_SIZE);
    if (result.error) throw new Error("流水读取未完成，请刷新重试：" + result.error.message);
    if (!Array.isArray(result.data)) throw new Error("服务端未确认流水列表，不能按空记录计算。");
    if (result.data.length === 0) return rows;
    for (const row of result.data) {
      const next = cursorOf(row);
      if (seen.has(next.id) || (cursor && !isAfter(cursor, next))) throw new Error("流水分页发生重复或顺序变化，请重新读取，未使用部分结果统计。");
      seen.add(next.id);
      rows.push(row);
      cursor = next;
    }
    // A server max_rows smaller than our request is still a page, not EOF.
  }
  throw new Error("流水记录较多，读取尚未完成；未返回部分记录作为全部流水。");
}
