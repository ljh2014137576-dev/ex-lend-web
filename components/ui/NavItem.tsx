import Link from "next/link";
import type { Ref } from "react";

export function NavItem({
  num,
  label,
  href,
  active,
  onClick,
  innerRef,
}: {
  num: string;
  label: string;
  href: string;
  active?: boolean;
  onClick?: () => void;
  innerRef?: Ref<HTMLAnchorElement>;
}) {
  return (
    <Link
      ref={innerRef}
      href={href}
      onClick={onClick}
      data-active={active || undefined}
      className={["nav-link relative flex items-baseline gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-[var(--transition-fast-v)]", !active ? "hover:bg-surface2" : ""].join(" ")}
    >
      <span className="font-mono text-[11px] opacity-60">{num}</span>
      <span>{label}</span>
    </Link>
  );
}