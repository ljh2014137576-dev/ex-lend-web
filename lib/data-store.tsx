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
  // 本地被 mutate 过、不应被后台刷新覆盖的资源集合
  const dirtyKeys = useRef<Set<string>>(new Set());

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
        [key]: {
          // 真实会话下 fetch 失败不写入 mock 兜底；已有旧数据则保留，否则为空数组
          data: hasSession ? (r[key]?.data ?? []) : fallback,
          real: hasSession ? (r[key]?.real ?? false) : false,
          loaded: true,
          error: e instanceof Error ? e.message : String(e),
        },
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
    // 本地被 mutate 过且已有数据：直接返回现有状态，不自动重拉，避免覆盖本地修改
    if (existing && existing.loaded && (dirtyKeys.current.has(key) || !staleFallback)) return existing;
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
            [key]: {
              // 真实会话下 fetch 失败不写入 mock 兜底；已有旧数据则保留，否则为空数组
              data: hasSession ? (r[key]?.data ?? []) : fallback,
              real: hasSession ? (r[key]?.real ?? false) : false,
              loaded: true,
              error: e instanceof Error ? e.message : String(e),
            },
          }));
        } finally {
          delete inflight.current[key];
        }
      })();
    }
    return existing ?? { data: [], real: false, loaded: false, error: null };
  };

  const mutate: Store["mutate"] = (key, updater) => {
    dirtyKeys.current.add(key); // 标记本地被 mutate，后台刷新不应覆盖
    setResources((r) => {
      const cur = r[key];
      return { ...r, [key]: { ...cur, data: updater(cur?.data ?? []) } };
    });
  };

  const invalidate: Store["invalidate"] = (key) => {
    dirtyKeys.current.delete(key); // 失效时同时清除 dirty 标记
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
      const refreshed: string[] = [];
      await Promise.all(
        keys.map(async (key) => {
          if (inflight.current[key]) return; // 该 key 正在首载，跳过本次刷新
          if (!force && dirtyKeys.current.has(key)) return; // 非强制刷新：本地被 mutate 过的 key 跳过，不覆盖本地修改
          if (!force && resources[key]?.real) return; // 非强制刷新：已新鲜的真实数据跳过，避免页面加载时重复请求
          const entry = registry.current[key];
          try {
            const rows = await entry.fetcher();
            const ok = Array.isArray(rows);
            setResources((r) => ({
              ...r,
              [key]: { data: ok ? rows : [], real: ok, loaded: true, error: ok ? null : "查询返回为空（可能 RLS 权限不足）" },
            }));
            refreshed.push(key); // 本次刷新成功，后续可清除该 key 的 dirty 标记
          } catch (e) {
            // 刷新失败：保留旧缓存，仅记录错误，不影响展示；真实会话下不写入 mock 兜底
            setResources((r) => ({
              ...r,
              [key]: {
                data: hasSession ? (r[key]?.data ?? []) : entry.fallback,
                real: hasSession ? (r[key]?.real ?? false) : false,
                loaded: true,
                error: e instanceof Error ? e.message : String(e),
              },
            }));
          }
        }),
      );
      // force 刷新成功后，清除本次已成功刷新 key 的 dirty 标记（本地修改已被服务器数据覆盖）
      if (force) {
        for (const k of refreshed) dirtyKeys.current.delete(k);
      }
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