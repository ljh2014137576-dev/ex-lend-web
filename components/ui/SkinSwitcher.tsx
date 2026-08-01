"use client";

import { SKINS, useSkin } from "@/lib/skin";

export function SkinSwitcher() {
  const { skin, setSkin } = useSkin();

  return (
    <div className="flex items-center gap-1 border border-line bg-surface p-1">
      {SKINS.map((s) => (
        <button
          key={s.name}
          type="button"
          onClick={() => setSkin(s.name)}
          aria-pressed={skin === s.name}
          className={[
            "px-2 py-1 text-xs transition-colors",
            skin === s.name ? "bg-accent text-accent-ink" : "text-muted hover:bg-paper hover:text-ink",
          ].join(" ")}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}