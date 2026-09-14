import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { KdosDatabaseClient } from "@kdos/database";
import type { PoolClient } from "pg";
import { KDOS_DATABASE } from "../planning/drizzle-planning.repository";
import type { PlanningActor } from "../planning/planning.types";
import type { OperationsPageInput, PlanningOperationsRepository } from "./planning-operations.repository";

@Injectable()
export class DrizzlePlanningOperationsRepository implements PlanningOperationsRepository {
  constructor(@Inject(KDOS_DATABASE) private readonly database: KdosDatabaseClient) {}
  async tenantId(code: string) { const result = await this.database.pool.query("SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true", [code]); if (!result.rowCount) throw new NotFoundException("租户不存在或已停用"); return String(result.rows[0].id); }
  private async transaction<T>(tenantId: string, work: (client: PoolClient) => Promise<T>) { const client = await this.database.pool.connect(); try { await client.query("BEGIN"); await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]); const result = await work(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  private async audit(client: PoolClient, tenantId: string, actor: PlanningActor, action: string, resourceType: string, resourceId: string | null, after: unknown, before: unknown = null) { await client.query(`INSERT INTO audit.audit_logs(tenant_id,user_id,action,resource_type,resource_id,before,after,source,request_id,trace_id,ip,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$2,$2)`, [tenantId, actor.userId, action, resourceType, resourceId, before == null ? null : JSON.stringify(before), JSON.stringify(after), actor.source, actor.requestId, actor.traceId ?? null, actor.ip ?? null]); }
  async listWeeklyPeriods(tenantId: string, currentDate: string) { return this.transaction(tenantId, async (client) => (await client.query(`SELECT id,sequence,name,start_date AS "startDate",end_date AS "endDate",($2::date BETWEEN start_date AND end_date) AS "isCurrent" FROM planning.weekly_plan_periods WHERE tenant_id=$1 ORDER BY sequence`, [tenantId,currentDate])).rows); }
  async listRollingPlanItems(tenantId: string) { return this.transaction(tenantId, async (client) => {
    const result = await client.query(`SELECT item.id,item.source_order_schedule_id AS "sourceOrderScheduleId",item.order_number AS "orderNumber",
      item.item_number AS "itemNumber",item.customer_name AS customer,item.order_quantity AS "orderQuantity",
      item.production_quantity AS "productionQuantity",item.delivery_date AS "customerDueDate",item.responsible_org_id AS "responsibleOrgId",
      item.sequence,item.legacy_data AS "legacyData",item.version,item.created_by AS "createdBy",item.created_at AS "createdAt",
      item.updated_by AS "updatedBy",item.updated_at AS "updatedAt"
      FROM planning.rolling_plan_items item WHERE item.tenant_id=$1 ORDER BY item.sequence,item.created_at`, [tenantId]);
    return result.rows.map((row) => ({
      ...(row.legacyData && typeof row.legacyData === "object" ? row.legacyData : {}), ...row,
      planSequence: row.sequence, historicalInboundQuantity: "0", todayInboundQuantity: "0",
      balanceQuantity: row.productionQuantity, inboundAmount: "0", balanceAmount: "0", completionRate: 0,
      itemStatus: "待生产", processes: (row.legacyData as Record<string, unknown> | null)?.processes ?? {}
    }));
  }); }
  async listWeeklyItems(tenantId: string, periodId: string, input: OperationsPageInput) { return this.transaction(tenantId, async (client) => {
    const values: unknown[]=[tenantId,periodId,input.search?.trim()??""]; const where=["item.tenant_id=$1","item.weekly_plan_period_id=$2","($3='' OR concat_ws(' ',item.customer_code,item.order_number,item.item_number,item.item_name,item.production_unit) ILIKE '%'||$3||'%')"];
    const columns:Record<string,string>={customerCode:"item.customer_code",orderNumber:"item.order_number",itemNumber:"item.item_number",itemName:"item.item_name",orderTotalQuantity:"item.order_total_quantity::text",productionUnit:"item.production_unit",completionRatio:"item.completion_ratio::text",customerDueDate:"item.customer_due_date::text",reviewDueDate:"item.review_due_date::text",createdBy:"item.created_by::text",createdAt:"item.created_at::text",updatedBy:"item.updated_by::text",updatedAt:"item.updated_at::text"};
    for(const [key,raw] of Object.entries(input.filters??{})){const value=raw.trim(),column=columns[key];if(!value||!column)continue;values.push(value);where.push(`coalesce(${column},'') ILIKE '%'||$${values.length}||'%'`);}
    const sortColumn=columns[input.sortField??""];const orderBy=sortColumn?`${sortColumn} ${input.sortOrder==="desc"?"DESC":"ASC"} NULLS LAST`:"item.customer_due_date NULLS LAST,item.order_number,item.item_number";
    const total=Number((await client.query(`SELECT count(*)::int total FROM planning.weekly_plan_items item WHERE ${where.join(" AND ")}`,values)).rows[0]?.total??0);
    values.push(input.pageSize,(input.page-1)*input.pageSize);
    const rows=(await client.query(`SELECT item.id,item.customer_code AS "customerCode",item.order_number AS "orderNumber",item.item_number AS "itemNumber",item.item_name AS "itemName",item.order_total_quantity AS "orderTotalQuantity",item.production_unit AS "productionUnit",item.completion_ratio AS "completionRatio",item.customer_due_date AS "customerDueDate",item.review_due_date AS "reviewDueDate",item.version,item.created_by AS "createdBy",item.created_at AS "createdAt",item.updated_by AS "updatedBy",item.updated_at AS "updatedAt" FROM planning.weekly_plan_items item WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
    return {rows,total,page:input.page,pageSize:input.pageSize};
  }); }
  async updateWeeklyDate(tenantId: string, id: string, field: "customer_due_date" | "review_due_date", value: string | null, expectedVersion: number, actor: PlanningActor) { return this.transaction(tenantId, async (client) => { const result = await client.query(`UPDATE planning.weekly_plan_items SET ${field}=$4,version=version+1,updated_at=now(),updated_by=$5 WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *`, [tenantId, id, expectedVersion, value, actor.userId]); if (!result.rowCount) throw new ConflictException("周计划已被其他用户修改，请刷新后重试"); await this.audit(client, tenantId, actor, "planning.weekly.updated", "WeeklyPlanItem", id, { field, value }); return result.rows[0]; }); }
  private workReportScope(actor: PlanningActor, action: string, values: unknown[], alias = "report") {
    if (actor.permissions.includes("*")) return "true";
    const scopes = (actor.tableDataScopes ?? []).filter((scope) => scope.resource === "work-report" && (!scope.actions || scope.actions.includes(action)));
    if (scopes.some((scope) => scope.scope === "ALL")) return "true";
    const columns: Record<string,string> = { divisionId: `${alias}.division_id`, workDate: `${alias}.work_date`, customer: `${alias}.customer`, orderNumber: `${alias}.order_number`, itemNumber: `${alias}.item_number`, itemName: `${alias}.item_name`, requiredQuantity: `${alias}.required_quantity`, reportedQuantity: `${alias}.reported_quantity`, createdBy: `${alias}.created_by` };
    const alternatives: string[] = [];
    if (actor.userId && scopes.some((scope) => scope.scope === "OWN")) { values.push(actor.userId); alternatives.push(`${alias}.created_by=$${values.length}::uuid`); }
    for (const scope of scopes.filter((entry) => entry.scope === "CUSTOM")) {
      const rules: string[] = [];
      for (const rule of scope.rules ?? []) {
        const column = columns[String(rule.fieldKey ?? "")]; if (!column) continue;
        const expected = rule.value === "CURRENT_USER" ? actor.userId : rule.value === "CURRENT_USER_MANAGED_DEPARTMENTS" ? actor.managedOrganizationUnitIds ?? [] : rule.value;
        const operator = String(rule.operator ?? "");
        if (operator === "IS_EMPTY") { rules.push(`(${column} IS NULL OR btrim(${column}::text)='')`); continue; }
        if (operator === "IS_NOT_EMPTY") { rules.push(`(${column} IS NOT NULL AND btrim(${column}::text)<>'')`); continue; }
        if (["IN","NOT_IN"].includes(operator)) { const entries = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")]; values.push(entries); rules.push(`${column}::text ${operator === "IN" ? "= ANY" : "<> ALL"}($${values.length}::text[])`); continue; }
        if (expected == null) continue;
        const comparison: Record<string,string> = { EQ:"=",NE:"<>",GT:">",GTE:">=",LT:"<",LTE:"<=" };
        if (comparison[operator]) { values.push(String(expected)); rules.push(`${column}::text ${comparison[operator]} $${values.length}`); continue; }
        if (["CONTAINS","NOT_CONTAINS","STARTS_WITH"].includes(operator)) { values.push(operator === "STARTS_WITH" ? `${expected}%` : `%${expected}%`); rules.push(`COALESCE(${column}::text,'') ${operator === "NOT_CONTAINS" ? "NOT ILIKE" : "ILIKE"} $${values.length}`); }
      }
      if (rules.length) alternatives.push(`(${rules.join(scope.match === "ANY" ? " OR " : " AND ")})`);
    }
    return alternatives.length ? `(${alternatives.join(" OR ")})` : "false";
  }
  async listWorkReports(tenantId: string, date: string, input: OperationsPageInput, actor: PlanningActor) { return this.transaction(tenantId, async (client) => {
    const values:unknown[]=[tenantId,date,input.search?.trim()??"",input.divisionIds??[]];const where=["report.tenant_id=$1","report.work_date=$2","($3='' OR concat_ws(' ',report.customer,report.order_number,report.item_number,report.item_name) ILIKE '%'||$3||'%' OR report.division_id=ANY($4::uuid[]))"];
    if (input.divisionFilterActive) where.push("report.division_id=ANY($4::uuid[])");
    where.push(this.workReportScope(actor,"read",values));
    const columns:Record<string,string>={workDate:"report.work_date::text",divisionId:"report.division_id::text",customer:"report.customer",orderNumber:"report.order_number",itemNumber:"report.item_number",itemName:"report.item_name",requiredQuantity:"report.required_quantity::text",reportedQuantity:"report.reported_quantity::text",createdBy:"report.created_by::text",createdAt:"report.created_at::text",updatedBy:"report.updated_by::text",updatedAt:"report.updated_at::text"};
    for(const [key,raw] of Object.entries(input.filters??{})){const value=raw.trim(),column=columns[key];if(!value||!column)continue;values.push(value);where.push(`coalesce(${column},'') ILIKE '%'||$${values.length}||'%'`);}
    const sortColumn=columns[input.sortField??""];const orderBy=sortColumn?`${sortColumn} ${input.sortOrder==="desc"?"DESC":"ASC"} NULLS LAST`:"report.order_number,report.item_number";
    const total=Number((await client.query(`SELECT count(*)::int total FROM planning.work_reports report WHERE ${where.join(" AND ")}`,values)).rows[0]?.total??0);values.push(input.pageSize,(input.page-1)*input.pageSize);
    const rows=(await client.query(`SELECT report.id,report.source_plan_item_id AS "sourcePlanItemId",report.work_date AS "workDate",report.division_id AS "divisionId",report.customer,report.order_number AS "orderNumber",report.item_number AS "itemNumber",report.item_name AS "itemName",report.required_quantity AS "requiredQuantity",report.reported_quantity AS "reportedQuantity",report.version,report.created_by AS "createdBy",report.created_at AS "createdAt",report.updated_by AS "updatedBy",report.updated_at AS "updatedAt" FROM planning.work_reports report WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
    return {rows,total,page:input.page,pageSize:input.pageSize};
  }); }
  async syncWorkReports(tenantId: string, date: string, actor: PlanningActor) { return this.transaction(tenantId, async (client) => {
    const targetResult = await client.query(`SELECT period.id AS "planPeriodId",version.id AS "planVersionId"
      FROM planning.plan_periods period
      JOIN planning.plan_versions version ON version.tenant_id=period.tenant_id AND version.period_id=period.id AND version.status IN ('DRAFT','PUBLISHED','LOCKED')
      WHERE period.tenant_id=$1 AND period.year=EXTRACT(YEAR FROM $2::date)::integer AND period.month=EXTRACT(MONTH FROM $2::date)::integer
      ORDER BY CASE WHEN version.id=period.current_version_id THEN 0 WHEN version.status='DRAFT' THEN 1 WHEN version.status='PUBLISHED' THEN 2 ELSE 3 END,version.version_number DESC
      LIMIT 1 FOR UPDATE OF version`, [tenantId, date]);
    if (!targetResult.rowCount) throw new NotFoundException(`${date.slice(0, 7)} 没有可用的月度计划版本`);
    const target = targetResult.rows[0];
    const itemCountResult = await client.query("SELECT count(*)::integer AS count FROM planning.plan_items WHERE tenant_id=$1 AND plan_version_id=$2", [tenantId, target.planVersionId]);
    if (Number(itemCountResult.rows[0]?.count ?? 0) === 0) throw new NotFoundException(`${date.slice(0, 7)} 的月度计划没有可导入数据`);
    const result = await client.query(`WITH source AS MATERIALIZED (
        SELECT item.id AS source_plan_item_id,item.responsible_org_id AS division_id,COALESCE(item.customer_name,item.customer_code) AS customer,
          item.order_number,item.item_number,item.item_name,item.order_quantity AS required_quantity
        FROM planning.plan_items item WHERE item.tenant_id=$1 AND item.plan_version_id=$3
      ), matched AS (
        SELECT count(*)::integer AS count FROM source JOIN planning.work_reports report
          ON report.tenant_id=$1 AND report.work_date=$2 AND report.order_number=source.order_number AND report.item_number=source.item_number
      ), removed AS (
        DELETE FROM planning.work_reports report WHERE report.tenant_id=$1 AND report.work_date=$2
          AND report.reported_quantity=0 AND NOT EXISTS (
            SELECT 1 FROM source WHERE source.order_number=report.order_number AND source.item_number=report.item_number
          ) RETURNING report.id
      ), preserved AS (
        SELECT count(*)::integer AS count FROM planning.work_reports report WHERE report.tenant_id=$1 AND report.work_date=$2
          AND report.reported_quantity<>0 AND NOT EXISTS (
            SELECT 1 FROM source WHERE source.order_number=report.order_number AND source.item_number=report.item_number
          )
      ), updated AS (
        UPDATE planning.work_reports report SET source_plan_item_id=source.source_plan_item_id,division_id=source.division_id,customer=source.customer,
          item_name=source.item_name,required_quantity=source.required_quantity,version=report.version+1,updated_at=now(),updated_by=$4
        FROM source WHERE report.tenant_id=$1 AND report.work_date=$2
          AND report.order_number=source.order_number AND report.item_number=source.item_number
          AND ROW(report.source_plan_item_id,report.division_id,report.customer,report.item_name,report.required_quantity)
            IS DISTINCT FROM ROW(source.source_plan_item_id,source.division_id,source.customer,source.item_name,source.required_quantity)
        RETURNING report.id
      ), inserted AS (
        INSERT INTO planning.work_reports(
          tenant_id,work_date,source_plan_item_id,division_id,customer,order_number,item_number,item_name,required_quantity,created_by,updated_by
        ) SELECT $1,$2,source.source_plan_item_id,source.division_id,source.customer,source.order_number,source.item_number,
          source.item_name,source.required_quantity,$4,$4 FROM source
        WHERE NOT EXISTS (
          SELECT 1 FROM planning.work_reports report WHERE report.tenant_id=$1 AND report.work_date=$2
            AND report.order_number=source.order_number AND report.item_number=source.item_number
        ) ON CONFLICT(tenant_id,work_date,order_number,item_number) DO NOTHING RETURNING id
      ) SELECT
        (SELECT count(*)::integer FROM source) AS source_count,
        (SELECT count FROM matched) AS matched,
        (SELECT count(*)::integer FROM inserted) AS created,
        (SELECT count(*)::integer FROM updated) AS updated,
        (SELECT count(*)::integer FROM removed) AS removed_stale,
        (SELECT count FROM preserved) AS preserved_reported`, [tenantId, date, target.planVersionId, actor.userId]);
    const stats = result.rows[0];
    const summary = {
      date, planPeriodId: String(target.planPeriodId), planVersionId: String(target.planVersionId), sourceCount: Number(stats.source_count),
      matched: Number(stats.matched), created: Number(stats.created), updated: Number(stats.updated),
      unchanged: Number(stats.matched) - Number(stats.updated), removedStale: Number(stats.removed_stale), preservedReported: Number(stats.preserved_reported)
    };
    await this.audit(client,tenantId,actor,"planning.work_report.imported_from_monthly_plan","WorkReport",null,{...summary,matchKey:["orderNumber","itemNumber"],reportedQuantityPreserved:true});
    return summary;
  }); }
  async updateReportedQuantity(tenantId: string, id: string, quantity: string, expectedVersion: number, actor: PlanningActor) { return this.transaction(tenantId, async (client) => {
    const scopeValues: unknown[] = [tenantId,id]; const scope = this.workReportScope(actor,"update",scopeValues,"report");
    const current = await client.query(`SELECT id,reported_quantity AS "reportedQuantity",version FROM planning.work_reports report WHERE tenant_id=$1 AND id=$2 AND ${scope} FOR UPDATE`, scopeValues);
    if (!current.rowCount) throw new NotFoundException("报工记录不存在");
    if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException("报工记录已被其他用户修改，请刷新后重试");
    const result=await client.query(`UPDATE planning.work_reports SET reported_quantity=$3,version=version+1,updated_at=now(),updated_by=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,id,quantity,actor.userId]);
    await this.audit(client,tenantId,actor,"planning.work_report.updated","WorkReport",id,{reportedQuantity:quantity,version:result.rows[0].version},{reportedQuantity:current.rows[0].reportedQuantity,version:current.rows[0].version});
    return result.rows[0];
  }); }
}
