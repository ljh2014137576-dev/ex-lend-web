"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { NOTES, type Note } from "@/lib/mock-data";
import { apiNotes } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export default function NotesPage() {
  const { data: notes, real, mutate: setNotes } = useResource<Note>("notes", apiNotes, NOTES);
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", published: false });

  const create = async () => {
    if (!form.title.trim()) return;
    const optimisticId = "tmp-" + Date.now();
    const optimistic: Note = {
      id: optimisticId,
      title: form.title.trim(),
      content: form.content.trim(),
      published: form.published,
      createdBy: "灰晨",
      updatedAt: new Date().toLocaleString("zh-CN"),
    };
    // 先入缓存展示，后台写库；失败回滚并提示
    setNotes((p) => [optimistic, ...p]);
    setOpen(false);
    setForm({ title: "", content: "", published: false });

    if (session) {
      const { data, error } = await supabase
        .from("note")
        .insert([
          {
            title: optimistic.title,
            content: optimistic.content,
            is_published: optimistic.published,
          },
        ])
        .select("id")
        .single();
      if (error || !data) {
        setNotes((prev) => prev.filter((x) => x.id !== optimisticId));
        window.alert("创建失败：" + (error?.message ?? "未知错误"));
        return;
      }
      setNotes((prev) => prev.map((x) => (x.id === optimisticId ? { ...x, id: data.id } : x)));
    }
  };

  const togglePublished = (id: string) =>
    setNotes((p) => p.map((n) => (n.id === id ? { ...n, published: !n.published } : n)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="笔记" meta={`/notes · ${notes.length} 条${real ? " · 真实数据" : "（Mock）"} · 发布后全员可见`} />
        <Button size="sm" onClick={() => setOpen(true)}>新建笔记</Button>
      </div>

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
              <div className="mt-2">
                <Button size="sm" variant="ghost" onClick={() => togglePublished(n.id)}>{n.published ? "改为私有" : "发布"}</Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Modal open={open} title="新建笔记" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">标题 *</span>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="笔记标题" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">内容</span>
            <Input value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="笔记内容" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} className="h-4 w-4 accent-black" />
            <span className="text-xs">发布（全员可见）</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create}>创建</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}