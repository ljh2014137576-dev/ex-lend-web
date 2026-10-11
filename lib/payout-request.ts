export type PayoutItem = { employee_id: string; amount: number };
export type PayoutReceipt = {
  id: string;
  batchNo: string;
  operatorId: string;
  total: number;
  count: number;
  status: "completed";
  proofPath: string | null;
  receiptId: string;
  replayed: boolean;
  createdAt?: string;
  items: { employeeId: string; amount: number; balanceBefore: number; balanceAfter: number }[];
};
export type PayoutScope = { project: string; actorId: string };
export type PayoutRequest = {
  requestId: string;
  batchNo: string;
  items: PayoutItem[];
  phase: "prepared" | "submitting" | "unknown" | "rejected" | "confirmed";
  receipt: PayoutReceipt | null;
  balancesSynced: boolean;
};
export type PayoutJournal = { version: 1; project: string; actorId: string; epoch: string; request: PayoutRequest | null };
export type PayoutEnvironment = {
  storage: Pick<Storage, "getItem" | "setItem">;
  uuid: () => string;
  actorId: () => string | null;
  withLock: <T>(key: string, run: () => Promise<T>) => Promise<T>;
};
export type PayoutDependencies = {
  submit: (items: PayoutItem[], batchNo: string) => Promise<
    { kind: "confirmed"; receipt: PayoutReceipt } | { kind: "rejected" | "unknown"; message: string; code?: string }
  >;
  lookup: (batchNo: string, actorId: string) => Promise<
    { kind: "not_found" } | { kind: "found"; receipt: PayoutReceipt | null; reason?: string }
  >;
  refreshBalances: () => Promise<void>;
};
export type PayoutOutcome = { journal: PayoutJournal; message: string; submitted?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CENTS = 999_999_999_999;
export class PayoutFlowError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "PayoutFlowError"; }
}

/** Parse currency as integer cents. Never turn blank, NULL, NaN or excess precision into zero. */
export function payoutCents(value: unknown, positive = false): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value).trim())) throw new PayoutFlowError("INVALID_AMOUNT", "金额须为最多两位小数的有效数字。");
  const text = String(value).trim();
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const cents = Number(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS || (positive && cents <= 0)) throw new PayoutFlowError("INVALID_AMOUNT", "结算金额必须大于 0，且不能超过可保存范围。");
  return cents;
}

export function canonicalPayoutItems(items: PayoutItem[]): PayoutItem[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > 1000) throw new PayoutFlowError("INVALID_ITEMS", "请选择 1–1000 名员工。");
  const seen = new Set<string>();
  let total = 0;
  const normalized = items.map(item => {
    if (!item || !UUID.test(item.employee_id) || seen.has(item.employee_id.toLowerCase())) throw new PayoutFlowError("INVALID_ITEMS", "员工 ID 缺失或重复，请刷新员工列表。");
    const employee_id = item.employee_id.toLowerCase();
    seen.add(employee_id);
    const cents = payoutCents(item.amount, true);
    total += cents;
    if (total > MAX_CENTS) throw new PayoutFlowError("INVALID_AMOUNT", "本批次总金额超过可保存范围。");
    return { employee_id, amount: cents / 100 };
  });
  return normalized.sort((a, b) => a.employee_id.localeCompare(b.employee_id));
}

export function samePayoutItems(a: PayoutItem[], b: PayoutItem[]): boolean {
  const left = canonicalPayoutItems(a), right = canonicalPayoutItems(b);
  return left.length === right.length && left.every((item, index) => item.employee_id === right[index].employee_id && payoutCents(item.amount) === payoutCents(right[index].amount));
}

export function payoutJournalKey(scope: PayoutScope): string {
  if (!scope.project || !UUID.test(scope.actorId)) throw new PayoutFlowError("INVALID_ACTOR", "请重新登录后结算。");
  return "exlend:payout:v1:" + encodeURIComponent(scope.project) + ":" + scope.actorId.toLowerCase();
}

