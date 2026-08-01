"use client";

import { useMemo, useState } from "react";
import { EMPLOYEES, type Employee } from "@/lib/mock-data";
import { Input } from "@/components/ui/Input";

export function EmployeePicker({
  value,
  onChange,
  employees = EMPLOYEES,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  employees?: Employee[];
}) {
  const [keyword, setKeyword] = useState("");

  const active = useMemo(() => employees.filter((e) => e.status === "active"), [employees]);
  const filtered = active.filter(
    (e) => keyword === "" || e.name.includes(keyword),
  );

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (value.length < 2) onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted">已选 {value.length} / 2 人</span>
        {value.length === 2 && (
          <span className="font-mono text-[10px] text-muted">已达上限，取消一人后可再选</span>
        )}
      </div>
      <Input placeholder="搜索员工姓名…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      <ul className="max-h-56 divide-y divide-line overflow-y-auto border border-line bg-surface">
        {filtered.map((e) => {
          const selected = value.includes(e.id);
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => toggle(e.id)}
                className={[
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors",
                  selected ? "bg-nav-active text-nav-active-text" : "hover:bg-surface2",
                ].join(" ")}
              >
                <span>{e.name}</span>
                <span className="font-mono text-[11px] opacity-70">
                  Lv{e.grade}
                  {selected ? " · ✓" : ""}
                </span>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-3 py-4 font-mono text-xs text-muted">无匹配员工</li>
        )}
      </ul>
    </div>
  );
}