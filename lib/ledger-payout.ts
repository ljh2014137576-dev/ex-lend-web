import type { PayoutItem, PayoutReceipt } from "@/lib/ledger-types";

export const PAYOUT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工资回执结构不完整，请按原批次核对。");
  return value as JsonRecord;
};
const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !PAYOUT_UUID.test(value)) throw new Error("工资回执 ID 不完整，请按原批次核对。");
  return value.toLowerCase();
};

export function payoutMoneyCents(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("工资金额缺失。");
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || !Number.isFinite(Number(text))) throw new Error("工资金额须为有限数字。");
  const decimals = (match[3] ?? "").replace(/0+$/, "");
  if (decimals.length > 2) throw new Error("工资金额最多保留两位小数。");
  const cents = Number(match[2]) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("工资金额超出可核验精度。");
  return match[1] === "-" ? -cents : cents;
}

export function validatePayoutRequest(items: PayoutItem[], batchNo: string): { actorId: string; items: PayoutItem[] } {
  const parts = batchNo.split(":");
  if (parts.length !== 3 || parts[0] !== "PB2" || !PAYOUT_UUID.test(parts[1]) || !PAYOUT_UUID.test(parts[2]) || batchNo !== `PB2:${parts[1].toLowerCase()}:${parts[2].toLowerCase()}`) throw new Error("需要完整且稳定的工资批次编号。");
  if (!Array.isArray(items) || items.length === 0 || items.length > 1000) throw new Error("工资批次需要 1 到 1000 条明细。");
  const seen = new Set<string>();
  const canonical = items.map(item => {
    const employeeId = uuid(item.employee_id), cents = payoutMoneyCents(item.amount);
    if (cents <= 0 || seen.has(employeeId)) throw new Error("工资明细必须为正金额，且不能重复员工。");
    seen.add(employeeId);
    return { employee_id: employeeId, amount: cents / 100 };
  }).sort((a, b) => a.employee_id.localeCompare(b.employee_id));
  return { actorId: parts[1].toLowerCase(), items: canonical };
}

export function readPayoutReceipt(value: unknown, expected: { batchNo: string; actorId: string; items?: PayoutItem[] }): PayoutReceipt {
  const data = record(value), receipt = record(data.receipt);
  const id = uuid(data.payout_id), operatorId = uuid(data.operator_id), receiptId = uuid(data.receipt_id);
  if (data.success !== true || data.batch_id !== data.payout_id || data.batch_no !== expected.batchNo || operatorId !== expected.actorId.toLowerCase()
    || data.status !== "completed" || typeof data.replayed !== "boolean" || typeof data.created_at !== "string" || !Number.isFinite(Date.parse(data.created_at))
    || !(data.proof_path === null || typeof data.proof_path === "string")) throw new Error("工资回执与原批次或操作人不一致，不能确认发放成功。");
  if (uuid(receipt.receipt_id) !== receiptId || uuid(receipt.payout_id) !== id || receipt.batch_no !== data.batch_no || uuid(receipt.operator_id) !== operatorId || receipt.status !== "completed" || receipt.created_at !== data.created_at) throw new Error("工资回执头部不一致。");
  const totalCents = payoutMoneyCents(data.total_amount);
  if (payoutMoneyCents(receipt.total_amount) !== totalCents || typeof data.detail_count !== "number" || !Number.isInteger(data.detail_count) || data.detail_count < 1 || receipt.detail_count !== data.detail_count || !Array.isArray(receipt.items) || receipt.items.length !== data.detail_count) throw new Error("工资回执汇总或明细不完整。");
  const seen = new Set<string>(), detailIds = new Set<string>(), ledgerIds = new Set<string>();
  let sum = 0;
  const items = receipt.items.map(value => {
    const item = record(value), employeeId = uuid(item.employee_id), detailId = uuid(item.detail_id), ledgerId = uuid(item.ledger_id);
    const amount = payoutMoneyCents(item.amount), before = payoutMoneyCents(item.balance_before), after = payoutMoneyCents(item.balance_after);
    if (amount <= 0 || before - after !== amount || seen.has(employeeId) || detailIds.has(detailId) || ledgerIds.has(ledgerId)) throw new Error("工资回执明细重复或余额变化不一致。");
    seen.add(employeeId); detailIds.add(detailId); ledgerIds.add(ledgerId); sum += amount;
    if (!Number.isSafeInteger(sum)) throw new Error("工资回执合计超出可核验精度。");
    return { employeeId, amount: amount / 100, balanceBefore: before / 100, balanceAfter: after / 100, detailId, ledgerId };
  });
  if (sum !== totalCents) throw new Error("工资回执明细合计与批次金额不一致。");
  if (expected.items) {
    const requested = validatePayoutRequest(expected.items, expected.batchNo).items;
    if (requested.length !== items.length || requested.some(item => !items.some(saved => saved.employeeId === item.employee_id && payoutMoneyCents(saved.amount) === payoutMoneyCents(item.amount)))) throw new Error("工资回执与本次锁定的员工及金额不一致。");
  }
  return { success: true, id, receiptId, batchNo: expected.batchNo, operatorId, total: totalCents / 100, count: data.detail_count, status: "completed", proofPath: data.proof_path as string | null, createdAt: data.created_at, replayed: data.replayed, items };
}

export function payoutProofObjectPath(fileName: string, userId: string, payoutId: string, uploadId: string): string {
  const owner = uuid(userId), payout = uuid(payoutId), upload = uuid(uploadId);
  const proposed = fileName.split(".").pop()?.toLowerCase() ?? "dat";
  const extension = /^[a-z0-9]{1,8}$/.test(proposed) ? proposed : "dat";
  return `${owner}/payout-${payout}/${upload}.${extension}`;
}
