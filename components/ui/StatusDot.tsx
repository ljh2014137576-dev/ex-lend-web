type Tone = "neutral" | "active" | "warn" | "danger" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted/15 text-muted",
  active: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  accent: "bg-accent/15 text-accent",
};

export function StatusDot({ tone = "neutral", label }: { tone?: Tone; label?: string }) {
  if (!label) return null;
  return (
    <span
      className={[
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-medium",
        TONES[tone],
      ].join(" ")}
    >
      {label}
    </span>
  );
}
