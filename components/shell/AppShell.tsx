"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold tracking-tight">Ex-Lend</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted">员工提成与账户管理</p>
      </div>
      <ul className="flex-1 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              onClick={() => setDrawerOpen(false)}
              className={[
                "flex items-baseline gap-3 px-4 py-2 text-sm transition-colors",
                isActive(item.href)
                  ? "bg-ink text-paper"
                  : "text-ink hover:bg-paper",
              ].join(" ")}
            >
              <span className="font-mono text-[11px] opacity-60">{item.num}</span>
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            className="flex h-8 w-8 items-center justify-center border border-line text-sm lg:hidden"
          >
            ☰
          </button>
          <p className="hidden font-mono text-xs text-muted sm:block">
            Ex-Lend / {pathname}
          </p>
        </div>
        <Link
          href="/settings"
          title="设置"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper text-xs font-semibold"
        >
          设
        </Link>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-52 shrink-0 border-r border-line bg-surface lg:block">
          {nav}
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-30 lg:hidden">
            <div
              className="absolute inset-0 bg-ink/40"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="absolute right-2 top-3 border border-line px-2 py-1 font-mono text-xs"
              >
                关闭
              </button>
              {nav}
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}