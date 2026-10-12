/** A missing profit is not zero. A partial sum must carry its missing-order count. */
export function summarizeGrossProfit(values: readonly (number | null)[]) {
  let knownTotal = 0, knownCount = 0, unknownCount = 0;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) unknownCount++;
    else { knownTotal += value; knownCount++; }
  }
  return { knownTotal: unknownCount > 0 && knownCount === 0 ? null : knownTotal, knownCount, unknownCount };
}
