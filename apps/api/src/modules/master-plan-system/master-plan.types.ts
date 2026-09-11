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
  return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning") === true
    || actor.permissions.includes(`${resource}:*:${action}`);
}

export function hasMasterPlanFieldPermission(actor: MasterPlanActor, resource: string, field: string, action: "read" | "update") {
  return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning") === true
    || actor.permissions.includes(`${resource}:${field}:${action}`);
}

