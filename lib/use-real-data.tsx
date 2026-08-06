"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

export function useRealData<T>(
  fetcher: () => Promise<T[] | null>,
  fallback: T[],
): { data: T[]; real: boolean; loading: boolean; error: string | null; pending: boolean; setData: (updater: T[] | ((prev: T[]) => T[])) => void } {
  const { session } = useAuth();
  // 不再预填 Mock：真实会话下避免"假数据闪现"，无会话时才用 fallback
  const [data, setDataState] = useState<T[]>([]);
  const [real, setReal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!session) {
        if (mounted) {
          setDataState(fallback);
          setLoading(false);
        }
        return;
      }
      try {
        const rows = await fetcher();
        if (mounted && Array.isArray(rows)) {
          setData(rows);
          setReal(true);
          setError(null);
        } else if (mounted) {
          setError("查询返回为空（可能 RLS 权限不足）");
        }
      } catch (e) {
        if (mounted) {
          // eslint-disable-next-line no-console
          console.error("[real-data]", e);
          setDataState([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const setData = (updater: T[] | ((prev: T[]) => T[])) => {
    setDataState(updater);
  };

  // pending = 真实会话下正在加载（页面可显示"加载中"）
  const pending = !!session && loading && !real;

  return { data, real, loading, error, pending, setData };
}

export function DataSourceBadge({ real, error }: { real: boolean; error?: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={[
          "rounded-md px-1.5 py-0.5 font-mono text-[10px]",
          real ? "bg-success text-success-ink" : "bg-surface2 text-muted",
        ].join(" ")}
      >
        {real ? "真实数据" : "Mock"}
      </span>
      {error && (
        <span className="rounded-md bg-danger px-1.5 py-0.5 font-mono text-[10px] text-danger-ink" title={error}>
          拉取失败：{error.slice(0, 60)}
        </span>
      )}
    </span>
  );
}