export const MIN_COMMISSION_RATE = 0.8;
export const MAX_COMMISSION_RATE = 1;
export const DEFAULT_COMMISSION_PERCENT = "80";

export class CommissionPolicyError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "CommissionPolicyError"; }
}

/** Database/API rates are fractions; editable controls below use percentages. */
export function requireCommissionRate(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) {
    throw new CommissionPolicyError("COMMISSION_RATE_INVALID", "提成比例未配置或无效，请填写 80%–100%。");
  }
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate > MAX_COMMISSION_RATE) throw new CommissionPolicyError("COMMISSION_RATE_INVALID", "提成比例必须是 80%–100% 之间的有效数字。");
  if (rate < MIN_COMMISSION_RATE) throw new CommissionPolicyError("COMMISSION_RATE_BELOW_MINIMUM", "提成比例不能低于 80%，此配置不能用于新订单。");
  return rate;
}

export function commissionRateFromPercent(value: string): number {
  const draft = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(draft)) throw new CommissionPolicyError("COMMISSION_RATE_INVALID", "请输入 80–100 的百分数，例如 80 表示 80%；不能为空。");
  const [whole, rawFraction = ""] = draft.split(".");
  const fraction = rawFraction.replace(/0+$/, "");
  // Both rate columns use numeric(6,4): percentages can retain at most two decimal places.
  if (fraction.length > 2) throw new CommissionPolicyError("COMMISSION_RATE_INVALID", "提成百分数最多保留两位小数，例如 80.25 表示 80.25%。");
  const padded = whole.padStart(3, "0");
  // Decimal shifting avoids the floating division artifact 80.1 / 100 !== Number('0.801').
  return requireCommissionRate(Number(`${padded.slice(0, -2)}.${padded.slice(-2)}${fraction}`));
}

export function commissionPercentText(rate: number | null): string {
  return rate === null || !Number.isFinite(rate) ? "" : String(Number((rate * 100).toFixed(6)));
}

type CommissionProduct = { name: string; commissionType: string; fixedRate: number | null };
type CommissionEmployee = { id: string; name: string; grade: number };
type CommissionGrade = { grade: number; rate: number };

/** Check each applied rate, not each employee's fraction of the entire order. */
export function assertOrderCommissionPolicy(products: CommissionProduct[], employeeIds: string[], employees: CommissionEmployee[], grades: CommissionGrade[]): void {
  for (const product of products) {
    if (product.commissionType === "fixed") {
      try { requireCommissionRate(product.fixedRate); }
      catch (error) { throw new CommissionPolicyError(error instanceof CommissionPolicyError ? error.code : "COMMISSION_RATE_INVALID", `商品「${product.name}」：${error instanceof Error ? error.message : "提成比例无效"}`); }
    } else if (product.commissionType !== "grade") {
      throw new CommissionPolicyError("COMMISSION_RATE_INVALID", `商品「${product.name}」的提成方式未确认，不能新建订单。`);
    }
  }
  if (!products.some(product => product.commissionType === "grade")) return;
  // Booking without assigned employees remains supported. Their rates are checked once selected.
  for (const employeeId of employeeIds) {
    const employee = employees.find(row => row.id === employeeId);
    const matched = employee ? grades.filter(rule => rule.grade === employee.grade) : [];
    if (!employee || !Number.isInteger(employee.grade) || employee.grade < 1 || matched.length !== 1) {
      throw new CommissionPolicyError("COMMISSION_RULE_UNAVAILABLE", `${employee ? `员工「${employee.name}」` : "所选员工"}缺少可确认的等级提成规则，请先检查员工等级和规则配置。`);
    }
    try { requireCommissionRate(matched[0].rate); }
    catch (error) { throw new CommissionPolicyError(error instanceof CommissionPolicyError ? error.code : "COMMISSION_RATE_INVALID", `员工「${employee.name}」Lv${employee.grade}：${error instanceof Error ? error.message : "提成比例无效"}`); }
  }
}

export function commissionRejectionMessage(code: string | undefined, message: string | undefined): string {
  return code === "COMMISSION_RATE_BELOW_MINIMUM" || message?.includes("COMMISSION_RATE_BELOW_MINIMUM")
    ? "提成比例不能低于 80%，订单未创建。请检查商品固定比例或所选员工的等级提成规则。"
    : message || "请检查订单信息";
}