export function validatePayoutReceipt(receipt: PayoutReceipt, request: PayoutRequest, scope: PayoutScope): PayoutReceipt {
  if (!receipt || !UUID.test(receipt.id) || !UUID.test(receipt.receiptId) || receipt.batchNo !== request.batchNo || receipt.operatorId?.toLowerCase() !== scope.actorId.toLowerCase() || receipt.status !== "completed" || !Array.isArray(receipt.items)) throw new PayoutFlowError("RECEIPT_MISMATCH", "结算回执的身份或批次不匹配，不能认作本次成功。");
  const items = receipt.items.map(item => {
    const cents = payoutCents(item.amount, true);
    if (payoutCents(item.balanceBefore) - payoutCents(item.balanceAfter) !== cents) throw new PayoutFlowError("RECEIPT_MISMATCH", "结算回执的员工余额变化不一致，请核对记录。");
    return { employee_id: item.employeeId, amount: cents / 100 };
  });
  if (!samePayoutItems(items, request.items) || receipt.count !== items.length || payoutCents(receipt.total, true) !== items.reduce((sum, item) => sum + payoutCents(item.amount), 0)) throw new PayoutFlowError("RECEIPT_MISMATCH", "结算回执与原员工/金额明细不一致，请核对记录。");
  return {
    id: receipt.id, batchNo: receipt.batchNo, operatorId: receipt.operatorId, total: receipt.total,
    count: receipt.count, status: "completed", proofPath: typeof receipt.proofPath === "string" ? receipt.proofPath : null,
    receiptId: receipt.receiptId, replayed: receipt.replayed === true,
    createdAt: typeof receipt.createdAt === "string" ? receipt.createdAt : undefined,
    items: receipt.items.map(item => ({ employeeId: item.employeeId, amount: item.amount, balanceBefore: item.balanceBefore, balanceAfter: item.balanceAfter })),
  };
}

export function readPayoutJournal(env: PayoutEnvironment, scope: PayoutScope): PayoutJournal | null {
  let raw: string | null;
  try { raw = env.storage.getItem(payoutJournalKey(scope)); }
  catch { throw new PayoutFlowError("STORAGE_UNAVAILABLE", "无法读取本机结算记录，已停止资金提交。"); }
  if (raw === null) return null;
  try {
    const j = JSON.parse(raw) as PayoutJournal;
    if (j.version !== 1 || j.project !== scope.project || j.actorId !== scope.actorId || !UUID.test(j.epoch)) throw new Error("scope");
    if (j.request !== null && (typeof j.request !== "object" || Array.isArray(j.request))) throw new Error("request shape");
    if (j.request) {
      const r = j.request;
      if (!UUID.test(r.requestId) || r.batchNo !== `PB2:${scope.actorId}:${r.requestId}` || !["prepared", "submitting", "unknown", "rejected", "confirmed"].includes(r.phase)) throw new Error("request");
      canonicalPayoutItems(r.items);
      if (r.phase === "confirmed") {
        if (!r.receipt) throw new Error("receipt");
        r.receipt = validatePayoutReceipt(r.receipt, r, scope);
      } else if (r.receipt) throw new Error("unexpected receipt");
    }
    return j;
  } catch { throw new PayoutFlowError("STORAGE_CORRUPT", "本机结算记录不完整，请先在结算记录中核对；不会生成新批次继续扣款。"); }
}

function writeJournal(env: PayoutEnvironment, scope: PayoutScope, journal: PayoutJournal) {
  try {
    const text = JSON.stringify(journal);
    const key = payoutJournalKey(scope);
    env.storage.setItem(key, text);
    if (env.storage.getItem(key) !== text) throw new Error("readback");
  } catch { throw new PayoutFlowError("STORAGE_UNAVAILABLE", "无法可靠保存本机结算标识，已停止新的资金提交。"); }
}

function assertActor(env: PayoutEnvironment, scope: PayoutScope) {
  if (env.actorId() !== scope.actorId) throw new PayoutFlowError("ACTOR_CHANGED", "登录账号已变化，已停止后续结算操作。请切回原账号核对。");
}

function newEpoch(env: PayoutEnvironment): string {
  const id = env.uuid().toLowerCase();
  if (!UUID.test(id)) throw new PayoutFlowError("UUID_UNAVAILABLE", "无法生成可靠请求标识，已停止资金提交。");
  return id;
}

