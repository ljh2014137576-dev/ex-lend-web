export const RECOVERY_HISTORY_MESSAGE = "这是恢复的历史订单，商品、支付流水或佣金证据不完整，原主记录继续保留，编辑、审核、退款和删除维持财务保护；开始和完成状态可正常使用。";

export type OrderActionData = {
  success: boolean;
  message?: string;
  code?: string;
  count?: number;
  order_id?: string;
  order_no?: string;
  status?: string;
  unchanged?: boolean;
  updated_ids?: string[];
  skipped?: { order_id?: string; code?: string; message?: string }[];
  total_commission?: number;
  gross_profit?: number;
  [key: string]: unknown;
};
export type OrderActionError = { message: string; code?: string; uncertain?: boolean };
export type OrderActionResult = { data: OrderActionData | null; error: OrderActionError | null };

export function orderActionMessage(value: unknown): string {
  const raw = value && typeof value === "object" && "message" in value ? String(value.message) : String(value ?? "未知错误");
  if (/Recovered order|RECOVERY_HISTORY_INCOMPLETE|recovery.*history|historical commission evidence/i.test(raw)) return RECOVERY_HISTORY_MESSAGE;
  if (/NO MEMBER|NO_MEMBERS|未添加员工|no.*(?:order_)?member/i.test(raw)) return "订单尚未分配员工，请先分配员工再开始或完成。";
  if (/Direct order status updates only allow/i.test(raw)) return "订单状态更新被旧接口拒绝，请刷新到最新版后重试。";
  return raw;
}

export function normalizeOrderResult(data: unknown, error: unknown): OrderActionResult {
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data as OrderActionData : null;
  if (error) {
    const code = typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
    const message = orderActionMessage(error);
    return { data: payload, error: { message, code, uncertain: !code || /fetch|network|timeout/i.test(message) } };
  }
  if (payload?.success !== true) {
    return { data: payload, error: {
      message: payload?.success === false ? orderActionMessage(payload.message ?? payload.code ?? "操作被拒绝") : "服务端未确认操作成功，请刷新订单核对，勿重复提交。",
      code: payload?.code ?? "ORDER_RESULT_UNCONFIRMED", uncertain: payload?.success !== false,
    } };
  }
  return { data: payload, error: null };
}

export function verifiedBatchCount(data: OrderActionData | null, requested: string[]): number {
  const unique = new Set(requested);
  const count = data?.count;
  if (data?.success !== true || typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > unique.size) throw new Error("服务端未返回有效更新数量，请刷新订单核对，勿重复提交。");
  if (data.updated_ids !== undefined && (!Array.isArray(data.updated_ids) || new Set(data.updated_ids).size !== count || data.updated_ids.length !== count || data.updated_ids.some(id => !unique.has(id)))) throw new Error("服务端更新数量与订单 ID 不一致，请刷新核对。");
  return count;
}

export function commissionChanges(members: { employeeId: string }[], drafts: Record<string, string>): { employee_id: string; amount: number | null }[] {
  return members.map(member => {
    const draft = drafts[member.employeeId];
    if (draft === undefined) throw new Error("提成输入未完整加载，请重新打开编辑。");
    if (draft.trim() === "") return { employee_id: member.employeeId, amount: null };
    const amount = Number(draft);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("提成须为有限的非负金额；留空表示恢复自动计算。");
    return { employee_id: member.employeeId, amount };
  });
}
