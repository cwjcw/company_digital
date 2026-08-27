import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { KdosDatabaseClient } from "@kdos/database";
import type { PoolClient } from "pg";
import { KDOS_DATABASE } from "../planning/drizzle-planning.repository";
import type { PlanningActor } from "../planning/planning.types";
import type { PlanningOperationsRepository } from "./planning-operations.repository";

@Injectable()
export class DrizzlePlanningOperationsRepository implements PlanningOperationsRepository {
  constructor(@Inject(KDOS_DATABASE) private readonly database: KdosDatabaseClient) {}
  async tenantId(code: string) { const result = await this.database.pool.query("SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true", [code]); if (!result.rowCount) throw new NotFoundException("租户不存在或已停用"); return String(result.rows[0].id); }
  private async transaction<T>(tenantId: string, work: (client: PoolClient) => Promise<T>) { const client = await this.database.pool.connect(); try { await client.query("BEGIN"); await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]); const result = await work(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  private async audit(client: PoolClient, tenantId: string, actor: PlanningActor, action: string, resourceType: string, resourceId: string | null, after: unknown, before: unknown = null) { await client.query(`INSERT INTO audit.audit_logs(tenant_id,user_id,action,resource_type,resource_id,before,after,source,request_id,trace_id,ip,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$2,$2)`, [tenantId, actor.userId, action, resourceType, resourceId, before == null ? null : JSON.stringify(before), JSON.stringify(after), actor.source, actor.requestId, actor.traceId ?? null, actor.ip ?? null]); }
  async listWeeklyPeriods(tenantId: string, currentDate: string) { return this.transaction(tenantId, async (client) => (await client.query(`SELECT id,sequence,name,start_date AS "startDate",end_date AS "endDate",($2::date BETWEEN start_date AND end_date) AS "isCurrent" FROM planning.weekly_plan_periods WHERE tenant_id=$1 ORDER BY sequence`, [tenantId,currentDate])).rows); }
  async listWeeklyItems(tenantId: string, periodId: string, search = "") { return this.transaction(tenantId, async (client) => (await client.query(`SELECT item.id,item.customer_code AS "customerCode",item.order_number AS "orderNumber",item.item_number AS "itemNumber",item.item_name AS "itemName",item.order_total_quantity AS "orderTotalQuantity",item.production_unit AS "productionUnit",item.completion_ratio AS "completionRatio",item.customer_due_date AS "customerDueDate",item.review_due_date AS "reviewDueDate",item.version,item.created_by AS "createdBy",item.created_at AS "createdAt",item.updated_by AS "updatedBy",item.updated_at AS "updatedAt" FROM planning.weekly_plan_items item WHERE item.tenant_id=$1 AND item.weekly_plan_period_id=$2 AND ($3='' OR concat_ws(' ',item.customer_code,item.order_number,item.item_number,item.item_name,item.production_unit) ILIKE '%'||$3||'%') ORDER BY item.customer_due_date NULLS LAST,item.order_number,item.item_number`, [tenantId, periodId, search.trim()])).rows); }
  async syncWeeklyItemsForDate(tenantId: string, currentDate: string, actor: PlanningActor) { return this.transaction(tenantId, async (client) => {
    const periodResult = await client.query(`SELECT id,name,to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(end_date,'YYYY-MM-DD') AS "endDate"
      FROM planning.weekly_plan_periods WHERE tenant_id=$1 AND $2::date BETWEEN start_date AND end_date FOR UPDATE`, [tenantId, currentDate]);
    if (!periodResult.rowCount) throw new NotFoundException(`${currentDate} 没有对应的周计划`);
    const period = periodResult.rows[0];
    const removedResult = await client.query(`DELETE FROM planning.weekly_plan_items weekly
      WHERE weekly.tenant_id=$1 AND weekly.weekly_plan_period_id=$2 AND NOT EXISTS (
        SELECT 1 FROM marketing.order_schedules schedule
        WHERE schedule.tenant_id=$1 AND schedule.id=weekly.source_order_schedule_id
          AND schedule.order_number=weekly.order_number AND schedule.item_number=weekly.item_number
          AND schedule.completion_ratio<100
      )`, [tenantId, period.id]);
    const result = await client.query(`WITH source AS MATERIALIZED (
        SELECT schedule.id AS source_order_schedule_id,schedule.customer_code,schedule.order_number,schedule.item_number,
          schedule.item_name,schedule.order_total_quantity,schedule.production_unit,schedule.completion_ratio,
          schedule.customer_due_date,item.delivery_date AS review_due_date
        FROM marketing.order_schedules schedule
        LEFT JOIN planning.plan_items item ON item.tenant_id=schedule.tenant_id AND item.id=schedule.source_plan_item_id
        WHERE schedule.tenant_id=$1 AND schedule.completion_ratio<100
      ), stats AS (
        SELECT count(*)::integer AS source_count,
          count(weekly.id)::integer AS matched,
          count(*) FILTER (WHERE weekly.id IS NULL)::integer AS created,
          count(*) FILTER (WHERE weekly.id IS NOT NULL AND ROW(
            weekly.source_order_schedule_id,weekly.customer_code,weekly.item_name,weekly.order_total_quantity,
            weekly.production_unit,weekly.completion_ratio,weekly.customer_due_date,weekly.review_due_date
          ) IS DISTINCT FROM ROW(
            source.source_order_schedule_id,source.customer_code,source.item_name,source.order_total_quantity,
            source.production_unit,source.completion_ratio,source.customer_due_date,COALESCE(source.review_due_date,weekly.review_due_date)
          ))::integer AS updated
        FROM source LEFT JOIN planning.weekly_plan_items weekly
          ON weekly.tenant_id=$1 AND weekly.weekly_plan_period_id=$2
         AND weekly.order_number=source.order_number AND weekly.item_number=source.item_number
      ), upserted AS (
        INSERT INTO planning.weekly_plan_items(
          tenant_id,weekly_plan_period_id,source_order_schedule_id,customer_code,order_number,item_number,item_name,
          order_total_quantity,production_unit,completion_ratio,customer_due_date,review_due_date,created_by,updated_by
        )
        SELECT $1,$2,source_order_schedule_id,customer_code,order_number,item_number,item_name,
          order_total_quantity,production_unit,completion_ratio,customer_due_date,review_due_date,$3,$3 FROM source
        ON CONFLICT(weekly_plan_period_id,order_number,item_number) DO UPDATE SET
          source_order_schedule_id=EXCLUDED.source_order_schedule_id,customer_code=EXCLUDED.customer_code,
          item_name=EXCLUDED.item_name,order_total_quantity=EXCLUDED.order_total_quantity,
          production_unit=EXCLUDED.production_unit,completion_ratio=EXCLUDED.completion_ratio,
          customer_due_date=EXCLUDED.customer_due_date,
          review_due_date=COALESCE(EXCLUDED.review_due_date,planning.weekly_plan_items.review_due_date),
          version=planning.weekly_plan_items.version+1,updated_at=now(),updated_by=$3
        WHERE ROW(
          planning.weekly_plan_items.source_order_schedule_id,planning.weekly_plan_items.customer_code,
          planning.weekly_plan_items.item_name,planning.weekly_plan_items.order_total_quantity,
          planning.weekly_plan_items.production_unit,planning.weekly_plan_items.completion_ratio,
          planning.weekly_plan_items.customer_due_date,planning.weekly_plan_items.review_due_date
        ) IS DISTINCT FROM ROW(
          EXCLUDED.source_order_schedule_id,EXCLUDED.customer_code,EXCLUDED.item_name,EXCLUDED.order_total_quantity,
          EXCLUDED.production_unit,EXCLUDED.completion_ratio,EXCLUDED.customer_due_date,
          COALESCE(EXCLUDED.review_due_date,planning.weekly_plan_items.review_due_date)
        ) RETURNING id
      )
      SELECT stats.*, (stats.matched-stats.updated)::integer AS unchanged FROM stats`, [tenantId, period.id, actor.userId]);
    const stats = result.rows[0] ?? { source_count: 0, matched: 0, created: 0, updated: 0, unchanged: 0 };
    const completedResult = await client.query("SELECT count(*)::integer AS count FROM marketing.order_schedules WHERE tenant_id=$1 AND completion_ratio>=100", [tenantId]);
    const summary = {
      currentDate, periodId: String(period.id), periodName: String(period.name), startDate: String(period.startDate), endDate: String(period.endDate),
      sourceCount: Number(stats.source_count), matched: Number(stats.matched), created: Number(stats.created), updated: Number(stats.updated),
      unchanged: Number(stats.unchanged), removed: removedResult.rowCount ?? 0, skippedCompleted: Number(completedResult.rows[0]?.count ?? 0)
    };
    await this.audit(client, tenantId, actor, "planning.weekly.imported_from_order_schedule", "WeeklyPlanPeriod", period.id, { ...summary, matchKey: ["orderNumber", "itemNumber"] });
    return summary;
  }); }
  async updateWeeklyDate(tenantId: string, id: string, field: "customer_due_date" | "review_due_date", value: string | null, expectedVersion: number, actor: PlanningActor) { return this.transaction(tenantId, async (client) => { const result = await client.query(`UPDATE planning.weekly_plan_items SET ${field}=$4,version=version+1,updated_at=now(),updated_by=$5 WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *`, [tenantId, id, expectedVersion, value, actor.userId]); if (!result.rowCount) throw new ConflictException("周计划已被其他用户修改，请刷新后重试"); await this.audit(client, tenantId, actor, "planning.weekly.updated", "WeeklyPlanItem", id, { field, value }); return result.rows[0]; }); }
  async listWorkReports(tenantId: string, date: string, search = "") { return this.transaction(tenantId, async (client) => (await client.query(`SELECT report.id,report.source_plan_item_id AS "sourcePlanItemId",report.work_date AS "workDate",report.customer,report.order_number AS "orderNumber",report.item_number AS "itemNumber",report.item_name AS "itemName",report.required_quantity AS "requiredQuantity",report.reported_quantity AS "reportedQuantity",report.version,report.created_by AS "createdBy",report.created_at AS "createdAt",report.updated_by AS "updatedBy",report.updated_at AS "updatedAt" FROM planning.work_reports report WHERE report.tenant_id=$1 AND report.work_date=$2 AND ($3='' OR concat_ws(' ',report.customer,report.order_number,report.item_number,report.item_name) ILIKE '%'||$3||'%') ORDER BY report.order_number,report.item_number`, [tenantId, date, search.trim()])).rows); }
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
        SELECT item.id AS source_plan_item_id,COALESCE(item.customer_name,item.customer_code) AS customer,
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
        UPDATE planning.work_reports report SET source_plan_item_id=source.source_plan_item_id,customer=source.customer,
          item_name=source.item_name,required_quantity=source.required_quantity,version=report.version+1,updated_at=now(),updated_by=$4
        FROM source WHERE report.tenant_id=$1 AND report.work_date=$2
          AND report.order_number=source.order_number AND report.item_number=source.item_number
          AND ROW(report.source_plan_item_id,report.customer,report.item_name,report.required_quantity)
            IS DISTINCT FROM ROW(source.source_plan_item_id,source.customer,source.item_name,source.required_quantity)
        RETURNING report.id
      ), inserted AS (
        INSERT INTO planning.work_reports(
          tenant_id,work_date,source_plan_item_id,customer,order_number,item_number,item_name,required_quantity,created_by,updated_by
        ) SELECT $1,$2,source.source_plan_item_id,source.customer,source.order_number,source.item_number,
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
    const current = await client.query(`SELECT id,reported_quantity AS "reportedQuantity",version FROM planning.work_reports WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId,id]);
    if (!current.rowCount) throw new NotFoundException("报工记录不存在");
    if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException("报工记录已被其他用户修改，请刷新后重试");
    const result=await client.query(`UPDATE planning.work_reports SET reported_quantity=$3,version=version+1,updated_at=now(),updated_by=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,id,quantity,actor.userId]);
    await this.audit(client,tenantId,actor,"planning.work_report.updated","WorkReport",id,{reportedQuantity:quantity,version:result.rows[0].version},{reportedQuantity:current.rows[0].reportedQuantity,version:current.rows[0].version});
    return result.rows[0];
  }); }
}
