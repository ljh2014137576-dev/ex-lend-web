"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthed, loading } = useAuth();
  const router = useRouter();
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    if (!loading && !isAuthed && !redirected) {
      setRedirected(true);
      router.replace("/login");
    }
  }, [loading, isAuthed, redirected, router]);

  if (loading) {
    return <div className="p-10 font-mono text-xs text-muted">加载中…</div>;
  }
  if (!isAuthed) return null;
  return <>{children}</>;
}