export async function preparePayoutDraft(env: PayoutEnvironment, scope: PayoutScope, deps: PayoutDependencies): Promise<PayoutOutcome> {
  return env.withLock(payoutJournalKey(scope), async () => {
    assertActor(env, scope);
    const existing = readPayoutJournal(env, scope);
    if (existing?.request) {
      let message = existing.request.phase === "confirmed" ? "该批次已记账；凭证问题只补附件，不再扣款。" : "检测到未结束请求，请先核对原批次或用原标识重试。";
      try { await deps.refreshBalances(); assertActor(env, scope); }
      catch { message += " 员工名称/余额暂未刷新，原批次和回执仍保留，可继续核对。"; }
      return { journal: existing, message };
    }
    await deps.refreshBalances();
    assertActor(env, scope);
    const journal: PayoutJournal = existing ?? { version: 1, ...scope, epoch: newEpoch(env), request: null };
    writeJournal(env, scope, journal);
    return { journal, message: "员工余额已从服务器刷新，请核对后结算。" };
  });
}

async function confirmReceipt(env: PayoutEnvironment, scope: PayoutScope, journal: PayoutJournal, receipt: PayoutReceipt, deps: PayoutDependencies): Promise<PayoutOutcome> {
  const request = journal.request!;
  request.receipt = validatePayoutReceipt(receipt, request, scope);
  request.phase = "confirmed";
  request.balancesSynced = false;
  // Store an ACK under its original actor even if the UI account changed while the request was in flight.
  try { writeJournal(env, scope, journal); }
  catch { return { journal, message: "工资已记账，但本机回执保存失败；请核对原批次，勿重新结算。" }; }
  if (env.actorId() !== scope.actorId) return { journal, message: "工资已记账，回执保存在原账号下；账号变化后未继续刷新或上传。" };
  try {
    await deps.refreshBalances();
    assertActor(env, scope);
    request.balancesSynced = true;
    writeJournal(env, scope, journal);
    return { journal, message: "工资已记账，员工余额已按服务器刷新；凭证可独立补传。" };
  } catch { return { journal, message: "工资已记账，但余额刷新未完成；请先核对原批次，勿重新结算。" }; }
}

async function lookupExisting(env: PayoutEnvironment, scope: PayoutScope, journal: PayoutJournal, deps: PayoutDependencies): Promise<PayoutOutcome | null> {
  assertActor(env, scope);
  const found = await deps.lookup(journal.request!.batchNo, scope.actorId);
  assertActor(env, scope);
  if (found.kind === "not_found") return null;
  if (!found.receipt) throw new PayoutFlowError("LEGACY_UNVERIFIED", found.reason ?? "该批次缺少可核验明细，不能认作本次回执，也不会生成新号扣款。");
  return confirmReceipt(env, scope, journal, found.receipt, deps);
}

export async function submitPayoutRequest(env: PayoutEnvironment, scope: PayoutScope, expectedEpoch: string, items: PayoutItem[], deps: PayoutDependencies): Promise<PayoutOutcome> {
  const canonical = canonicalPayoutItems(items);
  return env.withLock(payoutJournalKey(scope), async () => {
    assertActor(env, scope);
    const journal = readPayoutJournal(env, scope);
    if (!journal || journal.epoch !== expectedEpoch) throw new PayoutFlowError("STALE_DRAFT", "这份工资草稿已过期，请重新打开并核对服务器余额。");
    if (journal.request) {
      if (!samePayoutItems(journal.request.items, canonical)) throw new PayoutFlowError("PAYLOAD_LOCKED", "原批次已有固定员工与金额，不能用另一份草稿替换。请先核对原批次。");
      if (journal.request.phase === "confirmed") return { journal, message: "该批次已经记账，本次未再次扣款。凭证失败只需补附件。" };
      const found = await lookupExisting(env, scope, journal, deps);
      if (found) return found;
    } else {
      const requestId = newEpoch(env);
      journal.request = { requestId, batchNo: `PB2:${scope.actorId}:${requestId}`, items: canonical, phase: "prepared", receipt: null, balancesSynced: false };
      writeJournal(env, scope, journal);
    }
    assertActor(env, scope);
    journal.request.phase = "submitting";
    writeJournal(env, scope, journal); // Must succeed before the first money request.
    let result: Awaited<ReturnType<PayoutDependencies["submit"]>>;
    try { result = await deps.submit(journal.request.items, journal.request.batchNo); }
    catch { result = { kind: "unknown", message: "结算响应未确认，请先核对原批次或使用原标识重试。" }; }
    if (result.kind === "confirmed") {
      try { return { ...await confirmReceipt(env, scope, journal, result.receipt, deps), submitted: true }; }
      catch (error) {
        journal.request.phase = "unknown";
        journal.request.receipt = null;
        try { writeJournal(env, scope, journal); } catch { /* Existing submitting record remains the recovery anchor. */ }
        return { journal, message: error instanceof Error ? error.message : "回执无法核验，请核对原批次。" };
      }
    }
    journal.request.phase = result.kind === "rejected" && !/CONFLICT|ACTOR|LEGACY|MISMATCH/.test(result.code ?? "") ? "rejected" : "unknown";
    try { writeJournal(env, scope, journal); } catch { return { journal, message: "结果待核对且本机保存失败，请核对原批次；禁止换新号重付。" }; }
    return { journal, message: result.message };
  });
}

