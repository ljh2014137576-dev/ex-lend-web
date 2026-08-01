"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusDot } from "@/components/ui/StatusDot";
import { Divider } from "@/components/ui/Divider";
import { SkinSettings } from "@/components/ui/SkinSettings";
import { FONTS, useSkin } from "@/lib/skin";
import { useProfile } from "@/lib/profile";

function SectionTitle({ shape, title, meta }: { shape: string; title: string; meta?: string }) {
  return (
    <header className="flex items-baseline gap-2 border-b border-line pb-2">
      <span className="text-sm" aria-hidden>{shape}</span>
      <h2 className="text-base font-semibold">{title}</h2>
      {meta && <p className="font-mono text-[11px] text-muted">{meta}</p>}
    </header>
  );
}

function FontSettings() {
  const { font, setFont } = useSkin();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FONTS.map((f) => (
        <button
          key={f.family || "default"}
          type="button"
          onClick={() => setFont(f.family)}
          aria-pressed={font === f.family}
          className={[
            "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors",
            font === f.family ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-surface2",
          ].join(" ")}
        >
          <span className="truncate text-sm" style={{ fontFamily: f.family ? `"${f.family}"` : undefined }}>
            {f.label}
          </span>
          <span className="font-mono text-[10px] opacity-60">Aa 中文 0123</span>
        </button>
      ))}
    </div>
  );
}

function ProfileSettings() {
  const { name, avatar, setName, setAvatar } = useProfile();
  const [draft, setDraft] = useState(name);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface2 text-xl">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="头像" className="h-full w-full object-cover" />
          ) : (
            <span>{name.slice(0, 1) || "?"}</span>
          )}
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            上传头像
          </Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <p className="mt-1 font-mono text-[10px] text-muted">头像保存在本机（Mock）</p>
        </div>
      </div>

      <label className="block space-y-1">
        <span className="font-mono text-[11px] text-muted">姓名</span>
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="你的姓名" />
          <Button onClick={() => setName(draft.trim())} disabled={!draft.trim()}>保存</Button>
        </div>
      </label>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-10">
      <PageHeader title="设置" meta="/settings · 个人信息 / 外观 / 控件预览" />

      <section id="profile" className="scroll-mt-16 space-y-6">
        <SectionTitle shape="○" title="个人信息" meta="姓名 · 头像" />
        <Panel title="个人信息">
          <ProfileSettings />
        </Panel>
      </section>

      <section id="appearance" className="scroll-mt-16 space-y-6">
        <SectionTitle shape="▢" title="外观" meta="界面主题 · 字体" />
        <Panel title="界面主题" meta="切换立即生效 · 保存到本机">
          <SkinSettings />
        </Panel>
        <Panel title="界面字体" meta="19 款自托管免费商用字体 · 选择覆盖当前皮肤默认">
          <FontSettings />
        </Panel>
      </section>

      <section id="preview" className="scroll-mt-16 space-y-6">
        <SectionTitle shape="△" title="控件预览" meta="当前皮肤 + 当前字体下的基础控件" />
        <Panel title="控件风格预览">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button>主操作</Button>
              <Button variant="secondary">次要操作</Button>
              <Button variant="ghost">幽灵按钮</Button>
              <Button variant="danger">危险操作</Button>
              <Button variant="secondary" size="sm">小号</Button>
            </div>
            <Divider />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="font-mono text-[11px] text-muted">输入框 / INPUT</span>
                <Input placeholder="请输入内容" />
              </label>
              <label className="block space-y-1.5">
                <span className="font-mono text-[11px] text-muted">禁用态 / DISABLED</span>
                <Input placeholder="不可用" disabled />
              </label>
            </div>
            <Divider />
            <div className="flex flex-wrap gap-5">
              <StatusDot tone="neutral" label="待处理" />
              <StatusDot tone="active" label="已完成" />
              <StatusDot tone="warn" label="待审核" />
              <StatusDot tone="danger" label="已撤销" />
              <StatusDot tone="accent" label="进行中" />
            </div>
            <Divider />
            <p className="font-mono text-[11px] text-muted">
              边距 · 圆角 · 阴影 · 描边 · 材质 · 尺寸 · 密度 · 动效 · 字体 —— 全部由皮肤/字体 token 控制。
            </p>
          </div>
        </Panel>
      </section>
    </div>
  );
}