"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { isAuthed, mockLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthed) router.replace("/");
  }, [isAuthed, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Ex-Lend</h1>
          <p className="mt-1 font-mono text-xs text-muted">员工提成与客户账户管理系统</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 border border-line bg-surface p-6">
          <div className="space-y-1">
            <label htmlFor="email" className="font-mono text-xs text-muted">邮箱 / EMAIL</label>
            <input id="email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none transition-colors focus:border-ink"
              placeholder="you@example.com" />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="font-mono text-xs text-muted">密码 / PASSWORD</label>
            <input id="password" type="password" required autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none transition-colors focus:border-ink"
              placeholder="••••••••" />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-50">
            {busy ? "登录中…" : "登录"}
          </button>
        </form>

        <p className="mt-4 text-center font-mono text-[11px] text-muted">
          使用 Supabase Auth 账号登录（邮箱 + 密码）
        </p>

        <div className="mt-6 border-t border-line pt-4">
          <p className="mb-2 text-center font-mono text-[11px] text-muted">测试模式（免 Supabase 账号）</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => mockLogin("boss")}
              className="rounded-md border border-line bg-paper px-3 py-2 text-xs transition-colors hover:bg-surface2">
              以老板进入
            </button>
            <button type="button" onClick={() => mockLogin("manager")}
              className="rounded-md border border-line bg-paper px-3 py-2 text-xs transition-colors hover:bg-surface2">
              以管理岗进入
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}