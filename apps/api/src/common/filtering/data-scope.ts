import type { TableFilterActor } from "./table-filter.registry";

/**
 * 平台通用数据范围片段（KN-FILTER-001）：按 actor 的 tableDataScopes 生成参数化 WHERE 片段。
 * 语义与各模块既有实现一致：ALL/NONE 放行、OWN 按 created_by、CUSTOM 按规则命中；无任何范围配置时拒绝。
 * 任何 candidate / filter 查询都必须先拼上该片段，保证 tenant 与数据范围始终生效。
 */
export function buildDataScopeClause(input: {
  resource: string; action?: string; columns: Record<string, string>; actor: TableFilterActor; params: unknown[]; expression?: (column: string) => string;
}): string {
  const { resource, columns, actor, params } = input;
  const action = input.action ?? "read";
  const expression = input.expression ?? ((column: string) => `record.${column}`);
  if (actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning")) return "1=1";
  const scopes = (actor.tableDataScopes ?? []).filter((scope) => scope.resource === resource && (!scope.actions || scope.actions.includes(action)));
  if (scopes.some((scope) => scope.scope === "ALL" || scope.scope === "NONE")) return "1=1";
  const alternatives: string[] = [];
  if (actor.userId && scopes.some((scope) => scope.scope === "OWN")) { params.push(actor.userId); alternatives.push(`record.created_by=$${params.length}::uuid`); }
  for (const scope of scopes.filter((entry) => entry.scope === "CUSTOM")) {
    const rules = (scope.rules ?? []).map((rule) => {
      const column = columns[String(rule.fieldKey ?? "")];
      if (!column) return "";
      const target = expression(column);
      const operator = String(rule.operator ?? "");
      const value = rule.value === "CURRENT_USER" ? actor.userId : rule.value;
      if (operator === "IS_EMPTY") return `(${target} IS NULL OR btrim(${target}::text)='')`;
      if (operator === "IS_NOT_EMPTY") return `(${target} IS NOT NULL AND btrim(${target}::text)<>'')`;
      if (operator === "IN" || operator === "NOT_IN") {
        const values = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
        if (!values.length) return operator === "IN" ? "1=0" : "1=1";
        params.push(values); return `${target}::text ${operator === "NOT_IN" ? "<> ALL" : "= ANY"}($${params.length}::text[])`;
      }
      if (value == null) return "";
      const comparisons: Record<string, string> = { EQ: "=", NE: "<>", GT: ">", GTE: ">=", LT: "<", LTE: "<=" };
      if (comparisons[operator]) { params.push(String(value)); return `${target}::text ${comparisons[operator]} $${params.length}`; }
      if (["CONTAINS", "NOT_CONTAINS", "STARTS_WITH"].includes(operator)) {
        params.push(operator === "STARTS_WITH" ? `${value}%` : `%${value}%`);
        return `COALESCE(${target}::text,'') ${operator === "NOT_CONTAINS" ? "NOT ILIKE" : "ILIKE"} $${params.length}`;
      }
      return "";
    }).filter(Boolean) as string[];
    if (rules.length) alternatives.push(`(${rules.join(scope.match === "ANY" ? " OR " : " AND ")})`);
  }
  return alternatives.length ? `(${alternatives.join(" OR ")})` : "1=0";
}
