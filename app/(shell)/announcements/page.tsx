"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { ANNOUNCEMENTS, type Announcement } from "@/lib/mock-data";
import { apiAnnouncements } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { BossOnly } from "@/components/business/RequireRole";

export default function AnnouncementsPage() {
  const { data: items, mutate: setItems } = useResource<Announcement>("announcements", apiAnnouncements, ANNOUNCEMENTS);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", pinned: false });

  const create = () => {
    if (!form.title.trim()) return;
    setItems((p) => [
      { id: "a" + Date.now(), title: form.title.trim(), content: form.content.trim(), pinned: form.pinned, createdBy: "灰晨", updatedAt: new Date().toLocaleString("zh-CN") },
      ...p,
    ]);
    setOpen(false);
    setForm({ title: "", content: "", pinned: false });
  };

  const togglePin = (id: string) =>
    setItems((p) => p.map((a) => (a.id === id ? { ...a, pinned: !a.pinned } : a)));

  const sorted = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="公告" meta={`/announcements · ${items.length} 条（Mock）· 仅老板可发布`} />
        <BossOnly fallback={<span className="font-mono text-[11px] text-muted">仅老板可发布</span>}><Button size="sm" onClick={() => setOpen(true)}>发布公告</Button></BossOnly>
      </div>

      <Panel title="公告列表" meta="置顶优先">
        <ul className="divide-y divide-line">
          {sorted.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                {a.pinned && <StatusDot tone="accent" label="置顶" />}
                <p className="text-sm font-medium">{a.title}</p>
              </div>
              {a.content && <p className="mt-1 text-xs text-muted">{a.content}</p>}
              <p className="mt-1 font-mono text-[10px] text-muted">{a.createdBy} · {a.updatedAt}</p>
              <div className="mt-2">
                <Button size="sm" variant="ghost" onClick={() => togglePin(a.id)}>{a.pinned ? "取消置顶" : "置顶"}</Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Modal open={open} title="发布公告" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">标题 *</span>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="公告标题" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">内容</span>
            <Input value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="公告内容" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="h-4 w-4 accent-black" />
            <span className="text-xs">置顶</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create}>发布</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}