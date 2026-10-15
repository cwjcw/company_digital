import { BadRequestException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { DataSource } from "typeorm";
import { standardProcesses } from "@tracker/shared";
import { auxiliaryPlanGroups, mpsDashboardDateRange, mpsDashboardReadinessColumns, mpsDashboardExecutionColumns, mpsDashboardTableKeys, mpsDashboardRiskColumns, mpsDashboardGaps, mpsDashboardGapKeys, mpsDashboardGapColumns, type MpsDashboardGapKey, mpsDashboardResource as resource, tablePermissionFieldsFor, type MpsDashboardData, type MpsDashboardFilters, type MpsDashboardRow, type MpsDashboardTableData, type MpsDashboardTableKey } from "@kdos/contracts";
import { normalizeKdosPageSize } from "../../common/pagination";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MASTER_PLAN_RESOURCE_MAP, virtualColumns } from "./master-plan.config";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

export type DashboardQuery = MpsDashboardFilters & { page?: unknown; pageSize?: unknown; riskType?: string; sortField?: string; sortOrder?: string; tableKey?: string; search?: string; processCode?: string; onlyIncomplete?: string; onlyOverdue?: string };
const processes = [...standardProcesses].sort((a, b) => a.order - b.order);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const riskTypes = ["已延期", "生产异常"];

@Injectable()
export class MasterPlanDashboardService {
  constructor(private readonly dataSource: DataSource, @Optional() private readonly formal?: MasterPlanQueryService) {}

