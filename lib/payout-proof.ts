import { PayoutFlowError, payoutJournalKey, type PayoutEnvironment, type PayoutScope } from "./payout-request";
import { payoutProofObjectPath } from "./ledger-payout";

export type PayoutProofDraft = {
  version: 1;
  project: string;
  actorId: string;
  payoutId: string;
  uploadId: string;
  path: string | null;
  expectedProofPath: string | null;
  fileName: string;
  fileSize: number;
  uploadConfirmed: boolean;
  phase: "uploading" | "uploaded" | "unknown" | "attached";
};
export type PayoutProofDependencies = {
  upload: (file: File, actorId: string, payoutId: string, uploadId: string) => Promise<string>;
  attach: (payoutId: string, path: string, expectedProofPath: string | null) => Promise<{ id: string; proofPath: string }>;
  read: (payoutId: string) => Promise<{ id: string; proofPath: string | null } | null>;
};

export function payoutProofKey(scope: PayoutScope, payoutId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(payoutId)) throw new PayoutFlowError("INVALID_PAYOUT", "结算记录 ID 无效。");
  return payoutJournalKey(scope) + ":proof:" + payoutId;
}

export function readPayoutProofDraft(env: PayoutEnvironment, scope: PayoutScope, payoutId: string): PayoutProofDraft | null {
  let raw: string | null;
  try { raw = env.storage.getItem(payoutProofKey(scope, payoutId)); }
  catch { throw new PayoutFlowError("STORAGE_UNAVAILABLE", "无法读取凭证待处理记录；工资结果不会被重新提交。"); }
  if (raw === null) return null;
  try {
    const draft = JSON.parse(raw) as PayoutProofDraft;
    if (draft.version !== 1 || draft.project !== scope.project || draft.actorId !== scope.actorId || draft.payoutId !== payoutId || !["uploading", "uploaded", "unknown", "attached"].includes(draft.phase)) throw new Error("scope");
    if (typeof draft.fileName !== "string" || !draft.fileName || !Number.isSafeInteger(draft.fileSize) || draft.fileSize < 0 || typeof draft.uploadConfirmed !== "boolean") throw new Error("file intent");
    if (draft.path !== payoutProofObjectPath(draft.fileName, scope.actorId, payoutId, draft.uploadId)) throw new Error("path");
    if (draft.expectedProofPath !== null && typeof draft.expectedProofPath !== "string") throw new Error("expected path");
    return draft;
  } catch { throw new PayoutFlowError("STORAGE_CORRUPT", "凭证待处理记录不完整，请核对该结算记录；不要重复结算工资。"); }
}

function persist(env: PayoutEnvironment, scope: PayoutScope, draft: PayoutProofDraft) {
  const key = payoutProofKey(scope, draft.payoutId), raw = JSON.stringify(draft);
  try { env.storage.setItem(key, raw); if (env.storage.getItem(key) !== raw) throw new Error("readback"); }
  catch { throw new PayoutFlowError("STORAGE_UNAVAILABLE", "凭证本机记录保存失败；工资已经记账，请核对附件，勿重新结算。"); }
}

/** This function has no salary-RPC dependency: every retry is attachment-only. */
export async function savePayoutProof(env: PayoutEnvironment, scope: PayoutScope, payoutId: string, file: File | null, deps: PayoutProofDependencies): Promise<{ draft: PayoutProofDraft; message: string }> {
  return env.withLock(payoutProofKey(scope, payoutId), async () => {
    const checkActor = () => { if (env.actorId() !== scope.actorId) throw new PayoutFlowError("ACTOR_CHANGED", "账号已变化，停止附件处理；工资不会再次提交。"); };
    checkActor();
    let draft = readPayoutProofDraft(env, scope, payoutId);
    const current = await deps.read(payoutId);
    checkActor();
    if (!current || current.id !== payoutId) throw new PayoutFlowError("PAYOUT_NOT_READABLE", "无法读取目标结算记录，未绑定附件。");
    if (draft?.path && current.proofPath === draft.path && (!file || draft.phase !== "attached")) {
      draft.phase = "attached";
      persist(env, scope, draft);
      return { draft, message: "凭证已由服务器确认，无需重复上传或结算。" };
    }
    if (draft?.phase === "attached" && draft.path && current.proofPath !== draft.path && !file) throw new PayoutFlowError("PROOF_CHANGED", "该批次的凭证已被其他操作更新，请重新核对；不会覆盖新凭证。");
    if (!draft?.path || draft.phase === "attached") {
      if (!file) throw new PayoutFlowError("FILE_REQUIRED", "请选择需要补传的文件；此操作不会再次扣款。");
      const uploadId = env.uuid();
      draft = { version: 1, ...scope, payoutId, uploadId, path: payoutProofObjectPath(file.name, scope.actorId, payoutId, uploadId), expectedProofPath: current.proofPath, fileName: file.name, fileSize: file.size, uploadConfirmed: false, phase: "uploading" };
      persist(env, scope, draft);
    }
    if (!draft.uploadConfirmed && file) {
      if (file.name !== draft.fileName || file.size !== draft.fileSize || payoutProofObjectPath(file.name, scope.actorId, payoutId, draft.uploadId) !== draft.path) throw new PayoutFlowError("PROOF_FILE_MISMATCH", "请重新选择原待处理文件；原上传路径与替换前凭证保持固定。");
      try {
        const path = await deps.upload(file, scope.actorId, payoutId, draft.uploadId);
        if (path !== draft.path) throw new PayoutFlowError("PROOF_PATH_MISMATCH", "上传路径与本次固定的凭证路径不匹配。");
        draft.uploadConfirmed = true;
        draft.phase = "uploaded";
        persist(env, scope, draft); // Persist object path before attempting the independent binding RPC.
      } catch (error) {
        draft.phase = "unknown";
        try { persist(env, scope, draft); } catch { /* Retain previous upload marker. */ }
        // A lost upload ACK or duplicate path is not proof of absence. The binding RPC below
        // verifies the exact object exists; neither path nor expected CAS value is replaced.
        if (error instanceof PayoutFlowError) throw error;
      }
    }
    checkActor();
    try {
      const bound = await deps.attach(payoutId, draft.path!, draft.expectedProofPath);
      if (bound.id !== payoutId || bound.proofPath !== draft.path) throw new PayoutFlowError("BIND_UNCONFIRMED", "凭证绑定响应未确认。");
      draft.phase = "attached";
      draft.uploadConfirmed = true;
      persist(env, scope, draft);
      return { draft, message: "凭证已绑定到该结算记录，本次没有再次扣款。" };
    } catch (error) {
      draft.phase = "unknown";
      try { persist(env, scope, draft); } catch { /* Uploaded path was already persisted before binding. */ }
      // Re-read may establish success after a lost response. Never re-run salary or delete the file.
      if (env.actorId() === scope.actorId) {
        try {
          const fresh = await deps.read(payoutId);
          if (fresh?.id === payoutId && fresh.proofPath === draft.path) {
            draft.phase = "attached";
            draft.uploadConfirmed = true;
            persist(env, scope, draft);
            return { draft, message: "已通过读取核对凭证绑定成功，本次没有再次扣款。" };
          }
        } catch { /* Remains uncertain; next retry uses the original uploaded path. */ }
      }
      throw error;
    }
  });
}
