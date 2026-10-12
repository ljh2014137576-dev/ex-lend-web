type CreatedOrder = { id: string; createdAtRaw?: string; createdAt: string };

function createdTime(order: CreatedOrder): number | null {
  const raw = Date.parse(order.createdAtRaw ?? "");
  if (Number.isFinite(raw)) return raw;

  // Old cache and mock dates are local display strings, including unpadded month/day.
  const text = order.createdAt.trim();
  const local = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (local) {
    const [, year, month, day, hour = "0", minute = "0", second = "0"] = local;
    const date = new Date(+year, +month - 1, +day, +hour, +minute, +second);
    if (date.getFullYear() !== +year || date.getMonth() !== +month - 1 || date.getDate() !== +day || date.getHours() !== +hour || date.getMinutes() !== +minute || date.getSeconds() !== +second) return null;
    return date.getTime();
  }
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : NaN;
  return Number.isFinite(iso) ? iso : null;
}

/** Newest first; invalid dates last; IDs make equal timestamps deterministic. */
export function compareOrderCreatedDesc(a: CreatedOrder, b: CreatedOrder): number {
  const left = createdTime(a), right = createdTime(b);
  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
