"use client";

import { useEffect, useRef, useState } from "react";
import { CUSTOMERS, type Customer } from "@/lib/mock-data";
import { Input } from "@/components/ui/Input";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export function CustomerSelect({
  value,
  onChange,
  customers = CUSTOMERS,
  onCreate,
  pendingNewName,
}: {
  value: string;
  onChange: (id: string) => void;
  customers?: Customer[];
  onCreate?: (name: string) => void;
  pendingNewName?: string | null;
}) {
  const [keyword, setKeyword] = useState("");
  const [focus, setFocus] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = customers.find((c) => c.id === value) ?? null;
  const kw = keyword.trim();

  // 父组件自动选中默认客户（customers[0]）时，把名称同步进输入框，让“选中态”可见
  useEffect(() => {
    if (selected && keyword === "") setKeyword(selected.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, customers]);

  const matches = customers.filter(
    (c) => kw === "" || c.name.includes(kw) || c.phone.includes(kw),
  );
  // 无完全同名 → 显示“＋ 新建客户”；有完全同名 → 仅行内“作为新客户”按钮
  const exactMatch = matches.some((c) => c.name === kw);
  const showCreate = onCreate != null && kw !== "" && !exactMatch;
  const selectedByName = selected != null && selected.name === kw;
  const showList = focus;

  const pick = (id: string, name: string) => {
    onChange(id);
    setKeyword(name);
    setFocus(false);
  };

  const create = (name: string) => {
    if (onCreate) onCreate(name);
    setFocus(false);
  };

  return (
    <div
      ref={wrapRef}
      className="space-y-2"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setFocus(false);
      }}
    >
      <Input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onFocus={() => setFocus(true)}
        placeholder="输入客户名称 / 手机号…"
      />

      {pendingNewName && (
        <p className="flex items-center gap-1.5 rounded-md border border-dashed border-line bg-paper px-2 py-1.5 font-mono text-[11px]">
          <span className="text-ink">＋ 新客户：{pendingNewName}</span>
          <span className="text-muted">（随下单创建）</span>
        </p>
      )}

      {showList && (
        <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-md border border-line bg-paper">
          {showCreate && (
            <li>
              <button
                type="button"
                onClick={() => create(kw)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface2"
              >
                <span className="text-ink">＋ 新建客户：{kw}</span>
              </button>
            </li>
          )}

          {matches.map((c) => (
            <li key={c.id}>
              <div
                className={[
                  "flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface2",
                  c.id === value && selectedByName ? "bg-nav-active text-nav-active-text hover:bg-nav-active" : "",
                ].join(" ")}
              >
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => pick(c.id, c.name)}>
                  <span className="block truncate">
                    {c.name}
                    {c.type === "vip" ? ` · VIP${c.vipLevel}` : ""}
                  </span>
                  <span className="block font-mono text-[11px] text-muted">
                    余额 {money(c.principal + c.bonus)}
                  </span>
                </button>
                {onCreate != null && c.name === kw && (
                  <button
                    type="button"
                    onClick={() => create(c.name)}
                    title="同名老客户，作为新客户创建"
                    className="shrink-0 rounded-md border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-surface2 hover:text-ink"
                  >
                    作为新客户
                  </button>
                )}
              </div>
            </li>
          ))}

          {matches.length === 0 && !showCreate && (
            <li className="px-3 py-4 font-mono text-xs text-muted">无匹配客户</li>
          )}
        </ul>
      )}
    </div>
  );
}
