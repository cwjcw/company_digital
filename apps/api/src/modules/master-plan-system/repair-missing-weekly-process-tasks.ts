import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { AppModule } from "../../app.module";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { weeklyLifecycleExecutableSql } from "./master-plan.lifecycle-sql";
import { MASTER_PLAN_SYSTEM_USER_ID } from "./master-plan.sync.service";
import type { MasterPlanActor } from "./master-plan.types";

const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
const apply = process.argv.includes("--apply");

/** Rebuild only a never-initialized internal route when inbound is the sole execution fact. */
async function main() {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const dataSource = context.get(DataSource);
    const application = context.get(MasterPlanApplicationService);
    const query = context.get(MasterPlanQueryService);
    const candidates = await dataSource.query<Array<{ id: string; order_number: string; item_code: string }>>(`
      SELECT w.id,w.order_number,w.item_code
      FROM mps_weekly_plans w
      WHERE w.tenant_id=$1 AND w.manufacturing_method IN ('自制','自制+外协')
        AND (${weeklyLifecycleExecutableSql("w")})
        AND mps_weekly_has_execution(w.tenant_id,w.id)
        AND NOT EXISTS(SELECT 1 FROM mps_weekly_process_plans p WHERE p.tenant_id=w.tenant_id AND p.weekly_plan_id=w.id)
        AND w.process_config_locked_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM mps_process_reports r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id)
        AND NOT EXISTS(SELECT 1 FROM mps_technical_reports r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id AND mps_execution_content('mps_technical_reports',to_jsonb(r)))
        AND NOT EXISTS(SELECT 1 FROM mps_material_reports r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id AND mps_execution_content('mps_material_reports',to_jsonb(r)))
        AND NOT EXISTS(SELECT 1 FROM mps_outsourcing_reports r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id AND mps_execution_content('mps_outsourcing_reports',to_jsonb(r)))
        AND NOT EXISTS(SELECT 1 FROM mps_three_day_work_orders r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id AND mps_execution_content('mps_three_day_work_orders',to_jsonb(r)))
        AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.tenant_id=w.tenant_id AND a.resource='mps-weekly-process-plans'
          AND a.record_id=w.id::text AND a.action IN ('mps-weekly-plans.process_config_confirmed','mps-weekly-plans.process_config_initialized'))
        AND EXISTS(SELECT 1 FROM mps_division_process_configs c WHERE c.tenant_id=w.tenant_id
          AND c.division_id=w.division_id AND c.default_enabled=true)
      ORDER BY w.order_number,w.item_code,w.id`, [tenantId]);

    const before = await taskAndReportFacts(dataSource, candidates.map(({ id }) => id));
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", tenantId, candidates: candidates.length, before }));
    if (!apply) return;

    const actor: MasterPlanActor = {
      tenantId, userId: MASTER_PLAN_SYSTEM_USER_ID, username: "MPS-MISSING-PROCESS-TASK-REPAIR",
      permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: ["planning"], tableDataScopes: [],
      requestId: randomUUID(), source: "system"
    };
    for (const candidate of candidates) {
      await application.refreshWeeklyExecution(candidate.id, actor);
    }

    const after = await taskAndReportFacts(dataSource, candidates.map(({ id }) => id));
    const remaining = await dataSource.query<Array<{ count: string }>>(`
      SELECT count(*)::text count FROM mps_weekly_plans w
      WHERE w.tenant_id=$1 AND w.manufacturing_method IN ('自制','自制+外协')
        AND (${weeklyLifecycleExecutableSql("w")})
        AND mps_weekly_has_execution(w.tenant_id,w.id)
        AND NOT EXISTS(SELECT 1 FROM mps_weekly_process_plans p WHERE p.tenant_id=w.tenant_id AND p.weekly_plan_id=w.id)
        AND w.process_config_locked_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM mps_process_reports r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id)
        AND NOT EXISTS(SELECT 1 FROM mps_technical_reports r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id AND mps_execution_content('mps_technical_reports',to_jsonb(r)))
        AND NOT EXISTS(SELECT 1 FROM mps_material_reports r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id AND mps_execution_content('mps_material_reports',to_jsonb(r)))
        AND NOT EXISTS(SELECT 1 FROM mps_outsourcing_reports r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id AND mps_execution_content('mps_outsourcing_reports',to_jsonb(r)))
        AND NOT EXISTS(SELECT 1 FROM mps_three_day_work_orders r WHERE r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id AND mps_execution_content('mps_three_day_work_orders',to_jsonb(r)))
        AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.tenant_id=w.tenant_id AND a.resource='mps-weekly-process-plans'
          AND a.record_id=w.id::text AND a.action IN ('mps-weekly-plans.process_config_confirmed','mps-weekly-plans.process_config_initialized'))
        AND EXISTS(SELECT 1 FROM mps_division_process_configs c WHERE c.tenant_id=w.tenant_id
          AND c.division_id=w.division_id AND c.default_enabled=true)`, [tenantId]);
    if (Number(before.reportCount) !== Number(after.reportCount) || before.reportQuantity !== after.reportQuantity)
      throw new Error("修复前后实际报工事实发生变化，停止并检查");
    if (Number(after.taskCount) < candidates.length) throw new Error("部分候选仍未生成工序任务");
    const pending = await query.list("mps-process-reports", { view: "PENDING", search: "2025A027058", pageSize: 500 }, actor);
    const targetTasks = pending.rows.filter((row: Record<string, unknown>) => row.orderNumber === "2025A027058" && row.itemCode === "TGH121HT-1/1");
    if (!targetTasks.length) throw new Error("应用层 PENDING 查询未返回目标订单/品号，不能确认修复完成");
    console.log(JSON.stringify({ repaired: candidates.length, after, remaining: Number(remaining[0]?.count ?? 0),
      targetPendingTasks: targetTasks.length, targetProcessCodes: targetTasks.map((row: Record<string, unknown>) => row.processCode) }));
  } finally {
    await context.close();
  }
}

async function taskAndReportFacts(dataSource: DataSource, ids: string[]) {
  if (!ids.length) return { taskCount: 0, reportCount: 0, reportQuantity: "0" };
  const [row] = await dataSource.query<Array<{ task_count: string; report_count: string; report_quantity: string }>>(`
    SELECT (SELECT count(*) FROM mps_weekly_process_plans p WHERE p.tenant_id=$1 AND p.weekly_plan_id=ANY($2::uuid[]))::text task_count,
      count(*)::text report_count,COALESCE(sum(r.production_quantity),0)::text report_quantity
    FROM mps_process_reports r WHERE r.tenant_id=$1 AND r.weekly_plan_id=ANY($2::uuid[])`, [tenantId, ids]);
  return { taskCount: Number(row?.task_count ?? 0), reportCount: Number(row?.report_count ?? 0), reportQuantity: row?.report_quantity ?? "0" };
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
