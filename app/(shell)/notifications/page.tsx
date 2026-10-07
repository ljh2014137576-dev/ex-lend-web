"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/StatusDot";
import { NOTIFICATIONS, type NotificationItem } from "@/lib/mock-data";
import { apiNotifications, apiMarkNotificationsRead } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";

export default function NotificationsPage() {
  const { data: items, real, mutate: setItems } = useResource<NotificationItem>("notifications", apiNotifications, NOTIFICATIONS);
  const { session, mockRole } = useAuth();
  const canWrite = !!session || (MOCK_LOGIN_ENABLED && !!mockRole);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const request = useRef(false);
  const unread = items.filter((n) => !n.read).length;

  const markRead = async (ids: string[]) => {
    if (!canWrite) return setActionError("登录状态已失效，请重新登录后操作");
    if (request.current || ids.length === 0) return;
    if (session && !real) return setActionError("通知数据未加载，请刷新后重试");
    request.current = true;
    setSaving(true);
    setActionError(null);
    try {
      const confirmed = new Set(session ? await apiMarkNotificationsRead(session.user.id, ids) : ids);
      setItems((previous) => previous.map((item) => confirmed.has(item.id) ? { ...item, read: true } : item));
      if (confirmed.size < ids.length) setActionError("部分通知状态已变化，请刷新查看最新结果");
    } catch (error) {
      setActionError("已读状态保存失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      request.current = false;
      setSaving(false);
    }
  };
  const markAll = () => markRead(items.filter((item) => !item.read).map((item) => item.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="通知" meta={`/notifications · ${unread} 条未读${real ? " · 真实数据" : "（Mock）"}`} />
        <Button size="sm" variant="secondary" onClick={markAll} disabled={saving || unread === 0 || !canWrite}>{saving ? "保存中…" : "全部已读"}</Button>
      </div>
      {actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}

      <Panel title="通知列表">
        <ul className="divide-y divide-line">
          {items.map((n) => (
            <li key={n.id} className={["py-3", !n.read ? "bg-surface2/60" : ""].join(" ")}>
              <div className="flex flex-wrap items-center gap-2">
                {!n.read && <span className="h-2 w-2 rounded-full bg-accent" />}
                <StatusDot tone={n.type === "todo_mention" ? "accent" : "active"} label={n.type === "todo_mention" ? "@提及" : "VIP 升级"} />
                <p className="text-sm font-medium">{n.title}</p>
              </div>
              <p className="mt-1 text-xs text-muted">{n.content}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] text-muted">{n.at}</p>
                {!n.read && <Button size="sm" variant="ghost" disabled={saving || !canWrite} onClick={() => markRead([n.id])}>标为已读</Button>}
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="py-8 text-center font-mono text-xs text-muted">暂无通知</li>}
        </ul>
      </Panel>
    </div>
  );
}
