// 日期工具：把订单 createdAt 的各种格式（Mock "YYYY-MM-DD HH:mm"、
// 真实 toLocaleString("zh-CN") 如 "2026/8/1 10:30:00"、ISO "2026-08-01T02:30:00+00:00"）
// 统一归一为本地时区 "YYYY-MM-DD"，供按日筛选/统计使用。
export function dateKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    const s = typeof value === "string" ? value : "";
    return s.slice(0, 10);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
