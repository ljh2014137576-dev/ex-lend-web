import { AppShell } from "@/components/shell/AppShell";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { PrefetchAll } from "@/components/shell/PrefetchAll";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <PrefetchAll />
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}