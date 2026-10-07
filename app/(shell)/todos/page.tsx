"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/StatusDot";
import { TODOS, EMPLOYEES, type Todo } from "@/lib/mock-data";
import { apiTodos, apiEmployees, apiCreateTodo, apiUpdateTodoStatus } from "@/lib/supabase-api";
import { useResource } from "@/lib/data-store";
import { MOCK_LOGIN_ENABLED, useAuth } from "@/lib/auth";

const STATUS: Record<string, { tone: "neutral" | "active" | "warn" | "danger" | "accent"; label: string }> = {
  pending: { tone: "neutral", label: "待处理" },
  in_progress: { tone: "accent", label: "进行中" },
  completed: { tone: "active", label: "已完成" },
};

export default function TodosPage() {
  const { session, mockRole } = useAuth();
  const canWrite = !!session || (MOCK_LOGIN_ENABLED && !!mockRole);
  const { data: todos, real, mutate: setTodos } = useResource<Todo>("todos", apiTodos, TODOS);
  const { data: employees } = useResource("employees", apiEmployees, EMPLOYEES);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", mentions: [] as string[] });
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const createRequest = useRef(false);
  const statusRequests = useRef(new Set<string>());

  const setStatus = async (id: string, status: Todo["status"]) => {
    if (!canWrite) return setActionError("登录状态已失效，请重新登录后操作");
    if (statusRequests.current.has(id)) return;
    const current = todos.find((todo) => todo.id === id);
    if (!current) return;
    if (session && !real) return setActionError("待办数据未加载，请刷新后重试");
    statusRequests.current.add(id);
    setSaving((previous) => ({ ...previous, [id]: true }));
    setActionError(null);
    try {
      const saved = session ? await apiUpdateTodoStatus(id, status) : { ...current, status, updatedAt: new Date().toLocaleString("zh-CN") };
      setTodos((previous) => previous.map((todo) => todo.id === id ? saved : todo));
    } catch (error) {
      setActionError("待办状态保存失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      statusRequests.current.delete(id);
      setSaving((previous) => ({ ...previous, [id]: false }));
    }
  };

  const create = async () => {
    if (!canWrite) return setActionError("登录状态已失效，请重新登录后操作");
    if (createRequest.current || !form.title.trim()) return;
    createRequest.current = true;
    setCreating(true);
    setActionError(null);
    try {
      const input = { title: form.title.trim(), content: form.content.trim(), mentionedEmployeeNames: form.mentions };
      const saved: Todo = session ? await apiCreateTodo(input) : {
        ...input, id: "tmp-" + Date.now(), status: "pending", mentions: form.mentions,
        createdBy: "—", updatedAt: new Date().toLocaleString("zh-CN"),
      };
      setTodos((previous) => [saved, ...previous.filter((todo) => todo.id !== saved.id)]);
      setOpen(false);
      setForm({ title: "", content: "", mentions: [] });
    } catch (error) {
      setActionError("创建失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      createRequest.current = false;
      setCreating(false);
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
        <Button size="sm" disabled={creating || !canWrite} onClick={() => { setActionError(null); setOpen(true); }}>新建待办</Button>
      </div>
      {!open && actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}

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
                  {saving[t.id] && <span role="status" className="text-xs text-muted">保存中…</span>}
                  {t.status !== "pending" && <Button size="sm" variant="ghost" disabled={saving[t.id] || !canWrite} onClick={() => setStatus(t.id, "pending")}>待处理</Button>}
                  {t.status !== "in_progress" && <Button size="sm" variant="ghost" disabled={saving[t.id] || !canWrite} onClick={() => setStatus(t.id, "in_progress")}>进行中</Button>}
                  {t.status !== "completed" && <Button size="sm" variant="secondary" disabled={saving[t.id] || !canWrite} onClick={() => setStatus(t.id, "completed")}>完成</Button>}
                </div>
              </li>
            );
          })}
          {todos.length === 0 && <li className="py-8 text-center font-mono text-xs text-muted">暂无待办</li>}
        </ul>
      </Panel>

      <Modal open={open} title="新建待办" onClose={() => { if (!createRequest.current) setOpen(false); }}>
        <div className="space-y-3">
          {actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">标题 *</span>
            <Input value={form.title} maxLength={160} disabled={creating} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="待办标题" />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[11px] text-muted">内容</span>
            <Input value={form.content} disabled={creating} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="补充说明" />
          </label>
          <div className="space-y-1">
            <span className="font-mono text-[11px] text-muted">提及员工（仅记录，不发通知）</span>
            <div className="flex flex-wrap gap-1">
              {[...new Set(employees.map((employee) => employee.name))].map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={creating}
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
            <Button variant="secondary" disabled={creating} onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={creating} onClick={create}>{creating ? "创建中…" : "创建"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
