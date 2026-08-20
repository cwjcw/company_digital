import type { FieldAccess, PlanningFieldDefinition } from "@kdos/contracts";

export interface AuthorizationSubject {
  permissions?: string[];
  roles?: string[];
  divisions?: string[] | "*";
}

const legacyPermissionAliases: Record<string, string[]> = {
  "planning.plan.read": ["monthly-plan:*:read", "rolling-plan:*:read"],
  "planning.plan.create": ["monthly-plan:*:create"],
  "planning.plan.update": ["monthly-plan:*:update"],
  "planning.plan.import": ["monthly-plan:*:import"],
  "planning.plan.export": ["monthly-plan:*:export"],
  "planning.plan.move": ["monthly-plan:*:update"]
};

export function hasPermission(subject: AuthorizationSubject, permission: string) {
  const permissions = subject.permissions ?? [];
  return permissions.includes("*")
    || permissions.includes(permission)
    || (legacyPermissionAliases[permission] ?? []).some((alias) => permissions.includes(alias));
}

export function fieldAccess(subject: AuthorizationSubject, field: PlanningFieldDefinition): FieldAccess {
  const permissions = subject.permissions ?? [];
  if (permissions.includes("*")) return field.editable ? "EDITABLE" : "READONLY";
  if (!hasPermission(subject, "planning.plan.read")) return "HIDDEN";
  const exactUpdate = `${field.permissionCode}.update`;
  const legacyUpdate = `monthly-plan:${field.code}:update`;
  if (field.editable && (permissions.includes(exactUpdate) || permissions.includes(legacyUpdate) || hasPermission(subject, "planning.plan.update"))) return "EDITABLE";
  return "READONLY";
}
