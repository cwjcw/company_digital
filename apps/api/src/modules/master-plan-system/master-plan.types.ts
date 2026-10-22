import { reviewDueDateEditableKeys } from '@kdos/contracts';

export type MasterPlanActor = {
  tenantId: string;
  userId: string | null;
  username: string;
  isSystemAdmin?: boolean;
  moduleAdminCodes?: string[];
  permissions: string[];
  tableDataScopes: Array<{
    resource: string; scope: string; match?: string; actions?: string[];
    rules?: Array<{ fieldKey?: string; operator?: string; value?: unknown }>;
  }>;
  requestId: string;
  source: "web" | "system";
};

export function hasMasterPlanPermission(actor: MasterPlanActor, resource: string, action: string) {
  if (resource === "mps-review-due-dates" && !["read", "export", "update", "create", "import"].includes(action)) return false;
  return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning") === true
    || actor.permissions.includes(`${resource}:*:${action}`);
}

export function hasMasterPlanFieldPermission(actor: MasterPlanActor, resource: string, field: string, action: "read" | "update") {
  if (resource === "mps-review-due-dates" && action === "update" && !reviewDueDateEditableKeys.includes(field)) return false;
  return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning") === true
    || actor.permissions.includes(`${resource}:${field}:${action}`);
}

/** Creation fills readable/editable business fields; it does not grant update to existing records. */
export function hasReviewDueCreateFieldPermission(actor: MasterPlanActor, field: string) {
  return reviewDueDateEditableKeys.includes(field) && hasMasterPlanPermission(actor,'mps-review-due-dates','create')
    && (hasMasterPlanFieldPermission(actor,'mps-review-due-dates',field,'read') || hasMasterPlanFieldPermission(actor,'mps-review-due-dates',field,'update'));
}
