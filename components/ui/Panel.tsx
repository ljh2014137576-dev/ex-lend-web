export function Panel({
  title,
  meta,
  children,
  className = "",
}: {
  title?: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={["border border-line bg-surface rounded-md", className].join(" ")}>
      {(title || meta) && (
        <header className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-sm font-medium">{title}</h2>}
          {meta && <p className="font-mono text-[11px] text-muted">{meta}</p>}
        </header>
      )}
      <div className="p-[var(--panel-pad)]">{children}</div>
    </section>
  );
}