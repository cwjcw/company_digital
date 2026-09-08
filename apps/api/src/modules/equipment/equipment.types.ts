export type EquipmentActor = {
  tenantId: string;
  userId: string | null;
  username: string;
  isSystemAdmin?: boolean;
  permissions: string[];
  tableDataScopes: Array<{
    resource: string;
    scope: string;
    match?: string;
    actions?: string[];
    rules?: Array<{ fieldKey?: string; operator?: string; value?: unknown }>;
  }>;
  requestId: string;
  source?: "web" | "import";
};

export type EquipmentScope = { unrestricted: boolean; divisionIds: string[]; own?: true };

export type EquipmentStatusImportSourceRow = {
  rowNumber: number;
  divisionName: string;
  equipmentCode: string;
  reportDate: string;
  runtimeMinutes: number;
  faultMinutes: number;
  faultReason: string | null;
};

export type EquipmentStatusImportRow = EquipmentStatusImportSourceRow & {
  equipmentId: string;
  equipmentName: string;
  action: "CREATE" | "UPDATE" | "UNCHANGED";
};

export function hasEquipmentPermission(actor: EquipmentActor, resource: string, action: string) {
  return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.permissions.includes(`${resource}:*:${action}`);
}

export function equipmentScope(actor: EquipmentActor, resource: string, action: string): EquipmentScope {
  if (actor.isSystemAdmin === true || actor.permissions.includes("*")) return { unrestricted: true, divisionIds: [] };
  const scopes = (actor.tableDataScopes ?? []).filter((scope) =>
    scope.resource === resource && (!Array.isArray(scope.actions) || scope.actions.includes(action))
  );
  if (scopes.some((scope) => scope.scope === "ALL")) return { unrestricted: true, divisionIds: [] };
  const own = scopes.some((scope) => scope.scope === "OWN");
  const divisionIds = new Set<string>();
  for (const scope of scopes) {
    const rules = scope.rules ?? [];
    const divisionRules = rules.filter((rule) => rule.fieldKey === "divisionId" && ["EQ", "IN"].includes(String(rule.operator)));
    // This service intentionally supports division authorization only. An ALL rule set containing
    // another field must fail closed instead of silently widening access to the whole division.
    if (String(scope.match ?? "ALL") === "ALL" && rules.length !== divisionRules.length) continue;
    const sets = divisionRules.map((rule) => new Set(
      rule.operator === "EQ" && typeof rule.value === "string" ? [rule.value]
        : rule.operator === "IN" && Array.isArray(rule.value) ? rule.value.filter((value): value is string => typeof value === "string") : []
    ));
    if (!sets.length) continue;
    const allowed = String(scope.match ?? "ALL") === "ANY"
      ? new Set(sets.flatMap((set) => [...set]))
      : new Set([...sets[0]!].filter((value) => sets.every((set) => set.has(value))));
    for (const value of allowed) divisionIds.add(value);
  }
  return own
    ? { unrestricted: false, divisionIds: [...divisionIds], own: true }
    : { unrestricted: false, divisionIds: [...divisionIds] };
}
