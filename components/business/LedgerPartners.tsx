"use client";

import { useRef, useState } from "react";
import type { Order } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";

export function LedgerPartners({ orderId, currentEmployeeId, orders }: {
  orderId?: string | null;
  currentEmployeeId?: string | null;
  // Accept legacy props for source compatibility without inferring identity.
  orderNo?: string | null;
  currentEmployee?: string;
  orders: Order[];
}) {
  const order = orderId ? orders.find(o => o.id === orderId) : undefined;
  if (!order || !currentEmployeeId || !order.members.some(member => member.employeeId === currentEmployeeId)) {
    return <span className="font-mono text-[11px] text-muted">{orderId ? "协作关系未知" : "未保留订单关联"}</span>;
  }
  const partners = order.members.filter(member => member.employeeId !== currentEmployeeId).map(member => member.name);
  return <span className="font-mono text-[11px]">{partners.length ? `与 ${partners.join("、")} 完成` : "独立完成"}</span>;
}

export function LedgerProofLink({ path }: { path: string | null }) {
  const [link, setLink] = useState<{ path: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  if (!path) return <span className="text-muted">未保留</span>;
  if (link?.path === path) return <a className="text-accent underline" href={link.url} target="_blank" rel="noopener noreferrer">打开凭证</a>;
  const load = async () => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(null);
    try {
      const { data, error: signedError } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 300);
      if (signedError || !data?.signedUrl) throw new Error("凭证文件缺失或暂不可读取");
      setLink({ path, url: data.signedUrl });
    } catch { setError("凭证读取失败，可重试"); }
    finally { busy.current = false; setLoading(false); }
  };
  return <span><button type="button" className="text-accent underline" disabled={loading} onClick={() => void load()}>{loading ? "读取中…" : "查看凭证"}</button>{error && <span role="alert" className="ml-2 text-danger">{error}</span>}</span>;
}
