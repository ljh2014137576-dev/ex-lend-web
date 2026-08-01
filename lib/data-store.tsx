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
  mutate: (key: string, updater: (prev: unknown[]) => unknown[]) => void;
  invalidate: (key: string) => void;
};

const DataContext = createContext<Store | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [resources, setResources] = useState<Record<string, ResourceState>>({});
  const inflight = useRef<Record<string, boolean>>({});

  const ensure: Store["ensure"] = (key, fetcher, fallback, hasSession) => {
    const existing = resources[key];
    if (existing && existing.loaded) return existing;
    if (!inflight.current[key] && !existing) {
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

  return (
    <DataContext.Provider value={{ resources, ensure, mutate, invalidate }}>{children}</DataContext.Provider>
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