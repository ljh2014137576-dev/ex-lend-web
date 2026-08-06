// 客户钱包流水类型 → 中文展示（customer_wallet_ledger.type）
export const CUSTOMER_LEDGER_TYPE_LABELS: Record<string, string> = {
  recharge_principal: "充值本金",
  recharge_bonus: "充值赠送",
  recharge_custom: "自定义充值",
  consume_principal: "下单扣款·本金",
  consume_bonus: "下单扣款·赠送",
  consume_from_pending: "预收转消费",
  cash_received: "现金预收",
  cash_refund: "现金退款",
  refund: "订单退款",
  adjust: "人工调整",
};

export function customerLedgerTypeLabel(type: string): string {
  return CUSTOMER_LEDGER_TYPE_LABELS[type] ?? type;
}
