"use client";

import { useEffect } from "react";
import { useDataStore } from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
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

// 进入系统即全量预取到缓存，点击页面时零等待
export function PrefetchAll() {
  const store = useDataStore();
  const { session } = useAuth();

  useEffect(() => {
    const has = !!session;
    const jobs: [string, () => Promise<unknown[] | null>, unknown[]][] = [
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
    jobs.forEach(([key, fetcher, fallback]) => {
      store.ensure(key, fetcher as () => Promise<unknown[] | null>, fallback as unknown[], has);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return null;
}