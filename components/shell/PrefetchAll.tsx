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
  apiTodos,
  apiAnnouncements,
  apiNotes,
  apiNotifications,
  apiGradeRules,
  apiVipDiscountRules,
  apiVipUpgradeRules,
  apiRechargePackages,
  apiWalletLedgers,
  apiCustomerLedgers,
  apiPayouts,
  apiDeleteLogs,
} from "@/lib/supabase-api";
import {
  CUSTOMERS,
  EMPLOYEES,
  PRODUCTS,
  CATEGORIES,
  ORDERS,
  TODOS,
  ANNOUNCEMENTS,
  NOTES,
  NOTIFICATIONS,
  GRADE_RULES,
  VIP_DISCOUNT_RULES,
  VIP_UPGRADE_RULES,
  RECHARGE_PACKAGES,
  WALLET_LEDGERS,
  CUSTOMER_LEDGERS,
  DELETE_LOGS,
} from "@/lib/mock-data";

type Job = [string, () => Promise<unknown[] | null>, unknown[]];

// 全部可能被访问的数据资源
const JOBS: Job[] = [
  ["customers", apiCustomers, CUSTOMERS],
  ["employees", apiEmployees, EMPLOYEES],
  ["products", apiProducts, PRODUCTS],
  ["categories", apiCategories, CATEGORIES],
  ["orders", apiOrders, ORDERS],
  ["todos", apiTodos, TODOS],
  ["announcements", apiAnnouncements, ANNOUNCEMENTS],
  ["notes", apiNotes, NOTES],
  ["notifications", apiNotifications, NOTIFICATIONS],
  ["gradeRules", apiGradeRules, GRADE_RULES],
  ["vipDiscounts", apiVipDiscountRules, VIP_DISCOUNT_RULES],
  ["vipUpgrades", apiVipUpgradeRules, VIP_UPGRADE_RULES],
  ["rechargePackages", apiRechargePackages, RECHARGE_PACKAGES],
  ["walletLedgers", apiWalletLedgers, WALLET_LEDGERS],
  ["customerLedgers", apiCustomerLedgers, CUSTOMER_LEDGERS],
  ["deleteLogs", apiDeleteLogs, DELETE_LOGS],
  ["payouts", apiPayouts, []],
];

// 常用页面所需数据：优先加载（工作台/收银/订单/客户/员工/商品/财务）
const PRIORITY_KEYS = ["customers", "employees", "products", "categories", "orders", "payouts", "walletLedgers"];

// 后台刷新间隔：5 分钟（低频率；需要更实时可调小）
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function PrefetchAll() {
  const store = useDataStore();
  const { session } = useAuth();
  const { setProgress, markReady } = useBoot();

  useEffect(() => {
    const has = !!session;
    const priority = JOBS.filter(([key]) => PRIORITY_KEYS.includes(key));
    const rest = JOBS.filter(([key]) => !PRIORITY_KEYS.includes(key));
    // 安全超时：优先加载最长等待 10s，避免启动界面因请求卡住而永久遮挡
    const safety = window.setTimeout(() => markReady(), 10_000);
    let done = 0;
    (async () => {
      // 1) 优先加载常用页面所需数据（逐个等待，驱动启动进度条）
      for (const [key, fetcher, fallback] of priority) {
        await store.load(key, fetcher, fallback, has);
        done += 1;
        setProgress((done / JOBS.length) * 100);
      }
      setProgress(100);
      // 2) 常用数据就绪 → 隐藏启动加载界面
      markReady();
      // 3) 后台继续加载其余数据（不阻塞交互）
      for (const [key, fetcher, fallback] of rest) {
        store.ensure(key, fetcher, fallback, has);
      }
      // 4) 页面（重新）加载兜底：重拉任何过期/未拉数据（已新鲜数据跳过，不重复请求）
      if (has) {
        void store.refreshAll(true, false);
      }
      window.clearTimeout(safety);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 后台定时全量刷新：低频率静默覆盖缓存，页面始终只读缓存、无感更新
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      void store.refreshAll(true, true);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return null;
}
