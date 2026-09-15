import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP, type MasterPlanResource } from "./master-plan.config";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { OrganizationDirectoryService } from "../organization-directory/organization-directory.service";

type ListInput = { page?: unknown; pageSize?: unknown; search?: unknown; filters?: unknown; sortField?: unknown; sortOrder?: unknown; view?: unknown };

@Injectable()
export class MasterPlanQueryService {
  constructor(private readonly dataSource: DataSource, private readonly directory: OrganizationDirectoryService) {}

  metadata(code: string, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "read")) throw new ForbiddenException("当前权限组没有该表查看权限");
    const canCreate = resource.create && hasMasterPlanPermission(actor, code, "create");
    return {
      resource: resource.code,
      fields: fieldsFor(resource).filter((field) => this.visible(actor, code, field.key)),
      createFields: canCreate ? fieldsFor(resource).filter((field) => field.editable && this.visible(actor, code, field.key)) : [],
      actions: {
        create: canCreate,
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
    if (code === "mps-process-reports" && String(input.view ?? "").toUpperCase() === "PENDING") return this.processReportTasks(input, actor);
    const allColumns = columnsFor(resource);
    const visibleFields = fieldsFor(resource).map((field) => field.key).filter((field) => this.visible(actor, code, field));
    if (!visibleFields.length) throw new ForbiddenException("当前权限组没有该表可见字段");
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const requestedPageSize = Math.floor(Number(input.pageSize) || 50);
    const pageSize = [20, 50, 100, 200].includes(requestedPageSize) ? requestedPageSize : 50;
    const params: unknown[] = [actor.tenantId];
    const clauses = [`record.tenant_id=$1`, this.scopeClause(resource, actor, "read", allColumns, params)];
    if (["mps-weekly-process-plans", "mps-outsourcing-reports"].includes(code)) clauses.push("record.execution_enabled=true");
    const organizationOptions = resource.divisionField && visibleFields.includes(resource.divisionField) ? await this.directory.listEnabled() : [];
    const search = String(input.search ?? "").trim();
    if (search) {
      const searchableFields = visibleFields.filter((field) => field !== resource.divisionField && !allColumns[field]!.startsWith("("));
      params.push(`%${search}%`);
      const alternatives = searchableFields.map((field) => `COALESCE(${this.expression(allColumns[field]!)}::text,'') ILIKE $${params.length}`);
      const organizationIds = organizationOptions.filter((option) => option.name.includes(search) || option.pathLabel.includes(search)).map((option) => option.id);
      if (organizationIds.length && resource.divisionField) { params.push(organizationIds); alternatives.push(`${this.expression(allColumns[resource.divisionField]!)}=ANY($${params.length}::uuid[])`); }
      clauses.push(`(${alternatives.join(" OR ") || "1=0"})`);
    }
    for (const [field, raw] of Object.entries(this.filters(input.filters))) {
      if (!visibleFields.includes(field)) continue;
      const value = String(raw ?? "").trim(); if (!value) continue;
      if (field === resource.divisionField) {
        const ids = organizationOptions.filter((option) => option.name.includes(value) || option.pathLabel.includes(value) || option.id === value).map((option) => option.id);
        params.push(ids); clauses.push(`${this.expression(allColumns[field]!)}=ANY($${params.length}::uuid[])`);
      } else { params.push(`%${value}%`); clauses.push(`COALESCE(${this.expression(allColumns[field]!)}::text,'') ILIKE $${params.length}`); }
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
    const dataParams = [...params];
    const updateAllowed = hasMasterPlanPermission(actor, code, "update")
      ? this.scopeClause(resource, actor, "update", allColumns, dataParams)
      : "false";
    const deleteAllowed = resource.remove && hasMasterPlanPermission(actor, code, "delete")
      ? this.scopeClause(resource, actor, "delete", allColumns, dataParams)
      : "false";
    const selected = visibleFields.map((field) => `${this.expression(allColumns[field]!)} "${field}"`);
    selected.push(`(${updateAllowed}) "canUpdate"`);
    selected.push(`(${deleteAllowed}) "canDelete"`);
    const joins: string[] = [];
    if (resource.divisionField && visibleFields.includes(resource.divisionField)) {
      joins.push(`LEFT JOIN organization_units division ON division.id=record.${allColumns[resource.divisionField]}`);
      selected.push(`division.name "divisionName"`);
    }
    if (resource.code === "mps-weekly-process-plans" && visibleFields.includes("weeklyPlanId")) {
      joins.push("LEFT JOIN mps_weekly_plans weekly_reference ON weekly_reference.tenant_id=record.tenant_id AND weekly_reference.id=record.weekly_plan_id");
      selected.push(`concat_ws(' / ',weekly_reference.order_number,weekly_reference.item_code,weekly_reference.item_name,'交期编码'||weekly_reference.delivery_number::text) "weeklyPlanLabel"`);
    }
    dataParams.push(pageSize, (page - 1) * pageSize);
    const rows = await this.dataSource.query(`SELECT record.id,record.version,${selected.join(",")} FROM ${resource.table} record ${joins.join(" ")} WHERE ${where} ORDER BY ${orderBy} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams);
    const paths = new Map(organizationOptions.map((option) => [option.id, option.pathLabel]));
    if (resource.divisionField) for (const row of rows) row.divisionName = paths.get(String(row[resource.divisionField] ?? "")) ?? row.divisionName ?? null;
    return { rows, total: Number(count), page, pageSize, visibleFields };
  }

  async organizationOptions(code: string, actor: MasterPlanActor) {
    const resource = this.resource(code);
    const departmentFields = fieldsFor(resource).filter((field) => field.type === "department");
    const hasTableAccess = ["read", "create", "update", "import"].some((action) => hasMasterPlanPermission(actor, code, action));
    const hasFieldAccess = departmentFields.some((field) => this.visible(actor, code, field.key));
    if (!hasTableAccess || !hasFieldAccess) throw new ForbiddenException("当前权限组不能访问该表事业部选项");
    return this.directory.listEnabled();
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

  async weeklyPlanOptions(searchInput: unknown, actor: MasterPlanActor) {
    const resource = this.resource("mps-weekly-plans");
    if (!hasMasterPlanPermission(actor, resource.code, "read")) throw new ForbiddenException("当前权限组没有事业部周计划查看权限");
    const columns = columnsFor(resource); const params: unknown[] = [actor.tenantId];
    const clauses = [`record.tenant_id=$1`, this.scopeClause(resource, actor, "read", columns, params)];
    const search = String(searchInput ?? "").trim();
    if (search) { params.push(`%${search}%`); clauses.push(`concat_ws('/',record.order_number,record.item_code,record.item_name,record.delivery_number::text) ILIKE $${params.length}`); }
    return this.dataSource.query(`SELECT record.id,concat_ws(' / ',record.order_number,record.item_code,record.item_name,'交期编码'||record.delivery_number::text) label FROM mps_weekly_plans record WHERE ${clauses.join(" AND ")} ORDER BY record.latest_review_due_date DESC,record.order_number,record.item_code,record.delivery_number LIMIT 100`, params);
  }

  private async processReportTasks(input: ListInput, actor: MasterPlanActor) {
    const resource = this.resource("mps-process-reports"); const columns = columnsFor(resource);
    const visibleFields = fieldsFor(resource).map((field) => field.key).filter((field) => this.visible(actor, resource.code, field));
    if (!visibleFields.length) throw new ForbiddenException("当前权限组没有该表可见字段");
    const page = Math.max(1, Math.floor(Number(input.page) || 1)); const requested = Math.floor(Number(input.pageSize) || 50); const pageSize = [20,50,100,200].includes(requested) ? requested : 50;
    const source = `SELECT task.id,task.version,task.tenant_id,weekly.division_id,task.weekly_plan_id,weekly.order_number,weekly.item_code,weekly.item_name,weekly.delivery_number,task.process_code,task.process_name,NULL::date production_date,weekly.planned_quantity,NULL::numeric production_quantity,task.created_by,task.created_at,task.updated_by,task.updated_at FROM mps_weekly_process_plans task JOIN mps_weekly_plans weekly ON weekly.tenant_id=task.tenant_id AND weekly.id=task.weekly_plan_id WHERE task.execution_enabled=true AND task.status<>'已完成'`;
    const params: unknown[] = [actor.tenantId]; const clauses = ["record.tenant_id=$1", this.scopeClause(resource, actor, "read", columns, params)];
    const organizations = visibleFields.includes("divisionId") ? await this.directory.listEnabled() : [];
    const search = String(input.search ?? "").trim();
    if (search) {
      const searchableFields = visibleFields.filter((field) => field !== "divisionId" && columns[field] && !columns[field]!.startsWith("("));
      params.push(`%${search}%`);
      const alternatives = searchableFields.map((field) => `COALESCE(${this.expression(columns[field]!)}::text,'') ILIKE $${params.length}`);
      const organizationIds = organizations.filter((option) => option.name.includes(search) || option.pathLabel.includes(search)).map((option) => option.id);
      if (organizationIds.length) { params.push(organizationIds); alternatives.push(`record.division_id=ANY($${params.length}::uuid[])`); }
      clauses.push(`(${alternatives.join(" OR ") || "1=0"})`);
    }
    for (const [field, raw] of Object.entries(this.filters(input.filters))) {
      if (!visibleFields.includes(field) || !columns[field]) continue; const value = String(raw ?? "").trim(); if (!value) continue;
      if (field === "divisionId") {
        const ids = organizations.filter((option) => option.name.includes(value) || option.pathLabel.includes(value) || option.id === value).map((option) => option.id);
        params.push(ids); clauses.push(`record.division_id=ANY($${params.length}::uuid[])`);
      } else { params.push(`%${value}%`); clauses.push(`COALESCE(${this.expression(columns[field]!)}::text,'') ILIKE $${params.length}`); }
    }
    const where = clauses.join(" AND "); const [{ count }] = await this.dataSource.query(`WITH record AS (${source}) SELECT count(*)::integer count FROM record WHERE ${where}`, params);
    const selected = visibleFields.map((field) => `${this.expression(columns[field]!)} "${field}"`); const dataParams = [...params, pageSize, (page - 1) * pageSize];
    const rows = await this.dataSource.query(`WITH record AS (${source}) SELECT record.id,record.version,false "canUpdate",false "canDelete",true "pendingTask",${selected.join(",")} FROM record WHERE ${where} ORDER BY record.production_date DESC NULLS LAST,record.order_number,record.item_code,record.delivery_number,record.process_code LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams);
    const paths = new Map(organizations.map((option) => [option.id, option.pathLabel]));
    for (const row of rows) {
      if (visibleFields.includes("divisionId")) row.divisionName = paths.get(String(row.divisionId ?? "")) ?? null;
      if (visibleFields.includes("weeklyPlanId")) row.weeklyPlanLabel = `${row.orderNumber ?? ""} / ${row.itemCode ?? ""} / ${row.itemName ?? ""} / 交期编码${row.deliveryNumber ?? ""}`;
    }
    return { rows, total: Number(count), page, pageSize, visibleFields };
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
