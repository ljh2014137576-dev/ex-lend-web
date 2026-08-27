"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type Role = "boss" | "manager";

const MOCK_KEY = "exlend-mock-auth";
// mock 登录开关：编译期判定，仅 NEXT_PUBLIC_ENABLE_MOCK_LOGIN=1 时启用
export const MOCK_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MOCK_LOGIN === "1";

function base64UrlDecode(s: string): string {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4 === 0 ? "" : "=".repeat(4 - (t.length % 4));
  return atob(t + pad);
}

function decodeRole(token?: string): Role | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(token.split(".")[1]));
    // 兼容多种 JWT 写入位置：custom_access_token_hook 顶层 user_role、app_metadata、claims 等
    const r =
      payload?.user_role?.role ??
      payload?.app_metadata?.user_role?.role ??
      payload?.app_metadata?.role ??
      payload?.user_metadata?.user_role?.role ??
      payload?.claims?.user_role?.role ??
      payload?.role ??
      null;
    return r === "boss" ? "boss" : r === "manager" ? "manager" : null;
  } catch {
    return null;
  }
}

type AuthContextValue = {
  session: Session | null;
  mockRole: Role | null;
  role: Role | null;
  isAuthed: boolean;
  isBoss: boolean;
  isManager: boolean;
  loading: boolean;
  name: string;
  signOut: () => Promise<void>;
  mockLogin: (role: Role) => void;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  mockRole: null,
  role: null,
  isAuthed: false,
  isBoss: false,
  isManager: false,
  loading: true,
  name: "",
  signOut: async () => {},
  mockLogin: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [mockRole, setMockRole] = useState<Role | null>(null);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      try {
        const m = MOCK_LOGIN_ENABLED ? localStorage.getItem(MOCK_KEY) : null;
        if (m) {
          const parsed = JSON.parse(m) as { role: Role };
          if (parsed.role === "boss" || parsed.role === "manager") setMockRole(parsed.role);
        }
      } catch {
        // ignore
      }
      setSession(data.session);
      if (data.session) {
        const { data: u } = await supabase
          .from("users")
          .select("role")
          .eq("id", data.session.user.id)
          .maybeSingle();
        if (u?.role === "boss" || u?.role === "manager") setUserRole(u.role);
      }
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) {
        supabase
          .from("users")
          .select("role")
          .eq("id", s.user.id)
          .maybeSingle()
          .then(({ data: u }) => {
            if (u?.role === "boss" || u?.role === "manager") setUserRole(u.role);
          });
      } else {
        setUserRole(null);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 真实会话优先（先查 users 表角色，再回退 JWT claim），无会话时用测试模式角色
  const role: Role | null = session ? (userRole ?? decodeRole(session.access_token) ?? mockRole) : mockRole;
  const isAuthed = !!session || !!mockRole;
  const name =
    mockRole === "boss" ? "灰晨" : mockRole === "manager" ? "管理岗" : session?.user?.email?.split("@")[0] ?? "";

  const signOut = async () => {
    localStorage.removeItem(MOCK_KEY);
    setMockRole(null);
    setSession(null);
    await supabase.auth.signOut();
  };

  const mockLogin = (r: Role) => {
    if (!MOCK_LOGIN_ENABLED) return;
    localStorage.setItem(MOCK_KEY, JSON.stringify({ role: r }));
    setMockRole(r);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        mockRole,
        role,
        isAuthed,
        isBoss: role === "boss",
        isManager: role === "manager",
        loading,
        name,
        signOut,
        mockLogin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}