  readable(actor: MasterPlanActor, key: string) { return hasMasterPlanFieldPermission(actor, resource, key, "read"); }
  private assert(actor: MasterPlanActor, action = "read") {
    if (!hasMasterPlanPermission(actor, resource, action)) throw new ForbiddenException("当前权限组没有主计划综合大屏权限");
  }
  private allowed(actor: MasterPlanActor, key: string): boolean {
    const dependencies: Record<string, string[]> = {
      orderCompletionRate: ["orderCompletedQuantity", "orderRequiredQuantity"], dispatchRate: ["dispatchedWeeklyQuantity", "requiredQuantity"],
      inboundRate: ["cumulativeInboundQuantity", "requiredQuantity"], overdueCount: ["pendingQuantity", "latestCustomerDueDate"],
      exceptionCount: ["exceptionSummary"], unfinishedOrderCount: ["orderPendingQuantity"]
    };
    for (const gap of mpsDashboardGaps) dependencies[gap.metric] = [...gap.dependencies];
    dependencies.reportedQuantity = processes.map(p => `${p.code}ReportedQuantity`);
    for (const p of processes) dependencies[`${p.code}ProductionProgress`] = [`${p.code}RequiredQuantity`, `${p.code}ReportedQuantity`];
    return this.readable(actor, key) && (dependencies[key] ?? []).every(k => k === "reportedQuantity" ? this.allowed(actor, k) : this.readable(actor, k));
  }
  private normalize(input: DashboardQuery): DashboardQuery {
    const result = { ...input };
    for (const key of ["orderNumbers", "itemCodes"] as const) {
      let value: unknown = input[key];
      if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new BadRequestException("多选筛选必须为数组"); } }
      if (value != null && (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== "string" || !v.trim() || v.length > 200))) throw new BadRequestException("多选筛选无效，最多100项");
      result[key] = value == null ? undefined : [...new Set(value as string[])];
    }
    if ("item" in input || "orderNumber" in input) throw new BadRequestException("请使用正式订单号/品号多选筛选");
    return result;
  }
  private validate(input: DashboardQuery, actor: MasterPlanActor) {
    for (const [key, field] of [["divisionId", "divisionId"], ["customerCode", "customerCode"], ["orderNumbers", "orderNumber"], ["itemCodes", "itemCode"]] as const) {
      if (input[key]?.length && !this.readable(actor, field)) throw new ForbiddenException("没有该筛选字段查看权限");
      if (["divisionId", "customerCode"].includes(key) && input[key] != null && (typeof input[key] !== "string" || input[key]!.length > 200)) throw new BadRequestException("筛选值无效或过长");
    }
    if (input.divisionId && !uuid.test(input.divisionId)) throw new BadRequestException("事业部必须使用组织ID");
    for(const key of ["dateType","datePeriod","dateValue","dateFrom","dateTo"] as const) if(input[key]!=null && (typeof input[key]!=="string" || input[key]!.length>10)) throw new BadRequestException("日期参数无效");
    if (input.dateType && !["NONE", "ORDER", "DELIVERY"].includes(input.dateType)) throw new BadRequestException("日期类型无效");
    if (input.dateType && input.dateType !== "NONE" && !this.readable(actor, input.dateType === "ORDER" ? "orderDate" : "deliveryDate")) throw new ForbiddenException("没有日期字段查看权限");
    try { mpsDashboardDateRange(input); } catch (e) { throw new BadRequestException((e as Error).message); }
    if (input.tableKey && !mpsDashboardTableKeys.includes(input.tableKey as MpsDashboardTableKey)) throw new BadRequestException("导出/明细表无效");
    const columns = mpsDashboardGapKeys.includes(input.tableKey as MpsDashboardGapKey) ? mpsDashboardGapColumns(input.tableKey as MpsDashboardGapKey) : input.tableKey === "plan-readiness" ? mpsDashboardReadinessColumns : input.tableKey === "process-execution" ? mpsDashboardExecutionColumns : mpsDashboardRiskColumns;
    if (input.sortField && !columns.some(([key]) => key === input.sortField)) throw new BadRequestException("排序字段无效");
    if (input.sortField && !["processName", "reportedQuantity", "productionProgress", "status", "issueCategory", "currentNode", "currentStatus"].includes(input.sortField) && !this.readable(actor, input.sortField)) throw new ForbiddenException("没有排序字段查看权限");
    const processSort: Record<string,string> = {requiredQuantity:"RequiredQuantity",reportedQuantity:"ReportedQuantity",productionProgress:"ProductionProgress",status:"Status"};
    if(input.tableKey==="process-execution" && input.sortField && processSort[input.sortField] && !processes.filter(p=>!input.processCode||p.code===input.processCode).every(p=>this.allowed(actor,p.code+processSort[input.sortField!]))) throw new ForbiddenException("没有全部工序排序字段权限");
    if(input.sortField==="issueCategory" && !this.readable(actor,"weeklyPlanState")) throw new ForbiddenException("没有准备状态权限");
    if (input.sortOrder && !["asc", "desc"].includes(input.sortOrder)) throw new BadRequestException("排序方向无效");
    if (input.search != null && (typeof input.search !== "string" || input.search.length > 200)) throw new BadRequestException("局部搜索无效");
    if (input.search && !["orderNumber", "itemCode", "itemName"].some(k => this.readable(actor, k))) throw new ForbiddenException("没有局部搜索字段权限");
    if (input.processCode && !processes.some(p => p.code === input.processCode)) throw new BadRequestException("工序无效");
    for (const k of ["onlyIncomplete", "onlyOverdue"] as const) if (input[k] != null && !["true", "false"].includes(input[k]!)) throw new BadRequestException("工序条件无效");
    if (input.processCode || input.onlyIncomplete === "true" || input.onlyOverdue === "true") {
      if (input.tableKey !== "process-execution") throw new BadRequestException("工序条件只能用于工序执行明细");
      if ((input.onlyIncomplete === "true" || input.onlyOverdue === "true") && !processes.filter(p => !input.processCode || p.code === input.processCode).every(p => this.readable(actor, p.code + "Status"))) throw new ForbiddenException("没有工序状态筛选权限");
    }
    if (input.riskType && !this.readable(actor, "riskType")) throw new ForbiddenException("没有风险类型筛选权限");
    if (input.riskType && !riskTypes.includes(input.riskType)) throw new BadRequestException("风险类型无效");
  }

  /** One scope helper maps the dashboard's stable divisionId to each fact's true division column. */
  scopeSql(actor: MasterPlanActor, division: string, params: unknown[], action: "read" | "export" = "read") {
    for (const scope of actor.tableDataScopes.filter(s => s.resource === resource && s.scope === "CUSTOM" && (!s.actions || s.actions.includes(action)))) {
      if (!scope.rules?.length || scope.rules.some(r => r.fieldKey !== "divisionId" || !["EQ", "IN"].includes(r.operator ?? "") || (r.operator === "EQ" ? !uuid.test(String(r.value)) : !Array.isArray(r.value) || !r.value.length || r.value.some(v => !uuid.test(String(v)))))) throw new ForbiddenException("大屏自定义数据范围仅支持事业部组织ID的等于或包含规则");
    }
    const columns = { divisionId: division, customerCode: "customer_code", orderNumber: "order_number", itemCode: "item_code", itemName: "item_name", createdBy: "created_by" };
    return buildDataScopeClause({ resource, actor, columns, params, action });
  }
  private facts(input: DashboardQuery, actor: MasterPlanActor, params: unknown[], action: "read" | "export") {
    const authorized = (table: string, columns: string, division = "division_id") => {
      const clauses = ["record.tenant_id=$1", this.scopeSql(actor, division, params)];
      if (action === "export") clauses.push(this.scopeSql(actor, division, params, "export"));
      const keys = table.endsWith("plans") ? `,jsonb_build_array(record.tenant_id,record.order_number)::text order_key${table === "mps_group_plans" ? "" : ",jsonb_build_array(record.tenant_id,record.order_number,record.item_code)::text plan_key,jsonb_build_array(record.tenant_id,record.order_number,record.item_code,record.division_id)::text business_key"}` : "";
      return `SELECT ${columns.split(",").map(c => `record.${c}`).join(",")}${keys} FROM ${table} record WHERE ${clauses.join(" AND ")}`;
    };
    const identity = "tenant_id,id,division_id,order_number,item_code,item_name,created_by";
    const sources: Record<string, string> = {
      group: authorized("mps_group_plans", "tenant_id,id,primary_division_id,order_number,customer_code,order_date,required_quantity,completed_quantity,pending_quantity,created_by", "primary_division_id"),
      shipping: authorized("mps_shipping_plans", `${identity},customer_code,order_date,latest_customer_due_date,planned_quantity,delivery_number,monthly_plan_id`),
      monthly: authorized("mps_monthly_plans", `${identity},customer_code,order_date,latest_customer_due_date,required_quantity,cumulative_inbound_quantity,pending_quantity`),
      base: authorized("mps_base_plans", `${identity},customer_code,order_date,latest_customer_due_date,planned_quantity,shipping_plan_id,delivery_number,latest_review_due_date,product_attribute,surface_nature,manufacturing_method`),
      weekly: authorized("mps_weekly_plans", `${identity},customer_code,order_date,base_plan_id,delivery_number,planned_quantity,pending_quantity,latest_customer_due_date,hardware_due_date,wood_due_date`)
    };
    const clauses: string[] = [];
    const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
    if (input.divisionId) clauses.push(`s.division_id=${bind(input.divisionId)}::uuid`);
    if (input.customerCode) clauses.push(`s.customer_code=${bind(input.customerCode)}`);
    if (input.orderNumbers?.length) clauses.push(`s.order_number=ANY(${bind(input.orderNumbers)}::text[])`);
    if (input.itemCodes?.length) clauses.push(`s.item_code=ANY(${bind(input.itemCodes)}::text[])`);
    const range = mpsDashboardDateRange(input);
    if (range) { const column = input.dateType === "ORDER" ? "order_date" : "delivery_date"; clauses.push(`s.${column}>=${bind(range.start)}::date AND s.${column}<${bind(range.end)}::date`); }
    const ctes = Object.entries(sources).map(([key, sql]) => `authorized_${key} AS MATERIALIZED (${sql})`);
    ctes.push(`business_items AS MATERIALIZED (${["monthly", "base", "weekly", "shipping"].map((key, i) => `SELECT tenant_id,order_number,item_code,division_id,customer_code,item_name,order_date,latest_customer_due_date,order_key,plan_key,business_key,${i} priority FROM authorized_${key}`).join(" UNION ALL ")})`,
      `order_dates AS MATERIALIZED (SELECT x.order_key,COALESCE(g.order_date,min(x.order_date) FILTER(WHERE priority=0),min(x.order_date) FILTER(WHERE priority=1),min(x.order_date) FILTER(WHERE priority=2),min(x.order_date) FILTER(WHERE priority=3)) order_date FROM business_items x LEFT JOIN authorized_group g USING(order_key) GROUP BY x.order_key,g.order_date)`,
      `delivery_dates AS MATERIALIZED (SELECT k.plan_key,COALESCE(w.due,w.last_due,m.latest_customer_due_date,k.base_due) delivery_date FROM (SELECT plan_key,COALESCE(min(latest_customer_due_date) FILTER(WHERE priority=1),min(latest_customer_due_date) FILTER(WHERE priority=3)) base_due FROM business_items GROUP BY 1) k LEFT JOIN (SELECT plan_key,min(latest_customer_due_date) FILTER(WHERE pending_quantity>0) due,max(latest_customer_due_date) last_due FROM authorized_weekly GROUP BY 1) w USING(plan_key) LEFT JOIN authorized_monthly m USING(plan_key))`,
      `scope_identities AS MATERIALIZED (SELECT k.*,d.order_date,e.delivery_date FROM (SELECT tenant_id,order_number,item_code,division_id,order_key,plan_key,business_key,(array_agg(customer_code ORDER BY priority) FILTER(WHERE customer_code IS NOT NULL))[1] customer_code,(array_agg(item_name ORDER BY priority) FILTER(WHERE item_name IS NOT NULL))[1] item_name FROM business_items GROUP BY 1,2,3,4,5,6,7) k JOIN order_dates d USING(order_key) JOIN delivery_dates e USING(plan_key) UNION ALL SELECT tenant_id,order_number,NULL::varchar,primary_division_id,order_key,jsonb_build_array(tenant_id,order_number,NULL)::text,jsonb_build_array(tenant_id,order_number,NULL,primary_division_id)::text,customer_code,NULL::varchar,order_date,NULL::date FROM authorized_group g WHERE NOT EXISTS(SELECT 1 FROM business_items i WHERE i.order_key=g.order_key))`,
      `dashboard_scope AS MATERIALIZED (SELECT s.* FROM scope_identities s ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""})`);
    for (const key of ["monthly", "base", "weekly", "shipping"]) ctes.push(`scoped_${key} AS MATERIALIZED (SELECT r.*,d.order_date dashboard_order_date,d.delivery_date dashboard_delivery_date FROM authorized_${key} r JOIN dashboard_scope d ON d.business_key=r.business_key)`);
    ctes.push(`scoped_group AS MATERIALIZED (SELECT g.* FROM authorized_group g WHERE EXISTS(SELECT 1 FROM dashboard_scope d WHERE d.order_key=g.order_key))`,
      `scoped_tasks AS MATERIALIZED (SELECT task.tenant_id,task.weekly_plan_id,task.process_code,task.status FROM mps_weekly_process_plans task JOIN scoped_weekly w ON w.id=task.weekly_plan_id)`);
    for (const [key, columns] of Object.entries({ process: "process_code,production_date,production_quantity,exception_text", technical: "status,exception_text", material: "material_name,received,actual_inbound_date,exception_text", outsourcing: "status,exception_text" })) {
      const sql = authorized(`mps_${key}_reports`, `${identity},weekly_plan_id,${columns}`);
      ctes.push(`scoped_${key}_reports AS MATERIALIZED (SELECT r.* FROM (${sql}) r JOIN scoped_weekly w ON w.id=r.weekly_plan_id ${input.divisionId ? `WHERE r.division_id=${bind(input.divisionId)}::uuid` : ""})`);
    }
    return ctes.join(",\n");
  }

  /** Reuse formal derived SQL, replacing each source with its authorized CTE before aggregation. */
  private derived(code: "mps-monthly-plans" | "mps-base-plans", key: string) {
    let sql = virtualColumns(MASTER_PLAN_RESOURCE_MAP.get(code)!)[key]!;
    const replacements = {
      mps_weekly_plans: "scoped_weekly", mps_weekly_process_plans: "scoped_tasks", mps_process_reports: "scoped_process_reports",
      mps_technical_reports: "scoped_technical_reports", mps_material_reports: "scoped_material_reports", mps_outsourcing_reports: "scoped_outsourcing_reports"
    };
    for (const [from, to] of Object.entries(replacements)) sql = sql.replaceAll(from, to);
    return sql;
  }
  /** Counts, lists and exports consume this exact relation; no second gap formula. */
  private gapCtes(actor: MasterPlanActor) {
    const jsonRow = (extras: Record<string, string>, node: string, title: string) => {
      const values: Record<string, string> = {
        id: "r.id::text", divisionId: "r.division_id", customerCode: "r.customer_code", orderNumber: "r.order_number", itemCode: "r.item_code", itemName: "r.item_name",
        orderDate: "r.dashboard_order_date::text", deliveryDate: "r.dashboard_delivery_date::text", currentNode: `'${node}'`, currentStatus: `'${title}'`, ...extras
      };
      return `jsonb_build_object(${Object.entries(values).flatMap(([key, expression]) => [`'${key}'`, expression]).join(",")})`;
    };
    const monthly = { requiredQuantity: "r.required_quantity::text", cumulativeInboundQuantity: "r.cumulative_inbound_quantity::text", pendingQuantity: "r.pending_quantity::text", exceptionSummary: 'r."exceptionSummary"' };
    const base = { plannedQuantity: "r.planned_quantity::text", deliveryNumber: "r.delivery_number", weeklyPlanState: 'r."weeklyPlanState"', weeklyPlanMissingFields: 'r."weeklyPlanMissingFields"', weeklyPlanGenerationIssue: 'r."weeklyPlanGenerationIssue"' };
    const definitions: Record<MpsDashboardGapKey, { source: string; where: string; fields: Record<string, string>; node: string }> = {
      "missing-shipping-plan": { source: "monthly_data", where: "r.required_quantity>0 AND NOT EXISTS(SELECT 1 FROM authorized_shipping s WHERE s.tenant_id=r.tenant_id AND s.monthly_plan_id=r.id)", fields: monthly, node: "出货计划" },
      "missing-base-plan": { source: "scoped_shipping", where: "NOT EXISTS(SELECT 1 FROM authorized_base b WHERE b.tenant_id=r.tenant_id AND b.shipping_plan_id=r.id)", fields: { plannedQuantity: "r.planned_quantity::text", deliveryNumber: "r.delivery_number" }, node: "基础计划" },
      "missing-weekly-plan": { source: "base_data", where: 'r."weeklyPlanState"=\'已具备条件\'', fields: base, node: "周计划" },
      "plan-not-ready": { source: "base_data", where: 'r."weeklyPlanState"=\'待完善\'', fields: base, node: "计划准备" },
      "not-started-production": { source: "scoped_weekly", where: "r.planned_quantity>0 AND COALESCE((SELECT quantity FROM weekly_reported p WHERE p.weekly_plan_id=r.id),0)=0", fields: { plannedQuantity: "r.planned_quantity::text", deliveryNumber: "r.delivery_number", reportedQuantity: "'0'::text" }, node: "生产报工" },
      "no-inbound": { source: "monthly_data", where: "r.required_quantity>0 AND r.cumulative_inbound_quantity=0", fields: monthly, node: "入库" },
      "incomplete-inbound": { source: "monthly_data", where: "r.cumulative_inbound_quantity>0 AND r.pending_quantity>0", fields: monthly, node: "入库" },
      "overdue": { source: "monthly_data", where: 'r.pending_quantity>0 AND r."latestCustomerDueDate"<(now() AT TIME ZONE \'Asia/Shanghai\')::date', fields: monthly, node: "交付" },
      "production-exception": { source: "monthly_data", where: 'r."exceptionSummary"<>\'\'', fields: monthly, node: "生产执行" }
    };
    return `weekly_reported AS (SELECT weekly_plan_id,sum(quantity) quantity FROM report_totals WHERE process_code IN (${processes.map(p => `'${p.code}'`).join(",")}) GROUP BY weekly_plan_id),
      gap_rows AS MATERIALIZED (${mpsDashboardGaps.map(g => {
        const d = definitions[g.key];
        return `SELECT '${g.key}' key,${jsonRow(d.fields, d.node, g.title)} row_json FROM ${d.source} r WHERE ${this.allowed(actor, g.metric)} AND (${d.where})`;
      }).join(" UNION ALL ")})`;
  }
  /** Public for real PostgreSQL/EXPLAIN verification; all values remain bound parameters. */
  querySql(input: DashboardQuery, actor: MasterPlanActor, action: "read" | "export" = "read", allRisks = false) {
    input = this.normalize(input);
    this.assert(actor); if (action === "export") this.assert(actor, "export"); this.validate(input, actor);
    const gap = mpsDashboardGaps.find(g => g.key === input.tableKey);
    if (gap && !this.allowed(actor, gap.metric)) throw new ForbiddenException("没有该待处理事项的指标字段权限");
    const params: unknown[] = [actor.tenantId];
    const facts = this.facts(input, actor, params, action);
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = normalizeKdosPageSize(input.pageSize);
    if (!Number.isSafeInteger(page) || page > 100000) throw new BadRequestException("页码无效");
    const monthColumns = [
      `COALESCE(w.due,w.last_due,record.latest_customer_due_date) "latestCustomerDueDate"`,
      `COALESCE(e.summary,'') "exceptionSummary"`,
      ...auxiliaryPlanGroups.map(g => `COALESCE(a.states->>'${g.key}','未开始') "${g.key}Status"`),
      ...processes.map(p => `COALESCE(t.states->>'${p.code}','未开始') "${p.code}Status"`)
    ].join(",");
    const baseColumns = ["weeklyPlanState", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue"].map(key => `${this.derived("mps-base-plans", key)} "${key}"`).join(",");
    const canRisk = (type: string) => this.readable(actor, "riskType") && (type === "已延期" ? this.readable(actor, "pendingQuantity") && this.readable(actor, "latestCustomerDueDate") : this.readable(actor, type === "生产异常" ? "exceptionSummary" : "weeklyPlanState"));
    const json = (pairs: Record<string, string>) => `jsonb_build_object(${Object.entries(pairs).flatMap(([k, v]) => [`'${k}'`, v]).join(",")})`;
    const sum = (column: string) => `COALESCE(sum(${column}),0)::text`;
    const planSummary = json({ requiredQuantity: sum("required_quantity"), dispatchedWeeklyQuantity: sum('"dispatchedWeeklyQuantity"'), cumulativeInboundQuantity: sum("cumulative_inbound_quantity"), pendingQuantity: sum("pending_quantity"), dispatchRate: '(sum("dispatchedWeeklyQuantity")/NULLIF(sum(required_quantity),0))::text', inboundRate: '(sum(cumulative_inbound_quantity)/NULLIF(sum(required_quantity),0))::text', overdueCount: 'count(*) FILTER(WHERE pending_quantity>0 AND "latestCustomerDueDate"< (now() AT TIME ZONE \'Asia/Shanghai\')::date)', exceptionCount: 'count(*) FILTER(WHERE "exceptionSummary"<>\'\')' });
    const processRows = processes.map(p => `SELECT '${p.code}' code, ${json({ requiredQuantity: '(SELECT COALESCE(sum(required_quantity),0)::text FROM scoped_monthly)', reportedQuantity: `COALESCE((SELECT sum(quantity) FROM monthly_reports WHERE process_code='${p.code}'),0)::text`, productionProgress: `(SELECT COALESCE((SELECT sum(quantity) FROM monthly_reports WHERE process_code='${p.code}'),0)/NULLIF(sum(required_quantity),0) FROM scoped_monthly)::text` })} values,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('status',status,'count',n)) FROM (SELECT "${p.code}Status" status,count(*) n FROM monthly_data GROUP BY 1) s),'[]'::jsonb) states`).join(" UNION ALL ");
    const auxiliary = auxiliaryPlanGroups.map(g => `SELECT '${g.key}' key, COALESCE((SELECT jsonb_agg(jsonb_build_object('status',status,'count',n)) FROM (SELECT "${g.key}Status" status,count(*) n FROM monthly_data GROUP BY 1) s),'[]'::jsonb) states`).join(" UNION ALL ");
    params.push(input.riskType || null); const typeParam = `$${params.length}`;
    const status = `CASE WHEN bool_or(status='延期') THEN '延期' WHEN bool_and(status IN ('已完成','已入库')) THEN '已完成' WHEN bool_or(status='进行中') THEN '进行中' ELSE '未开始' END`;
    const joinWeekly = (table: string) => `FROM ${table} r JOIN monthly_weekly w ON w.id=r.weekly_plan_id`;
    const exceptionSources = [
      `SELECT w.plan_key,0 ord,'技术' label,r.exception_text ${joinWeekly("scoped_technical_reports")}`,
      `SELECT w.plan_key,CASE WHEN r.material_name='五金' THEN 1 ELSE 2 END,CASE WHEN r.material_name='五金' THEN '五金主材' ELSE '木作主材' END,r.exception_text ${joinWeekly("scoped_material_reports")} WHERE r.material_name IN ('五金','木作')`,
      `SELECT w.plan_key,3,'外协',r.exception_text ${joinWeekly("scoped_outsourcing_reports")}`,
      `SELECT w.plan_key,p.ord+10,p.label,r.exception_text ${joinWeekly("scoped_process_reports")} JOIN (VALUES ${processes.map(p => `('${p.code}','${p.name}',${p.order})`).join(",")}) p(code,label,ord) ON p.code=r.process_code`
    ];
    const riskSort = input.sortField ? `${input.sortField === "divisionId" ? "o.name" : `r."${input.sortField}"${["requiredQuantity", "dispatchedWeeklyQuantity", "cumulativeInboundQuantity", "pendingQuantity"].includes(input.sortField) ? "::numeric" : ""}`} ${input.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST,` : "";
    const sql = `WITH ${facts},
      report_totals AS MATERIALIZED (SELECT tenant_id,weekly_plan_id,process_code,sum(production_quantity) quantity,max(production_date) last_date FROM scoped_process_reports GROUP BY 1,2,3),
      monthly_weekly AS MATERIALIZED (SELECT w.* FROM scoped_weekly w JOIN scoped_monthly m ON m.plan_key=w.plan_key),
      monthly_reports AS MATERIALIZED (SELECT r.* FROM report_totals r JOIN monthly_weekly w ON w.id=r.weekly_plan_id),
      weekly_totals AS (SELECT plan_key,sum(planned_quantity) dispatched,min(latest_customer_due_date) FILTER(WHERE pending_quantity>0) due,max(latest_customer_due_date) last_due FROM monthly_weekly GROUP BY 1),
      task_states AS (SELECT w.plan_key,r.process_code,${status} status ${joinWeekly("scoped_tasks")} GROUP BY 1,2),
      task_maps AS (SELECT plan_key,jsonb_object_agg(process_code,status) states FROM task_states GROUP BY 1),
      aux_facts AS (
        SELECT w.plan_key,'technical' key,r.status ${joinWeekly("scoped_technical_reports")}
        UNION ALL SELECT w.plan_key,CASE WHEN r.material_name='五金' THEN 'hardware' ELSE 'wood' END,CASE WHEN r.received OR r.actual_inbound_date IS NOT NULL THEN '已完成' WHEN (CASE WHEN r.material_name='五金' THEN w.hardware_due_date ELSE w.wood_due_date END)<CURRENT_DATE THEN '延期' ELSE '未开始' END ${joinWeekly("scoped_material_reports")} WHERE r.material_name IN ('五金','木作')
        UNION ALL SELECT w.plan_key,'outsourcing',r.status ${joinWeekly("scoped_outsourcing_reports")}
      ), aux_states AS (SELECT plan_key,key,${status} status FROM aux_facts GROUP BY 1,2),
      aux_maps AS (SELECT plan_key,jsonb_object_agg(key,status) states FROM aux_states GROUP BY 1),
      exception_facts AS (${exceptionSources.join(" UNION ALL ")}),
      exception_parts AS (SELECT plan_key,ord,label||'：'||string_agg(DISTINCT exception_text,'、' ORDER BY exception_text) part FROM exception_facts WHERE btrim(COALESCE(exception_text,''))<>'' GROUP BY 1,2,label),
      exception_totals AS (SELECT plan_key,string_agg(part,'；' ORDER BY ord) summary FROM exception_parts GROUP BY 1),
      monthly_data AS MATERIALIZED (SELECT record.*,${monthColumns},COALESCE(w.dispatched,0) "dispatchedWeeklyQuantity" FROM scoped_monthly record
        LEFT JOIN weekly_totals w USING(plan_key)
        LEFT JOIN task_maps t USING(plan_key)
        LEFT JOIN aux_maps a USING(plan_key)
        LEFT JOIN exception_totals e USING(plan_key)),
      base_data AS MATERIALIZED (SELECT record.*,${baseColumns} FROM scoped_base record),
      ${this.gapCtes(actor)},
      risk_rows AS (
        SELECT id::text, 'mps-monthly-plans' resource,division_id "divisionId",order_number "orderNumber",item_code "itemCode",item_name "itemName", customer_code "customerCode",dashboard_order_date::text "orderDate",dashboard_delivery_date::text "deliveryDate", "latestCustomerDueDate"::text, required_quantity::text "requiredQuantity", "dispatchedWeeklyQuantity"::text, cumulative_inbound_quantity::text "cumulativeInboundQuantity",pending_quantity::text "pendingQuantity",kind "riskType", "exceptionSummary",NULL::text "weeklyPlanMissingFields",NULL::text "weeklyPlanGenerationIssue"
        FROM monthly_data CROSS JOIN LATERAL (SELECT concat_ws('、',CASE WHEN ${canRisk("已延期")} AND pending_quantity>0 AND "latestCustomerDueDate"<(now() AT TIME ZONE 'Asia/Shanghai')::date THEN '已延期' END, CASE WHEN ${canRisk("生产异常")} AND "exceptionSummary"<>'' THEN '生产异常' END) kind) risks WHERE kind<>''

      ), filtered_risks AS (SELECT * FROM risk_rows WHERE ${typeParam}::text IS NULL OR strpos("riskType",${typeParam})>0),
      division_rows AS (SELECT division_id "divisionId",${planSummary} metrics FROM monthly_data GROUP BY division_id),
      daily AS (SELECT production_date,process_code,sum(production_quantity) quantity FROM scoped_process_reports WHERE production_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date-7 AND production_date < (now() AT TIME ZONE 'Asia/Shanghai')::date GROUP BY 1,2)
      SELECT jsonb_build_object(
        'gaps',(SELECT jsonb_object_agg(key,n) FROM (SELECT key,count(*) n FROM gap_rows GROUP BY key) counts),
        'orders',(SELECT ${json({ orderCount: 'count(DISTINCT order_number)', unfinishedOrderCount: 'count(*) FILTER(WHERE pending_quantity>0)', orderRequiredQuantity: sum('required_quantity'), orderCompletedQuantity: sum('completed_quantity'), orderPendingQuantity: sum('pending_quantity'), orderCompletionRate: '(sum(completed_quantity)/NULLIF(sum(required_quantity),0))::text' })} FROM scoped_group),
        'plans',(SELECT ${planSummary} FROM monthly_data),
        'readiness',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',status,'count',n,'ratio',(n::numeric/NULLIF((SELECT count(*) FROM base_data),0))::text)) FROM (SELECT "weeklyPlanState" status,count(*) n FROM base_data GROUP BY 1) r),'[]'::jsonb),
        'auxiliary',(SELECT jsonb_agg(a) FROM (${auxiliary}) a),
        'processes',(SELECT jsonb_agg(p) FROM (${processRows}) p),
        'trend',(SELECT jsonb_agg(jsonb_build_object('productionDate',d::date::text) || COALESCE((SELECT jsonb_object_agg(process_code||'ReportedQuantity',quantity::text) FROM daily WHERE production_date=d::date),'{}'::jsonb) ORDER BY d) FROM generate_series((now() AT TIME ZONE 'Asia/Shanghai')::date-7,(now() AT TIME ZONE 'Asia/Shanghai')::date-1,'1 day') d),
        'divisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('divisionId',d."divisionId",'divisionName',o.name)||d.metrics ORDER BY o.name) FROM division_rows d LEFT JOIN organization_units o ON o.id=d."divisionId"),'[]'::jsonb),
        'risks',jsonb_build_object('total',(SELECT count(*) FROM filtered_risks),'rows',COALESCE((SELECT jsonb_agg(r) FROM (SELECT r.*,o.name "divisionName" FROM filtered_risks r LEFT JOIN organization_units o ON o.id=r."divisionId" ORDER BY ${riskSort} "latestCustomerDueDate" NULLS LAST,"orderNumber","itemCode","riskType",id ${allRisks ? "" : `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`}) r),'[]'::jsonb)),
        'trendStart',((now() AT TIME ZONE 'Asia/Shanghai')::date-7)::text,'trendEnd',((now() AT TIME ZONE 'Asia/Shanghai')::date-1)::text
      ) data`;
    if (input.tableKey) {
      const gapFields = [...new Set(mpsDashboardGaps.flatMap(g => mpsDashboardGapColumns(g.key).map(([key]) => key)))];
      let source = input.tableKey === "plan-readiness" ? `SELECT id::text,division_id "divisionId",customer_code "customerCode",order_number "orderNumber",item_code "itemCode",item_name "itemName",dashboard_order_date::text "orderDate",dashboard_delivery_date::text "deliveryDate",delivery_number "deliveryNumber",latest_customer_due_date::text "latestCustomerDueDate",planned_quantity::text "plannedQuantity","weeklyPlanState","weeklyPlanMissingFields","weeklyPlanGenerationIssue",'计划准备问题' "issueCategory" FROM base_data WHERE "weeklyPlanState"='待完善' AND ${this.readable(actor, "weeklyPlanState")}`
        : input.tableKey === "process-execution" ? `SELECT m.id::text||':'||p.code id,m.division_id "divisionId",m.customer_code "customerCode",m.dashboard_order_date::text "orderDate",m.dashboard_delivery_date::text "deliveryDate",r.last_date::text "productionDate",m.order_number "orderNumber",m.item_code "itemCode",m.item_name "itemName",p.code "processCode",p.name "processName",p.ord "processOrder",m.required_quantity::text "requiredQuantity",COALESCE(r.quantity,0)::text "reportedQuantity",(COALESCE(r.quantity,0)/NULLIF(m.required_quantity,0))::text "productionProgress",m.statuses->>p.code status FROM (SELECT m.*,jsonb_build_object(${processes.flatMap(p => [`'${p.code}'`, `"${p.code}Status"`]).join(",")}) statuses FROM monthly_data m) m CROSS JOIN (VALUES ${processes.map(p => `('${p.code}','${p.name}',${p.order})`).join(",")}) p(code,name,ord) LEFT JOIN (SELECT w.plan_key,r.process_code,sum(r.quantity) quantity,max(r.last_date) last_date FROM monthly_reports r JOIN monthly_weekly w ON w.id=r.weekly_plan_id GROUP BY 1,2) r ON r.plan_key=m.plan_key AND r.process_code=p.code`
        : `SELECT * FROM filtered_risks`;
      if (gap) {
        params.push(gap.key);
        source = `SELECT x.* FROM gap_rows g CROSS JOIN LATERAL jsonb_to_record(g.row_json) AS x(id text,${gapFields.map(k => `"${k}" text`).join(",")}) WHERE g.key=$${params.length}`;
      }
      const local: string[] = [];
      const bindLocal = (value: unknown) => { params.push(value); return `$${params.length}`; };
      if (input.search) {
        const search = bindLocal(`%${input.search}%`);
        local.push(`(${["orderNumber", "itemCode", "itemName"].filter(k => this.readable(actor,k)).map(k => `r."${k}" ILIKE ${search}`).join(" OR ")})`);
      }
      if (input.tableKey === "process-execution") {
        if (input.processCode) local.push(`r."processCode"=${bindLocal(input.processCode)}`);
        if (input.onlyIncomplete === "true") local.push(`COALESCE(r.status,'未开始')<>'已完成'`);
        if (input.onlyOverdue === "true") local.push(`r.status='延期'`);
      }
      const sort = input.sortField ? `${input.sortField === "divisionId" ? "o.name" : `r."${input.sortField}"${["requiredQuantity","plannedQuantity","reportedQuantity","productionProgress","dispatchedWeeklyQuantity","cumulativeInboundQuantity","pendingQuantity"].includes(input.sortField) ? "::numeric" : ""}`} ${input.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST,` : "";
      const cte = sql.slice(0, sql.indexOf("\n      SELECT jsonb_build_object("));
      return { sql: `${cte}, table_source AS MATERIALIZED (${source}), table_rows AS MATERIALIZED (SELECT r.* FROM table_source r ${local.length ? `WHERE ${local.join(" AND ")}` : ""}) SELECT jsonb_build_object('total',(SELECT count(*) FROM table_rows),'rows',COALESCE((SELECT jsonb_agg(x) FROM (SELECT r.*,o.name "divisionName" FROM table_rows r LEFT JOIN organization_units o ON o.id::text=r."divisionId"::text ORDER BY ${sort} r."orderNumber",r."itemCode",${input.tableKey === "process-execution" ? 'r."processOrder",' : ""}r.id ${allRisks ? "" : `LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`}) x),'[]'::jsonb)) data`, params, page, pageSize };
    }
    return { sql, params, page, pageSize };
  }

  async dashboard(input: DashboardQuery, actor: MasterPlanActor, action: "read" | "export" = "read", allRisks = false): Promise<MpsDashboardData> {
    if(input.tableKey) throw new BadRequestException("请使用明细表接口");
    const { sql, params, page, pageSize } = this.querySql(input, actor, action, allRisks);
    const data = await this.dataSource.transaction("REPEATABLE READ", async manager => {
      await manager.query("SET TRANSACTION READ ONLY");
      // EXPLAIN: JIT compilation dominated this correlated CTE report; disable only in this read transaction.
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('statement_timeout','15000',true),set_config('jit','off',true)", [actor.tenantId]);
      return (await manager.query(sql, params))[0].data;
    });
    const clean = (row: MpsDashboardRow, mapping: Record<string, string> = {}) => Object.fromEntries(Object.entries(row).filter(([key]) => ["id", "resource"].includes(key) || this.allowed(actor, mapping[key] ?? (key === "divisionName" ? "divisionId" : key))));
    return {
      gaps: Object.fromEntries(mpsDashboardGaps.filter(g => this.allowed(actor,g.metric)).map(g => [g.key, Number(data.gaps?.[g.key] ?? 0)])),
      generatedAt: new Date().toISOString(), visibleFields: tablePermissionFieldsFor(resource).map(f => f.key).filter(k => this.allowed(actor, k)),
      trendStart: data.trendStart, trendEnd: data.trendEnd, orders: clean(data.orders), plans: clean(data.plans),
      readiness: this.readable(actor, "weeklyPlanState") ? data.readiness : [],
      auxiliary: data.auxiliary.map((g: { key: string; states: MpsDashboardRow[] }) => ({ ...g, states: this.readable(actor, `${g.key}Status`) ? g.states : [] })),
      processes: processes.map(p => { const row = data.processes.find((r: { code: string }) => r.code === p.code); return { code: p.code, name: p.name, order: p.order, values: clean(row.values, { requiredQuantity: `${p.code}RequiredQuantity`, reportedQuantity: `${p.code}ReportedQuantity`, productionProgress: `${p.code}ProductionProgress` }), states: this.readable(actor, `${p.code}Status`) ? row.states : [] }; }),
      trend: this.readable(actor, "productionDate") ? data.trend.map((r: MpsDashboardRow) => clean(r)) : [],
      divisions: this.readable(actor, "divisionId") ? data.divisions.map((r: MpsDashboardRow) => clean(r)) : [],
      risks: { total: data.risks.total, rows: data.risks.rows.map((r: MpsDashboardRow) => clean(r)), page, pageSize: allRisks ? data.risks.total : pageSize }
    };
  }

  async drill(input: DashboardQuery & { resourceCode?: string; filterGroup?: string; view?: string }, actor: MasterPlanActor) {
    const tables: Record<string,string> = { "mps-group-plans":"scoped_group", "mps-monthly-plans":"scoped_monthly", "mps-base-plans":"scoped_base", "mps-weekly-plans":"scoped_weekly", "mps-process-reports":"scoped_process_reports" };
    if(input.view && !["ALL","COMPLETE","INCOMPLETE"].includes(input.view)) throw new BadRequestException("下钻视图无效");
    const source=tables[input.resourceCode ?? ""]; if(!source) throw new BadRequestException("下钻资源无效");
    const filters=this.normalize({...input,sortField:undefined,sortOrder:undefined,tableKey:undefined});
    this.assert(actor);this.validate(filters,actor);
    if(!this.formal) throw new BadRequestException("正式明细服务不可用");
    return this.formal.list(input.resourceCode!,input,actor,params=>`EXISTS(WITH ${this.facts(filters,actor,params,"read")} SELECT 1 FROM ${source} d WHERE d.tenant_id=record.tenant_id AND d.id=record.id)`);
  }

  gaps(type: string, input: DashboardQuery, actor: MasterPlanActor) {
    this.assert(actor);
    if (!mpsDashboardGapKeys.includes(type as MpsDashboardGapKey)) throw new BadRequestException("待处理事项无效");
    return this.table({ ...input, tableKey: type }, actor);
  }

  async table(input: DashboardQuery, actor: MasterPlanActor, action: "read" | "export" = "read", allRows = false): Promise<MpsDashboardTableData> {
    if (!["plan-readiness", "process-execution", "risk-exception", ...mpsDashboardGapKeys].includes(input.tableKey ?? "")) throw new BadRequestException("明细表无效");
    const { sql, params, page, pageSize } = this.querySql(input, actor, action, allRows);
    const data = await this.dataSource.transaction("REPEATABLE READ", async manager => {
      await manager.query("SET TRANSACTION READ ONLY");
      // EXPLAIN: JIT compilation dominated this correlated CTE report; disable only in this read transaction.
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('statement_timeout','15000',true),set_config('jit','off',true)", [actor.tenantId]);
      return (await manager.query(sql, params))[0].data;
    });
    const execution = input.tableKey === "process-execution";
    const gapColumns = mpsDashboardGapKeys.includes(input.tableKey as MpsDashboardGapKey) ? new Set(mpsDashboardGapColumns(input.tableKey as MpsDashboardGapKey).map(([k]) => k)) : null;
    const rows = data.rows.map((row: MpsDashboardRow) => Object.fromEntries(Object.entries(row).filter(([key]) => {
      if (["id", "resource"].includes(key)) return true;
      if (gapColumns && key !== "divisionName" && !gapColumns.has(key)) return false;
      if (["currentNode", "currentStatus"].includes(key)) return mpsDashboardGaps.some(g => g.key === input.tableKey && this.allowed(actor,g.metric));
      if (key === "reportedQuantity" && !execution) return this.allowed(actor,key);
      if (key === "issueCategory") return this.readable(actor, "weeklyPlanState");
      if (execution && ["processCode", "processName"].includes(key)) return true;
      const fields: Record<string, string> = { requiredQuantity: `${row.processCode}RequiredQuantity`, reportedQuantity: `${row.processCode}ReportedQuantity`, productionProgress: `${row.processCode}ProductionProgress`, status: `${row.processCode}Status` };
      return this.allowed(actor, execution && fields[key] ? fields[key]! : key === "divisionName" ? "divisionId" : key);
    })));
    return { rows, total: data.total, page, pageSize: allRows ? data.total : pageSize, visibleFields: tablePermissionFieldsFor(resource).map(f => f.key).filter(k => this.allowed(actor,k)) };
  }

  async candidates(kind: string, search: string, input: DashboardQuery, actor: MasterPlanActor) {
    input = this.normalize(input); this.assert(actor); this.validate(input, actor);
    if (!["divisionId", "customerCode", "orderNumber", "itemCode"].includes(kind)) throw new BadRequestException("候选字段无效");
    if (!this.readable(actor, kind)) throw new ForbiddenException("没有候选字段查看权限");
    if (typeof search !== "undefined" && (typeof search !== "string" || search.length > 100)) throw new BadRequestException("搜索过长");
    const context = { ...input }; delete context[kind === "orderNumber" ? "orderNumbers" : kind === "itemCode" ? "itemCodes" : kind as "divisionId" | "customerCode"];
    const params: unknown[] = [actor.tenantId];
    const facts = this.facts(context, actor, params, "read"); params.push(`%${search ?? ""}%`);
    const column = {divisionId:"division_id", customerCode:"customer_code", orderNumber:"order_number", itemCode:"item_code"}[kind]!;
    const label = kind === "divisionId" ? "o.name" : kind === "itemCode" && this.readable(actor,"itemName") ? "c.value||COALESCE(' · '||NULLIF(c.name,''),'')" : "c.value";
    return this.dataSource.transaction(async manager => {
      await manager.query("SET TRANSACTION READ ONLY");
      // EXPLAIN: JIT compilation dominated this correlated CTE report; disable only in this read transaction.
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('statement_timeout','15000',true),set_config('jit','off',true)", [actor.tenantId]);
      const rows = await manager.query(`WITH ${facts}, candidates AS (SELECT ${column}::text value,${kind === "itemCode" ? "min(item_name)" : "NULL::text"} name FROM dashboard_scope GROUP BY ${column}) SELECT c.value,${label} label FROM candidates c ${kind === "divisionId" ? "JOIN organization_units o ON o.id::text=c.value" : ""} WHERE c.value IS NOT NULL AND (${label} ILIKE $${params.length}) ORDER BY label LIMIT 51`, params);
      return { options: rows.slice(0,50), hasMore: rows.length>50 };
    });
  }
}
