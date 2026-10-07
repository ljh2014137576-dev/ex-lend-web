"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { NOTES } from "@/lib/mock-data";
import { apiNotes, apiCreateNote, apiUpdateNotePublished, type NoteWithOwner } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";

export default function NotesPage() {
  const { data: notes, real, mutate: setNotes } = useResource<NoteWithOwner>("notes", apiNotes, NOTES);
  const { session, mockRole } = useAuth();
  const canMock = MOCK_LOGIN_ENABLED && !!mockRole;
  const canWrite = !!session || canMock;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", published: false });
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const createRequest = useRef(false);
  const publishRequests = useRef(new Set<string>());

  const create = async () => {
    if (!canWrite) return setActionError("登录状态已失效，请重新登录后操作");
    if (createRequest.current || !form.title.trim()) return;
    createRequest.current = true;
    setCreating(true);
    setActionError(null);
    try {
      const input = { title: form.title.trim(), content: form.content.trim(), published: form.published };
      const saved: NoteWithOwner = session ? await apiCreateNote(input) : {
        ...input, id: "tmp-" + Date.now(), createdBy: "—", updatedAt: new Date().toLocaleString("zh-CN"),
      };
      setNotes((previous) => [saved, ...previous.filter((note) => note.id !== saved.id)]);
      setOpen(false);
      setForm({ title: "", content: "", published: false });
    } catch (error) {
      setActionError("创建失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      createRequest.current = false;
      setCreating(false);
    }
  };

  const canPublish = (note: NoteWithOwner) => session ? note.createdById === session.user.id : canMock;
  const togglePublished = async (id: string) => {
    if (publishRequests.current.has(id)) return;
    const current = notes.find((note) => note.id === id);
    if (!current || !canPublish(current)) return;
    if (session && !real) return setActionError("笔记数据未加载，请刷新后重试");
    publishRequests.current.add(id);
    setSaving((previous) => ({ ...previous, [id]: true }));
    setActionError(null);
    try {
      const saved = session ? await apiUpdateNotePublished(id, !current.published) : { ...current, published: !current.published };
      setNotes((previous) => previous.map((note) => note.id === id ? saved : note));
    } catch (error) {
      setActionError("发布状态保存失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      publishRequests.current.delete(id);
      setSaving((previous) => ({ ...previous, [id]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="笔记" meta={`/notes · ${notes.length} 条${real ? " · 真实数据" : "（Mock）"} · 发布后全员可见`} />
        <Button size="sm" disabled={creating || !canWrite} onClick={() => { setActionError(null); setOpen(true); }}>新建笔记</Button>
      </div>
      {!open && actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}

      <Panel title="笔记列表">
        <ul className="divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                {n.published ? <StatusDot tone="active" label="已发布" /> : <StatusDot tone="neutral" label="私有" />}
                <p className="text-sm font-medium">{n.title}</p>
              </div>
              {n.content && <p className="mt-1 text-xs text-muted">{n.content}</p>}
              <p className="mt-1 font-mono text-[10px] text-muted">{n.createdBy} · {n.updatedAt}</p>
              {canPublish(n) && <div className="mt-2">
                <Button size="sm" variant="ghost" disabled={saving[n.id]} onClick={() => togglePublished(n.id)}>{saving[n.id] ? "保存中…" : n.published ? "改为私有" : "发布"}</Button>
              </div>}
            </li>
          ))}
        </ul>
      </Panel>

      <Modal open={open} title="新建笔记" onClose={() => { if (!createRequest.current) setOpen(false); }}>
        <div className="space-y-3">
          {actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">标题 *</span>
            <Input value={form.title} maxLength={160} disabled={creating} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="笔记标题" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">内容</span>
            <Input value={form.content} disabled={creating} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="笔记内容" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.published} disabled={creating} onChange={(e) => setForm({ ...form, published: e.target.checked })} className="h-4 w-4 accent-black" />
            <span className="text-xs">发布（全员可见）</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" disabled={creating} onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={creating} onClick={create}>{creating ? "创建中…" : "创建"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
