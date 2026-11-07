import { ConflictException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";

export type SyncRunType = "SCHEDULED" | "MANUAL" | "EVENT" | "RECONCILIATION";
export type SyncExecutionScope = { weeklyPlanId: string; processCode: string };
export type SyncScope = SyncExecutionScope | {basePlanIds:string[]} | {monthlyPlans:Array<{id:string;expectedVersion:number}>};
export type SyncOutcomeStatus = "SUCCESS" | "SKIPPED" | "BLOCKED" | "DISABLED";
export type SyncOutcome = { count: number; metrics?: Record<string, number>; status?: SyncOutcomeStatus; skipped?: boolean };
export type SyncResult = { syncKey: string; status: SyncOutcomeStatus; count: number; repeated: boolean; metrics: Record<string, number> | null };
type Event = { id: string; tenant_id: string; sync_key: string; scope_json: unknown; version: number;
  actor_id: string; actor_name: string; idempotency_key: string };
type Log = { id: string; version: number; status: string; sync_key: string; attempts: number;
  scope_json: SyncScope | null; lease_expires_at: Date | null; sync_count: number; metrics: Record<string, number> | null };
type Claim = { tenant: string; key: string; configId: string; version: number; actorId: string; actorName: string;
  logs: Log[]; events: Event[]; disabled: boolean };
type Executor = (manager: EntityManager, key: string, tenant: string, actorId: string, actorName: string, scope: SyncScope | null, trustedInternalService: boolean) => Promise<SyncOutcome>;

export class SyncLeaseLost extends ConflictException {
  constructor() { super("同步租约已失效，旧Worker不能提交结果"); }
}

/** One bounded lease, one DB transaction and one version fence per tenant/task.
 * Locks stay on the business connection until commit/rollback. A contender never
 * steals from a live transaction; PG statement/idle/transaction timeouts release
 * crashed or stalled owners. No separate heartbeat updates can invalidate the
 * existing REPEATABLE READ projection snapshot. */
export class MasterPlanSyncRunner {
  constructor(private readonly db: DataSource, private readonly execute: Executor, private readonly systemUser: string,
    private readonly leaseMs = 300_000) {}

  async dueConfigurations(tenant: string) {
    return this.db.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      return manager.query(`SELECT sync_key FROM mps_sync_configs WHERE tenant_id=$1 AND enabled=true
        AND ((status<>'RUNNING' AND (last_started_at IS NULL OR last_started_at + interval_minutes * interval '1 minute' <= clock_timestamp()))
          OR (status='RUNNING' AND lease_expires_at<=clock_timestamp())) ORDER BY sync_key`, [tenant]);
    });
  }

  async processAvailableTenants() {
    // Same privileged system queue scan as the original consumer, now metadata
    // only. Actual claims, execution and acknowledgements each set tenant context.
    const tenants = await this.db.query(`SELECT tenant_id FROM mps_reconciliation_outbox
      WHERE (${this.eligible}) GROUP BY tenant_id ORDER BY min(created_at),tenant_id LIMIT 20`);
    let processed = 0;
    for (const { tenant_id } of tenants) {
      if (processed >= 20) break;
      processed += await this.processOutbox(tenant_id, 20 - processed);
    }
    return processed;
  }

  async processOutbox(tenant: string, limit = 20) {
    let processed = 0;
    const seen = new Set<string>();
    // Claim the next same-scope group only when ready to execute it. Queued groups
    // cannot lose their leases while waiting behind a long first group.
    while (processed < limit) {
      const events = await this.claimEvents(tenant, limit - processed, [...seen]);
      if (!events.length) break;
      processed += events.length;
      for (const event of events) seen.add(event.id);
      const first = events[0]!;
      try {
        const result = await this.run(tenant, first.sync_key, "EVENT", first.actor_id, first.actor_name,
          first.idempotency_key, this.scope(first.sync_key, first.scope_json), events, false);
        // Do not trust "did not throw", skipped results, or an unverified SUCCESS.
        if (result.status === "SUCCESS") {
          const [verification] = await this.db.transaction(async manager => {
            await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
          return manager.query(`SELECT count(*)::integer AS verified
            FROM mps_reconciliation_outbox o JOIN mps_sync_logs l
              ON l.tenant_id=o.tenant_id AND l.idempotency_key=o.idempotency_key AND l.sync_key=o.sync_key
            WHERE o.tenant_id=$1 AND o.id=ANY($2::uuid[]) AND o.status='SUCCESS'
              AND l.status='SUCCESS' AND l.attempts>0`, [tenant, events.map(event => event.id)]);
          });
          if (Number(verification?.verified) !== events.length) throw new Error("同步结果未经日志及Outbox事务验证");
        } else await this.failEvents(events, `同步未完整成功：${result.status}`, false);
      } catch (error) {
        const busy = (error instanceof ConflictException && error.message === "该同步任务正在运行") || (error as { code?: string })?.code === "55P03";
        await this.failEvents(events, this.errorText(error), busy);
      }
    }
    return processed;
  }

  async run(tenant: string, key: string, type: SyncRunType, actor: string | null, name: string,
    idempotencyKey: string, scope: SyncScope | null = null, events: Event[] = [], trustedInternalService = false): Promise<SyncResult> {
    scope=this.scope(key,scope);
    const actorId = actor ?? this.systemUser;
    if(trustedInternalService && (actorId!==this.systemUser || !['SCHEDULED','RECONCILIATION','EVENT'].includes(type)))throw new ConflictException('内部服务身份上下文无效');
    const claim = await this.claim(tenant, key, type, actorId, name, idempotencyKey, scope, events);
    if ("repeated" in claim) return claim;
    try {
      return await this.db.transaction(key === "plan-projections" ? "REPEATABLE READ" : "READ COMMITTED", async manager => {
        await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout',$2,true)", [tenant, String(Math.min(this.leaseMs, 5000))]);
        await manager.query("SELECT set_config('statement_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$2,true),set_config('transaction_timeout',$3,true)",
          [String(Math.min(this.leaseMs, 120_000)), String(Math.min(this.leaseMs, 30_000)), String(this.leaseMs)]);
        await this.lockOwned(manager, claim);
        const raw = claim.disabled ? { count: 0, status: "DISABLED" as const }
          : await this.execute(manager, key, tenant, actorId, name, scope, trustedInternalService);
        const outcome = this.verifyOutcome(key, raw);
        await this.finish(manager, claim, outcome);
        return { syncKey: key, repeated: false, count: outcome.count, metrics: outcome.metrics ?? null, status: outcome.status! };
      });
    } catch (error) {
      await this.recordFailure(claim, error);
      throw error;
    }
  }

  private eligible = `(status IN ('PENDING','FAILED') AND next_attempt_at<=clock_timestamp())
    OR (status='RUNNING' AND lease_expires_at<=clock_timestamp())`;

  private async claimEvents(tenant: string, limit: number, exclude: string[] = []): Promise<Event[]> {
    return this.db.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout',$2,true)", [tenant, String(Math.min(this.leaseMs, 5000))]);
      const [first] = await manager.query(`SELECT * FROM mps_reconciliation_outbox
        WHERE tenant_id=$1 AND NOT(id=ANY($2::uuid[])) AND (${this.eligible}) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, [tenant, exclude]);
      if (!first) return [];
      const result = await manager.query(`UPDATE mps_reconciliation_outbox SET status='RUNNING',attempts=attempts+1,
        lease_expires_at=clock_timestamp()+$5::integer*interval '1 millisecond',completed_at=NULL,updated_at=clock_timestamp(),version=version+1
        WHERE tenant_id=$1 AND id IN (SELECT id FROM mps_reconciliation_outbox
          WHERE tenant_id=$1 AND sync_key=$2 AND NOT(id=ANY($6::uuid[])) AND COALESCE(scope_json,'null'::jsonb) IS NOT DISTINCT FROM COALESCE($3::jsonb,'null'::jsonb) AND (${this.eligible})
          ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $4) RETURNING *`,
        [tenant, first.sync_key, first.scope_json == null ? null : JSON.stringify(first.scope_json), limit, this.leaseMs, exclude]);
      return this.rows(result);
    });
  }

  private async claim(tenant: string, key: string, type: SyncRunType, actorId: string, name: string,
    idempotencyKey: string, scope: SyncScope | null, events: Event[]): Promise<Claim | SyncResult> {
    return this.db.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout',$2,true)", [tenant, String(Math.min(this.leaseMs, 5000))]);
      const [config] = await manager.query(`SELECT *,lease_expires_at>clock_timestamp() AS live
        FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key=$2 FOR UPDATE SKIP LOCKED`, [tenant, key]);
      if (!config) {
        const [known] = await manager.query("SELECT id FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key=$2", [tenant, key]);
        throw new ConflictException(known ? "该同步任务正在运行" : "同步配置不存在");
      }
      if (config.status === "RUNNING") {
        if (config.lease_expires_at == null) throw new ConflictException("历史RUNNING没有可信租约，须只读核验后人工处理");
        if (config.live) throw new ConflictException("该同步任务正在运行");
      }
      const expired = await manager.query(`UPDATE mps_sync_logs SET status='FAILED',error_message='LEASE_EXPIRED：执行中断，未验证成功',
          completed_at=clock_timestamp(),lease_expires_at=NULL,updated_at=clock_timestamp(),version=version+1
          WHERE tenant_id=$1 AND sync_key=$2 AND status='RUNNING' AND lease_expires_at<=clock_timestamp() RETURNING *`, [tenant, key]);
      for (const log of this.rows(expired)) await this.audit(manager, tenant, actorId, name, log.id, "lease_expired", { version: log.version - 1 }, { status: "FAILED" });
      const keys = events.length ? events.map(event => event.idempotency_key) : [idempotencyKey];
      const logs: Log[] = await manager.query(`SELECT * FROM mps_sync_logs WHERE tenant_id=$1 AND idempotency_key=ANY($2::varchar[]) ORDER BY id FOR UPDATE`, [tenant, keys]);
      for (const log of logs) {
        if (log.sync_key !== key || (log.attempts > 0 && !this.sameScope(log.scope_json, scope))) throw new ConflictException("同步幂等键与任务或执行范围不一致");
        if (log.status === "RUNNING") {
          if (log.lease_expires_at == null) throw new ConflictException("历史RUNNING日志须人工核验，禁止自动重放");
          throw new ConflictException("该同步任务正在运行");
        }
        if (log.status === "SUCCESS" && log.attempts === 0) throw new ConflictException("历史SUCCESS尚无本版验证凭据，禁止自动重放或误确认");
      }
      if (logs.length === keys.length && logs.every(log => log.status === "SUCCESS" && log.attempts > 0)) {
        await this.finishEvents(manager, events, "SUCCESS", null);
        return { syncKey: key, repeated: true, status: "SUCCESS", count: Number(logs[0]!.sync_count), metrics: logs[0]!.metrics };
      }
      const [owner] = this.rows(await manager.query(`UPDATE mps_sync_configs SET status='RUNNING',
        last_started_at=clock_timestamp(),lease_expires_at=clock_timestamp()+$3::integer*interval '1 millisecond',
        error_message=NULL,updated_at=clock_timestamp(),updated_by=$4::uuid,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid RETURNING id,version`, [tenant, config.id, this.leaseMs, actorId]));
      const active: Log[] = [];
      for (const identity of keys) {
        const previous = logs.find(log => (log as Log & { idempotency_key: string }).idempotency_key === identity);
        if (previous?.status === "SUCCESS") continue;
        const [log] = this.rows(await manager.query(`INSERT INTO mps_sync_logs(tenant_id,sync_config_id,sync_key,run_type,status,
          started_at,idempotency_key,created_by,updated_by,lease_expires_at,attempts,scope_json)
          VALUES($1,$2::uuid,$3,$4,'RUNNING',clock_timestamp(),$5,$6::uuid,$6::uuid,clock_timestamp()+$7::integer*interval '1 millisecond',1,$8::jsonb)
          ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET status='RUNNING',started_at=clock_timestamp(),completed_at=NULL,
            error_message=NULL,sync_count=0,metrics=NULL,lease_expires_at=excluded.lease_expires_at,attempts=mps_sync_logs.attempts+1,
            scope_json=excluded.scope_json,updated_at=clock_timestamp(),updated_by=excluded.updated_by,version=mps_sync_logs.version+1
          WHERE mps_sync_logs.status='FAILED' RETURNING *`, [tenant, config.id, key, type, identity, actorId, this.leaseMs, scope == null ? null : JSON.stringify(scope)]));
        if (!log) throw new SyncLeaseLost();
        active.push(log);
        await this.audit(manager, tenant, actorId, name, log.id, "attempt_started", previous ?? null,
          { status: "RUNNING", version: log.version, attempts: log.attempts, scope });
      }
      await this.lockEvents(manager, events);
      for (const event of events) await manager.query(`UPDATE mps_reconciliation_outbox SET lease_expires_at=
        clock_timestamp()+$4::integer*interval '1 millisecond' WHERE tenant_id=$1 AND id=$2::uuid AND version=$3`, [tenant, event.id, event.version, this.leaseMs]);
      return { tenant, key, configId: owner.id, version: owner.version, actorId, actorName: name,
        logs: active, events, disabled: !config.enabled && type !== "MANUAL" };
    });
  }

  private async lockOwned(manager: EntityManager, claim: Claim) {
    const [owner] = await manager.query(`SELECT id FROM mps_sync_configs WHERE tenant_id=$1 AND id=$2::uuid
      AND version=$3 AND status='RUNNING' AND lease_expires_at>clock_timestamp() FOR UPDATE SKIP LOCKED`, [claim.tenant, claim.configId, claim.version]);
    if (!owner) throw new SyncLeaseLost();
    for (const log of claim.logs) {
      const [owned] = await manager.query(`SELECT id FROM mps_sync_logs WHERE tenant_id=$1 AND id=$2::uuid AND version=$3
        AND status='RUNNING' AND lease_expires_at>clock_timestamp() FOR UPDATE`, [claim.tenant, log.id, log.version]);
      if (!owned) throw new SyncLeaseLost();
    }
    await this.lockEvents(manager, claim.events);
  }

  private async lockEvents(manager: EntityManager, events: Event[]) {
    for (const event of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
      const [owned] = await manager.query(`SELECT id FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND id=$2::uuid
        AND version=$3 AND status='RUNNING' AND lease_expires_at>clock_timestamp() FOR UPDATE`, [event.tenant_id, event.id, event.version]);
      if (!owned) throw new SyncLeaseLost();
    }
  }

  private verifyOutcome(key: string, value: SyncOutcome): SyncOutcome {
    if (!value || !Number.isSafeInteger(value.count) || value.count < 0) throw new Error("同步执行结果计数无效，未验证成功");
    const status = value.status ?? (value.skipped ? "SKIPPED" : "SUCCESS");
    const blocked = (key === "plan-projections" && Number(value.metrics?.skipped) > 0)
      || (key === "shipping-to-base" && Number(value.metrics?.base_conflicts) > 0);
    if (!["SUCCESS", "BLOCKED", "SKIPPED", "DISABLED"].includes(status)) throw new Error("同步执行返回未知状态，未验证成功");
    if (value.skipped && status === "SUCCESS") throw new Error("跳过的同步不能声明成功");
    return { ...value, status: status === "SUCCESS" && blocked ? "BLOCKED" : status };
  }

  private async finish(manager: EntityManager, claim: Claim, outcome: SyncOutcome, failureMessage?: string) {
    const success = outcome.status === "SUCCESS", error = failureMessage ?? (success ? null : `同步未完整成功：${outcome.status}`);
    const configStatus = success ? "SUCCESS" : outcome.status === "DISABLED" ? "DISABLED" : "FAILED";
    const config = this.rows(await manager.query(`UPDATE mps_sync_configs SET status=$4::varchar,last_sync_count=$5,error_message=$6,
      last_success_at=CASE WHEN $4::varchar='SUCCESS' THEN clock_timestamp() ELSE last_success_at END,
      last_failure_at=CASE WHEN $4::varchar='FAILED' THEN clock_timestamp() ELSE last_failure_at END,
      lease_expires_at=NULL,updated_at=clock_timestamp(),updated_by=$7::uuid,version=version+1
      WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 AND status='RUNNING' AND lease_expires_at>clock_timestamp() RETURNING id`,
      [claim.tenant, claim.configId, claim.version, configStatus, outcome.count, error, claim.actorId]));
    if (!config.length) throw new SyncLeaseLost();
    for (const log of claim.logs) {
      const updated = this.rows(await manager.query(`UPDATE mps_sync_logs SET status=$4::varchar,completed_at=clock_timestamp(),sync_count=$5,
        metrics=$6::jsonb,error_message=$7,lease_expires_at=NULL,updated_at=clock_timestamp(),updated_by=$8::uuid,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 AND status='RUNNING' AND lease_expires_at>clock_timestamp() RETURNING id`,
        [claim.tenant, log.id, log.version, success ? "SUCCESS" : "FAILED", outcome.count, JSON.stringify(outcome.metrics ?? null), error, claim.actorId]));
      if (!updated.length) throw new SyncLeaseLost();
      await this.audit(manager, claim.tenant, claim.actorId, claim.actorName, log.id, "attempt_finished",
        { status: "RUNNING", version: log.version }, { status: success ? "SUCCESS" : "FAILED", outcome: failureMessage ? "FAILED" : outcome.status, count: outcome.count });
    }
    await this.finishEvents(manager, claim.events, success ? "SUCCESS" : "FAILED", error);
    if (!success && outcome.status !== "DISABLED") await manager.query(`INSERT INTO mps_data_exceptions(
      tenant_id,exception_key,resource,business_key,exception_type,severity,message,active,created_by,updated_by)
      VALUES($1,$2,'mps-sync-configs',$3,'SYNC_FAILURE','ERROR',$4,true,$5::uuid,$5::uuid)
      ON CONFLICT(tenant_id,exception_key) DO UPDATE SET message=excluded.message,active=true,resolved_at=NULL,
        updated_at=clock_timestamp(),updated_by=excluded.updated_by,version=mps_data_exceptions.version+1`,
      [claim.tenant, `sync:${claim.key}`, claim.key, error, claim.actorId]);
  }

  private async finishEvents(manager: EntityManager, events: Event[], status: "SUCCESS" | "FAILED", error: string | null) {
    await this.lockEvents(manager, events);
    for (const event of events) {
      const updated = this.rows(await manager.query(`UPDATE mps_reconciliation_outbox SET status=$4::varchar,last_error=$5,
        completed_at=CASE WHEN $4::varchar='SUCCESS' THEN clock_timestamp() ELSE NULL END,
        next_attempt_at=clock_timestamp()+least(attempts,30)*interval '1 minute',lease_expires_at=NULL,
        updated_at=clock_timestamp(),updated_by=$6::uuid,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 AND status='RUNNING' AND lease_expires_at>clock_timestamp() RETURNING id`,
        [event.tenant_id, event.id, event.version, status, error, event.actor_id]));
      if (!updated.length) throw new SyncLeaseLost();
    }
  }

  private async recordFailure(claim: Claim, error: unknown) {
    await this.db.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout',$2,true)", [claim.tenant, String(Math.min(this.leaseMs, 5000))]);
      const [owner] = await manager.query(`SELECT id FROM mps_sync_configs WHERE tenant_id=$1 AND id=$2::uuid AND version=$3
        AND status='RUNNING' AND lease_expires_at>clock_timestamp() FOR UPDATE SKIP LOCKED`, [claim.tenant, claim.configId, claim.version]);
      if (!owner) return; // Expired/late workers may not write even failure metadata.
      await this.finish(manager, claim, { count: 0, status: "BLOCKED" }, this.errorText(error));
    });
  }

  private async failEvents(events: Event[], error: string, busy: boolean) {
    if (!events.length) return;
    await this.db.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout',$2,true)", [events[0]!.tenant_id, String(Math.min(this.leaseMs, 5000))]);
      for (const event of events) await manager.query(`UPDATE mps_reconciliation_outbox SET status=$4::varchar,last_error=$5,
        lease_expires_at=NULL,updated_at=clock_timestamp(),updated_by=$6::uuid,version=version+1,
        next_attempt_at=clock_timestamp()+CASE WHEN $4::varchar='PENDING' THEN interval '5 seconds' ELSE least(attempts,30)*interval '1 minute' END
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 AND status='RUNNING' AND lease_expires_at>clock_timestamp()`,
        [event.tenant_id, event.id, event.version, busy ? "PENDING" : "FAILED", busy ? null : error, event.actor_id]);
    });
  }

  private async audit(manager: EntityManager, tenant: string, actor: string, name: string, id: string, action: string, before: unknown, after: unknown) {
    await manager.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,source,created_by,updated_by,request_id)
      VALUES($1,$2::uuid,$3,'mps-sync-logs',$4,$5,$6::jsonb,$7::jsonb,'api',$2::uuid,$2::uuid,$8)`,
      [tenant, actor, name, id, `mps-sync.${action}`, JSON.stringify(before), JSON.stringify(after), `mps-sync:${id}:${action}`]);
  }

  private scope(key: string, value: unknown): SyncScope | null {
    if(value==null)return null;
    const scope=value as Record<string,unknown>;
    if(key==='shipping-to-base'&&scope&&Object.keys(scope).length===1&&'monthlyPlans' in scope&&Array.isArray(scope.monthlyPlans)&&scope.monthlyPlans.length>0&&scope.monthlyPlans.length<=25&&scope.monthlyPlans.every((plan:any)=>plan&&typeof plan.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plan.id)&&Number.isInteger(plan.expectedVersion)&&plan.expectedVersion>0)){
      const unique=new Map((scope.monthlyPlans as Array<{id:string;expectedVersion:number}>).map(plan=>[plan.id,{id:plan.id,expectedVersion:plan.expectedVersion}]));
      if(unique.size!==(scope.monthlyPlans as unknown[]).length)throw new ConflictException('月度计划恢复范围存在重复ID');
      return {monthlyPlans:[...unique.values()].sort((a,b)=>a.id.localeCompare(b.id))};
    }
    if(key==='base-to-weekly'&&scope&&Array.isArray(scope.basePlanIds)&&scope.basePlanIds.length>0&&scope.basePlanIds.length<=100&&scope.basePlanIds.every(id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))return {basePlanIds:[...new Set(scope.basePlanIds as string[])].sort()};
    if(key==='execution-rollup'&&scope&&typeof scope.weeklyPlanId==='string'&&typeof scope.processCode==='string')return {weeklyPlanId:scope.weeklyPlanId,processCode:scope.processCode};
    throw new ConflictException('同步范围无效，禁止回退全租户执行');
  }
  private sameScope(a:SyncScope|null,b:SyncScope|null){if(a&&'basePlanIds' in a)return !!b&&'basePlanIds' in b&&JSON.stringify([...a.basePlanIds].sort())===JSON.stringify([...b.basePlanIds].sort());if(b&&'basePlanIds' in b)return false;if(a&&'monthlyPlans' in a)return !!b&&'monthlyPlans' in b&&JSON.stringify(a.monthlyPlans)===JSON.stringify(b.monthlyPlans);if(b&&'monthlyPlans' in b)return false;if(a&&'weeklyPlanId' in a)return !!b&&'weeklyPlanId' in b&&a.weeklyPlanId===b.weeklyPlanId&&a.processCode===b.processCode;return b==null;}
  private rows(result: any[]): any[] { return Array.isArray(result[0]) ? result[0] : result; }
  private errorText(error: unknown) {
    const e = error as { code?: string; message?: string };
    if (e?.code && /^[0-9A-Z]{5}$/.test(e.code)) return `同步事务失败（SQLSTATE ${e.code}）`;
    return String(e?.message ?? "同步执行失败").replace(/(token|secret|password)=\S+/gi, "$1=[redacted]").slice(0, 4000);
  }
}