export async function reconcilePayoutRequest(env: PayoutEnvironment, scope: PayoutScope, deps: PayoutDependencies): Promise<PayoutOutcome> {
  return env.withLock(payoutJournalKey(scope), async () => {
    assertActor(env, scope);
    const journal = readPayoutJournal(env, scope);
    if (!journal?.request) throw new PayoutFlowError("NO_REQUEST", "没有待核对的工资请求。");
    const found = await lookupExisting(env, scope, journal, deps);
    if (found) return found;
    if (journal.request.phase === "confirmed") throw new PayoutFlowError("RECEIPT_NOT_VISIBLE", "已保存成功回执，但暂时读不到服务器批次，请核对权限或连接；不会再次扣款。");
    return { journal, message: "暂未查到已完成回执；这不代表未扣款。仍保留原标识，可安全重试原请求，不能换新批次。" };
  });
}

export async function startNewPayoutDraft(env: PayoutEnvironment, scope: PayoutScope, expectedEpoch: string, deps: PayoutDependencies): Promise<PayoutOutcome> {
  return env.withLock(payoutJournalKey(scope), async () => {
    assertActor(env, scope);
    const old = readPayoutJournal(env, scope);
    if (!old || old.epoch !== expectedEpoch) throw new PayoutFlowError("STALE_DRAFT", "另一标签已切换结算请求，请先重新核对。");
    if (!old.request || !["confirmed", "rejected"].includes(old.request.phase)) throw new PayoutFlowError("PENDING_REQUEST", "原结算结果尚未确定，不能生成新的扣款请求。");
    if (old.request.phase === "rejected") {
      const found = await deps.lookup(old.request.batchNo, scope.actorId);
      assertActor(env, scope);
      if (found.kind !== "not_found") throw new PayoutFlowError("PENDING_REQUEST", "原批次存在记录，请先核对，不能直接新建。");
    }
    await deps.refreshBalances();
    assertActor(env, scope);
    const journal: PayoutJournal = { version: 1, ...scope, epoch: newEpoch(env), request: null };
    writeJournal(env, scope, journal);
    return { journal, message: "已明确开始新结算，余额已重新读取；其他标签的旧草稿失效。" };
  });
}

export function browserPayoutEnvironment(actorId: () => string | null): PayoutEnvironment {
  if (typeof window === "undefined" || !globalThis.crypto?.randomUUID || !navigator.locks?.request) throw new PayoutFlowError("LOCK_UNAVAILABLE", "当前浏览器无法可靠协调跨标签结算，已停止资金提交。请使用支持 Web Locks 的安全浏览器页面。");
  let storage: Storage;
  try { storage = window.localStorage; } catch { throw new PayoutFlowError("STORAGE_UNAVAILABLE", "本机存储不可用，已停止资金提交。"); }
  return { storage, uuid: () => crypto.randomUUID(), actorId,
    withLock: async (key, run) => await navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, lock => {
      if (!lock) throw new PayoutFlowError("OTHER_TAB_BUSY", "另一标签正在处理此账号的工资请求，请等待后核对原批次。");
      return run();
    }),
  };
}
