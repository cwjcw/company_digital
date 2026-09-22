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
  plannedRuntimeMinutes: number;
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

/**
 * KN-EQUIP-001 设备“新增(create)”数据范围（唯一真相）：
 * 候选设备（status-options）、正式保存（assertRecordAccess）与导入必须共用本函数，
 * 保证「候选里能选的设备」严格等于「保存允许新增的设备」，不再维护两套事业部判断。
 *
 * 语义（与权限组预设一致）：ALL/OWN/NONE 视为不受事业部限制；CUSTOM 只支持
 * `divisionId EQ <organization UUID>` / `divisionId IN [<organization UUID>...]`，
 * 一律按稳定部门 ID 比较，禁止用中文名称比较。
 */
export function equipmentCreateScope(actor: EquipmentActor, resource: string): EquipmentScope {
  if (actor.isSystemAdmin === true || actor.permissions.includes("*")) return { unrestricted: true, divisionIds: [] };
  const scopes = (actor.tableDataScopes ?? []).filter((scope) =>
    scope.resource === resource && (!Array.isArray(scope.actions) || scope.actions.includes("create"))
  );
  if (scopes.some((scope) => ["ALL", "OWN", "NONE"].includes(scope.scope))) return { unrestricted: true, divisionIds: [] };
  return equipmentScope(actor, resource, "create");
}

/** create 范围谓词：候选 SQL 与导入预校验共用（参数化，禁止拼接客户端输入）。 */
export function equipmentCreateScopeClause(actor: EquipmentActor, resource: string, alias: string, params: unknown[]) {
  const scope = equipmentCreateScope(actor, resource);
  if (scope.unrestricted) return "1=1";
  if (!scope.divisionIds.length) return "1=0";
  params.push(scope.divisionIds);
  return `${alias}.division_organization_unit_id=ANY($${params.length}::uuid[])`;
}

/** create 记录级校验：与候选 SQL 同源同语义。 */
export function equipmentCreateAllowed(actor: EquipmentActor, resource: string, divisionId: string) {
  const scope = equipmentCreateScope(actor, resource);
  return scope.unrestricted || scope.divisionIds.includes(divisionId);
}

/**
 * 设备数据范围谓词（唯一实现）：列表、总数、导出与平台 candidate 必须共用本函数，
 * 保证“候选来源集合”与“列表可见集合”完全一致。
 */
export function equipmentScopeClause(actor: EquipmentActor, resource: string, action: string, alias: string, params: unknown[]) {
  const scope = equipmentScope(actor, resource, action);
  if (scope.unrestricted) return "1=1";
  const clauses: string[] = [];
  if (scope.divisionIds.length) {
    params.push(scope.divisionIds);
    clauses.push(`${alias}.division_organization_unit_id=ANY($${params.length}::uuid[])`);
  }
  if (scope.own && actor.userId) {
    params.push(actor.userId);
    clauses.push(`${alias}.created_by=$${params.length}::uuid`);
  }
  return clauses.length ? `(${clauses.join(" OR ")})` : "1=0";
}
