import { StatusDot } from "@/components/ui/StatusDot";

const ORDER_STATUS: Record<string, { tone: "neutral" | "active" | "warn" | "danger" | "accent"; label: string }> = {
  booking: { tone: "neutral", label: "待开始" },
  in_progress: { tone: "accent", label: "进行中" },
  completed: { tone: "warn", label: "已完成" },
  cancelled: { tone: "danger", label: "已取消" },
};

const AUDIT_STATUS: Record<string, { tone: "neutral" | "active" | "warn" | "danger" | "accent"; label: string }> = {
  pending: { tone: "warn", label: "待审核" },
  approved: { tone: "active", label: "已通过" },
  rejected: { tone: "danger", label: "已拒绝" },
};

export function OrderStatusTag({ status }: { status: string }) {
  const s = ORDER_STATUS[status] ?? { tone: "neutral", label: status };
  return <StatusDot tone={s.tone} label={s.label} />;
}

export function AuditStatusTag({ status }: { status: string }) {
  const s = AUDIT_STATUS[status] ?? { tone: "neutral", label: status };
  return <StatusDot tone={s.tone} label={s.label} />;
}