import { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={["ui-input",
        "h-[var(--control-h)] border border-line bg-paper px-3 text-sm text-ink",
        "outline-none transition-colors placeholder:text-muted focus:border-ink focus:ring-1 focus:ring-focus-ring",
        "rounded-md",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
