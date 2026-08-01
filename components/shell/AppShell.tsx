"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-sm transition-colors hover:bg-surface2 lg:hidden"
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
          className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper text-xs font-semibold transition-colors hover:bg-surface2"
        >
          设
        </Link>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-52 shrink-0 border-r border-line bg-sidebar lg:block">
          <Sidebar pathname={pathname} />
        </aside>

        {/* 移动端抽屉：滑入 + 滑出动画 */}
        <div className="fixed inset-0 z-30 lg:hidden" aria-hidden={!drawerOpen}>
          <div
            className={[
              "absolute inset-0 bg-overlay transition-opacity duration-[var(--transition-mid-v)]",
              drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
            ].join(" ")}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className={[
              "glass absolute inset-y-0 left-0 w-64 shadow-lg",
              "transition-[transform,visibility] ease-[cubic-bezier(0.22,1,0.36,1)]",
              drawerOpen ? "visible translate-x-0" : "invisible -translate-x-full",
            ].join(" ")}
            style={{
              transitionDuration: "var(--transition-mid-v), 0s",
              transitionDelay: drawerOpen ? "0s, 0s" : "0s, var(--transition-mid-v)",
            }}
          >
            <div className="flex justify-end border-b border-line p-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-md border border-line px-2 py-1 font-mono text-xs transition-colors hover:bg-surface2"
              >
                关闭
              </button>
            </div>
            <Sidebar pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>

        <main className="min-w-0 flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}