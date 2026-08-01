"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

export function useRealData<T>(
  fetcher: () => Promise<T[] | null>,
  fallback: T[],
): { data: T[]; real: boolean; loading: boolean; setData: (updater: T[] | ((prev: T[]) => T[])) => void } {
  const { session } = useAuth();
  const [data, setDataState] = useState<T[]>(fallback);
  const [real, setReal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!session) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const rows = await fetcher();
        if (mounted && rows) {
          setData(rows);
          setReal(true);
        }
      } catch {
        // 查询失败保留 mock
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

  return { data, real, loading, setData };
}

export function DataSourceBadge({ real }: { real: boolean }) {
  return (
    <span
      className={[
        "ml-2 rounded-md px-1.5 py-0.5 font-mono text-[10px]",
        real ? "bg-success text-success-ink" : "bg-surface2 text-muted",
      ].join(" ")}
    >
      {real ? "真实数据" : "Mock"}
    </span>
  );
}