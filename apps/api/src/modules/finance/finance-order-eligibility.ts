/** Current header eligibility; closure remains an independent existing item/header rule. */
export function financeOrderEligible(docType: unknown, approved: unknown): boolean {
  return String(docType ?? '').trim() !== '材料销售单' && String(approved ?? '').trim() === 'Y';
}

/** Old snapshots did not capture these attributes. Unknown is not an observed zero. */
export function financeFactEligibility(fact: Record<string, unknown>): boolean | null {
  if (!Object.prototype.hasOwnProperty.call(fact, 'docType') || !Object.prototype.hasOwnProperty.call(fact, 'headerApproved')) return null;
  return financeOrderEligible(fact.docType, fact.headerApproved);
}
