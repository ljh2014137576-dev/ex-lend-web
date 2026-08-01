import Link from "next/link";

export function NavItem({
  num,
  label,
  href,
  active,
  onClick,
}: {
  num: string;
  label: string;
  href: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <li className="px-2 py-0.5">
      <Link
        href={href}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={[
          "flex items-baseline gap-3 rounded-md px-3 py-2 text-sm",
          "transition-all duration-[var(--transition-fast-v)]",
          active
            ? "bg-nav-active font-medium text-nav-active-text shadow-sm"
            : "text-ink hover:bg-surface2",
        ].join(" ")}
      >
        <span className="font-mono text-[11px] opacity-60">{num}</span>
        <span>{label}</span>
      </Link>
    </li>
  );
}