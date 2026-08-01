"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useSkin } from "@/lib/skin";
import { NAV_ITEMS } from "./nav";
import { NavItem } from "@/components/ui/NavItem";

export function Sidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const { skin } = useSkin();
  const ulRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState({ top: 0, height: 36 });
  const posRef = useRef({ top: 0, height: 36 });
  const [ghost, setGhost] = useState<{ top: number; height: number; key: number } | null>(null);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const activeItem = NAV_ITEMS.find((it) => isActive(it.href));

  useLayoutEffect(() => {
    const ul = ulRef.current;
    const anchor = itemRefs.current.get(activeItem?.href ?? "/");
    if (!ul || !anchor) return;
    const ulRect = ul.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    const top = r.top - ulRect.top;
    const height = r.height;
    const prev = posRef.current;
    // monochrome：记录旧黑条位置做"从右到左褪去"残影
    if (skin === "monochrome" && ready && Math.abs(prev.top - top) > 1) {
      setGhost({ top: prev.top, height: prev.height, key: Date.now() });
    }
    posRef.current = { top, height };
    setPos({ top, height });
    setReady(true);
  }, [pathname, skin, ready]);

  // modern：底部强调条；其余：整条黑/左条
  const indicatorTop = skin === "modern" ? pos.top + pos.height - 4 : pos.top;
  const indicatorHeight = skin === "modern" ? 4 : pos.height;

  return (
    <nav className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold tracking-tight">Ex-Lend</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted">员工提成与账户管理</p>
      </div>

      <ul ref={ulRef} className="relative flex-1 overflow-y-auto py-2">
        {ready && (
          <li
            aria-hidden
            className="nav-indicator pointer-events-none absolute left-2 right-2 z-0"
            style={{ transform: `translateY(${indicatorTop}px)`, height: indicatorHeight }}
          >
            <span key={pathname + skin} className="nav-indicator-inner" />
          </li>
        )}

        {ghost && skin === "monochrome" && (
          <li
            aria-hidden
            key={ghost.key}
            className="nav-indicator-ghost pointer-events-none absolute left-2 right-2 z-0"
            style={{ top: ghost.top, height: ghost.height }}
            onAnimationEnd={() => setGhost(null)}
          />
        )}

        {NAV_ITEMS.map((item) => (
          <li key={item.id} className="relative z-10 px-2 py-0.5">
            <NavItem
              num={item.num}
              label={item.label}
              href={item.href}
              active={isActive(item.href)}
              onClick={onNavigate}
              innerRef={(el) => {
                if (el) itemRefs.current.set(item.href, el);
              }}
            />
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-4 py-2.5">
        <p className="font-mono text-[10px] text-muted">v0.1 · 皮肤系统 v2</p>
      </div>
    </nav>
  );
}