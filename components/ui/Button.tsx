import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "border border-line bg-surface text-ink hover:bg-surface2",
  ghost: "text-ink hover:bg-surface",
  danger: "bg-danger text-danger-ink hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  sm: "h-[28px] px-2.5 text-xs",
  md: "h-[var(--control-h)] px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={["ui-btn ui-btn--" + variant + " ui-btn--" + size,
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(" ")}
      {...props}
    />
  );
}
