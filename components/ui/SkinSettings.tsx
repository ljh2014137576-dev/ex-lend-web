"use client";

import { SKINS, useSkin } from "@/lib/skin";

const DESCRIPTIONS: Record<string, string> = {
  editorial: "暖灰纸面 · 白色数据组 · 黑色层级 · 单一蓝色强调（推荐）",
  monochrome: "纯黑白 · 直角 · 等宽元数据 · 反白状态",
  modern: "白底 · 黑灰层级 · 轻阴影 · 单强调色",
};

export function SkinSettings() {
  const { skin, setSkin } = useSkin();

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
    </div>
  );
}