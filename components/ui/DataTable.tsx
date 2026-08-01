import { ReactNode } from "react";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  mono?: boolean;
  render?: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "暂无数据",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: string;
}) {
  const alignCls = (a?: string) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <div className="overflow-x-auto border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface2 font-mono text-[11px] uppercase text-muted">
            {columns.map((c) => (
              <th key={c.key} className={["whitespace-nowrap px-3 py-2 font-medium", alignCls(c.align)].join(" ")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center font-mono text-xs text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-b border-line last:border-0 transition-colors hover:bg-surface2">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={[
                    "whitespace-nowrap px-3 py-2",
                    alignCls(c.align),
                    c.mono ? "font-mono tabular-nums text-xs" : "",
                  ].join(" ")}
                >
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}