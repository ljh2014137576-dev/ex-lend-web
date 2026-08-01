"use client";

import { useEffect, useRef, useState } from "react";
import { CUSTOMERS, type Customer } from "@/lib/mock-data";
import { Input } from "@/components/ui/Input";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export function CustomerSelect({
  value,
  onChange,
  customers = CUSTOMERS,
}: {
  value: string;
  onChange: (id: string) => void;
  customers?: Customer[];
}) {
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const customer = customers.find((c) => c.id === value);
  const filtered = customers.filter(
    (c) => keyword === "" || c.name.includes(keyword) || c.phone.includes(keyword),
  );

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2 text-left text-sm transition-colors hover:bg-surface2"
      >
        {customer ? (
          <span>
            {customer.name}
            {customer.type === "vip" ? `（VIP${customer.vipLevel}）` : ""}
            <span className="ml-2 font-mono text-[11px] text-muted">余额 {money(customer.principal + customer.bonus)}</span>
          </span>
        ) : (
          <span className="text-muted">选择客户</span>
        )}
        <span className="font-mono text-[10px] text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-line bg-surface shadow-md">
          <div className="border-b border-line p-2">
            <Input
              autoFocus
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索姓名 / 手机号…"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                    setKeyword("");
                  }}
                  className={[
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-surface2",
                    c.id === value ? "bg-nav-active text-nav-active-text" : "",
                  ].join(" ")}
                >
                  <span>
                    {c.name}
                    {c.type === "vip" ? ` · VIP${c.vipLevel}` : ""}
                  </span>
                  <span className="font-mono text-[11px] opacity-70">{money(c.principal + c.bonus)}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-4 font-mono text-xs text-muted">无匹配客户</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}