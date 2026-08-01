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
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-baseline gap-3 px-4 py-2 text-sm transition-colors",
        active
          ? "bg-nav-active text-nav-active-text"
          : "text-ink hover:bg-paper",
      ].join(" ")}
    >
      <span className="font-mono text-[11px] opacity-60">{num}</span>
      <span>{label}</span>
    </Link>
  );
}