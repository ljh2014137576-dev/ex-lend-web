"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";
import type { Product } from "@/lib/mock-data";

const money = (n: number) => "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2 });

export function ProductSelect({
  value,
  onChange,
  products,
}: {
  value: string;
  onChange: (id: string) => void;
  products: Product[];
}) {
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const onSale = products.filter((p) => p.status === "on_sale");
  const selected = onSale.find((p) => p.id === value);
  const filtered = onSale.filter(
    (p) => keyword === "" || p.name.includes(keyword) || p.category.includes(keyword),
  );

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2 text-left text-sm transition-colors hover:bg-surface2"
      >
        {selected ? (
          <span className="truncate">
            {selected.name}
            <span className="ml-2 font-mono text-[11px] text-muted">{money(selected.price)}</span>
          </span>
        ) : (
          <span className="text-muted">选择商品</span>
        )}
        <span className="font-mono text-[10px] text-muted">▼</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-line bg-surface shadow-md">
          <div className="border-b border-line p-2">
            <Input autoFocus value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索商品名称 / 分类" />
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                    setKeyword("");
                  }}
                  className={[
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface2",
                    p.id === value ? "bg-nav-active text-nav-active-text" : "",
                  ].join(" ")}
                >
                  <span className="truncate">
                    {p.name}
                    <span className="ml-2 font-mono text-[11px] opacity-70">{p.category}</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums">{money(p.price)}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-4 font-mono text-xs text-muted">无匹配商品</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
