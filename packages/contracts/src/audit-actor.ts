/** 审计身份展示规则；稳定 actor 值只用于内部关联和筛选，不改写历史。 */
export type AuditActorUser = { id: string; username: string; displayName: string | null };
export const isAuditActorUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isAuditActorField = (field: { format?: string }) => field.format === "auditActor";

export function auditActorUserLabels(users: readonly AuditActorUser[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const user of users) {
    const label = user.displayName?.trim() || user.username;
    labels.set(user.id.toLowerCase(), label);
    labels.set(user.username, label);
  }
  return labels;
}

export function formatAuditActor(value: unknown, labels: ReadonlyMap<string, string> = new Map()): string {
  // 保留现有 Web 空值/系统显示；正式文字 actor 沿用其原始可读名称。
  if (value == null || value === "" || value === "system") return "系统";
  const raw = String(value);
  const uuid = isAuditActorUuid(raw);
  return labels.get(uuid ? raw.toLowerCase() : raw) || (uuid ? "未知用户" : raw);
}
