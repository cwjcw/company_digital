import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { DataSource } from "typeorm";
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP, processReportPendingColumns, processReportPendingFields, type MasterPlanResource } from "./master-plan.config";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { OrganizationDirectoryService } from "../organization-directory/organization-directory.service";
import { standardProcesses } from "@tracker/shared";
import { MasterPlanFilterCompiler } from "./master-plan.filter";
import { FieldCandidateService } from "../../common/filtering/field-candidate.service";

type ListInput = { page?: unknown; pageSize?: unknown; search?: unknown; filters?: unknown; filterGroup?: unknown; sortField?: unknown; sortOrder?: unknown; view?: unknown; basePlanId?: unknown; /** KN-PRINT-001 打印已选：稳定记录 ID。 */ ids?: unknown };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const basePlanDerivedFields = new Set(["weeklyPlanState", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue"]);
const processReportDerivedFields = new Set(["cumulativeReportedQuantity", "remainingQuantity"]);

@Injectable()
export class MasterPlanQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly directory: OrganizationDirectoryService,
    /* 字段候选值服务（平台级）；单元测试直接构造时可省略。 */
    @Optional() @Inject(FieldCandidateService) private readonly candidates?: Pick<FieldCandidateService, "resolve">
  ) {}

  metadata(code: string, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "read")) throw new ForbiddenException("当前权限组没有该表查看权限");
    const canCreate = resource.create && hasMasterPlanPermission(actor, code, "create");
    return {
      resource: resource.code,
      fields: fieldsFor(resource).filter((field) => this.visible(actor, code, field.key)),
      createFields: canCreate ? fieldsFor(resource).filter((field) => (field.editable || (field as { createOnly?: boolean }).createOnly) && this.visible(actor, code, field.key)) : [],
      actions: {
        create: canCreate,
        update: hasMasterPlanPermission(actor, code, "update"),
        delete: resource.remove && hasMasterPlanPermission(actor, code, "delete"),
        import: hasMasterPlanPermission(actor, code, "import"),
        export: hasMasterPlanPermission(actor, code, "export"),
        viewWeekly: code === "mps-base-plans" && hasMasterPlanPermission(actor, "mps-weekly-plans", "read"),
        /* 待报工行内填报的本质是 CREATE 实际报工记录，因此按 mps-process-reports 的新增权限判定，不借用修改权限。 */
        reportProcess: code === "mps-process-reports" && hasMasterPlanPermission(actor, code, "create"),
        batchUpdate: hasMasterPlanPermission(actor, code, "batch_update") && fieldsFor(resource).some((field) => field.editable && hasMasterPlanFieldPermission(actor, code, field.key, "update"))
      },
      /* 待报工视图字段与 Excel 模板共用同一份权威定义；累计/剩余由实际报工汇总，只读。 */
      pendingFields: code === "mps-process-reports" ? processReportPendingFields().filter((field) => this.visible(actor, code, field.key)) : undefined,
      /* 工序顺序唯一来源：@tracker/shared canonical registry（含毛坯），前端据此生成周计划工序分组与顺序。 */
      processes: standardProcesses.map((process) => ({ code: process.code, name: process.name, order: process.order }))
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
    /* KN-PRINT-001：打印已选只取选中记录（与列表共用同一 where/排序/分页语义）。 */
    const printIds = Array.isArray(input.ids) ? input.ids.map((id) => String(id)).filter(Boolean) : [];
    if (printIds.length) { params.push(printIds); clauses.push(`record.id = ANY($${params.length}::uuid[])`); }
    if (code === "mps-weekly-plans" && input.basePlanId != null && String(input.basePlanId).trim() !== "") {
      const basePlanId = String(input.basePlanId).trim();
      if (!uuidPattern.test(basePlanId)) throw new BadRequestException("基础计划定位参数无效");
      params.push(basePlanId); clauses.push(`record.base_plan_id=$${params.length}::uuid`);
    }
    const organizationOptions = resource.divisionField && visibleFields.includes(resource.divisionField) ? await this.directory.listEnabled() : [];
    const search = String(input.search ?? "").trim();
    if (search) {
      const searchableFields = visibleFields.filter((field) => field !== resource.divisionField && !allColumns[field]!.startsWith("("));
      params.push(`%${search}%`);
      const alternatives = searchableFields.map((field) => `COALESCE(${this.expression(allColumns[field]!)}::text,'') ILIKE $${params.length}`);
      for (const field of searchableFields) {
        const optionValues = this.resolveOptionFilterValues(resource, field, search);
        if (!optionValues?.length) continue;
        params.push(optionValues); alternatives.push(`${this.expression(allColumns[field]!)}::text = ANY($${params.length}::text[])`);
      }
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
      } else if (!this.applyDictionaryFilter(resource, field, this.expression(allColumns[field]!), value, params, clauses)) {
        params.push(`%${value}%`); clauses.push(`COALESCE(${this.expression(allColumns[field]!)}::text,'') ILIKE $${params.length}`);
      }
    }
    /* KN-FILTER-001：类型化高级筛选（ALL/ANY）。字段类型、可筛选性与操作符全部由服务端 metadata 决定，
       与旧 Record<string,string> 条件并存；两者都只能落在当前用户可见字段上。 */
    if (input.filterGroup != null && String(input.filterGroup).trim() !== "") {
      const compiler = new MasterPlanFilterCompiler(
        fieldsFor(resource), allColumns, (key) => visibleFields.includes(key),
        (column) => this.expression(column), (field, raw) => this.resolveOptionFilterValues(resource, field, raw)
      );
      clauses.push(compiler.compile(input.filterGroup, params));
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
    if (resource.code === "mps-base-plans") {
      selected.push(`(SELECT weekly.id FROM mps_weekly_plans weekly WHERE weekly.tenant_id=record.tenant_id AND weekly.base_plan_id=record.id) "weeklyPlanId"`);
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

  /** 待报工导入模板需要当前全部待报工任务作为识别行（不含填报值）。 */
  async pendingReportRows(actor: MasterPlanActor) {
    const first = await this.processReportTasks({ page: 1, pageSize: 200 }, actor);
    const rows = [...first.rows];
    for (let page = 2; rows.length < first.total; page++) {
      const next = await this.processReportTasks({ page, pageSize: 200 }, actor);
      rows.push(...next.rows);
      if (!next.rows.length) break;
    }
    return { rows, visibleFields: first.visibleFields };
  }

  /**
   * KN-FILTER-001 字段候选值：只返回当前用户可见（资源读权限 + 字段读权限 + 租户 + 数据范围）范围内的候选。
   * 字典字段复用正式 options（不查历史数据库值），reference 走声明好的候选来源资源。
   */
  async fieldCandidates(code: string, fieldKey: unknown, search: unknown, limit: unknown, actor: MasterPlanActor, view?: unknown) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "read")) throw new ForbiddenException("当前权限组没有该表查看权限");
    /* 只有显式请求 PENDING 视图时才使用待报工字段集（否则按实际报工字段集解析）。 */
    const pending = code === "mps-process-reports" && String(view ?? "").toUpperCase() === "PENDING";
    const columns = pending ? processReportPendingColumns() : columnsFor(resource);
    const expressions = Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, this.expression(column)]));
    const params: unknown[] = [actor.tenantId];
    const scope = this.scopeClause(resource, actor, "read", columns, params);
    if (!this.candidates) throw new BadRequestException("字段候选值服务不可用");
    return this.candidates.resolve(String(fieldKey ?? ""), search, limit, {
      fields: pending ? processReportPendingFields() : fieldsFor(resource),
      expressions,
      canReadField: (key) => this.visible(actor, code, key),
      scopedSource: `${resource.table} record`,
      scopedWhere: `record.tenant_id=$1 AND ${scope}`,
      scopedParams: params,
      departmentCandidates: async (term, size) => (await this.directory.listEnabled())
        .filter((option) => !term || option.name.includes(term) || option.pathLabel.includes(term))
        .slice(0, size).map((option) => ({ value: option.id, label: option.pathLabel })),
      memberCandidates: async (term, size) => (await this.dataSource.query(
        `SELECT id, COALESCE(NULLIF(display_name,''),username) label FROM users WHERE enabled=true${term ? " AND (COALESCE(display_name,'') ILIKE $1 OR username ILIKE $1)" : ""} ORDER BY label LIMIT $${term ? 2 : 1}`,
        term ? [`%${term}%`, size] : [size]
      )).map((row: { id: string; label: string }) => ({ value: row.id, label: row.label })),
      referenceCandidates: (referenceResource, term, size) => this.referenceCandidates(referenceResource, term, size, actor)
    });
  }

  private async referenceCandidates(referenceResource: string, term: string, size: number, actor: MasterPlanActor) {
    if (referenceResource === "mps-weekly-plans") {
      if (!hasMasterPlanPermission(actor, "mps-weekly-plans", "read")) throw new ForbiddenException("当前权限组没有事业部周计划查看权限");
      const resource = this.resource("mps-weekly-plans");
      const params: unknown[] = [actor.tenantId];
      const scope = this.scopeClause(resource, actor, "read", columnsFor(resource), params);
      let clause = "record.tenant_id=$1 AND " + scope;
      if (term) { params.push(`%${term}%`); clause += ` AND concat_ws(' / ',record.order_number,record.item_code,record.item_name) ILIKE $${params.length}`; }
      params.push(size);
      return (await this.dataSource.query(`SELECT record.id value, concat_ws(' / ',record.order_number,record.item_code,record.item_name,'交期编码'||record.delivery_number::text) label
        FROM mps_weekly_plans record WHERE ${clause} ORDER BY label LIMIT $${params.length}`, params))
        .map((row: { value: string; label: string }) => ({ value: row.value, label: row.label }));
    }
    if (referenceResource === "suppliers") {
      if (!hasMasterPlanPermission(actor, "suppliers", "read")) throw new ForbiddenException("当前权限组没有供应商查看权限");
      const params: unknown[] = [];
      let clause = "enabled=true";
      if (term) { params.push(`%${term}%`); clause += ` AND name ILIKE $${params.length}`; }
      params.push(size);
      return (await this.dataSource.query(`SELECT id value, name label FROM suppliers WHERE ${clause} ORDER BY name LIMIT $${params.length}`, params))
        .map((row: { value: string; label: string }) => ({ value: row.value, label: row.label }));
    }
    if (referenceResource === "equipment-register") {
      if (!hasMasterPlanPermission(actor, "equipment-register", "read")) throw new ForbiddenException("当前权限组没有设备台账查看权限");
      const params: unknown[] = [actor.tenantId];
      let clause = "tenant_id=$1 AND active=true";
      if (term) { params.push(`%${term}%`); clause += ` AND (equipment_code ILIKE $${params.length} OR equipment_name ILIKE $${params.length})`; }
      params.push(size);
      return (await this.dataSource.query(`SELECT id value, concat_ws(' / ',equipment_code,equipment_name) label FROM equipment_assets WHERE ${clause} ORDER BY label LIMIT $${params.length}`, params))
        .map((row: { value: string; label: string }) => ({ value: row.value, label: row.label }));
    }
    throw new BadRequestException(`关联字段候选来源暂不支持：${referenceResource}`);
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
    /* 待报工任务不是 mps_process_reports 记录：它来自 mps_weekly_process_plans + mps_weekly_plans，
       累计/剩余由实际报工 SUM 得出，字段顺序取自唯一权威定义 processReportPendingFields()。 */
    const resource = this.resource("mps-process-reports"); const columns = processReportPendingColumns();
    const visibleFields = processReportPendingFields().map((field) => field.key).filter((field) => this.visible(actor, resource.code, field));
    if (!visibleFields.length) throw new ForbiddenException("当前权限组没有该表可见字段");
    const page = Math.max(1, Math.floor(Number(input.page) || 1)); const requested = Math.floor(Number(input.pageSize) || 50); const pageSize = [20,50,100,200].includes(requested) ? requested : 50;
    const source = `SELECT task.id,task.version,task.tenant_id,weekly.division_id,task.weekly_plan_id "weeklyPlanId",weekly.order_number,weekly.item_code,weekly.item_name,weekly.delivery_number,
      task.process_code,task.process_name,weekly.planned_quantity,
      COALESCE(reports.cumulative_quantity,0) cumulative_reported_quantity,
      GREATEST(COALESCE(weekly.planned_quantity,0)-COALESCE(reports.cumulative_quantity,0),0) remaining_quantity,
      NULL::numeric production_quantity,NULL::date production_date,
      task.created_by,task.created_at,task.updated_by,task.updated_at
      FROM mps_weekly_process_plans task
      JOIN mps_weekly_plans weekly ON weekly.tenant_id=task.tenant_id AND weekly.id=task.weekly_plan_id
      LEFT JOIN (SELECT tenant_id,weekly_plan_id,process_code,sum(production_quantity) cumulative_quantity FROM mps_process_reports GROUP BY 1,2,3) reports
        ON reports.tenant_id=task.tenant_id AND reports.weekly_plan_id=task.weekly_plan_id AND reports.process_code=task.process_code
      WHERE task.execution_enabled=true AND NOT (COALESCE(weekly.planned_quantity,0)>0 AND COALESCE(reports.cumulative_quantity,0)>=COALESCE(weekly.planned_quantity,0))`;
    const params: unknown[] = [actor.tenantId]; const clauses = ["record.tenant_id=$1", this.scopeClause(resource, actor, "read", columns, params)];
    const organizations = visibleFields.includes("divisionId") ? await this.directory.listEnabled() : [];
    const search = String(input.search ?? "").trim();
    if (search) {
      /* 本次报工数量/生产日期是待填报输入列，不是任务事实，不参与搜索。 */
      const searchableFields = visibleFields.filter((field) => !["divisionId", "productionQuantity", "productionDate"].includes(field) && columns[field]);
      params.push(`%${search}%`);
      const alternatives = searchableFields.map((field) => `COALESCE(${this.expression(columns[field]!)}::text,'') ILIKE $${params.length}`);
      for (const field of searchableFields) {
        const optionValues = this.resolveOptionFilterValues(resource, field, search);
        if (!optionValues?.length) continue;
        params.push(optionValues); alternatives.push(`${this.expression(columns[field]!)}::text = ANY($${params.length}::text[])`);
      }
      const organizationIds = organizations.filter((option) => option.name.includes(search) || option.pathLabel.includes(search)).map((option) => option.id);
      if (organizationIds.length) { params.push(organizationIds); alternatives.push(`record.division_id=ANY($${params.length}::uuid[])`); }
      clauses.push(`(${alternatives.join(" OR ") || "1=0"})`);
    }
    for (const [field, raw] of Object.entries(this.filters(input.filters))) {
      /* 本次报工数量/生产日期是待填报输入列，不是任务事实，不参与筛选。 */
      if (!visibleFields.includes(field) || !columns[field] || ["productionQuantity", "productionDate"].includes(field)) continue;
      const value = String(raw ?? "").trim(); if (!value) continue;
      if (field === "divisionId") {
        const ids = organizations.filter((option) => option.name.includes(value) || option.pathLabel.includes(value) || option.id === value).map((option) => option.id);
        params.push(ids); clauses.push(`record.division_id=ANY($${params.length}::uuid[])`);
      } else if (!this.applyDictionaryFilter(resource, field, this.expression(columns[field]!), value, params, clauses)) {
        params.push(`%${value}%`); clauses.push(`COALESCE(${this.expression(columns[field]!)}::text,'') ILIKE $${params.length}`);
      }
    }
    /* 待报工任务同样支持类型化高级筛选；本次报工数量/生产日期是输入列，不参与筛选。 */
    if (input.filterGroup != null && String(input.filterGroup).trim() !== "") {
      const compiler = new MasterPlanFilterCompiler(
        processReportPendingFields().filter((field) => !field.input), columns, (key) => visibleFields.includes(key),
        (column) => this.expression(column), (field, raw) => this.resolveOptionFilterValues(resource, field, raw)
      );
      clauses.push(compiler.compile(input.filterGroup, params));
    }
    const where = clauses.join(" AND "); const [{ count }] = await this.dataSource.query(`WITH record AS (${source}) SELECT count(*)::integer count FROM record WHERE ${where}`, params);
    const selected = visibleFields.map((field) => `${this.expression(columns[field]!)} "${field}"`); const dataParams = [...params, pageSize, (page - 1) * pageSize];
    const rows = await this.dataSource.query(`WITH record AS (${source}) SELECT record.id,record.version,record."weeklyPlanId",false "canUpdate",false "canDelete",true "pendingTask",${selected.join(",")} FROM record WHERE ${where} ORDER BY record.order_number,record.item_code,record.delivery_number,record.process_code LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams);
    const paths = new Map(organizations.map((option) => [option.id, option.pathLabel]));
    for (const row of rows) {
      if (visibleFields.includes("divisionId")) row.divisionName = paths.get(String(row.divisionId ?? "")) ?? null;
    }
    return { rows, total: Number(count), page, pageSize, visibleFields, view: "PENDING" as const };
  }

  private resource(code: string) {
    const resource = MASTER_PLAN_RESOURCE_MAP.get(code as any);
    if (!resource) throw new NotFoundException("主计划表不存在");
    return resource;
  }

  private expression(column: string) { return column.startsWith("(") ? column : `record.${column}`; }

  private visible(actor: MasterPlanActor, resource: string, field: string) {
    if (resource === "mps-base-plans" && basePlanDerivedFields.has(field)) return hasMasterPlanPermission(actor, resource, "read");
    if (resource === "mps-process-reports" && processReportDerivedFields.has(field)) return hasMasterPlanPermission(actor, resource, "read");
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

  /**
   * 字典/选项字段在数据库保存稳定 value、页面展示 label；筛选输入必须先解析成真实 value 再查询。
   * 返回 null 表示该字段没有选项定义，调用方继续使用普通 ILIKE 文本筛选。
   * 返回空数组表示有选项定义但输入匹配不到任何选项，必须返回 0 行，不得退回用 label 匹配 value 列。
   */
  private resolveOptionFilterValues(resource: MasterPlanResource, field: string, raw: string) {
    const options = fieldsFor(resource).find((entry) => entry.key === field)?.options ?? [];
    if (!options.length) return null;
    const needle = raw.trim().toLocaleLowerCase();
    if (!needle) return [];
    const exact = options.filter((option) => String(option.value).toLocaleLowerCase() === needle || String(option.label).toLocaleLowerCase() === needle);
    const matched = exact.length
      ? exact
      : options.filter((option) => String(option.value).toLocaleLowerCase().includes(needle) || String(option.label).toLocaleLowerCase().includes(needle));
    return [...new Set(matched.map((option) => String(option.value)))];
  }

  /** 字典字段筛选：解析出全部匹配的真实 value 后按值过滤；无匹配项时直接返回 0 行。 */
  private applyDictionaryFilter(resource: MasterPlanResource, field: string, expression: string, raw: string, params: unknown[], clauses: string[]) {
    const optionValues = this.resolveOptionFilterValues(resource, field, raw);
    if (!optionValues) return false;
    if (!optionValues.length) { clauses.push("1=0"); return true; }
    params.push(optionValues); clauses.push(`${expression}::text = ANY($${params.length}::text[])`);
    return true;
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
