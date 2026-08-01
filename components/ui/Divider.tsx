export function Divider({ className = "" }: { className?: string }) {
  return <hr className={["border-line", className].join(" ")} />;
}