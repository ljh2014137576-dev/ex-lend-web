"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useSkin } from "@/lib/skin";
import { useAuth } from "@/lib/auth";
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
  const { role, mockRole, session, signOut } = useAuth();
  const effectiveRole = role ?? "manager";
  const visibleItems = NAV_ITEMS.filter((it) => !it.roles || it.roles.includes(effectiveRole));
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

  // 指示条：整块高度（monochrome=黑条 / modern=强调背景层 / editorial=左条）
  const indicatorTop = pos.top;
  const indicatorHeight = pos.height;

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
            className="nav-indicator pointer-events-none absolute left-2 right-2 top-0 z-0"
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

        {visibleItems.map((item) => (
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

      {pathname === "/settings" && (
        <div className="border-t border-line px-2 py-2">
          <p className="px-2 pb-1 font-mono text-[10px] text-muted">设置索引</p>
          <ul className="space-y-0.5">
            {[
              { id: "profile", shape: "○", label: "个人信息" },
              { id: "appearance", shape: "▢", label: "外观" },
              { id: "preview", shape: "△", label: "控件预览" },
            ].map((s) => (
              <li key={s.id}>
                <a
                  href={"#" + s.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink transition-colors hover:bg-surface2"
                >
                  <span className="text-[10px] leading-none" aria-hidden>{s.shape}</span>
                  <span>{s.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="border-t border-line px-4 py-2.5">
        <p className="mb-1 font-mono text-[9px] text-muted">
          会话:{session ? "✓" : "✗"} · 角色:{role ?? "无"} · {mockRole ? "测试模式" : session ? "真实" : "—"}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted">
            {effectiveRole === "boss" ? "老板" : "管理岗"} · v0.1
          </span>
          <button
            type="button"
            onClick={signOut}
            className="font-mono text-[10px] text-muted underline underline-offset-2 transition-colors hover:text-ink"
          >
            退出
          </button>
        </div>
      </div>
    </nav>
  );
}