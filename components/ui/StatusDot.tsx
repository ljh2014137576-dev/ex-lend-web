type Tone = "neutral" | "active" | "warn" | "danger" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted",
  active: "bg-success",
  warn: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
};

export function StatusDot({ tone = "neutral", label }: { tone?: Tone; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
      <span className={["h-2 w-2 rounded-full", TONES[tone]].join(" ")} />
      {label}
    </span>
  );
}