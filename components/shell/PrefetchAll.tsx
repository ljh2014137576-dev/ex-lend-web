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
} from "@/lib/supabase-api";
import { CUSTOMERS, EMPLOYEES, PRODUCTS, CATEGORIES, ORDERS } from "@/lib/mock-data";

// 进入任一页面即一口气预取核心资源到缓存；后续页面全部走缓存
export function PrefetchAll() {
  const store = useDataStore();
  const { session } = useAuth();

  useEffect(() => {
    const has = !!session;
    store.ensure("customers", apiCustomers, CUSTOMERS, has);
    store.ensure("employees", apiEmployees, EMPLOYEES, has);
    store.ensure("products", apiProducts, PRODUCTS, has);
    store.ensure("categories", apiCategories, CATEGORIES, has);
    store.ensure("orders", apiOrders, ORDERS, has);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return null;
}