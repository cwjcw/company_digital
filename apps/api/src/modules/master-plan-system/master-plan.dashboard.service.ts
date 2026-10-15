import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { standardProcesses } from "@tracker/shared";
import { auxiliaryPlanGroups, mpsDashboardRiskColumns, mpsDashboardResource as resource, tablePermissionFieldsFor, type MpsDashboardData, type MpsDashboardFilters, type MpsDashboardRow } from "@kdos/contracts";
import { normalizeKdosPageSize } from "../../common/pagination";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import { MASTER_PLAN_RESOURCE_MAP, virtualColumns } from "./master-plan.config";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

export type DashboardQuery = MpsDashboardFilters & { page?: unknown; pageSize?: unknown; riskType?: string; sortField?: string; sortOrder?: string };
const processes = [...standardProcesses].sort((a, b) => a.order - b.order);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const riskTypes = ["已延期", "计划待完善", "生产异常"];

@Injectable()
export class MasterPlanDashboardService {
  constructor(private readonly dataSource: DataSource) {}

  readable(actor: MasterPlanActor, key: string) { return hasMasterPlanFieldPermission(actor, resource, key, "read"); }
  private assert(actor: MasterPlanActor, action = "read") {
    if (!hasMasterPlanPermission(actor, resource, action)) throw new ForbiddenException("当前权限组没有主计划综合大屏权限");
  }
  private allowed(actor: MasterPlanActor, key: string) {
    const dependencies: Record<string, string[]> = {
      orderCompletionRate: ["orderCompletedQuantity", "orderRequiredQuantity"], dispatchRate: ["dispatchedWeeklyQuantity", "requiredQuantity"],
      inboundRate: ["cumulativeInboundQuantity", "requiredQuantity"], overdueCount: ["pendingQuantity", "latestCustomerDueDate"],
      exceptionCount: ["exceptionSummary"], unfinishedOrderCount: ["orderPendingQuantity"]
    };
    for (const p of processes) dependencies[`${p.code}ProductionProgress`] = [`${p.code}RequiredQuantity`, `${p.code}ReportedQuantity`];
    return this.readable(actor, key) && (dependencies[key] ?? []).every(k => this.readable(actor, k));
  }
  private validate(input: DashboardQuery, actor: MasterPlanActor) {
    for (const [key, field] of [["divisionId", "divisionId"], ["customerCode", "customerCode"], ["orderNumber", "orderNumber"], ["item", "itemCode"]] as const) {
      if (input[key] && (!this.readable(actor, field) || (key === "item" && !this.readable(actor, "itemName")))) throw new ForbiddenException("没有该筛选字段查看权限");
      if (input[key] != null && (typeof input[key] !== "string" || input[key]!.length > 200)) throw new BadRequestException("筛选值无效或过长");
    }
    if (input.divisionId && !uuid.test(input.divisionId)) throw new BadRequestException("事业部必须使用组织ID");
    if (input.sortField && !mpsDashboardRiskColumns.some(([key]) => key === input.sortField)) throw new BadRequestException("排序字段无效");
    if (input.sortField && !this.readable(actor, input.sortField)) throw new ForbiddenException("没有排序字段查看权限");
    if (input.sortOrder && !["asc", "desc"].includes(input.sortOrder)) throw new BadRequestException("排序方向无效");
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
    const scoped = (table: string, division = "division_id", item = true) => {
      const clauses = ["record.tenant_id=$1", this.scopeSql(actor, division, params)];
      if (action === "export") clauses.push(this.scopeSql(actor, division, params, "export"));
      const report = table.endsWith("reports");
      const weekly = table === "mps_weekly_plans";
      const business: string[] = [];
      for (const [key, column] of [["divisionId", division], ["customerCode", "customer_code"], ["orderNumber", "order_number"]] as const) {
        if (!input[key] || (report && key !== "divisionId")) continue;
        params.push(key === "orderNumber" ? `%${input[key]}%` : input[key]);
        const clause = `record.${column} ${key === "orderNumber" ? "ILIKE" : "="} $${params.length}${key === "divisionId" ? "::uuid" : ""}`;
        if (key === "divisionId") clauses.push(clause); else business.push(clause);
      }
      if (input.item && item && !report) { params.push(`%${input.item}%`); business.push(`(record.item_code ILIKE $${params.length} OR record.item_name ILIKE $${params.length})`); }
      // Current parent identities retain matching historical snapshots. Missing monthly plans must not erase actual reports.
      if (weekly && business.length) clauses.push(`((${business.join(" AND ")}) OR EXISTS(SELECT 1 FROM scoped_monthly m WHERE m.tenant_id=record.tenant_id AND m.order_number=record.order_number AND m.item_code=record.item_code) OR EXISTS(SELECT 1 FROM scoped_base b WHERE b.tenant_id=record.tenant_id AND b.id=record.base_plan_id))`);
      else clauses.push(...business);
      if (report) clauses.push("EXISTS(SELECT 1 FROM scoped_weekly w WHERE w.tenant_id=record.tenant_id AND w.id=record.weekly_plan_id)");
      if (table === "mps_group_plans" && input.item) clauses.push("EXISTS(SELECT 1 FROM scoped_monthly m WHERE m.tenant_id=record.tenant_id AND m.order_number=record.order_number)");
      const identity = "tenant_id,id,division_id,order_number,item_code,item_name,created_by";
      const selections: Record<string, string> = {
        mps_group_plans: "tenant_id,id,primary_division_id,order_number,customer_code,required_quantity,completed_quantity,pending_quantity,created_by",
        mps_monthly_plans: `${identity},customer_code,latest_customer_due_date,required_quantity,cumulative_inbound_quantity,pending_quantity`,
        mps_base_plans: `${identity},customer_code,latest_customer_due_date,planned_quantity,latest_review_due_date,product_attribute,surface_nature,manufacturing_method`,
        mps_weekly_plans: `${identity},customer_code,base_plan_id,planned_quantity,pending_quantity,latest_customer_due_date,hardware_due_date,wood_due_date`,
        mps_process_reports: `${identity},weekly_plan_id,process_code,production_date,production_quantity,exception_text`,
        mps_technical_reports: `${identity},weekly_plan_id,status,exception_text`,
        mps_material_reports: `${identity},weekly_plan_id,material_name,received,actual_inbound_date,exception_text`,
        mps_outsourcing_reports: `${identity},weekly_plan_id,status,exception_text`
      };
      return `SELECT ${selections[table]!.split(",").map(column => `record.${column}`).join(",")} FROM ${table} record WHERE ${clauses.join(" AND ")}`;
    };
    return `scoped_monthly AS MATERIALIZED (${scoped("mps_monthly_plans")}),
      scoped_group AS MATERIALIZED (${scoped("mps_group_plans", "primary_division_id", false)}),
      scoped_base AS MATERIALIZED (${scoped("mps_base_plans")}),
      scoped_weekly AS MATERIALIZED (${scoped("mps_weekly_plans")}),
      scoped_tasks AS MATERIALIZED (SELECT task.tenant_id,task.weekly_plan_id,task.process_code,task.status FROM mps_weekly_process_plans task JOIN scoped_weekly w ON w.tenant_id=task.tenant_id AND w.id=task.weekly_plan_id),
      scoped_process_reports AS MATERIALIZED (${scoped("mps_process_reports")}),
      scoped_technical_reports AS MATERIALIZED (${scoped("mps_technical_reports")}),
      scoped_material_reports AS MATERIALIZED (${scoped("mps_material_reports")}),
      scoped_outsourcing_reports AS MATERIALIZED (${scoped("mps_outsourcing_reports")})`;
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
  /** Public for real PostgreSQL/EXPLAIN verification; all values remain bound parameters. */
  querySql(input: DashboardQuery, actor: MasterPlanActor, action: "read" | "export" = "read", allRisks = false) {
    this.assert(actor); if (action === "export") this.assert(actor, "export"); this.validate(input, actor);
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
    const joinWeekly = (table: string) => `FROM ${table} r JOIN monthly_weekly w ON w.tenant_id=r.tenant_id AND w.id=r.weekly_plan_id`;
    const exceptionSources = [
      `SELECT w.tenant_id,w.order_number,w.item_code,0 ord,'技术' label,r.exception_text ${joinWeekly("scoped_technical_reports")}`,
      `SELECT w.tenant_id,w.order_number,w.item_code,CASE WHEN r.material_name='五金' THEN 1 ELSE 2 END,CASE WHEN r.material_name='五金' THEN '五金主材' ELSE '木作主材' END,r.exception_text ${joinWeekly("scoped_material_reports")} WHERE r.material_name IN ('五金','木作')`,
      `SELECT w.tenant_id,w.order_number,w.item_code,3,'外协',r.exception_text ${joinWeekly("scoped_outsourcing_reports")}`,
      `SELECT w.tenant_id,w.order_number,w.item_code,p.ord+10,p.label,r.exception_text ${joinWeekly("scoped_process_reports")} JOIN (VALUES ${processes.map(p => `('${p.code}','${p.name}',${p.order})`).join(",")}) p(code,label,ord) ON p.code=r.process_code`
    ];
    const riskSort = input.sortField ? `${input.sortField === "divisionId" ? "o.name" : `r."${input.sortField}"${["requiredQuantity", "dispatchedWeeklyQuantity", "cumulativeInboundQuantity", "pendingQuantity"].includes(input.sortField) ? "::numeric" : ""}`} ${input.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST,` : "";
    const sql = `WITH ${facts},
      report_totals AS MATERIALIZED (SELECT tenant_id,weekly_plan_id,process_code,sum(production_quantity) quantity FROM scoped_process_reports GROUP BY 1,2,3),
      monthly_weekly AS MATERIALIZED (SELECT w.* FROM scoped_weekly w JOIN scoped_monthly m ON m.tenant_id=w.tenant_id AND m.order_number=w.order_number AND m.item_code=w.item_code),
      monthly_reports AS MATERIALIZED (SELECT r.* FROM report_totals r JOIN monthly_weekly w ON w.tenant_id=r.tenant_id AND w.id=r.weekly_plan_id),
      weekly_totals AS (SELECT tenant_id,order_number,item_code,sum(planned_quantity) dispatched,min(latest_customer_due_date) FILTER(WHERE pending_quantity>0) due,max(latest_customer_due_date) last_due FROM monthly_weekly GROUP BY 1,2,3),
      task_states AS (SELECT w.tenant_id,w.order_number,w.item_code,r.process_code,${status} status ${joinWeekly("scoped_tasks")} GROUP BY 1,2,3,4),
      task_maps AS (SELECT tenant_id,order_number,item_code,jsonb_object_agg(process_code,status) states FROM task_states GROUP BY 1,2,3),
      aux_facts AS (
        SELECT w.tenant_id,w.order_number,w.item_code,'technical' key,r.status ${joinWeekly("scoped_technical_reports")}
        UNION ALL SELECT w.tenant_id,w.order_number,w.item_code,CASE WHEN r.material_name='五金' THEN 'hardware' ELSE 'wood' END,CASE WHEN r.received OR r.actual_inbound_date IS NOT NULL THEN '已完成' WHEN (CASE WHEN r.material_name='五金' THEN w.hardware_due_date ELSE w.wood_due_date END)<CURRENT_DATE THEN '延期' ELSE '未开始' END ${joinWeekly("scoped_material_reports")} WHERE r.material_name IN ('五金','木作')
        UNION ALL SELECT w.tenant_id,w.order_number,w.item_code,'outsourcing',r.status ${joinWeekly("scoped_outsourcing_reports")}
      ), aux_states AS (SELECT tenant_id,order_number,item_code,key,${status} status FROM aux_facts GROUP BY 1,2,3,4),
      aux_maps AS (SELECT tenant_id,order_number,item_code,jsonb_object_agg(key,status) states FROM aux_states GROUP BY 1,2,3),
      exception_facts AS (${exceptionSources.join(" UNION ALL ")}),
      exception_parts AS (SELECT tenant_id,order_number,item_code,ord,label||'：'||string_agg(DISTINCT exception_text,'、' ORDER BY exception_text) part FROM exception_facts WHERE btrim(COALESCE(exception_text,''))<>'' GROUP BY 1,2,3,4,label),
      exception_totals AS (SELECT tenant_id,order_number,item_code,string_agg(part,'；' ORDER BY ord) summary FROM exception_parts GROUP BY 1,2,3),
      monthly_data AS MATERIALIZED (SELECT record.*,${monthColumns},COALESCE(w.dispatched,0) "dispatchedWeeklyQuantity" FROM scoped_monthly record
        LEFT JOIN weekly_totals w USING(tenant_id,order_number,item_code)
        LEFT JOIN task_maps t USING(tenant_id,order_number,item_code)
        LEFT JOIN aux_maps a USING(tenant_id,order_number,item_code)
        LEFT JOIN exception_totals e USING(tenant_id,order_number,item_code)),
      base_data AS MATERIALIZED (SELECT record.*,${baseColumns} FROM scoped_base record),
      risk_rows AS (
        SELECT id::text, 'mps-monthly-plans' resource,division_id "divisionId",order_number "orderNumber",item_code "itemCode",item_name "itemName", "latestCustomerDueDate"::text, required_quantity::text "requiredQuantity", "dispatchedWeeklyQuantity"::text, cumulative_inbound_quantity::text "cumulativeInboundQuantity",pending_quantity::text "pendingQuantity",kind "riskType", "exceptionSummary",NULL::text "weeklyPlanMissingFields",NULL::text "weeklyPlanGenerationIssue"
        FROM monthly_data CROSS JOIN LATERAL (SELECT '已延期' kind WHERE ${canRisk("已延期")} AND pending_quantity>0 AND "latestCustomerDueDate"<(now() AT TIME ZONE 'Asia/Shanghai')::date UNION ALL SELECT '生产异常' WHERE ${canRisk("生产异常")} AND "exceptionSummary"<>'') risks
        UNION ALL SELECT id::text,'mps-base-plans',division_id,order_number,item_code,item_name,latest_customer_due_date::text,NULL,NULL,NULL,NULL,'计划待完善',NULL,"weeklyPlanMissingFields","weeklyPlanGenerationIssue" FROM base_data WHERE ${canRisk("计划待完善")} AND "weeklyPlanState"='待完善'
      ), filtered_risks AS (SELECT * FROM risk_rows WHERE ${typeParam}::text IS NULL OR "riskType"=${typeParam}),
      division_rows AS (SELECT division_id "divisionId",${planSummary} metrics FROM monthly_data GROUP BY division_id),
      daily AS (SELECT production_date,process_code,sum(production_quantity) quantity FROM scoped_process_reports WHERE production_date >= (now() AT TIME ZONE 'Asia/Shanghai')::date-7 AND production_date < (now() AT TIME ZONE 'Asia/Shanghai')::date GROUP BY 1,2)
      SELECT jsonb_build_object(
        'orders',(SELECT ${json({ orderCount: 'count(*)', unfinishedOrderCount: 'count(*) FILTER(WHERE pending_quantity>0)', orderRequiredQuantity: sum('required_quantity'), orderCompletedQuantity: sum('completed_quantity'), orderPendingQuantity: sum('pending_quantity'), orderCompletionRate: '(sum(completed_quantity)/NULLIF(sum(required_quantity),0))::text' })} FROM scoped_group),
        'plans',(SELECT ${planSummary} FROM monthly_data),
        'readiness',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',status,'count',n,'ratio',(n::numeric/NULLIF((SELECT count(*) FROM base_data),0))::text)) FROM (SELECT "weeklyPlanState" status,count(*) n FROM base_data GROUP BY 1) r),'[]'::jsonb),
        'auxiliary',(SELECT jsonb_agg(a) FROM (${auxiliary}) a),
        'processes',(SELECT jsonb_agg(p) FROM (${processRows}) p),
        'trend',(SELECT jsonb_agg(jsonb_build_object('productionDate',d::date::text) || COALESCE((SELECT jsonb_object_agg(process_code||'ReportedQuantity',quantity::text) FROM daily WHERE production_date=d::date),'{}'::jsonb) ORDER BY d) FROM generate_series((now() AT TIME ZONE 'Asia/Shanghai')::date-7,(now() AT TIME ZONE 'Asia/Shanghai')::date-1,'1 day') d),
        'divisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('divisionId',d."divisionId",'divisionName',o.name)||d.metrics ORDER BY o.name) FROM division_rows d LEFT JOIN organization_units o ON o.id=d."divisionId"),'[]'::jsonb),
        'risks',jsonb_build_object('total',(SELECT count(*) FROM filtered_risks),'rows',COALESCE((SELECT jsonb_agg(r) FROM (SELECT r.*,o.name "divisionName" FROM filtered_risks r LEFT JOIN organization_units o ON o.id=r."divisionId" ORDER BY ${riskSort} "latestCustomerDueDate" NULLS LAST,"orderNumber","itemCode","riskType",id ${allRisks ? "" : `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`}) r),'[]'::jsonb)),
        'trendStart',((now() AT TIME ZONE 'Asia/Shanghai')::date-7)::text,'trendEnd',((now() AT TIME ZONE 'Asia/Shanghai')::date-1)::text
      ) data`;
    return { sql, params, page, pageSize };
  }

  async dashboard(input: DashboardQuery, actor: MasterPlanActor, action: "read" | "export" = "read", allRisks = false): Promise<MpsDashboardData> {
    const { sql, params, page, pageSize } = this.querySql(input, actor, action, allRisks);
    const data = await this.dataSource.transaction("REPEATABLE READ", async manager => {
      await manager.query("SET TRANSACTION READ ONLY");
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('statement_timeout','15000',true)", [actor.tenantId]);
      return (await manager.query(sql, params))[0].data;
    });
    const clean = (row: MpsDashboardRow, mapping: Record<string, string> = {}) => Object.fromEntries(Object.entries(row).filter(([key]) => ["id", "resource"].includes(key) || this.allowed(actor, mapping[key] ?? (key === "divisionName" ? "divisionId" : key))));
    return {
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

  async candidates(kind: string, search: string, input: DashboardQuery, actor: MasterPlanActor) {
    this.assert(actor); this.validate(input, actor);
    if (!["divisionId", "customerCode"].includes(kind)) throw new BadRequestException("候选字段无效");
    if (!this.readable(actor, kind)) throw new ForbiddenException("没有候选字段查看权限");
    if (String(search ?? "").length > 100) throw new BadRequestException("搜索过长");
    const params: unknown[] = [actor.tenantId];
    const facts = this.facts(input, actor, params, "read"); params.push(`%${search ?? ""}%`);
    const dimension = kind === "divisionId" ? 'SELECT division_id::text value FROM scoped_monthly UNION SELECT primary_division_id::text FROM scoped_group UNION SELECT division_id::text FROM scoped_base UNION SELECT division_id::text FROM scoped_weekly' : 'SELECT customer_code value FROM scoped_monthly UNION SELECT customer_code FROM scoped_group UNION SELECT customer_code FROM scoped_base UNION SELECT customer_code FROM scoped_weekly';
    return this.dataSource.transaction(async manager => {
      await manager.query("SET TRANSACTION READ ONLY");
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const rows = await manager.query(`WITH ${facts}, candidates AS (${dimension}) SELECT c.value,${kind === "divisionId" ? "o.name" : "c.value"} label FROM candidates c ${kind === "divisionId" ? "JOIN organization_units o ON o.id::text=c.value" : ""} WHERE c.value IS NOT NULL AND ${kind === "divisionId" ? "o.name" : "c.value"} ILIKE $${params.length} ORDER BY label LIMIT 31`, params);
      return { options: rows.slice(0, 30), hasMore: rows.length > 30 };
    });
  }
}
