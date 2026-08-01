import { PageHeader } from "@/components/ui/PageHeader";
import { SkinSettings } from "@/components/ui/SkinSettings";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusDot } from "@/components/ui/StatusDot";
import { Divider } from "@/components/ui/Divider";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="设置" meta="/settings · 皮肤系统 v2" />

      <Panel title="界面主题" meta="切换立即生效 · 保存到本机">
        <SkinSettings />
      </Panel>

      <Panel title="控件风格预览" meta="当前皮肤下的所有基础控件">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button>主操作</Button>
            <Button variant="secondary">次要操作</Button>
            <Button variant="ghost">幽灵按钮</Button>
            <Button variant="danger">危险操作</Button>
            <Button variant="secondary" size="sm">小号</Button>
          </div>

          <Divider />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="font-mono text-[11px] text-muted">输入框 / INPUT</span>
              <Input placeholder="请输入内容" />
            </label>
            <label className="block space-y-1.5">
              <span className="font-mono text-[11px] text-muted">禁用态 / DISABLED</span>
              <Input placeholder="不可用" disabled />
            </label>
          </div>

          <Divider />

          <div className="flex flex-wrap gap-5">
            <StatusDot tone="neutral" label="待处理" />
            <StatusDot tone="active" label="已完成" />
            <StatusDot tone="warn" label="待审核" />
            <StatusDot tone="danger" label="已撤销" />
            <StatusDot tone="accent" label="进行中" />
          </div>

          <Divider />

          <p className="font-mono text-[11px] text-muted">
            边距 · 圆角 · 阴影 · 描边 · 材质（毛玻璃/亚克力）· 尺寸 · 密度 · 动效
            均由皮肤 token 控制，切换皮肤可对比。
          </p>
        </div>
      </Panel>
    </div>
  );
}