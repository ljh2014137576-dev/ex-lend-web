"use client";

import { SKINS, useSkin } from "@/lib/skin";

const DESCRIPTIONS: Record<string, string> = {
  editorial: "暖灰纸面 · 白色数据组 · 黑色层级 · 单一蓝色强调（推荐）",
  monochrome: "纯黑白 · 直角 · 等宽元数据 · 反白状态",
  modern: "白底 · 黑灰层级 · 轻阴影 · 单强调色",
  hero: "HeroUI 风格 · 大圆角 · 柔和阴影 · 紫罗兰强调 · 支持白天/黑夜",
};

export function SkinSettings() {
  const { skin, setSkin, mode, setMode } = useSkin();

  return (
    <div className="space-y-2">
      {SKINS.map((s) => (
        <button
          key={s.name}
          type="button"
          onClick={() => setSkin(s.name)}
          aria-pressed={skin === s.name}
          className={[
            "flex w-full items-center justify-between gap-4 border px-4 py-3 text-left transition-colors",
            skin === s.name
              ? "border-ink bg-ink text-paper"
              : "border-line bg-paper hover:bg-surface",
          ].join(" ")}
        >
          <span>
            <span className="block text-sm font-medium">{s.label}</span>
            <span className="block font-mono text-[11px] opacity-70">
              {DESCRIPTIONS[s.name]}
            </span>
          </span>
          <span className="font-mono text-[11px]">
            {skin === s.name ? "● 使用中" : "○"}
          </span>
        </button>
      ))}
      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-2 font-mono text-[11px] text-muted">模式（白天 / 黑夜，Hero 皮肤生效）</p>
        <div className="flex gap-1">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={[
                "flex-1 rounded-md px-3 py-2 text-xs transition-colors",
                mode === m ? "bg-nav-active text-nav-active-text" : "border border-line bg-paper hover:bg-surface2",
              ].join(" ")}
            >
              {m === "light" ? "☀ 白天" : "🌙 黑夜"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}