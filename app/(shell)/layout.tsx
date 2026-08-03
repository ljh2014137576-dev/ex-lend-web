import { AppShell } from "@/components/shell/AppShell";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { PrefetchAll } from "@/components/shell/PrefetchAll";
import { BootLoading } from "@/components/shell/BootLoading";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <PrefetchAll />
      <AppShell>{children}</AppShell>
      <BootLoading />
    </RequireAuth>
  );
}