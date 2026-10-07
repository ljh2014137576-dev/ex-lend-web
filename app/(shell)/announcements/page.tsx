"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { ANNOUNCEMENTS, type Announcement } from "@/lib/mock-data";
import { apiAnnouncements, apiCreateAnnouncement, apiUpdateAnnouncementPin } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { BossOnly } from "@/components/business/RequireRole";
import { useAuth } from "@/lib/auth";

export default function AnnouncementsPage() {
  const { data: items, real, mutate: setItems } = useResource<Announcement>("announcements", apiAnnouncements, ANNOUNCEMENTS);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", pinned: false });
  const { session, isBoss, name } = useAuth();
  const [publishing, setPublishing] = useState(false);
  const [pinSaving, setPinSaving] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const publishingRef = useRef(false);
  const pinRequests = useRef(new Set<string>());

  const create = async () => {
    if (!isBoss || publishingRef.current) return;
    const input = { title: form.title.trim(), content: form.content.trim(), pinned: form.pinned };
    if (!input.title || input.title.length > 160) {
      setActionError("请输入 1 到 160 个字的公告标题");
      return;
    }
    publishingRef.current = true;
    setPublishing(true);
    setActionError(null);
    try {
      const saved = session
        ? await apiCreateAnnouncement(input)
        : { ...input, id: "a" + Date.now(), createdBy: name, updatedAt: new Date().toLocaleString("zh-CN") };
      setItems((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)]);
      setOpen(false);
      setForm({ title: "", content: "", pinned: false });
    } catch (error) {
      setActionError("发布失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  };

  const togglePin = async (id: string) => {
    if (!isBoss || pinRequests.current.has(id)) return;
    const item = items.find((row) => row.id === id);
    if (!item) return;
    if (session && !real) {
      setActionError("公告数据尚未加载完成，请刷新后重试");
      return;
    }
    pinRequests.current.add(id);
    setPinSaving((previous) => ({ ...previous, [id]: true }));
    setActionError(null);
    try {
      const saved = session ? await apiUpdateAnnouncementPin(id, !item.pinned) : { ...item, pinned: !item.pinned };
      setItems((previous) => previous.map((row) => row.id === id ? saved : row));
    } catch (error) {
      setActionError("置顶状态保存失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      pinRequests.current.delete(id);
      setPinSaving((previous) => ({ ...previous, [id]: false }));
    }
  };

  const sorted = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="公告" meta={`/announcements · ${items.length} 条${real ? " · 真实数据" : "（Mock）"} · 仅老板可发布`} />
          <BossOnly fallback={<span className="font-mono text-[11px] text-muted">仅老板可发布</span>}><Button size="sm" disabled={publishing} onClick={() => { setActionError(null); setOpen(true); }}>发布公告</Button></BossOnly>
      </div>
        {!open && actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}

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
                <BossOnly><div className="mt-2">
                  <Button size="sm" variant="ghost" disabled={pinSaving[a.id]} onClick={() => togglePin(a.id)}>{pinSaving[a.id] ? "保存中…" : a.pinned ? "取消置顶" : "置顶"}</Button>
                </div></BossOnly>
            </li>
          ))}
        </ul>
      </Panel>

        <Modal open={open && isBoss} title="发布公告" onClose={() => { if (!publishingRef.current) setOpen(false); }}>
        <div className="space-y-3">
            {actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">标题 *</span>
              <Input value={form.title} maxLength={160} disabled={publishing} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="公告标题" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">内容</span>
              <Input value={form.content} disabled={publishing} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="公告内容" />
          </label>
          <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.pinned} disabled={publishing} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="h-4 w-4 accent-black" />
            <span className="text-xs">置顶</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" disabled={publishing} onClick={() => setOpen(false)}>取消</Button>
              <Button disabled={publishing} onClick={create}>{publishing ? "发布中…" : "发布"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
