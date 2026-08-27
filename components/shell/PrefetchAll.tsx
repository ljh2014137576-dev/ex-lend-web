"use client";

import { useEffect } from "react";
import { useDataStore } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { useBoot } from "@/lib/boot";
import {
  apiCustomers,
  apiEmployees,
  apiProducts,
  apiCategories,
  apiOrders,
  apiPayouts,
  apiWalletLedgers,
} from "@/lib/supabase-api";
import {
  CUSTOMERS,
  EMPLOYEES,
  PRODUCTS,
  CATEGORIES,
  ORDERS,
  WALLET_LEDGERS,
} from "@/lib/mock-data";

type Job = [string, () => Promise<unknown[] | null>, unknown[]];

// 高频访问资源：登录后预取（工作台/收银/订单/客户/员工/商品/财务），其余资源由页面挂载时 useResource 按需拉取
const JOBS: Job[] = [
  ["customers", apiCustomers, CUSTOMERS],
  ["employees", apiEmployees, EMPLOYEES],
  ["products", apiProducts, PRODUCTS],
  ["categories", apiCategories, CATEGORIES],
  ["orders", apiOrders, ORDERS],
  ["payouts", apiPayouts, []],
  ["walletLedgers", apiWalletLedgers, WALLET_LEDGERS],
];

export function PrefetchAll() {
  const store = useDataStore();
  const { session } = useAuth();
  const { setProgress, markReady } = useBoot();

  useEffect(() => {
    const has = !!session;
    // 安全超时：优先加载最长等待 8s，避免启动界面因请求卡住而永久遮挡
    const safety = window.setTimeout(() => markReady(), 8_000);
    let done = 0;
    (async () => {
      // 1) 优先加载高频资源（并行，逐个更新进度条；串行曾导致首次切页等 3-5s）
      await Promise.all(
        JOBS.map(async ([key, fetcher, fallback]) => {
          await store.load(key, fetcher, fallback, has);
          done += 1;
          setProgress((done / JOBS.length) * 100);
        }),
      );
      setProgress(100);
      // 2) 高频数据就绪 → 隐藏启动加载界面
      markReady();
      // 3) 登录后补齐过期/未拉数据（非 force，不覆盖脏数据；已新鲜数据跳过，不重复请求）
      if (has) {
        void store.refreshAll(true, false);
      }
      window.clearTimeout(safety);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return null;
}