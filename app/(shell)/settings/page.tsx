import { PageHeader } from "@/components/ui/PageHeader";
import { SkinSettings } from "@/components/ui/SkinSettings";

export default function SettingsPage() {
  return (
    <div className="max-w-xl">
      <PageHeader title="设置" meta="/settings" />

      <section className="space-y-4 border border-line bg-surface p-6">
        <div>
          <h2 className="text-sm font-medium">界面主题</h2>
          <p className="mt-1 font-mono text-[11px] text-muted">
            切换立即生效，选择保存在本机
          </p>
        </div>
        <SkinSettings />
      </section>
    </div>
  );
}