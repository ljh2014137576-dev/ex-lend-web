"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { apiCurrentProfile, apiSystemLogo } from "@/lib/supabase-api";

// 头像签名 URL 会话内缓存（约 4 分钟）：跨页面/组件复用同一 URL，命中浏览器缓存，避免闪动
const AVATAR_TTL = 240_000;
const cacheKey = (path: string) => "avatar-signed:" + path;

export function cachedAvatar(path: string): string | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url: string; exp: number };
    return parsed && parsed.exp > Date.now() ? parsed.url : null;
  } catch {
    return null;
  }
}

export function storeAvatar(path: string, url: string) {
  try {
    sessionStorage.setItem(cacheKey(path), JSON.stringify({ url, exp: Date.now() + AVATAR_TTL }));
  } catch {
    // 忽略缓存配额等异常
  }
}

/**
 * 当前登录用户的真实头像（users.avatar_path → avatars 桶签名 URL）。
 * 优先用会话缓存；新 URL 预加载完成后再替换，避免闪烁。
 * AppShell 常驻，跨页面切换不重新加载 → 不闪。
 */
export function useUserAvatar() {
  const { session } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!session) {
      setAvatarUrl("");
      return;
    }
    let mounted = true;
    const load = async () => {
      try {
        const p = await apiCurrentProfile(session.user.id);
        if (!mounted || !p) return;
        const avatarPath = p.avatarPath;
        if (!avatarPath) return;
        const cached = cachedAvatar(avatarPath);
        if (cached) setAvatarUrl(cached);
        const { data } = await supabase.storage.from("avatars").createSignedUrl(avatarPath, 300);
        if (!mounted || !data) return;
        const signed = data.signedUrl;
        if (!signed) return;
        storeAvatar(avatarPath, signed);
        const img = new Image();
        img.onload = () => {
          if (mounted) setAvatarUrl(signed);
        };
        img.src = signed;
      } catch {
        // 头像加载失败静默处理
      }
    };
    void load();
    // 头像更新事件：设置页上传后触发，立即刷新顶栏头像
    const onAvatarUpdated = () => setVersion((v) => v + 1);
    window.addEventListener("avatar-updated", onAvatarUpdated);
    return () => {
      mounted = false;
      window.removeEventListener("avatar-updated", onAvatarUpdated);
    };
  }, [session, version]);

  return avatarUrl;
}

/**
 * 系统 Logo（system_setting.system_logo_path → avatars 桶签名 URL）。
 * 带会话缓存 + 预加载，避免闪烁；无 Logo 时返回空串（由调用方显示占位）。
 */
export function useSystemLogo() {
  const { session } = useAuth();
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    if (!session) {
      setLogoUrl("");
      return;
    }
    let mounted = true;
    apiSystemLogo().then((path) => {
      if (!mounted || !path) return;
      if (/^https?:\/\//i.test(path)) {
        setLogoUrl(path);
        return;
      }
      const cached = cachedAvatar(path);
      if (cached) setLogoUrl(cached);
      supabase.storage
        .from("avatars")
        .createSignedUrl(path, 900)
        .then(({ data }) => {
          if (!mounted || !data) return;
          const signed = data.signedUrl;
          if (!signed) return;
          storeAvatar(path, signed);
          const img = new Image();
          img.onload = () => {
            if (mounted) setLogoUrl(signed);
          };
          img.src = signed;
        });
    });
    return () => {
      mounted = false;
    };
  }, [session]);

  return logoUrl;
}
