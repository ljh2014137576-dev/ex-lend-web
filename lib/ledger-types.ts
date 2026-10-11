export interface WalletLedgerRow {
  id: string;
  employeeId: string | null;
  employee: string;
  type: string;
  amount: number | null;
  balance: number | null;
  orderId: string | null;
  orderNo: string | null;
  payoutId: string | null;
  batchNo: string | null;
  operatorId: string | null;
  operator: string | null;
  remark: string | null;
  proofPath: string | null;
  createdAtRaw: string | null;
  at: string;
}

export interface CustomerLedgerRow {
  id: string;
  customerId: string | null;
  customer: string;
  type: string;
  amount: number | null;
  principal: number | null;
  bonus: number | null;
  orderId: string | null;
  orderNo: string | null;
  operatorId: string | null;
  operator: string | null;
  remark: string | null;
  proofPath: string | null;
  createdAtRaw: string | null;
  at: string;
}

export interface PayoutRow {
  id: string;
  batchNo: string;
  operatorId: string | null;
  operator: string;
  total: number | null;
  count: number | null;
  status: string;
  createdAtRaw: string | null;
  at: string;
  proofPath: string | null;
}

export interface PayoutDetailRow {
  id: string;
  payoutId: string | null;
  employeeId: string | null;
  employee: string;
  amount: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  createdAtRaw: string | null;
}

export interface PayoutItem { employee_id: string; amount: number }
export interface PayoutReceipt {
  success: true;
  id: string;
  receiptId: string;
  batchNo: string;
  operatorId: string;
  total: number;
  count: number;
  status: "completed";
  proofPath: string | null;
  createdAt: string;
  replayed: boolean;
  items: { employeeId: string; amount: number; balanceBefore: number; balanceAfter: number; detailId: string; ledgerId: string }[];
}
export interface PayoutApiError { message: string; code: string; uncertain: boolean }
export type PayoutMutationResult = { data: PayoutReceipt | null; error: PayoutApiError | null };
export type PayoutLookupResult = { kind: "not_found" } | { kind: "found"; receipt: PayoutReceipt | null; reason?: string };
