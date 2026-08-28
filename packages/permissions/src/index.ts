import type { FieldAccess, PlanningFieldDefinition } from "@kdos/contracts";

export interface AuthorizationSubject {
  permissions?: string[];
  roles?: string[];
  divisions?: string[] | "*";
}

export interface OrganizationUnitIdentity {
  id: string;
  name: string;
  parentId?: string | null;
}

function normalizedOrganizationPath(path: string[]) {
  return path.map((part) => String(part).trim()).filter(Boolean);
}

function canonicalOrganizationPath(path: string[]) {
  return normalizedOrganizationPath(path).filter((part, index, values) => index === 0 || part !== values[index - 1]);
}

function organizationPathKey(path: string[]) {
  return canonicalOrganizationPath(path).join("\u001f");
}

/** Stable-ID matching for legacy member paths that may omit adjacent duplicate department names. */
export function createOrganizationMembershipIndex(units: OrganizationUnitIdentity[]) {
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const pathById = new Map<string, string[]>();
  const pathFor = (id: string) => {
    const cached = pathById.get(id);
    if (cached) return cached;
    const path: string[] = [];
    const visited = new Set<string>();
    let current = unitById.get(id);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current.name);
      current = current.parentId ? unitById.get(current.parentId) : undefined;
    }
    const normalized = normalizedOrganizationPath(path);
    pathById.set(id, normalized);
    return normalized;
  };
  const idsByCanonicalPath = new Map<string, string[]>();
  for (const unit of units) {
    const key = organizationPathKey(pathFor(unit.id));
    idsByCanonicalPath.set(key, [...(idsByCanonicalPath.get(key) ?? []), unit.id]);
  }
  const resolveDepartmentPath = (departmentPath: string[]) => {
    const candidates = idsByCanonicalPath.get(organizationPathKey(departmentPath)) ?? [];
    if (!candidates.length) return [];
    const deepestLevel = Math.max(...candidates.map((id) => pathFor(id).length));
    const deepest = candidates.filter((id) => pathFor(id).length === deepestLevel);
    return deepest.length === 1 ? deepest : [];
  };
  const isDescendantOrSelf = (unitId: string, ancestorId: string) => {
    const visited = new Set<string>();
    let current = unitById.get(unitId);
    while (current && !visited.has(current.id)) {
      if (current.id === ancestorId) return true;
      visited.add(current.id);
      current = current.parentId ? unitById.get(current.parentId) : undefined;
    }
    return false;
  };
  return {
    pathFor,
    unitIdForDepartmentPath: (departmentPath: string[]) => resolveDepartmentPath(departmentPath)[0],
    departmentPathBelongsTo: (departmentPath: string[], organizationId: string) =>
      resolveDepartmentPath(departmentPath).some((unitId) => isDescendantOrSelf(unitId, organizationId))
  };
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
