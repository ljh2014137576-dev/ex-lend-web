"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

export function BossOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { isBoss } = useAuth();
  if (!isBoss) return <>{fallback ?? null}</>;
  return <>{children}</>;
}

export function NoPermission() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="border border-line bg-surface p-6 text-center">
        <p className="text-sm font-medium">无权限访问</p>
        <p className="mt-1 font-mono text-[11px] text-muted">此功能仅老板可用</p>
      </div>
    </div>
  );
}