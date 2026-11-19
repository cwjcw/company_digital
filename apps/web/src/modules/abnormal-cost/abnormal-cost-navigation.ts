type PermissionSession = { sub?: string; userId?: string } | null | undefined;

export function abnormalJudgmentNavigationItem(session: PermissionSession) {
  // Assignment grants access to the assignee's own row; the API applies that
  // row boundary, so the entry must remain discoverable without a table grant.
  if (!session?.sub && !session?.userId) return null;
  return { key: '/workflow/abnormal-cost/judgments', label: '责任判定表' };
}
