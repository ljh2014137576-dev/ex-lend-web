"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { TODOS, EMPLOYEES, type Todo } from "@/lib/mock-data";
import { apiTodos, apiEmployees } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

const STATUS: Record<string, { tone: "neutral" | "active" | "warn" | "danger" | "accent"; label: string }> = {
  pending: { tone: "neutral", label: "待处理" },
  in_progress: { tone: "accent", label: "进行中" },
  completed: { tone: "active", label: "已完成" },
};

export default function TodosPage() {
  const { session } = useAuth();
  const { data: todos, real, mutate: setTodos } = useResource<Todo>("todos", apiTodos, TODOS);
  const { data: employees } = useResource("employees", apiEmployees, EMPLOYEES);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", mentions: [] as string[] });

  const setStatus = (id: string, status: Todo["status"]) =>
    setTodos((p) => p.map((t) => (t.id === id ? { ...t, status, updatedAt: new Date().toLocaleString("zh-CN") } : t)));

  const create = async () => {
    if (!form.title.trim()) return;
    const optimisticId = "tmp-" + Date.now();
    const optimistic: Todo = {
      id: optimisticId,
      title: form.title.trim(),
      content: form.content.trim(),
      status: "pending",
      mentions: form.mentions,
      createdBy: "灰晨",
      updatedAt: new Date().toLocaleString("zh-CN"),
    };
    // 先入缓存展示，后异步写库；失败回滚并提示
    setTodos((p) => [optimistic, ...p]);
    setOpen(false);
    setForm({ title: "", content: "", mentions: [] });

    if (session) {
      const { data, error } = await supabase
        .from("todo_item")
        .insert([
          {
            title: optimistic.title,
            content: optimistic.content,
            status: "pending",
            mentioned_user_ids: [],
          },
        ])
        .select("id")
        .single();
      if (error || !data) {
        setTodos((prev) => prev.filter((x) => x.id !== optimisticId));
        window.alert("创建失败：" + (error?.message ?? "未知错误"));
        return;
      }
      setTodos((prev) => prev.map((x) => (x.id === optimisticId ? { ...x, id: data.id } : x)));
    }
  };

  const toggleMention = (name: string) =>
    setForm((f) => ({
      ...f,
      mentions: f.mentions.includes(name) ? f.mentions.filter((x) => x !== name) : [...f.mentions, name],
    }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="待办" meta={`/todos · ${todos.length} 条${real ? " · 真实数据" : "（Mock）"}`} />
        <Button size="sm" onClick={() => setOpen(true)}>新建待办</Button>
      </div>

      <Panel title="待办列表">
        <ul className="divide-y divide-line">
          {todos.map((t) => {
            const s = STATUS[t.status];
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.content && <p className="mt-0.5 text-xs text-muted">{t.content}</p>}
                  <p className="mt-1 font-mono text-[10px] text-muted">
                    {t.createdBy} · {t.updatedAt}
                    {t.mentions.length > 0 && ` · @${t.mentions.join(" @")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusDot tone={s.tone} label={s.label} />
                  {t.status !== "pending" && <Button size="sm" variant="ghost" onClick={() => setStatus(t.id, "pending")}>待处理</Button>}
                  {t.status !== "in_progress" && <Button size="sm" variant="ghost" onClick={() => setStatus(t.id, "in_progress")}>进行中</Button>}
                  {t.status !== "completed" && <Button size="sm" variant="secondary" onClick={() => setStatus(t.id, "completed")}>完成</Button>}
                </div>
              </li>
            );
          })}
          {todos.length === 0 && <li className="py-8 text-center font-mono text-xs text-muted">暂无待办</li>}
        </ul>
      </Panel>

      <Modal open={open} title="新建待办" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">标题 *</span>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="待办标题" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">内容</span>
            <Input value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="补充说明" />
          </label>
          <div className="space-y-1">
            <span className="font-mono text-[11px] text-muted">@ 提及</span>
            <div className="flex flex-wrap gap-1">
              {["灰晨", ...employees.map((e) => e.name)].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleMention(name)}
                  aria-pressed={form.mentions.includes(name)}
                  className={[
                    "rounded-md px-2 py-1 text-xs transition-colors",
                    form.mentions.includes(name) ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2",
                  ].join(" ")}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create}>创建</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}