"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StatusDot } from "@/components/ui/StatusDot";
import { NOTIFICATIONS, type NotificationItem } from "@/lib/mock-data";

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>(NOTIFICATIONS);
  const unread = items.filter((n) => !n.read).length;

  const markRead = (id: string) => setItems((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
  const markAll = () => setItems((p) => p.map((n) => ({ ...n, read: true })));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="通知" meta={`/notifications · ${unread} 条未读（Mock）`} />
        <Button size="sm" variant="secondary" onClick={markAll} disabled={unread === 0}>全部已读</Button>
      </div>

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
                {!n.read && <Button size="sm" variant="ghost" onClick={() => markRead(n.id)}>标为已读</Button>}
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="py-8 text-center font-mono text-xs text-muted">暂无通知</li>}
        </ul>
      </Panel>
    </div>
  );
}