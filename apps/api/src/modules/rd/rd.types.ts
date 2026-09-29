export type RdActor = {
  tenantId: string; userId: string | null; username: string; permissions: string[]; moduleAdminCodes: string[];
  isSystemAdmin: boolean; tableDataScopes: Array<{ resource: string; scope: string; actions?: string[] }>;
  requestId: string; source: "web" | "api";
};

export function canRd(actor: RdActor, resource: string, action: string) {
  return actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes.includes("rd")
    || actor.permissions.includes(`${resource}:*:${action}`);
}

export function canReadRd(actor: RdActor, resource: string) { return canRd(actor, resource, "read"); }
