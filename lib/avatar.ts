"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { apiCurrentProfile } from "@/lib/supabase-api";

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

  useEffect(() => {
    if (!session) {
      setAvatarUrl("");
      return;
    }
    let mounted = true;
    apiCurrentProfile(session.user.id).then((p) => {
      if (!mounted || !p) return;
      const avatarPath = p.avatarPath;
      if (!avatarPath) return;
      const cached = cachedAvatar(avatarPath);
      if (cached) setAvatarUrl(cached);
      supabase.storage
        .from("avatars")
        .createSignedUrl(avatarPath, 300)
        .then(({ data }) => {
          if (!mounted || !data) return;
          const signed = data.signedUrl;
          if (!signed) return;
          storeAvatar(avatarPath, signed);
          const img = new Image();
          img.onload = () => {
            if (mounted) setAvatarUrl(signed);
          };
          img.src = signed;
        });
    });
    return () => {
      mounted = false;
    };
  }, [session]);

  return avatarUrl;
}
