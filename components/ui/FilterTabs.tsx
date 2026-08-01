"use client";

import { useLayoutEffect, useRef, useState } from "react";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function FilterTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [pos, setPos] = useState({ left: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const btn = btnRefs.current.get(active);
    if (!wrap || !btn) return;
    const wrapRect = wrap.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    setPos({ left: r.left - wrapRect.left, width: r.width, ready: true });
  }, [active, tabs]);

  return (
    <div
      ref={wrapRef}
      className="relative flex flex-wrap items-center gap-1 border border-line bg-surface p-1"
    >
      {pos.ready && (
        <span
          aria-hidden
          className="tab-indicator"
          style={{ transform: `translateX(${pos.left}px)`, width: pos.width }}
        >
          <span key={active} className="tab-indicator-inner" />
        </span>
      )}

      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) btnRefs.current.set(t.id, el);
            }}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={isActive}
            className={[
              "relative z-10 rounded-md px-3 py-1.5 text-xs transition-colors duration-[var(--transition-fast-v)]",
              isActive ? "font-medium text-nav-active-text" : "text-muted hover:bg-surface2 hover:text-ink",
            ].join(" ")}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className="ml-1.5 font-mono opacity-70">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}