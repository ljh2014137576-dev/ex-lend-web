"use client";

import { NAV_ITEMS } from "./nav";
import { NavItem } from "@/components/ui/NavItem";

export function Sidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold tracking-tight">Ex-Lend</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted">员工提成与账户管理</p>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.id}
            num={item.num}
            label={item.label}
            href={item.href}
            active={isActive(item.href)}
            onClick={onNavigate}
          />
        ))}
      </ul>

      <div className="border-t border-line px-4 py-2.5">
        <p className="font-mono text-[10px] text-muted">v0.1 · 皮肤系统 v2</p>
      </div>
    </nav>
  );
}