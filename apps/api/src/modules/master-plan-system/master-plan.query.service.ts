import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP, type MasterPlanResource } from "./master-plan.config";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

type ListInput = { page?: unknown; pageSize?: unknown; search?: unknown; filters?: unknown; sortField?: unknown; sortOrder?: unknown; view?: unknown };

@Injectable()
export class MasterPlanQueryService {
  constructor(private readonly dataSource: DataSource) {}

  metadata(code: string, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "read")) throw new ForbiddenException("当前权限组没有该表查看权限");
    return {
      resource: resource.code,
      fields: fieldsFor(resource).filter((field) => this.visible(actor, code, field.key)),
      actions: {
        create: resource.create && hasMasterPlanPermission(actor, code, "create"),
        update: hasMasterPlanPermission(actor, code, "update"),
        delete: resource.remove && hasMasterPlanPermission(actor, code, "delete"),
        import: hasMasterPlanPermission(actor, code, "import"),
        export: hasMasterPlanPermission(actor, code, "export"),
        batchUpdate: hasMasterPlanPermission(actor, code, "batch_update") && fieldsFor(resource).some((field) => field.editable && hasMasterPlanFieldPermission(actor, code, field.key, "update"))
      }
    };
  }

  async list(code: string, input: ListInput, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "read")) throw new ForbiddenException("当前权限组没有该表查看权限");
    const allColumns = columnsFor(resource);
    const visibleFields = Object.keys(allColumns).filter((field) => this.visible(actor, code, field));
    if (!visibleFields.length) throw new ForbiddenException("当前权限组没有该表可见字段");
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const requestedPageSize = Math.floor(Number(input.pageSize) || 50);
    const pageSize = [20, 50, 100, 200].includes(requestedPageSize) ? requestedPageSize : 50;
    const params: unknown[] = [actor.tenantId];
    const clauses = [`record.tenant_id=$1`, this.scopeClause(resource, actor, "read", allColumns, params)];
    const search = String(input.search ?? "").trim();
    if (search) {
      const searchableFields = visibleFields.filter((field) => !allColumns[field]!.startsWith("("));
      params.push(`%${search}%`);
      clauses.push(`(${searchableFields.map((field) => `COALESCE(${this.expression(allColumns[field]!)}::text,'') ILIKE $${params.length}`).join(" OR ") || "1=0"})`);
    }
    for (const [field, raw] of Object.entries(this.filters(input.filters))) {
      if (!visibleFields.includes(field)) continue;
      const value = String(raw ?? "").trim(); if (!value) continue;
      params.push(`%${value}%`); clauses.push(`COALESCE(${this.expression(allColumns[field]!)}::text,'') ILIKE $${params.length}`);
    }
    const view = String(input.view ?? "ALL").toUpperCase();
    if (["mps-group-plans", "mps-monthly-plans"].includes(code)) {
      if (view === "COMPLETE") clauses.push("record.completion_rate>=1");
      if (view === "INCOMPLETE") clauses.push("record.completion_rate<1");
    }
    const where = clauses.join(" AND ");
    const [{ count }] = await this.dataSource.query(`SELECT count(*)::integer count FROM ${resource.table} record WHERE ${where}`, params);
    const requestedSort = String(input.sortField ?? "");
    const sortColumn = visibleFields.includes(requestedSort) ? allColumns[requestedSort] : "";
    const orderBy = sortColumn ? `${this.expression(sortColumn)} ${String(input.sortOrder) === "desc" ? "DESC" : "ASC"} NULLS LAST` : resource.defaultOrder.split(",").map((part) => `record.${part.trim()}`).join(",");
    const selected = visibleFields.map((field) => `${this.expression(allColumns[field]!)} "${field}"`);
    const divisionJoin = resource.divisionField && visibleFields.includes(resource.divisionField)
      ? `LEFT JOIN organization_units division ON division.id=record.${allColumns[resource.divisionField]}` : "";
    if (divisionJoin) selected.push(`division.name "divisionName"`);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await this.dataSource.query(`SELECT record.id,record.version,${selected.join(",")} FROM ${resource.table} record ${divisionJoin} WHERE ${where} ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total: Number(count), page, pageSize, visibleFields };
  }

  async exportRows(code: string, input: ListInput, actor: MasterPlanActor) {
    if (!hasMasterPlanPermission(actor, code, "export")) throw new ForbiddenException("当前权限组没有该表导出权限");
    const first = await this.list(code, { ...input, page: 1, pageSize: 200 }, actor);
    const rows = [...first.rows];
    for (let page = 2; rows.length < first.total; page++) {
      const next = await this.list(code, { ...input, page, pageSize: 200 }, actor);
      rows.push(...next.rows);
      if (!next.rows.length) break;
    }
    return { rows, visibleFields: first.visibleFields };
  }

  private resource(code: string) {
    const resource = MASTER_PLAN_RESOURCE_MAP.get(code as any);
    if (!resource) throw new NotFoundException("主计划表不存在");
    return resource;
  }

  private expression(column: string) { return column.startsWith("(") ? column : `record.${column}`; }

  private visible(actor: MasterPlanActor, resource: string, field: string) {
    return hasMasterPlanFieldPermission(actor, resource, field, "read") || hasMasterPlanFieldPermission(actor, resource, field, "update");
  }

  private filters(raw: unknown): Record<string, unknown> {
    if (raw == null || raw === "") return {};
    try {
      const value = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100) throw new Error();
      return value as Record<string, unknown>;
    } catch { throw new BadRequestException("筛选条件格式无效"); }
  }

  private scopeClause(resource: MasterPlanResource, actor: MasterPlanActor, action: string, columns: Record<string, string>, params: unknown[]) {
    if (actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning")) return "1=1";
    const scopes = (actor.tableDataScopes ?? []).filter((scope) => scope.resource === resource.code && (!scope.actions || scope.actions.includes(action)));
    if (scopes.some((scope) => scope.scope === "ALL")) return "1=1";
    const alternatives: string[] = [];
    if (actor.userId && scopes.some((scope) => scope.scope === "OWN")) { params.push(actor.userId); alternatives.push(`record.created_by=$${params.length}::uuid`); }
    for (const scope of scopes.filter((entry) => entry.scope === "CUSTOM")) {
      const rules = (scope.rules ?? []).map((rule) => this.ruleClause(rule, actor, columns, params)).filter(Boolean) as string[];
      if (rules.length) alternatives.push(`(${rules.join(scope.match === "ANY" ? " OR " : " AND ")})`);
    }
    return alternatives.length ? `(${alternatives.join(" OR ")})` : "1=0";
  }

  private ruleClause(rule: { fieldKey?: string; operator?: string; value?: unknown }, actor: MasterPlanActor, columns: Record<string, string>, params: unknown[]) {
    const column = columns[String(rule.fieldKey ?? "")]; if (!column) return ""; const expression = this.expression(column);
    const operator = String(rule.operator ?? ""); const value = rule.value === "CURRENT_USER" ? actor.userId : rule.value;
    if (operator === "IS_EMPTY") return `(${expression} IS NULL OR btrim(${expression}::text)='')`;
    if (operator === "IS_NOT_EMPTY") return `(${expression} IS NOT NULL AND btrim(${expression}::text)<>'')`;
    if (["IN", "NOT_IN"].includes(operator)) { const values = Array.isArray(value) ? value.map(String).filter(Boolean) : []; if (!values.length) return operator === "IN" ? "1=0" : "1=1"; params.push(values); return `${expression}::text ${operator === "NOT_IN" ? "<> ALL" : "= ANY"}($${params.length}::text[])`; }
    if (value == null) return "";
    const comparisons: Record<string, string> = { EQ: "=", NE: "<>", GT: ">", GTE: ">=", LT: "<", LTE: "<=" };
    if (comparisons[operator]) { params.push(String(value)); return `${expression}::text ${comparisons[operator]} $${params.length}`; }
    if (["CONTAINS", "NOT_CONTAINS", "STARTS_WITH"].includes(operator)) { params.push(operator === "STARTS_WITH" ? `${value}%` : `%${value}%`); return `COALESCE(${expression}::text,'') ${operator === "NOT_CONTAINS" ? "NOT ILIKE" : "ILIKE"} $${params.length}`; }
    return "";
  }
}
