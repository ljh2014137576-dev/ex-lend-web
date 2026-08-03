"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";

type ResourceState = {
  data: unknown[];
  real: boolean;
  loaded: boolean;
  error: string | null;
};

type Store = {
  resources: Record<string, ResourceState>;
  ensure: <T>(key: string, fetcher: () => Promise<T[] | null>, fallback: T[], hasSession: boolean) => ResourceState;
  load: <T>(key: string, fetcher: () => Promise<T[] | null>, fallback: T[], hasSession: boolean) => Promise<void>;
  mutate: (key: string, updater: (prev: unknown[]) => unknown[]) => void;
  invalidate: (key: string) => void;
  refreshAll: (hasSession: boolean, force?: boolean) => Promise<void>;
};

const DataContext = createContext<Store | null>(null);

type RegistryEntry = { fetcher: () => Promise<unknown[] | null>; fallback: unknown[] };

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [resources, setResources] = useState<Record<string, ResourceState>>({});
  const inflight = useRef<Record<string, boolean>>({});
  const registry = useRef<Record<string, RegistryEntry>>({});
  const refreshing = useRef(false);

  const doFetch = async (key: string, fetcher: () => Promise<unknown[] | null>, fallback: unknown[], hasSession: boolean) => {
    try {
      if (!hasSession) {
        setResources((r) => ({ ...r, [key]: { data: fallback, real: false, loaded: true, error: null } }));
        return;
      }
      const rows = await fetcher();
      const ok = Array.isArray(rows);
      setResources((r) => ({
        ...r,
        [key]: { data: ok ? rows : [], real: ok, loaded: true, error: ok ? null : "查询返回为空（可能 RLS 权限不足）" },
      }));
    } catch (e) {
      setResources((r) => ({
        ...r,
        [key]: { data: fallback, real: false, loaded: true, error: e instanceof Error ? e.message : String(e) },
      }));
    }
  };

  const load: Store["load"] = (key, fetcher, fallback, hasSession) => {
    registry.current[key] = { fetcher: fetcher as () => Promise<unknown[] | null>, fallback: fallback as unknown[] };
    if (inflight.current[key]) return Promise.resolve();
    inflight.current[key] = true;
    return doFetch(key, fetcher as () => Promise<unknown[] | null>, fallback as unknown[], hasSession).finally(() => {
      delete inflight.current[key];
    });
  };

  const ensure: Store["ensure"] = (key, fetcher, fallback, hasSession) => {
    registry.current[key] = { fetcher: fetcher as () => Promise<unknown[] | null>, fallback: fallback as unknown[] };
    const existing = resources[key];
    // 页面刷新后若有会话，但缓存仍是“无会话时写入的 Mock 兜底”，视为过期，强制重拉真实数据
    const staleFallback = !!existing && existing.loaded && hasSession && !existing.real;
    if (existing && existing.loaded && !staleFallback) return existing;
    if (!inflight.current[key] && (!existing || staleFallback)) {
      inflight.current[key] = true;
      (async () => {
        try {
          if (!hasSession) {
            setResources((r) => ({ ...r, [key]: { data: fallback, real: false, loaded: true, error: null } }));
            return;
          }
          const rows = await fetcher();
          const ok = Array.isArray(rows);
          setResources((r) => ({
            ...r,
            [key]: {
              data: ok ? rows : [],
              real: ok,
              loaded: true,
              error: ok ? null : "查询返回为空（可能 RLS 权限不足）",
            },
          }));
        } catch (e) {
          setResources((r) => ({
            ...r,
            [key]: { data: fallback, real: false, loaded: true, error: e instanceof Error ? e.message : String(e) },
          }));
        } finally {
          delete inflight.current[key];
        }
      })();
    }
    return existing ?? { data: [], real: false, loaded: false, error: null };
  };

  const mutate: Store["mutate"] = (key, updater) => {
    setResources((r) => {
      const cur = r[key];
      return { ...r, [key]: { ...cur, data: updater(cur?.data ?? []) } };
    });
  };

  const invalidate: Store["invalidate"] = (key) => {
    setResources((r) => {
      const next = { ...r };
      delete next[key];
      return next;
    });
  };

  // 后台全量刷新：静默重新拉取所有已注册资源并覆盖缓存，保持 loaded=true（无加载闪烁）；失败保留旧数据。
  const refreshAll: Store["refreshAll"] = async (hasSession, force = false) => {
    if (!hasSession || refreshing.current) return;
    refreshing.current = true;
    try {
      const keys = Object.keys(registry.current);
      await Promise.all(
        keys.map(async (key) => {
          if (inflight.current[key]) return; // 该 key 正在首载，跳过本次刷新
          if (!force && resources[key]?.real) return; // 非强制刷新：已新鲜的真实数据跳过，避免页面加载时重复请求
          const entry = registry.current[key];
          try {
            const rows = await entry.fetcher();
            const ok = Array.isArray(rows);
            setResources((r) => ({
              ...r,
              [key]: { data: ok ? rows : [], real: ok, loaded: true, error: ok ? null : "查询返回为空（可能 RLS 权限不足）" },
            }));
          } catch (e) {
            // 刷新失败：保留旧缓存，仅记录错误，不影响展示
            setResources((r) => ({
              ...r,
              [key]: {
                ...(r[key] ?? { data: entry.fallback, real: false, loaded: true, error: null }),
                error: e instanceof Error ? e.message : String(e),
              },
            }));
          }
        }),
      );
    } finally {
      refreshing.current = false;
    }
  };

  return (
    <DataContext.Provider value={{ resources, ensure, load, mutate, invalidate, refreshAll }}>{children}</DataContext.Provider>
  );
}

export function useResource<T>(
  key: string,
  fetcher: () => Promise<T[] | null>,
  fallback: T[],
): {
  data: T[];
  real: boolean;
  loading: boolean;
  error: string | null;
  mutate: (updater: (prev: T[]) => T[]) => void;
  invalidate: () => void;
} {
  const store = useDataStore();
  const { session } = useAuth();

  useEffect(() => {
    store.ensure<T>(key, fetcher, fallback, !!session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, session]);

  const state = store.resources[key];
  return {
    data: (state?.data as T[]) ?? fallback,
    real: state?.real ?? false,
    loading: !state?.loaded,
    error: state?.error ?? null,
    mutate: (updater) => store.mutate(key, updater as (prev: unknown[]) => unknown[]),
    invalidate: () => store.invalidate(key),
  };
}

export function useDataStore() {
  const store = useContext(DataContext);
  if (!store) throw new Error("useDataStore must be used within DataProvider");
  return store;
}