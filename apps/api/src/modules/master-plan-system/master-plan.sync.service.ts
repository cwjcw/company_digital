import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { reverseScheduleForProcesses, shanghaiToday, shouldEnableProcess, STANDARD_PROCESSES, type ProcessScheduleDefinition } from "./master-plan.domain";
import { fieldsFor, MASTER_PLAN_RESOURCE_MAP, weeklyAdmissionSql, type MasterPlanResource } from "./master-plan.config";
import {
  MASTER_PLAN_ERP_ADMISSION, SNAPSHOT_BUSINESS_KEY_BINDING, erpAccountWhitelistSql, erpOrderAdmissibleStatusSql, erpOrderDateAdmissionSql,
  erpSourceIdentitySql, snapshotSourceSystemSql
} from "./master-plan.erp-admission";
import { hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { reconcileExistingMonthlyInbound } from "./master-plan.monthly-inbound";
import { reconcileAllocationPlans } from "./master-plan.allocation-projection";
import { reconcileMonthlyBasePlans } from "./master-plan.monthly-base";

type RunType = "SCHEDULED" | "MANUAL" | "EVENT" | "RECONCILIATION";
type ExecutionRollupScope = { weeklyPlanId: string; processCode: string };
/** 同步结果：`count` 继续写入 mps_sync_logs.sync_count，`metrics` 写入同表 metrics（KN-MPS-LIVE-002 可观测性）。 */
type SyncOutcome = { count: number; metrics?: Record<string, number> };
export const MASTER_PLAN_SYSTEM_USER_ID = "0199e000-0000-7000-8000-000000000001";

@Injectable()
export class MasterPlanSyncService {
  private readonly logger = new Logger(MasterPlanSyncService.name);
  private readonly running = new Set<string>();
  constructor(private readonly dataSource: DataSource) {}

  async manual(syncKey: string, actor: MasterPlanActor) {
    if (!hasMasterPlanPermission(actor, "mps-sync-configs", "update")) throw new ForbiddenException("当前权限组没有手工同步权限");
    return this.run(actor.tenantId, syncKey, "MANUAL", actor.userId, actor.username, `manual:${actor.requestId}:${syncKey}`);
  }

  async previewWeeklyProcessConfig(weeklyPlanId: string, actor: MasterPlanActor) {
    this.assertProcessConfigAccess(actor);
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const [weekly] = await manager.query(`SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid`, [actor.tenantId, weeklyPlanId]);
      if (!weekly) throw new NotFoundException("周计划不存在");
      this.assertWeeklyUpdateScope(weekly, actor);
      const current = await manager.query(`SELECT id,process_code,process_name,sequence,cycle_days,due_date,execution_enabled
        FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY sequence,process_code`, [actor.tenantId, weeklyPlanId]);
      const reports = await manager.query(`SELECT 1 FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid AND production_quantity>0 LIMIT 1`, [actor.tenantId, weeklyPlanId]);
      const locked = weekly.process_config_locked_at != null || reports.length > 0;
      const desired = await this.desiredProcessSnapshot(manager, weekly, actor.tenantId);
      const hashPayload = { weeklyPlanId, weeklyVersion: Number(weekly.version), current, desired };
      const previewHash = createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex");
      return {
        weeklyPlanId, expectedVersion: Number(weekly.version), previewHash, locked,
        source: (await manager.query(`SELECT 1 FROM mps_item_process_routes WHERE tenant_id=$1 AND item_code=$2 LIMIT 1`, [actor.tenantId, weekly.item_code])).length ? "品项独立路线" : "事业部默认工序",
        canConfirm: !locked,
        changes: this.processConfigDiff(current, desired),
        before: current.map((row: any) => ({ processCode: row.process_code, processName: row.process_name, sequence: Number(row.sequence), cycleDays: row.cycle_days == null ? null : Number(row.cycle_days), dueDate: this.dateOnly(row.due_date), executionEnabled: row.execution_enabled })),
        after: desired
      };
    });
  }

  async confirmWeeklyProcessConfig(weeklyPlanId: string, input: { expectedVersion: number; previewHash: string }, actor: MasterPlanActor) {
    this.assertProcessConfigAccess(actor);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || !/^[0-9a-f]{64}$/i.test(input.previewHash)) throw new BadRequestException("工序配置预览已失效，请重新预览");
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const [weekly] = await manager.query(`SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [actor.tenantId, weeklyPlanId]);
      if (!weekly) throw new NotFoundException("周计划不存在");
      this.assertWeeklyUpdateScope(weekly, actor);
      if (Number(weekly.version) !== input.expectedVersion) throw new ConflictException("周计划已变化，请重新预览工序配置");
      const current = await manager.query(`SELECT id,process_code,process_name,sequence,cycle_days,due_date,execution_enabled
        FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY sequence,process_code FOR UPDATE`, [actor.tenantId, weeklyPlanId]);
      const reports = await manager.query(`SELECT 1 FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid AND production_quantity>0 LIMIT 1`, [actor.tenantId, weeklyPlanId]);
      if (weekly.process_config_locked_at != null || reports.length > 0) throw new ConflictException("该周计划已有有效工序报工，工序集合、顺序和标准周期已锁定");
      const desired = await this.desiredProcessSnapshot(manager, weekly, actor.tenantId);
      const currentHash = createHash("sha256").update(JSON.stringify({ weeklyPlanId, weeklyVersion: Number(weekly.version), current, desired })).digest("hex");
      if (currentHash !== input.previewHash) throw new ConflictException("工序配置或差异已变化，请重新预览后确认");

      await manager.query("SELECT set_config('app.mps_process_config_write_mode','CONFIRM',true)");
      const desiredCodes = desired.map((row: any) => row.processCode);
      const removed = await manager.query(`DELETE FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid AND NOT (process_code=ANY($3::text[])) RETURNING *`, [actor.tenantId, weeklyPlanId, desiredCodes]);
      for (const process of desired) {
        await manager.query(`INSERT INTO mps_weekly_process_plans(tenant_id,weekly_plan_id,process_code,process_name,sequence,cycle_days,due_date,status,exception_text,execution_enabled,created_by,updated_by)
          VALUES($1,$2::uuid,$3,$4,$5,$6,$7,CASE WHEN $7::date IS NOT NULL AND $7::date<$8::date THEN '延期' ELSE '未开始' END,$9,true,$10::uuid,$11)
          ON CONFLICT(tenant_id,weekly_plan_id,process_code) DO UPDATE SET process_name=excluded.process_name,sequence=excluded.sequence,cycle_days=excluded.cycle_days,due_date=excluded.due_date,
            status=CASE WHEN excluded.due_date IS NOT NULL AND $8::date>excluded.due_date THEN '延期' ELSE '未开始' END,
            exception_text=excluded.exception_text,execution_enabled=true,updated_at=now(),updated_by=$11,version=mps_weekly_process_plans.version+1
          WHERE (mps_weekly_process_plans.process_name,mps_weekly_process_plans.sequence,mps_weekly_process_plans.cycle_days,mps_weekly_process_plans.due_date,mps_weekly_process_plans.execution_enabled)
            IS DISTINCT FROM (excluded.process_name,excluded.sequence,excluded.cycle_days,excluded.due_date,true)`,
        [actor.tenantId, weeklyPlanId, process.processCode, process.processName, process.sequence, process.cycleDays, process.dueDate, shanghaiToday(), process.cycleDays == null ? "未维护工序周期" : null, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID, actor.userId ?? actor.username]);
      }
      await manager.query("SELECT set_config('app.mps_process_config_write_mode','',true)");
      const updatedWeekly = await manager.query(`UPDATE mps_weekly_plans SET updated_at=now(),updated_by=$3,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid RETURNING *`, [actor.tenantId, weeklyPlanId, actor.userId ?? actor.username]);
      const after = await manager.query(`SELECT id,process_code,process_name,sequence,cycle_days,due_date,execution_enabled FROM mps_weekly_process_plans
        WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY sequence,process_code`, [actor.tenantId, weeklyPlanId]);
      const afterMap = new Map(after.map((row: any) => [String(row.process_code), row]));
      const beforeMap = new Map(current.map((row: any) => [String(row.process_code), row]));
      for (const [code, before] of beforeMap) {
        const next = afterMap.get(code);
        if (next) {
          if (JSON.stringify(before) !== JSON.stringify(next)) await this.auditProcessConfig(manager, actor, (before as any).id ?? null, "mps-weekly-process-plans.updated_by_config", before, next);
        } else await this.auditProcessConfig(manager, actor, current.find((row: any) => row.process_code === code)?.id ?? null, "mps-weekly-process-plans.removed_by_config", before, null);
      }
      for (const [code, next] of afterMap) if (!beforeMap.has(code)) await this.auditProcessConfig(manager, actor, (next as any).id ?? null, "mps-weekly-process-plans.created_by_config", null, next);
      const response = { weeklyPlanId, version: Number(updatedWeekly[0].version), removed: Array.isArray(removed[0]) ? removed[0].length : removed.length, processCount: after.length };
      await this.auditProcessConfig(manager, actor, weeklyPlanId, "mps-weekly-plans.process_config_confirmed", { processConfigLockedAt: null, processes: current }, response);
      return response;
    });
  }

  async previewWeeklyProcessConfigBatch(weeklyPlanIds: string[], actor: MasterPlanActor) {
    this.assertProcessConfigAccess(actor);
    if (!Array.isArray(weeklyPlanIds)) throw new BadRequestException("批量预览需提交周计划ID列表");
    const ids = [...new Set(weeklyPlanIds.map(String))];
    if (!ids.length || ids.length > 1000 || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new BadRequestException("批量预览需选择 1 至 1000 条有效周计划");
    const plans: any[] = [];
    for (let offset = 0; offset < ids.length; offset += 8) plans.push(...await Promise.all(ids.slice(offset, offset + 8).map(async (weeklyPlanId) => {
      try { return await this.previewWeeklyProcessConfig(weeklyPlanId, actor); }
      catch (error) { return { weeklyPlanId, canConfirm: false, locked: false, skipReason: (error as Error).message, changes: { added: [], removed: [], changed: [] } }; }
    })));
    const updatePlans = plans.filter((plan: any) => plan.canConfirm && (plan.changes.added.length + plan.changes.removed.length + plan.changes.changed.length > 0));
    const skipPlans = plans.filter((plan: any) => !plan.canConfirm || !(plan.changes.added.length + plan.changes.removed.length + plan.changes.changed.length));
    const diffCounts = new Map<string, { processName: string; added: number; removed: number; changed: number }>();
    for (const plan of updatePlans as any[]) for (const kind of ["added", "removed", "changed"] as const) for (const diff of plan.changes[kind]) {
      const process = kind === "changed" ? diff.after : diff;
      const item = diffCounts.get(process.processCode) ?? { processName: process.processName, added: 0, removed: 0, changed: 0 };
      item[kind] += 1; diffCounts.set(process.processCode, item);
    }
    return { total: plans.length, updateCount: updatePlans.length, skipCount: skipPlans.length,
      skipReasons: { locked: skipPlans.filter((plan: any) => plan.locked).length, noDifference: skipPlans.filter((plan: any) => plan.canConfirm && !plan.skipReason && !plan.changes.added.length && !plan.changes.removed.length && !plan.changes.changed.length).length, inaccessibleOrChanged: skipPlans.filter((plan: any) => plan.skipReason).length },
      mainDifferences: [...diffCounts.entries()].map(([processCode, counts]) => ({ processCode, ...counts })), plans };
  }

  async confirmWeeklyProcessConfigBatch(plans: Array<{ weeklyPlanId: string; expectedVersion: number; previewHash: string }>, actor: MasterPlanActor) {
    this.assertProcessConfigAccess(actor);
    if (!Array.isArray(plans) || plans.length < 1 || plans.length > 1000) throw new BadRequestException("批量确认需包含 1 至 1000 条预览计划");
    let succeeded = 0; const failed: Array<{ weeklyPlanId: string; reason: string }> = [];
    for (let offset = 0; offset < plans.length; offset += 8) {
      const results = await Promise.all(plans.slice(offset, offset + 8).map(async (plan) => {
        try { await this.confirmWeeklyProcessConfig(plan.weeklyPlanId, plan, actor); return null; }
        catch (error) { return { weeklyPlanId: plan.weeklyPlanId, reason: (error as Error).message }; }
      }));
      for (const result of results) if (result) failed.push(result); else succeeded += 1;
    }
    return { succeeded, failed: failed.length, items: failed };
  }

  private async desiredProcessSnapshot(manager: EntityManager, weekly: any, tenantId: string) {
    const definitions = await this.processDefinitions(manager, weekly, tenantId);
    const reviewDueDate = this.dateOnly(weekly.latest_review_due_date);
    const schedule = reviewDueDate ? reverseScheduleForProcesses(reviewDueDate, definitions)
      : [...definitions].sort((a,b) => a.sequence-b.sequence || a.code.localeCompare(b.code)).map((process) => ({ ...process, dueDate: null }));
    return schedule.map((process) => ({ processCode: process.code, processName: process.name, sequence: process.sequence, cycleDays: process.cycleDays, dueDate: process.dueDate, executionEnabled: true }));
  }

  private processConfigDiff(current: any[], desired: any[]) {
    const currentMap = new Map(current.map((row) => [String(row.process_code), row]));
    const desiredMap = new Map(desired.map((row) => [String(row.processCode), row]));
    const added = desired.filter((row) => !currentMap.has(row.processCode));
    const present = (row: any) => ({ processCode: row.process_code, processName: row.process_name, sequence: Number(row.sequence), cycleDays: row.cycle_days == null ? null : Number(row.cycle_days), dueDate: this.dateOnly(row.due_date), executionEnabled: row.execution_enabled });
    const removed = current.filter((row) => !desiredMap.has(String(row.process_code))).map(present);
    const changed = desired.filter((row) => {
      const before = currentMap.get(row.processCode);
      return before && (String(before.process_name) !== row.processName || Number(before.sequence) !== row.sequence
        || (before.cycle_days == null ? null : Number(before.cycle_days)) !== row.cycleDays
        || this.dateOnly(before.due_date) !== row.dueDate || before.execution_enabled !== row.executionEnabled);
    }).map((after) => ({ before: present(currentMap.get(after.processCode)), after }));
    return { added, removed, changed };
  }

  private assertProcessConfigAccess(actor: MasterPlanActor) {
    if (!hasMasterPlanPermission(actor, "mps-weekly-plans", "update")) throw new ForbiddenException("当前权限组没有更新周计划工序配置的权限");
    for (const resource of ["mps-division-process-configs", "mps-item-process-routes"]) {
      if (!hasMasterPlanPermission(actor, resource, "read")) throw new ForbiddenException("当前权限组没有读取工艺配置的权限");
    }
  }

  private assertWeeklyUpdateScope(weekly: any, actor: MasterPlanActor) {
    if (actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning")) return;
    const scopes = actor.tableDataScopes.filter((scope) => scope.resource === "mps-weekly-plans" && (!scope.actions || scope.actions.includes("update")));
    if (!scopes.length) throw new ForbiddenException("当前数据范围不允许更新该周计划的工序配置");
    if (scopes.some((scope) => scope.scope === "ALL")) return;
    const allowed = scopes.some((scope) => {
      if (scope.scope === "OWN") return String(weekly.created_by ?? "") === String(actor.userId ?? "");
      if (scope.scope !== "CUSTOM") return false;
      const matches = (scope.rules ?? []).map((rule) => {
        const value = rule.fieldKey === "divisionId" ? weekly.division_id : rule.fieldKey === "orderNumber" ? weekly.order_number : rule.fieldKey === "itemCode" ? weekly.item_code : null;
        const expected = rule.value === "CURRENT_USER" ? actor.userId : rule.value;
        if (rule.operator === "EQ") return String(value ?? "") === String(expected ?? "");
        if (rule.operator === "IN") return Array.isArray(expected) && expected.map(String).includes(String(value ?? ""));
        return false;
      });
      return matches.length > 0 && (scope.match === "ANY" ? matches.some(Boolean) : matches.every(Boolean));
    });
    if (!allowed) throw new ForbiddenException("当前数据范围不允许更新该周计划的工序配置");
  }

  private auditProcessConfig(manager: EntityManager, actor: MasterPlanActor, recordId: string | null, action: string, before: unknown, after: unknown) {
    const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
    return manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by,tenant_id)
      VALUES($1::uuid,$2,'mps-weekly-process-plans',$3::uuid,$4,$5::jsonb,$6::jsonb,$7,$8,$1::uuid,$1::uuid,$9)`,
    [actorId, actor.username, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId, actor.source === "system" ? "api" : actor.source, actor.tenantId]);
  }

  @Interval(60_000)
  async runDue() {
    const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
    try {
      const configs = await this.dataSource.query(`SELECT sync_key FROM mps_sync_configs WHERE tenant_id=$1 AND enabled=true AND status<>'RUNNING' AND (last_started_at IS NULL OR last_started_at + interval_minutes * interval '1 minute' <= now()) ORDER BY sync_key`, [tenantId]);
      for (const config of configs) await this.run(tenantId, config.sync_key, "SCHEDULED", MASTER_PLAN_SYSTEM_USER_ID, "KDOS系统任务", `scheduled:${config.sync_key}:${new Date().toISOString().slice(0, 16)}`);
      await this.processOutbox();
    } catch (error) { this.logger.error(`主计划定时同步检查失败: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async processOutbox() {
    const events = await this.dataSource.transaction(async (manager) => {
      const result = await manager.query(`UPDATE mps_reconciliation_outbox SET status='RUNNING',attempts=attempts+1,updated_at=now(),version=version+1
      WHERE id IN (
        SELECT id FROM mps_reconciliation_outbox
        WHERE status IN ('PENDING','FAILED') AND next_attempt_at<=now()
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20
      ) RETURNING *`);
      return Array.isArray(result[0]) ? result[0] : result;
    });
    const groups = new Map<string, typeof events>();
    for (const event of events) {
      const scope = this.executionScope(event.sync_key, event.scope_json);
      const key = `${event.tenant_id}:${event.sync_key}:${scope ? `${scope.weeklyPlanId}:${scope.processCode}` : "all"}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    for (const group of groups.values()) {
      const event = group[0]!;
      const eventIds = group.map((item: { id: string }) => item.id);
      const scope = this.executionScope(event.sync_key, event.scope_json);
      try {
        await this.run(event.tenant_id, event.sync_key, "EVENT", event.actor_id, event.actor_name, event.idempotency_key, scope);
        await this.dataSource.query(`UPDATE mps_reconciliation_outbox SET status='SUCCESS',completed_at=now(),last_error=NULL,updated_at=now(),updated_by=$2::uuid,version=version+1 WHERE id=ANY($1::uuid[])`, [eventIds, event.actor_id]);
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
        /* 同一同步键正在运行时只是暂时让位，不是业务失败：保持 PENDING 稍后重试，避免把并发让位显示成“生成失败”。 */
        if (error instanceof ConflictException && message === "该同步任务正在运行") {
          await this.dataSource.query(`UPDATE mps_reconciliation_outbox SET status='PENDING',last_error=NULL,next_attempt_at=now() + interval '5 seconds',updated_at=now(),updated_by=$2::uuid,version=version+1 WHERE id=ANY($1::uuid[])`, [eventIds, event.actor_id]);
          continue;
        }
        await this.dataSource.query(`UPDATE mps_reconciliation_outbox SET status='FAILED',last_error=$2,next_attempt_at=now() + least(attempts,30) * interval '1 minute',updated_at=now(),updated_by=$3::uuid,version=version+1 WHERE id=ANY($1::uuid[])`, [eventIds, message, event.actor_id]);
      }
    }
    return events.length;
  }

  async run(tenantId: string, syncKey: string, runType: RunType, userId: string | null, username: string, idempotencyKey = `${runType.toLowerCase()}:${syncKey}:${randomUUID()}`, executionScope: ExecutionRollupScope | null = null) {
    const runningKey = `${tenantId}:${syncKey}`;
    if (this.running.has(runningKey)) throw new ConflictException("该同步任务正在运行");
    this.running.add(runningKey);
    try {
      const [config] = await this.dataSource.query(`SELECT id,enabled FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey]);
      if (!config) throw new ConflictException("同步配置不存在");
      if (!config.enabled && runType !== "MANUAL") return { syncKey, skipped: true, count: 0 };
      const previous = await this.dataSource.query(`SELECT status,sync_count,error_message FROM mps_sync_logs WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, idempotencyKey]);
      if (previous[0]) return { syncKey, repeated: true, count: Number(previous[0].sync_count), status: previous[0].status };
      await this.dataSource.query(`INSERT INTO mps_sync_logs(tenant_id,sync_config_id,sync_key,run_type,status,started_at,idempotency_key,created_by,updated_by) VALUES($1,$2,$3,$4,'RUNNING',now(),$5,$6::uuid,$7)`, [tenantId, config.id, syncKey, runType, idempotencyKey, userId, userId ?? username]);
      await this.dataSource.query(`UPDATE mps_sync_configs SET status='RUNNING',last_started_at=now(),error_message=NULL,updated_at=now(),updated_by=$3,version=version+1 WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey, userId ?? username]);
      try {
        const outcome = await this.execute(syncKey, tenantId, userId, userId ?? username, executionScope, username);
        const count = outcome.count;
        await this.dataSource.query(`UPDATE mps_sync_logs SET status='SUCCESS',completed_at=now(),sync_count=$3,metrics=$5::jsonb,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND idempotency_key=$2`,
          [tenantId, idempotencyKey, count, userId ?? username, outcome.metrics ? JSON.stringify(outcome.metrics) : null]);
        await this.dataSource.query(`UPDATE mps_sync_configs SET status='SUCCESS',last_success_at=now(),last_sync_count=$3,error_message=NULL,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey, count, userId ?? username]);
        return { syncKey, repeated: false, count, metrics: outcome.metrics ?? null, status: "SUCCESS" };
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
        await this.dataSource.query(`UPDATE mps_sync_logs SET status='FAILED',completed_at=now(),error_message=$3,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, idempotencyKey, message, userId ?? username]);
        await this.dataSource.query(`UPDATE mps_sync_configs SET status='FAILED',last_failure_at=now(),error_message=$3,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey, message, userId ?? username]);
        await this.upsertException(tenantId, `sync:${syncKey}`, "mps-sync-configs", null, syncKey, "SYNC_FAILURE", "ERROR", `同步失败：${message}`, userId, userId ?? username);
        throw error;
      }
    } finally { this.running.delete(runningKey); }
  }

  private async execute(syncKey: string, tenantId: string, userId: string | null, updatedBy: string, executionScope: ExecutionRollupScope | null = null, actorName = updatedBy): Promise<SyncOutcome> {
    const jobs: Record<string, () => Promise<number | SyncOutcome>> = {
      "erp-orders": () => this.projectOrders(tenantId, userId, updatedBy),
      "plan-projections": () => this.projectPlans(tenantId, userId, actorName),
      "shipping-to-base": () => this.shippingToBase(tenantId, userId, actorName),
      "base-to-weekly": () => this.baseToWeekly(tenantId, userId, updatedBy),
      "inbound-allocation": () => this.allocateInbound(tenantId, updatedBy),
      "execution-rollup": () => this.executionRollup(tenantId, updatedBy, executionScope)
    };
    const job = jobs[syncKey]; if (!job) throw new ConflictException("未知同步任务");
    const result = await job();
    return typeof result === "number" ? { count: result } : result;
  }

  /**
   * KN-MPS-LIVE-002：主计划 ERP 订单准入（唯一入口）。
   *
   * 与 LIVE-001 审计到的旧行为（`SELECT … FROM sales_orders` 全量投影）不同，本实现强制：
   * 1) 账套白名单：只允许科加 `UFTData418971_000003`，其他账套一律 `blocked_by_source_database`；
   * 2) 业务准入水位：`order_date >= 2026-09-17` **只约束新来源身份**，不是 created_at / updated_at；
   * 3) 状态门槛：已关闭 / 已完成 / 已作废不得作为新订单准入；
   * 4) cutover watermark（`mps_sync_configs.watermark_at`，可空）：只约束新来源身份；
   * 5) 来源身份判定：自身来源身份或别名已存在 → UPDATE 原记录；不存在 → 走新单准入；
   * 6) 快照业务键抑制：新来源身份若与历史快照 `order_number+item_code` 相同 → 绝不 INSERT 第二条，
   *    改为写入 `mps_order_line_source_aliases` 绑定，此后 ERP 修改直接更新这条原记录；
   * 7) 关闭语义：只更新来源状态字段（`source_active`/`order_status`/…），绝不删除已产生的计划链数据。
   *
   * 增量变化仍然完全依赖 ERP 最后更新时间（`sales_orders.updated_at` ← `LastModifiedDate`）与稳定来源主键。
   */
  private async projectOrders(tenantId: string, userId: string | null, updatedBy: string): Promise<SyncOutcome> {
    const ss = (alias: string) => erpSourceIdentitySql(alias).sourceSystem;
    const sd = (alias: string) => erpSourceIdentitySql(alias).sourceDatabase;
    const sk = (alias: string) => erpSourceIdentitySql(alias).sourceKey;
    const [config] = await this.dataSource.query(`SELECT watermark_at FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key='erp-orders'`, [tenantId]);
    const watermark = config?.watermark_at ?? null;
    /** ERP-owned 字段的唯一投影表达式：来源身份 + 业务字段 + 状态 + 最后更新时间。 */
    const payload = (alias: string) => `${ss(alias)} AS source_system,${sd(alias)} AS source_database,${alias}.source_database AS source_account_name,
      ${sk(alias)} AS source_key,${alias}.employee_name AS salesperson_name,${alias}.customer_code AS customer_code,
      ${alias}.order_number AS order_number,${alias}.document_name AS order_type,coalesce(${alias}.order_date,${alias}.document_date) AS order_date,
      ${alias}.planned_delivery_date AS customer_due_date,${alias}.review_due_date AS preproduction_review_date,
      ${alias}.planned_delivery_date AS expected_shipping_date,${alias}.item_number AS item_code,${alias}.item_name AS item_name,
      ${alias}.unit_name AS unit,greatest(coalesce(${alias}.business_quantity,${alias}.quantity,0),0) AS order_quantity,
      coalesce(${alias}.rmb_price,${alias}.price) AS tax_included_unit_price,${alias}.rmb_tax_included_amount AS tax_included_amount,
      ${alias}.close_status AS order_status,(${erpOrderAdmissibleStatusSql(alias)}) AS source_active,${alias}.updated_at AS source_updated_at`;
    const ownedColumns = ["salesperson_name","customer_code","order_type","order_date","customer_due_date","preproduction_review_date",
      "expected_shipping_date","item_name","unit","order_quantity","tax_included_unit_price","tax_included_amount","order_status","source_active","source_updated_at"];
    const distinctGuard = (target: string, source: string) =>
      `(${ownedColumns.map((column) => `${target}.${column}`).join(",")}) IS DISTINCT FROM (${ownedColumns.map((column) => `${source}.${column}`).join(",")})`;

    return this.dataSource.transaction(async (manager) => {
      /* 1) 来源身份绑定：ERP 新来源身份与历史快照业务键相同 → 只建立别名，绝不新增第二条业务记录。 */
      const bound = await manager.query(`
        INSERT INTO mps_order_line_source_aliases(tenant_id,mps_order_line_id,source_system,source_database,source_key,bound_at,bound_reason,created_by,updated_by)
        SELECT $1,snap.id,${ss("o")},${sd("o")},${sk("o")},now(),$4,$2::uuid,$3
        FROM sales_orders o
        JOIN LATERAL (
          SELECT t.id FROM mps_erp_order_lines t
          WHERE t.tenant_id=$1 AND t.order_number=o.order_number AND t.item_code=o.item_number
            AND t.source_system IN (${snapshotSourceSystemSql()})
          ORDER BY t.created_at,t.id LIMIT 1
        ) snap ON true
        WHERE ${erpAccountWhitelistSql("o")}
          AND btrim(coalesce(o.order_number,''))<>'' AND btrim(coalesce(o.item_number,''))<>''
          AND NOT EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=${ss("o")} AND t.source_database=${sd("o")} AND t.source_key=${sk("o")})
          AND NOT EXISTS (SELECT 1 FROM mps_order_line_source_aliases a WHERE a.tenant_id=$1 AND a.source_system=${ss("o")} AND a.source_database=${sd("o")} AND a.source_key=${sk("o")})
        ON CONFLICT(tenant_id,source_system,source_database,source_key) DO NOTHING
        RETURNING id`, [tenantId, userId, updatedBy, SNAPSHOT_BUSINESS_KEY_BINDING]);

      /*
       * 2) 通过别名更新原记录：只回写「绑定之后确实发生内容变化」的 ERP 数据。
       *
       * KN-MPS-LIVE-003-01（用户确认方案一）：首次 alias 绑定 ≠ ERP 修改。
       * 判定变化的唯一依据是 canonical ERP 来源的内容更新时间（`sales_orders.updated_at`，
       * 它在 staging 内容哈希变化时才推进），而不是目标表自身的 `mps_erp_order_lines.updated_at`：
       *   canonical updated_at <= alias.bound_at → 不 UPDATE（保护 1169 初始化基线）
       *   canonical updated_at >  alias.bound_at → UPDATE 原记录（ERP-owned 字段以最新 ERP 为准）
       * 身份字段（订单号/品号）始终不在此语句中更新，以保护既有计划链业务键。
       */
      const aliasUpdated = await manager.query(`
        UPDATE mps_erp_order_lines t SET
          salesperson_name=p.salesperson_name,customer_code=p.customer_code,order_type=p.order_type,order_date=p.order_date,
          customer_due_date=p.customer_due_date,preproduction_review_date=p.preproduction_review_date,
          expected_shipping_date=p.expected_shipping_date,item_name=p.item_name,unit=p.unit,order_quantity=p.order_quantity,
          tax_included_unit_price=p.tax_included_unit_price,tax_included_amount=p.tax_included_amount,order_status=p.order_status,
          source_active=p.source_active,source_updated_at=p.source_updated_at,updated_at=now(),updated_by=$2,version=t.version+1
        FROM (
          SELECT DISTINCT ON (a.mps_order_line_id) a.mps_order_line_id,a.bound_at,${payload("o")}
          FROM sales_orders o
          JOIN mps_order_line_source_aliases a ON a.tenant_id=$1 AND a.source_system=${ss("o")} AND a.source_database=${sd("o")} AND a.source_key=${sk("o")}
          WHERE ${erpAccountWhitelistSql("o")}
          /* 同一初始化行可能绑定多条 ERP 明细：优先取「绑定之后确实变化过」的那条，再取最新修改时间。 */
          ORDER BY a.mps_order_line_id,(o.updated_at > a.bound_at) DESC,o.updated_at DESC NULLS LAST,o.id DESC
        ) p
        WHERE t.tenant_id=$1 AND t.id=p.mps_order_line_id AND p.source_system IS NOT NULL
          AND p.source_updated_at IS NOT NULL AND p.source_updated_at > p.bound_at
          AND ${distinctGuard("t", "p")}
        RETURNING t.id`, [tenantId, updatedBy]);

      /* 3) 自有来源身份的 upsert：已准入记录的修改照常更新；新来源身份必须先通过账套/水位/状态门槛。 */
      const written = await manager.query(`
        INSERT INTO mps_erp_order_lines(tenant_id,source_system,source_database,source_account_name,source_key,salesperson_name,customer_code,
          order_number,order_type,order_date,customer_due_date,preproduction_review_date,expected_shipping_date,item_code,item_name,unit,
          order_quantity,tax_included_unit_price,tax_included_amount,order_status,source_active,source_updated_at,created_by,updated_by)
        SELECT $1,p.*,$2::uuid,$3 FROM (
          SELECT ${payload("o")} FROM sales_orders o
          WHERE ${erpAccountWhitelistSql("o")}
            AND btrim(coalesce(o.order_number,''))<>'' AND btrim(coalesce(o.item_number,''))<>''
            AND NOT EXISTS (SELECT 1 FROM mps_order_line_source_aliases a WHERE a.tenant_id=$1 AND a.source_system=${ss("o")} AND a.source_database=${sd("o")} AND a.source_key=${sk("o")})
            AND (
              EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=${ss("o")} AND t.source_database=${sd("o")} AND t.source_key=${sk("o")})
              OR (${erpOrderDateAdmissionSql("o")} AND ${erpOrderAdmissibleStatusSql("o")}${watermark ? " AND o.updated_at > $4::timestamptz" : ""})
            )
        ) p
        ON CONFLICT(tenant_id,source_system,source_database,source_key) DO UPDATE SET
          salesperson_name=excluded.salesperson_name,customer_code=excluded.customer_code,order_type=excluded.order_type,
          order_date=excluded.order_date,customer_due_date=excluded.customer_due_date,preproduction_review_date=excluded.preproduction_review_date,
          expected_shipping_date=excluded.expected_shipping_date,item_name=excluded.item_name,unit=excluded.unit,
          order_quantity=excluded.order_quantity,tax_included_unit_price=excluded.tax_included_unit_price,tax_included_amount=excluded.tax_included_amount,
          order_status=excluded.order_status,source_active=excluded.source_active,source_updated_at=excluded.source_updated_at,
          updated_at=now(),updated_by=$3,version=mps_erp_order_lines.version+1
        WHERE ${distinctGuard("mps_erp_order_lines", "excluded")}
        RETURNING id,(xmax=0) AS inserted`, watermark ? [tenantId, userId, updatedBy, watermark] : [tenantId, userId, updatedBy]);

      /* 4) 计数：与准入谓词同源，供同步日志/验收报告使用（不做第二套判定逻辑）。 */
      const [counts] = await manager.query(`
        WITH src AS (
          SELECT ${ss("o")} AS source_system,${sd("o")} AS source_database,${sk("o")} AS source_key,o.order_number,o.item_number,o.order_date,o.close_status,o.updated_at
          FROM sales_orders o WHERE btrim(coalesce(o.order_number,''))<>'' AND btrim(coalesce(o.item_number,''))<>''
        ), classified AS (
          SELECT s.*,${erpAccountWhitelistSql("s")} AS account_allowed,(${erpOrderDateAdmissionSql("s")}) AS order_date_allowed,
            (${erpOrderAdmissibleStatusSql("s")}) AS status_allowed,${watermark ? "s.updated_at > $2::timestamptz" : "true"} AS watermark_allowed,
            EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=s.source_system AND t.source_database=s.source_database AND t.source_key=s.source_key) AS identity_known,
            EXISTS (SELECT 1 FROM mps_order_line_source_aliases a WHERE a.tenant_id=$1 AND a.source_system=s.source_system AND a.source_database=s.source_database AND a.source_key=s.source_key) AS alias_known
          FROM src s
        )
        SELECT count(*)::integer AS scanned,
          count(*) FILTER (WHERE account_allowed AND (identity_known OR alias_known OR (order_date_allowed AND status_allowed AND watermark_allowed)))::integer AS eligible,
          count(*) FILTER (WHERE NOT account_allowed)::integer AS blocked_by_source_database,
          count(*) FILTER (WHERE account_allowed AND NOT identity_known AND NOT alias_known AND NOT order_date_allowed)::integer AS blocked_by_order_date,
          count(*) FILTER (WHERE account_allowed AND NOT identity_known AND NOT alias_known AND order_date_allowed AND NOT status_allowed)::integer AS blocked_by_status,
          count(*) FILTER (WHERE account_allowed AND NOT identity_known AND NOT alias_known AND order_date_allowed AND status_allowed AND NOT watermark_allowed)::integer AS blocked_by_watermark
        FROM classified`, watermark ? [tenantId, watermark] : [tenantId]);

      /*
       * 计数必须用 changedCount() 归一化：TypeORM 对 UPDATE/DELETE 返回 [rows, affectedCount]，
       * 对 INSERT ... RETURNING 直接返回 rows；直接取 .length 会把「0 行更新」误报成 2（KN-MPS-LIVE-003-01 修复的计数缺陷）。
       */
      const inserted = written.filter((row: { inserted: boolean }) => row.inserted).length;
      const upserted = this.changedCount(written) - inserted;
      const updated = this.changedCount(aliasUpdated) + upserted;
      const eligible = Number(counts?.eligible ?? 0);
      const metrics = {
        scanned: Number(counts?.scanned ?? 0), eligible, inserted, updated,
        unchanged: Math.max(eligible - inserted - updated, 0),
        duplicate_suppressed: this.changedCount(bound), alias_bound: this.changedCount(bound),
        blocked_by_source_database: Number(counts?.blocked_by_source_database ?? 0),
        blocked_by_order_date: Number(counts?.blocked_by_order_date ?? 0),
        blocked_by_status: Number(counts?.blocked_by_status ?? 0),
        blocked_by_watermark: Number(counts?.blocked_by_watermark ?? 0)
      };
      return { count: inserted + updated, metrics };
    });
  }

  /**
   * KN-MPS-LIVE-002：集团/月度计划对账。
   *
   * 三处口径修正（均由 LIVE-001 审计暴露）：
   * 1) 订单分配的事业部**必须由客户→事业部映射派生**，不再依赖 `division_id` 列默认值（否则未映射订单会被静默归入事业四部）；
   * 2) 缺少客户代码或客户事业部映射的订单**禁止继续投影到月计划/集团主计划**，但保留订单分配并产生可追踪数据异常；
   * 3) 累计入库/欠数/完成率只统计科加账套 `UFTData418971_000003`，不再跨账套加总。
   */
  private projectPlans(tenantId: string, userId: string | null, updatedBy: string): Promise<SyncOutcome> {
    return this.dataSource.transaction(manager => reconcileAllocationPlans(manager, tenantId,
      userId ?? MASTER_PLAN_SYSTEM_USER_ID, updatedBy));
  }

  /** Retain the existing task key and entrypoint; its sole input is now monthly plans. */
  private shippingToBase(tenantId: string, userId: string | null, actorName: string): Promise<SyncOutcome> {
    return this.dataSource.transaction(manager => reconcileMonthlyBasePlans(manager, tenantId,
      userId ?? MASTER_PLAN_SYSTEM_USER_ID, actorName));
  }

  private baseToWeekly(tenantId: string, userId: string | null, updatedBy: string) {
    const basePlan = MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!;
    const admission = weeklyAdmissionSql(basePlan, "base");
    const dictionaryColumn = (field: string, column: string) =>
      this.dictionaryCopySql(basePlan, field, column, `base.${column}`, `weekly.${column}`);
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const rows = await manager.query(`
        INSERT INTO mps_weekly_plans(tenant_id,base_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,latest_review_due_date,model_age,image_refs,product_attribute,surface_nature,planned_quantity,pending_quantity,manufacturing_method,order_exception_info,inspection_required,inspection_quantity,remark,order_week_count,created_by,updated_by)
        SELECT base.tenant_id,base.id,base.division_id,base.customer_code,base.order_number,base.item_code,base.item_name,base.delivery_number,base.order_date,base.latest_customer_due_date,base.latest_review_due_date,
          ${dictionaryColumn("modelAge", "model_age")},base.image_refs,
          ${dictionaryColumn("productAttribute", "product_attribute")},
          ${dictionaryColumn("surfaceNature", "surface_nature")},
          base.planned_quantity,base.planned_quantity,
          ${dictionaryColumn("manufacturingMethod", "manufacturing_method")},
          NULL,false,NULL,NULL,CASE WHEN base.order_date IS NULL THEN NULL ELSE greatest(0,floor((CURRENT_DATE-base.order_date)/7.0))::integer END,$2::uuid,$3
        FROM mps_base_plans base
        LEFT JOIN mps_weekly_plans weekly ON weekly.tenant_id=base.tenant_id AND weekly.base_plan_id=base.id
        WHERE base.tenant_id=$1 AND ${admission}
        ON CONFLICT ON CONSTRAINT uq_mps_weekly_base DO UPDATE SET division_id=excluded.division_id,customer_code=excluded.customer_code,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,order_date=excluded.order_date,latest_customer_due_date=excluded.latest_customer_due_date,latest_review_due_date=excluded.latest_review_due_date,model_age=excluded.model_age,image_refs=excluded.image_refs,product_attribute=excluded.product_attribute,surface_nature=excluded.surface_nature,planned_quantity=excluded.planned_quantity,manufacturing_method=excluded.manufacturing_method,updated_at=now(),updated_by=$3,version=mps_weekly_plans.version+1
        WHERE (mps_weekly_plans.division_id,mps_weekly_plans.customer_code,mps_weekly_plans.order_number,mps_weekly_plans.item_code,mps_weekly_plans.item_name,mps_weekly_plans.delivery_number,mps_weekly_plans.order_date,mps_weekly_plans.latest_customer_due_date,mps_weekly_plans.latest_review_due_date,mps_weekly_plans.model_age,mps_weekly_plans.image_refs,mps_weekly_plans.product_attribute,mps_weekly_plans.surface_nature,mps_weekly_plans.planned_quantity,mps_weekly_plans.manufacturing_method)
          IS DISTINCT FROM (excluded.division_id,excluded.customer_code,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number,excluded.order_date,excluded.latest_customer_due_date,excluded.latest_review_due_date,excluded.model_age,excluded.image_refs,excluded.product_attribute,excluded.surface_nature,excluded.planned_quantity,excluded.manufacturing_method)
        RETURNING id`, [tenantId, userId, updatedBy]);
      /* 工艺只在新周计划创建时取一次快照。已存在周计划（包括未报工）不得被定时/手工同步重写。 */
      const weeklyRows = await manager.query(`SELECT w.*,c.technical_days,(w.created_at=transaction_timestamp()) AS created_in_this_sync
        FROM mps_weekly_plans w JOIN mps_base_plans base ON base.tenant_id=w.tenant_id AND base.id=w.base_plan_id
        LEFT JOIN mps_process_cycles c ON c.tenant_id=w.tenant_id AND c.item_code=w.item_code
        WHERE w.tenant_id=$1 AND ${admission}`, [tenantId]);
      for (const weekly of weeklyRows) await this.ensureExecutionRows(manager, weekly, tenantId, userId, updatedBy, weekly.created_in_this_sync === true);
      return this.changedCount(rows);
    });
  }

  /**
   * KN-MPS-UI-WEEKLY-EXEC-001：唯一的单条周计划执行刷新入口。
   * 基础计划全量投影、周计划关键字段保存和人工兜底都必须进入同一规则，
   * 以稳定 weekly_plan_id + tenant 定位，绝不按订单/品项等可变业务键推算。
   */
  async refreshWeeklyExecution(manager: EntityManager, weeklyPlanId: string, tenantId: string, userId: string | null, updatedBy: string) {
    const [weekly] = await manager.query(`SELECT w.*,c.technical_days FROM mps_weekly_plans w LEFT JOIN mps_process_cycles c ON c.tenant_id=w.tenant_id AND c.item_code=w.item_code WHERE w.tenant_id=$1 AND w.id=$2::uuid`, [tenantId, weeklyPlanId]);
    if (!weekly) return false;
    await this.ensureExecutionRows(manager, weekly, tenantId, userId, updatedBy, false);
    return true;
  }

  private async processDefinitions(manager: EntityManager, weekly: any, tenantId: string): Promise<ProcessScheduleDefinition[]> {
    if (!shouldEnableProcess(weekly.manufacturing_method, "cutting")) return [];
    const divisionRows = await manager.query(`SELECT process_code,cycle_days,default_enabled,sequence FROM mps_division_process_configs WHERE tenant_id=$1 AND division_id=$2::uuid ORDER BY sequence,process_code`, [tenantId, weekly.division_id]);
    const itemRows = await manager.query(`SELECT process_code,sequence FROM mps_item_process_routes WHERE tenant_id=$1 AND item_code=$2 ORDER BY sequence,process_code`, [tenantId, weekly.item_code]);
    const canonical = new Map(STANDARD_PROCESSES.map(([code, name]) => [code, name]));
    const cycles = new Map(divisionRows.map((row: any) => [String(row.process_code), row.cycle_days == null ? null : Number(row.cycle_days)]));
    const selected = itemRows.length
      ? itemRows
      : divisionRows.length
        ? divisionRows.filter((row: any) => row.default_enabled === true)
        : STANDARD_PROCESSES.map(([processCode], index) => ({ process_code: processCode, sequence: index + 1 }));
    return selected.map((row: any) => ({
      code: String(row.process_code), name: canonical.get(String(row.process_code)) ?? String(row.process_code),
      sequence: Number(row.sequence), cycleDays: cycles.get(String(row.process_code)) ?? null
    }));
  }

  private async ensureExecutionRows(manager: EntityManager, weekly: any, tenantId: string, userId: string | null, updatedBy: string, initializeProcessConfig: boolean) {
    const reviewDueDate = this.dateOnly(weekly.latest_review_due_date);
    if (initializeProcessConfig) {
      await manager.query("SELECT set_config('app.mps_process_config_write_mode','INITIALIZE',true)");
      const definitions = await this.processDefinitions(manager, weekly, tenantId);
      const scheduled = reviewDueDate
        ? reverseScheduleForProcesses(reviewDueDate, definitions)
        : [...definitions].sort((a,b) => a.sequence-b.sequence || a.code.localeCompare(b.code)).map((process) => ({ ...process, dueDate: null }));
      for (const schedule of scheduled) await manager.query(`INSERT INTO mps_weekly_process_plans(tenant_id,weekly_plan_id,process_code,process_name,sequence,cycle_days,due_date,exception_text,execution_enabled,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9::uuid,$10) ON CONFLICT(tenant_id,weekly_plan_id,process_code) DO NOTHING`,
        [tenantId, weekly.id, schedule.code, schedule.name, schedule.sequence, schedule.cycleDays, schedule.dueDate, schedule.cycleDays == null ? "未维护工序周期" : null, userId, updatedBy]);
      await manager.query("SELECT set_config('app.mps_process_config_write_mode','',true)");
    }
    await this.recalculateSnapshotDueDates(manager, weekly, tenantId, updatedBy);
    const technicalDays = this.nullableNumber(weekly.technical_days);
    const drawingDueDate = technicalDays == null || !reviewDueDate ? null : new Date(Date.parse(`${reviewDueDate}T00:00:00Z`) - technicalDays * 86_400_000).toISOString().slice(0, 10);
    await manager.query(`UPDATE mps_weekly_plans SET technical_cycle_days=$3,drawing_due_date=$4,updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND id=$2 AND (technical_cycle_days,drawing_due_date) IS DISTINCT FROM ($3,$4)`, [tenantId, weekly.id, technicalDays, drawingDueDate, updatedBy]);
    /* KN-MPS-UI-001：技术报工表的 exception_text 是人工异常事实，系统绝不自动写入“未维护技术周期”等提示；
       技术周期缺失属于计划配置问题（进 mps_data_exceptions / 状态），不得伪造生产异常。 */
    await manager.query(`INSERT INTO mps_technical_reports(tenant_id,weekly_plan_id,division_id,order_number,item_code,item_name,delivery_number,drawing_due_date,exception_text,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9::uuid,$10) ON CONFLICT(tenant_id,weekly_plan_id) DO UPDATE SET division_id=excluded.division_id,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,updated_at=now(),updated_by=$10,version=mps_technical_reports.version+1 WHERE (mps_technical_reports.division_id,mps_technical_reports.order_number,mps_technical_reports.item_code,mps_technical_reports.item_name,mps_technical_reports.delivery_number) IS DISTINCT FROM (excluded.division_id,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number)`, [tenantId, weekly.id, weekly.division_id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, drawingDueDate, userId, updatedBy]);
    for (const material of ["五金", "木作"]) await manager.query(`INSERT INTO mps_material_reports(tenant_id,weekly_plan_id,division_id,order_number,item_code,item_name,delivery_number,material_name,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10) ON CONFLICT(tenant_id,weekly_plan_id,material_name) DO UPDATE SET division_id=excluded.division_id,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,updated_at=now(),updated_by=$10,version=mps_material_reports.version+1 WHERE (mps_material_reports.division_id,mps_material_reports.order_number,mps_material_reports.item_code,mps_material_reports.item_name,mps_material_reports.delivery_number) IS DISTINCT FROM (excluded.division_id,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number)`, [tenantId, weekly.id, weekly.division_id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, material, userId, updatedBy]);
    const outsourcingEnabled = ["中心外购", "外协", "自制+外协"].includes(weekly.manufacturing_method);
    if (outsourcingEnabled) await manager.query(`INSERT INTO mps_outsourcing_reports(tenant_id,weekly_plan_id,division_id,order_number,item_code,item_name,delivery_number,execution_enabled,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8::uuid,$9) ON CONFLICT(tenant_id,weekly_plan_id) DO UPDATE SET division_id=excluded.division_id,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,execution_enabled=true,updated_at=now(),updated_by=$9,version=mps_outsourcing_reports.version+1 WHERE (mps_outsourcing_reports.division_id,mps_outsourcing_reports.order_number,mps_outsourcing_reports.item_code,mps_outsourcing_reports.item_name,mps_outsourcing_reports.delivery_number,mps_outsourcing_reports.execution_enabled) IS DISTINCT FROM (excluded.division_id,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number,true)`, [tenantId, weekly.id, weekly.division_id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, userId, updatedBy]);
    if (!outsourcingEnabled) await manager.query(`UPDATE mps_outsourcing_reports SET execution_enabled=false,updated_at=now(),updated_by=$3,version=version+1 WHERE tenant_id=$1 AND weekly_plan_id=$2 AND execution_enabled=true`, [tenantId, weekly.id, updatedBy]);
    await manager.query(`UPDATE mps_process_reports SET division_id=$3,order_number=$4,item_code=$5,item_name=$6,delivery_number=$7,planned_quantity=$8,updated_at=now(),updated_by=$9,version=version+1 WHERE tenant_id=$1 AND weekly_plan_id=$2 AND (division_id,order_number,item_code,item_name,delivery_number,planned_quantity) IS DISTINCT FROM ($3,$4,$5,$6,$7,$8)`, [tenantId, weekly.id, weekly.division_id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, weekly.planned_quantity, updatedBy]);
    await this.rollupWeeklyProcesses(manager, weekly.id, tenantId, updatedBy);
  }

  /** 只按周计划已保存的工序集合、顺序和周期重算日期；永不读取最新路线配置。 */
  private async recalculateSnapshotDueDates(manager: EntityManager, weekly: any, tenantId: string, updatedBy: string) {
    const rows = await manager.query(`SELECT id,process_code,process_name,sequence,cycle_days,due_date
      FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid AND execution_enabled=true
      ORDER BY sequence,process_code`, [tenantId, weekly.id]);
    if (!rows.length) return;
    const anchor = this.dateOnly(weekly.latest_review_due_date);
    const definitions = rows.map((row: any) => ({
      code: String(row.process_code) as ProcessScheduleDefinition["code"], name: String(row.process_name),
      sequence: Number(row.sequence), cycleDays: row.cycle_days == null ? null : Number(row.cycle_days)
    }));
    const scheduled = anchor
      ? reverseScheduleForProcesses(anchor, definitions)
      : [...definitions].sort((a,b) => a.sequence-b.sequence || a.code.localeCompare(b.code)).map((process) => ({ ...process, dueDate: null }));
    const dueDates = new Map(scheduled.map((row) => [row.code, row.dueDate]));
    await manager.query("SELECT set_config('app.mps_process_config_write_mode','RECALCULATE_DATES',true)");
    try {
      for (const row of rows) {
        const dueDate = dueDates.get(String(row.process_code) as ProcessScheduleDefinition["code"]) ?? null;
        if (this.dateOnly(row.due_date) === dueDate) continue;
        await manager.query(`UPDATE mps_weekly_process_plans SET due_date=$3::date,updated_at=now(),updated_by=$4,version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND due_date IS DISTINCT FROM $3::date`, [tenantId, row.id, dueDate, updatedBy]);
      }
    } finally {
      await manager.query("SELECT set_config('app.mps_process_config_write_mode','',true)");
    }
  }

  private async rollupWeeklyProcesses(manager: EntityManager, weeklyPlanId: string, tenantId: string, updatedBy: string) {
    const today = shanghaiToday();
    await manager.query(`WITH aggregates AS (
      SELECT p.id,p.due_date,p.report_date,w.planned_quantity,
        COALESCE(sum(r.production_quantity),0) cumulative_reported,
        COALESCE(sum(r.production_quantity) FILTER (WHERE r.production_date=p.report_date),0) daily_reported
      FROM mps_weekly_process_plans p
      JOIN mps_weekly_plans w ON w.tenant_id=p.tenant_id AND w.id=p.weekly_plan_id
      LEFT JOIN mps_process_reports r ON r.tenant_id=p.tenant_id AND r.weekly_plan_id=p.weekly_plan_id AND r.process_code=p.process_code
      WHERE p.tenant_id=$1 AND p.weekly_plan_id=$2::uuid AND p.execution_enabled=true
        AND w.manufacturing_method IN ('自制','自制+外协')
      GROUP BY p.id,p.due_date,p.report_date,w.planned_quantity
    ), desired AS (
      SELECT id,daily_reported,CASE WHEN planned_quantity>0 AND cumulative_reported>=planned_quantity THEN '已完成'
        WHEN due_date IS NOT NULL AND $3::date>due_date THEN '延期'
        WHEN cumulative_reported>0 THEN '进行中' ELSE '未开始' END status FROM aggregates
    )
    UPDATE mps_weekly_process_plans p SET daily_reported_quantity=d.daily_reported,status=d.status,updated_at=now(),updated_by=$4,version=p.version+1
    FROM desired d WHERE p.tenant_id=$1 AND p.id=d.id
      AND (p.daily_reported_quantity,p.status) IS DISTINCT FROM (d.daily_reported,d.status)`, [tenantId, weeklyPlanId, today, updatedBy]);
  }

  private async allocateInbound(tenantId: string, updatedBy: string) {
    return this.dataSource.transaction(async (manager) => {
      const actorId = /^[0-9a-f-]{36}$/i.test(updatedBy) ? updatedBy : MASTER_PLAN_SYSTEM_USER_ID;
      const monthly = await reconcileExistingMonthlyInbound(manager, tenantId, updatedBy, actorId);
      /* KN-MPS-LIVE-002：入库分摊只统计科加账套，禁止把其它账套入库加进事业四部。 */
      const changed = await manager.query(`
        WITH inbound_totals AS (
          SELECT sales_order_number order_number,inventory_code item_code,sum(greatest(COALESCE(received_quantity,0),0)) quantity
          FROM finished_goods_inbound WHERE sales_order_number IS NOT NULL AND source_database='${MASTER_PLAN_ERP_ADMISSION.sourceDatabase}'
          GROUP BY sales_order_number,inventory_code
        ), ordered AS (
          SELECT w.id,w.planned_quantity,COALESCE(t.quantity,0) inbound_quantity,
            COALESCE(sum(w.planned_quantity) OVER (
              PARTITION BY w.order_number,w.item_code
              ORDER BY w.latest_customer_due_date NULLS LAST,w.delivery_number::numeric,w.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),0) prior_planned
          FROM mps_weekly_plans w
          LEFT JOIN inbound_totals t ON t.order_number=w.order_number AND t.item_code=w.item_code
          WHERE w.tenant_id=$1
        ), allocations AS (
          SELECT id,greatest(least(inbound_quantity-prior_planned,planned_quantity),0) allocated_quantity
          FROM ordered
        )
        UPDATE mps_weekly_plans w SET allocated_inbound_quantity=a.allocated_quantity,
          pending_quantity=greatest(w.planned_quantity-a.allocated_quantity,0),updated_at=now(),updated_by=$2,version=w.version+1
        FROM allocations a WHERE w.tenant_id=$1 AND w.id=a.id
          AND (w.allocated_inbound_quantity,w.pending_quantity) IS DISTINCT FROM
            (a.allocated_quantity,greatest(w.planned_quantity-a.allocated_quantity,0))
        RETURNING w.id`, [tenantId, updatedBy]);
      const weeklyRows = this.changedCount(changed);
      return { count: monthly.monthlyRows + monthly.groupRows + weeklyRows,
        metrics: { monthly_inbound_recalculated: monthly.monthlyRows, group_inbound_recalculated: monthly.groupRows, monthly_inbound_source_unverified: monthly.unverifiedSourceItems, weekly_inbound_allocated: weeklyRows } };
    });
  }

  private async executionRollup(tenantId: string, updatedBy: string, scope: ExecutionRollupScope | null = null) {
    const today = shanghaiToday(); let count = 0;
    await this.dataSource.transaction(async (manager) => {
      const scoped = scope ? "AND p.weekly_plan_id=$4::uuid AND p.process_code=$5" : "";
      const params = scope ? [tenantId, updatedBy, today, scope.weeklyPlanId, scope.processCode] : [tenantId, updatedBy, today];
      const processes = await manager.query(`WITH aggregates AS (
        SELECT p.id,p.due_date,p.report_date,w.planned_quantity,
          COALESCE(sum(r.production_quantity),0) AS cumulative_reported,
          COALESCE(sum(r.production_quantity) FILTER (WHERE r.production_date=p.report_date),0) AS daily_reported
        FROM mps_weekly_process_plans p
        JOIN mps_weekly_plans w ON w.id=p.weekly_plan_id AND w.tenant_id=p.tenant_id
        LEFT JOIN mps_process_reports r ON r.tenant_id=p.tenant_id AND r.weekly_plan_id=p.weekly_plan_id AND r.process_code=p.process_code
        WHERE p.tenant_id=$1 AND p.execution_enabled=true AND w.manufacturing_method IN ('自制','自制+外协') ${scoped}
        GROUP BY p.id,p.due_date,p.report_date,w.planned_quantity
      ), desired AS (
        SELECT id,daily_reported,CASE
          WHEN planned_quantity>0 AND cumulative_reported>=planned_quantity THEN '已完成'
          WHEN due_date IS NOT NULL AND $3::date>due_date THEN '延期'
          WHEN cumulative_reported>0 THEN '进行中'
          ELSE '未开始' END AS status
        FROM aggregates
      )
      UPDATE mps_weekly_process_plans p SET daily_reported_quantity=d.daily_reported,status=d.status,updated_at=now(),updated_by=$2,version=p.version+1
      FROM desired d WHERE p.tenant_id=$1 AND p.id=d.id
        AND (p.daily_reported_quantity,p.status) IS DISTINCT FROM (d.daily_reported,d.status)
      RETURNING p.id`, params);
      count += this.changedCount(processes);
      if (!scope) {
        const outsource = await manager.query(`WITH desired AS (
          SELECT id,actual_inbound_date IS NOT NULL AS received,CASE
            WHEN actual_inbound_date IS NOT NULL THEN '已入库'
            WHEN btrim(coalesce(purchase_order_number,''))='' THEN '未开始'
            WHEN outsourcing_due_date IS NOT NULL AND $3::date>outsourcing_due_date THEN '延期'
            ELSE '进行中' END AS status
          FROM mps_outsourcing_reports WHERE tenant_id=$1
        )
        UPDATE mps_outsourcing_reports o SET status=d.status,received=d.received,updated_at=now(),updated_by=$2,version=o.version+1
        FROM desired d WHERE o.tenant_id=$1 AND o.id=d.id AND (o.status,o.received) IS DISTINCT FROM (d.status,d.received)
        RETURNING o.id`, [tenantId, updatedBy, today]);
        count += this.changedCount(outsource);
      }
      // 技术状态由技术人员在技术报工表维护；对账不得根据附件反向覆盖人工状态。
    });
    return count;
  }

  private async refreshExceptions(manager: EntityManager, tenantId: string, userId: string | null, updatedBy: string) {
    await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$2,version=version+1 WHERE tenant_id=$1 AND active=true AND exception_type IN ('MISSING_CUSTOMER_CODE','MISSING_PRIMARY_DIVISION','MISSING_ALLOCATION_DIVISION','NON_POSITIVE_DEMAND','INBOUND_EXCEEDS_DEMAND')`, [tenantId, updatedBy]);
    await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
    SELECT $1,exception_key,resource,record_id,business_key,exception_type,severity,message,true,$2::uuid,$3 FROM (SELECT DISTINCT ON (exception_key) * FROM (
      /* 业务字段可为空时，异常键必须仍是稳定、非空的业务主键，绝不依赖 NULL 拼接。 */
      SELECT 'group:'||order_number||':missing-customer-code' exception_key,'mps-group-plans' resource,id record_id,order_number business_key,'MISSING_CUSTOMER_CODE' exception_type,'ERROR' severity,'ERP订单缺少客户代码，无法确定承接事业部' message FROM mps_group_plans WHERE tenant_id=$1 AND NULLIF(BTRIM(customer_code),'') IS NULL
      UNION ALL SELECT 'allocation:'||order_number||':'||item_code||':missing-customer-code','mps-order-allocations',id,order_number||'/'||item_code,'MISSING_CUSTOMER_CODE','ERROR','ERP订单缺少客户代码，无法确定承接事业部' FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL AND NULLIF(BTRIM(customer_code),'') IS NULL
      UNION ALL SELECT 'customer:'||BTRIM(customer_code),'mps-group-plans',id,BTRIM(customer_code),'MISSING_PRIMARY_DIVISION','ERROR','客户未配置主责事业部' FROM mps_group_plans WHERE tenant_id=$1 AND NULLIF(BTRIM(customer_code),'') IS NOT NULL AND primary_division_id IS NULL
      UNION ALL SELECT 'allocation:'||order_number||':'||item_code,'mps-order-allocations',id,order_number||'/'||item_code,'MISSING_ALLOCATION_DIVISION','ERROR','订单品项未分配承接事业部' FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL AND NULLIF(BTRIM(customer_code),'') IS NOT NULL AND division_id IS NULL
      UNION ALL SELECT 'demand:'||order_number||':'||item_code,'mps-monthly-plans',id,order_number||'/'||item_code,'NON_POSITIVE_DEMAND','ERROR','订单需求数量必须大于0' FROM mps_monthly_plans WHERE tenant_id=$1 AND required_quantity<=0
      UNION ALL SELECT 'over-inbound:'||order_number||':'||item_code,'mps-monthly-plans',id,order_number||'/'||item_code,'INBOUND_EXCEEDS_DEMAND','WARNING','累计入库数量超过订单需求数量' FROM mps_monthly_plans WHERE tenant_id=$1 AND cumulative_inbound_quantity>required_quantity
    ) exceptions_raw ORDER BY exception_key) exceptions ON CONFLICT(tenant_id,exception_key) DO UPDATE SET resource=excluded.resource,record_id=excluded.record_id,business_key=excluded.business_key,exception_type=excluded.exception_type,severity=excluded.severity,message=excluded.message,active=true,resolved_at=NULL,updated_at=now(),updated_by=$3,version=mps_data_exceptions.version+1`, [tenantId, userId, updatedBy]);
  }

  private upsertException(tenantId: string, key: string, resource: string, recordId: string | null, businessKey: string, type: string, severity: string, message: string, userId: string | null, updatedBy: string, manager: EntityManager = this.dataSource.manager) {
    return manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by) VALUES($1,$2,$3,$4::uuid,$5,$6,$7,$8,true,$9::uuid,$10) ON CONFLICT(tenant_id,exception_key) DO UPDATE SET resource=excluded.resource,record_id=excluded.record_id,business_key=excluded.business_key,exception_type=excluded.exception_type,severity=excluded.severity,message=excluded.message,active=true,resolved_at=NULL,updated_at=now(),updated_by=$10,version=mps_data_exceptions.version+1`, [tenantId, key, resource, recordId, businessKey, type, severity, message, userId, updatedBy]);
  }

  private nullableNumber(value: unknown) { return value == null ? null : Number(value); }

  /**
   * 同步复制字典字段时同样只能写当前 field options 中的真实 value：
   * 来源为空 → NULL（保持既有可清空语义）；来源为合法 value → 复制；来源是历史非法值 → 保留目标表当前值，绝不向下游扩散。
   * 允许值统一来自 fieldsFor(resource) 的 options，不新增第二份字典。
   */
  private dictionaryCopySql(resource: MasterPlanResource, field: string, column: string, source: string, existing: string) {
    const options = fieldsFor(resource).find((entry) => entry.key === field)?.options ?? [];
    if (!options.length) return source;
    const allowed = options.map((option) => `'${String(option.value).replace(/'/g, "''")}'`).join(",");
    return `CASE WHEN ${source} IS NULL OR btrim(${source}::text)='' THEN NULL WHEN ${source}::text IN (${allowed}) THEN ${source}::text ELSE ${existing} END AS ${column}`;
  }

  private changedCount(result: unknown[]) { return Array.isArray(result[0]) ? result[0].length : result.length; }
  private dateOnly(value: unknown) {
    if (value == null || value === "") return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  private executionScope(syncKey: string, value: unknown): ExecutionRollupScope | null {
    if (syncKey !== "execution-rollup" || !value || typeof value !== "object") return null;
    const scope = value as Record<string, unknown>;
    return typeof scope.weeklyPlanId === "string" && typeof scope.processCode === "string"
      ? { weeklyPlanId: scope.weeklyPlanId, processCode: scope.processCode }
      : null;
  }
}
