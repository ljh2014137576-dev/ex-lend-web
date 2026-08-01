export function PageHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {meta && <p className="mt-1 font-mono text-xs text-muted">{meta}</p>}
    </header>
  );
}