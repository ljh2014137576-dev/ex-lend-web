"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusDot } from "@/components/ui/StatusDot";
import { Divider } from "@/components/ui/Divider";
import { SkinSettings } from "@/components/ui/SkinSettings";
import { FONTS, useSkin } from "@/lib/skin";
import { useProfile } from "@/lib/profile";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { apiCurrentProfile, apiUpdateMyName, uploadAvatar, rpcUpdateSelfAvatar } from "@/lib/supabase-api";
import Cropper, { type Area } from "react-easy-crop";
import { Modal } from "@/components/ui/Modal";

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

async function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

// 按裁切区域生成正方形 PNG（白底），供上传/预览
async function cropToBlob(src: string, px: Area): Promise<Blob | null> {
  const img = await loadImg(src);
  const canvas = document.createElement("canvas");
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

function ProfileSettings() {
  const { session } = useAuth();
  const { name: localName, avatar: localAvatar, setName: setLocalName, setAvatar: setLocalAvatar } = useProfile();
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 裁切状态
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);

  // 头像预加载后再替换，避免 <img src> 变化导致闪白
  const applyAvatar = (url: string) => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setAvatarUrl(url);
    img.src = url;
  };

  // 真实登录：从 users 表读取自己的姓名/头像；测试模式回退本地
  useEffect(() => {
    let mounted = true;
    if (session) {
      apiCurrentProfile(session.user.id).then((p) => {
        if (!mounted) return;
        if (p) {
          setName(p.name);
          setDraft(p.name);
        }
        if (p?.avatarPath) {
          const cacheKey = "avatar-signed:" + p.avatarPath;
          let cached: { url: string; exp: number } | null = null;
          try {
            const raw = sessionStorage.getItem(cacheKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && parsed.exp > Date.now()) cached = parsed;
            }
          } catch {
            cached = null;
          }
          if (cached) applyAvatar(cached.url);
          supabase.storage
            .from("avatars")
            .createSignedUrl(p.avatarPath, 300)
            .then(({ data }) => {
              if (!mounted || !data?.signedUrl) return;
              try {
                sessionStorage.setItem(cacheKey, JSON.stringify({ url: data.signedUrl, exp: Date.now() + 240_000 }));
              } catch {
                // 忽略缓存配额等异常
              }
              applyAvatar(data.signedUrl);
            });
        }
      });
    } else {
      setName(localName);
      setDraft(localName);
      setAvatarUrl(localAvatar);
    }
    return () => {
      mounted = false;
    };
  }, [session, localName, localAvatar]);

  const saveName = async () => {
    const v = draft.trim();
    if (!v) return;
    if (session) {
      const { error } = await apiUpdateMyName(session.user.id, v);
      if (error) return setMsg("保存失败：" + error.message);
      setName(v);
      setMsg("姓名已保存到账户");
    } else {
      setLocalName(v);
      setName(v);
      setMsg("已保存到本机（测试模式）");
    }
    window.setTimeout(() => setMsg(null), 2200);
  };

  // 选择图片 → 打开裁切
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(String(reader.result));
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCropPixels(null);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const closeCrop = () => {
    setCropOpen(false);
    setCropSrc(null);
    setCropPixels(null);
  };

  // 上传裁切结果
  const uploadAvatarBlob = async (blob: Blob) => {
    if (session) {
      try {
        const file = new File([blob], "avatar.png", { type: "image/png" });
        const path = await uploadAvatar(file, session.user.id);
        const { data: saved, error } = await rpcUpdateSelfAvatar(path);
        if (error || saved?.success !== true) return setMsg("头像保存失败：" + String(error?.message ?? saved?.message ?? "服务端未确认成功"));
        const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 300);
        if (data?.signedUrl) applyAvatar(data.signedUrl);
        window.dispatchEvent(new Event("avatar-updated")); // 顶栏头像立即刷新
        setMsg("头像已上传");
      } catch (err) {
        setMsg("上传失败：" + (err instanceof Error ? err.message : String(err)));
      }
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        setAvatarUrl(String(reader.result));
        setLocalAvatar(String(reader.result));
      };
      reader.readAsDataURL(blob);
      setMsg("头像已保存到本机（测试模式）");
    }
    window.setTimeout(() => setMsg(null), 2200);
  };

  const confirmCrop = async () => {
    if (!cropSrc || !cropPixels) return;
    try {
      const blob = await cropToBlob(cropSrc, cropPixels);
      if (!blob) return setMsg("裁切失败，请重试");
      closeCrop();
      await uploadAvatarBlob(blob);
    } catch (err) {
      setMsg("裁切失败：" + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface2 text-xl">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="头像" className="h-full w-full object-cover" />
          ) : (
            <span>{name.slice(0, 1) || "?"}</span>
          )}
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            上传头像
          </Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <p className="mt-1 font-mono text-[10px] text-muted">{session ? "真实登录：姓名/头像保存至账户 · 支持缩放裁切" : "测试模式：姓名/头像保存在本机 · 支持缩放裁切"}</p>
        </div>
      </div>

      {msg && <p className="font-mono text-[11px] text-muted">{msg}</p>}

      <label className="block space-y-1">
        <span className="font-mono text-[11px] text-muted">姓名</span>
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="你的姓名" className="min-w-0 flex-1" />
          <Button onClick={() => void saveName()} disabled={!draft.trim()} className="whitespace-nowrap">保存</Button>
        </div>
      </label>

      {/* 头像裁切弹窗 */}
      <Modal open={cropOpen} title="调整头像" onClose={closeCrop} wide>
        <div className="space-y-4">
          <div className="relative h-64 w-full overflow-hidden rounded-md bg-black/80">
            {cropSrc && (
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_c, px) => setCropPixels(px)}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-muted">缩放</span>
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeCrop}>取消</Button>
            <Button onClick={() => void confirmCrop()} disabled={!cropPixels}>确认</Button>
          </div>
        </div>
      </Modal>
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
