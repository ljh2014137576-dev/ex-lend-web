"use client";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function FilterTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border border-line bg-surface p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={active === t.id}
          className={[
            "rounded-md px-3 py-1.5 text-xs transition-colors",
            active === t.id
              ? "bg-nav-active font-medium text-nav-active-text"
              : "text-muted hover:bg-surface2 hover:text-ink",
          ].join(" ")}
        >
          {t.label}
          {typeof t.count === "number" && (
            <span className="ml-1.5 font-mono opacity-70">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}