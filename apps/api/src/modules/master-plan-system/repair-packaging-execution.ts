import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { AppModule } from "../../app.module";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MASTER_PLAN_SYSTEM_USER_ID } from "./master-plan.sync.service";
import type { MasterPlanActor } from "./master-plan.types";

type RepairCandidate = { id: string; manufacturing_method: string; order_number: string; item_code: string };

const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
const apply = process.argv.includes("--apply");

/**
 * KN-MPS-PROC-PACKAGING-001 历史修复。
 *
 * 默认仅输出影响范围；传入 --apply 后，逐条调用正式的周计划 execution refresh
 * Application Command，保留事务、乐观版本和审计，不允许用 SQL 直接改工序任务。
 */
async function main() {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const dataSource = context.get(DataSource);
    const application = context.get(MasterPlanApplicationService);
    const candidates = await dataSource.query<RepairCandidate[]>(`
      SELECT w.id,w.manufacturing_method,w.order_number,w.item_code
      FROM mps_weekly_plans w
      LEFT JOIN mps_weekly_process_plans packaging
        ON packaging.tenant_id=w.tenant_id AND packaging.weekly_plan_id=w.id AND packaging.process_code='packaging'
      WHERE w.tenant_id=$1
        AND w.manufacturing_method IN ('自制','自制+外协','外协','中心外购')
        AND (packaging.id IS NULL OR packaging.execution_enabled IS DISTINCT FROM true)
      ORDER BY w.manufacturing_method,w.order_number,w.item_code,w.id`, [tenantId]);
    const beforeReports = await reportFacts(dataSource, candidates.map((candidate) => candidate.id));
    const byMethod = Object.fromEntries(["自制", "自制+外协", "外协", "中心外购"].map((method) => [method, candidates.filter((candidate) => candidate.manufacturing_method === method).length]));
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", tenantId, candidates: candidates.length, byMethod, reportFactsBefore: beforeReports }));
    if (!apply) return;

    const actor: MasterPlanActor = {
      tenantId, userId: MASTER_PLAN_SYSTEM_USER_ID, username: "KN-MPS-PROC-PACKAGING-001",
      permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: ["planning"], tableDataScopes: [],
      requestId: randomUUID(), source: "system"
    };
    for (const candidate of candidates) {
      try { await application.refreshWeeklyExecution(candidate.id, actor); }
      catch (error) {
        console.error(JSON.stringify({ failedCandidate: candidate, code: (error as { code?: string }).code, message: error instanceof Error ? error.message : String(error) }));
        throw error;
      }
    }
    const afterReports = await reportFacts(dataSource, candidates.map((candidate) => candidate.id));
    if (JSON.stringify(beforeReports) !== JSON.stringify(afterReports)) throw new Error("历史修复意外修改了实际工序报工事实，已中止");
    const remaining = await dataSource.query<{ count: string }[]>(`
      SELECT count(*)::text AS count
      FROM mps_weekly_plans w
      LEFT JOIN mps_weekly_process_plans packaging
        ON packaging.tenant_id=w.tenant_id AND packaging.weekly_plan_id=w.id AND packaging.process_code='packaging'
      WHERE w.tenant_id=$1
        AND w.manufacturing_method IN ('自制','自制+外协','外协','中心外购')
        AND (packaging.id IS NULL OR packaging.execution_enabled IS DISTINCT FROM true)`, [tenantId]);
    console.log(JSON.stringify({ refreshed: candidates.length, reportFactsAfter: afterReports, remaining: Number(remaining[0]?.count ?? 0) }));
  } finally {
    await context.close();
  }
}

async function reportFacts(dataSource: DataSource, weeklyPlanIds: string[]) {
  if (!weeklyPlanIds.length) return { count: 0, quantity: "0", dated: 0 };
  const [row] = await dataSource.query<{ count: string; quantity: string; dated: string }[]>(`
    SELECT count(*)::text AS count,COALESCE(sum(production_quantity),0)::text AS quantity,
      count(*) FILTER (WHERE production_date IS NOT NULL)::text AS dated
    FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=ANY($2::uuid[])`, [tenantId, weeklyPlanIds]);
  return { count: Number(row?.count ?? 0), quantity: row?.quantity ?? "0", dated: Number(row?.dated ?? 0) };
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
