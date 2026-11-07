import { MpsSyncLeases1722920118000 as Leases } from "../../migrations/1722920118000-MpsSyncLeases";
import { createMpsTestDatabase } from "./master-plan.test-database";
import { DataSource, type EntityManager } from "typeorm";
import { MasterPlanSyncRunner, type SyncOutcome } from "./master-plan.sync-runner";
import { MasterPlanSyncService } from "./master-plan.sync.service";

const socket = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET;
const integration = socket ? describe : describe.skip;
const tenant = "SYNC-1A-ISOLATED", actor = "0199bc00-0000-7000-8000-000000000003";
const division = "0199bc00-0000-7000-8000-000000000001";
const scope = { weeklyPlanId: "0199bc00-0000-7000-8000-000000000005", processCode: "bending" };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

integration("MPS 1A reliability on dedicated PostgreSQL18 (never production)", () => {
  let db: DataSource;
  const run = (runner: MasterPlanSyncRunner, key = "fixture-key", type = "EVENT", task = "execution-rollup", executionScope: typeof scope | null = null) =>
    runner.run(tenant, task, type as "EVENT", actor, "合成用户", key, executionScope);
  const effect = async (manager: EntityManager) => {
    const rows = await manager.query(`INSERT INTO fixture_effects(tenant_id,business_key) VALUES(current_setting('app.tenant_id'),'SYNTHETIC-PLAN')
      ON CONFLICT DO NOTHING RETURNING business_key`);
    return { count: rows.length };
  };
  const make = (execute: (manager: EntityManager, key: string, tenant: string, actorId: string, actorName: string, scope: unknown, trustedInternalService: boolean) => Promise<SyncOutcome> = effect, ms = 300_000) => new MasterPlanSyncRunner(db, execute, actor, ms);
  const event = async (key = "fixture-key", task = "execution-rollup", who = tenant, eventScope: unknown = null) =>
    (await db.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,sync_key,idempotency_key,actor_id,actor_name,created_by,updated_by,scope_json)
      VALUES($1,'mps-process-reports',$2,$3,$4::uuid,'合成用户',$4::uuid,$4::uuid,$5::jsonb) RETURNING *`, [who, task, key, actor, eventScope == null ? null : JSON.stringify(eventScope)]))[0];
  const state = async (key = "fixture-key") => ({
    log: (await db.query("SELECT * FROM mps_sync_logs WHERE tenant_id=$1 AND idempotency_key=$2", [tenant, key]))[0],
    event: (await db.query("SELECT * FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND idempotency_key=$2", [tenant, key]))[0],
    config: (await db.query("SELECT * FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key='execution-rollup'", [tenant]))[0],
    effects: Number((await db.query("SELECT count(*)::integer n FROM fixture_effects"))[0].n)
  });
  const retryNow = () => db.query("UPDATE mps_reconciliation_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1", [tenant]);
  const expire = async () => {
    for (const table of ["mps_sync_configs", "mps_sync_logs", "mps_reconciliation_outbox"]) await db.query(`UPDATE ${table}
      SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND status='RUNNING'`, [tenant]);
  };

  beforeAll(async () => {
    db = await createMpsTestDatabase("sync_1a_fixture", actor, division);
    // The 1A fixture intentionally focuses on leases/outbox rather than 1B's
    // migration; the current sync code probes this 1B capability before routes.
    await db.query("CREATE FUNCTION mps_weekly_has_execution(t varchar,w uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'");
  }, 30000);
  beforeEach(async () => {
    await db.query("TRUNCATE mps_reconciliation_outbox,mps_sync_logs,mps_data_exceptions,audit_logs,fixture_effects,mps_order_allocations,mps_base_plans CASCADE");
    await db.query("DELETE FROM mps_sync_configs WHERE tenant_id=$1", [tenant]);
    for (const key of ["execution-rollup", "base-to-weekly", "plan-projections", "shipping-to-base", "erp-orders"]) await db.query(`INSERT INTO mps_sync_configs(
      tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)VALUES($1,$2,'合成同步',true,30,$3::uuid,$3::uuid)`, [tenant, key, actor]);
  });
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it("reexecutes a FAILED idempotency key, commits one plan, and keeps all three states consistent", async () => {
    await event(); let fail = true;
    const execute = jest.fn(async (m: EntityManager) => { const result = await effect(m); if (fail) throw Error("synthetic failure"); return result; });
    const runner = make(execute);
    expect(await runner.processOutbox(tenant)).toBe(1);
    const failed = await state(); expect(failed.effects).toBe(0);
    expect([failed.log.status, failed.event.status, failed.config.status]).toEqual(["FAILED", "FAILED", "FAILED"]);
    fail = false; await retryNow(); await runner.processOutbox(tenant);
    const succeeded = await state(); expect(succeeded.effects).toBe(1); expect(execute).toHaveBeenCalledTimes(2);
    expect([succeeded.log.status, succeeded.event.status, succeeded.config.status]).toEqual(["SUCCESS", "SUCCESS", "SUCCESS"]);
    expect(succeeded.log.attempts).toBe(2);
    const audits = await db.query("SELECT before_json,after_json FROM audit_logs WHERE action='mps-sync.attempt_started' ORDER BY created_at");
    expect(audits[1].before_json.error_message).toBe("synthetic failure");
  });

  it("keeps a repeated failure FAILED and rolls back each attempt's business writes", async () => {
    await event(); const execute = jest.fn(async (m: EntityManager) => { await effect(m); throw Error("again"); });
    const runner = make(execute); await runner.processOutbox(tenant); await retryNow(); await runner.processOutbox(tenant);
    const s = await state(); expect(s.effects).toBe(0); expect(s.log.attempts).toBe(2);
    expect([s.log.status, s.event.status, s.config.status]).toEqual(["FAILED", "FAILED", "FAILED"]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not elevate an Outbox event based on actor_id alone", async () => {
    await event();
    let trusted: boolean | undefined;
    const execute = jest.fn(async (manager: EntityManager, _key: string, _tenant: string, _actorId: string, _name: string, _scope: unknown, service: boolean) => {
      trusted = service;
      return effect(manager);
    });
    await make(execute).processOutbox(tenant);
    expect(trusted).toBe(false);
  });

  it("recovers managed RUNNING after a crash between claim and transaction start", async () => {
    const runner = make(); await event();
    const events = await (runner as any).claimEvents(tenant, 20);
    await (runner as any).claim(tenant, "execution-rollup", "EVENT", actor, "合成用户", "fixture-key", null, events);
    await expire(); await runner.processOutbox(tenant);
    const s = await state(); expect(s.effects).toBe(1); expect(s.log.status).toBe("SUCCESS"); expect(s.log.attempts).toBe(2);
    expect((await db.query("SELECT count(*)::integer n FROM audit_logs WHERE action='mps-sync.lease_expired'"))[0].n).toBe(1);
  });

  it("recovers an expired log even when a newer different-key sync already completed", async () => {
    const runner = make(); await event(); const events = await (runner as any).claimEvents(tenant, 20);
    await (runner as any).claim(tenant, "execution-rollup", "EVENT", actor, "合成用户", "fixture-key", null, events);
    await expire(); await run(runner, "newer-key"); await runner.processOutbox(tenant);
    const s = await state(); expect(s.log.status).toBe("SUCCESS"); expect(s.event.status).toBe("SUCCESS"); expect(s.effects).toBe(1);
  });

  it("rejects a late old Worker before any business write after a new generation succeeds", async () => {
    const ready = deferred(), release = deferred(); const oldExecute = jest.fn(effect), old = make(oldExecute), next = make();
    const lock = (old as any).lockOwned.bind(old);
    jest.spyOn(old as any, "lockOwned").mockImplementationOnce(async (...args: any[]) => { ready.resolve(); await release.promise; return lock(...args); });
    const oldResult = run(old).catch(error => error); await ready.promise; await expire();
    await run(next); const before = await state(); release.resolve(); await oldResult;
    const after = await state(); expect(oldExecute).not.toHaveBeenCalled(); expect(after.effects).toBe(1);
    expect(after.log).toEqual(before.log); expect(after.config).toEqual(before.config);
  });

  it("times out a stalled business transaction, rolls back its write, then fences its late completion", async () => {
    const ready = deferred(), release = deferred();
    const old = make(async m => { await effect(m); ready.resolve(); await release.promise; return { count: 999 }; }, 250);
    await event(); const pending = old.processOutbox(tenant).catch(error => error); await ready.promise;
    await new Promise(resolve => setTimeout(resolve, 600));
    await make().processOutbox(tenant); const before = await state(); release.resolve(); await pending;
    const after = await state(); expect(after.effects).toBe(1); expect(after.log.sync_count).toBe(1);
    expect(after.log).toEqual(before.log); expect(after.event).toEqual(before.event); expect(after.config).toEqual(before.config);
  }, 10000);

  it("does not reclaim a live transaction or run the same effective task concurrently", async () => {
    const ready = deferred(), release = deferred(); let active = 0, max = 0;
    const first = make(async m => { active++; max = Math.max(max, active); ready.resolve(); await release.promise; const result = await effect(m); active--; return result; });
    await event(); const pending = first.processOutbox(tenant); await ready.promise;
    expect(await make().processOutbox(tenant)).toBe(0);
    await expect(run(make(), "another-key")).rejects.toThrow("该同步任务正在运行");
    release.resolve(); await pending; expect(max).toBe(1); expect((await state()).effects).toBe(1);
  });

  it("keeps a different claimed event PENDING when the task is busy, then actually retries it", async () => {
    const ready = deferred(), release = deferred();
    await event("first", "execution-rollup", tenant, scope);
    const first = make(async m => { ready.resolve(); await release.promise; return effect(m); }).processOutbox(tenant);
    await ready.promise;
    await event("waiting", "execution-rollup", tenant, { ...scope, processCode: "packaging" });
    await make().processOutbox(tenant);
    const [waiting] = await db.query("SELECT status,last_error FROM mps_reconciliation_outbox WHERE idempotency_key='waiting'");
    expect(waiting).toMatchObject({ status: "PENDING", last_error: null });
    release.resolve(); await first; await retryNow(); await make().processOutbox(tenant);
    expect((await db.query("SELECT status FROM mps_sync_logs WHERE idempotency_key='waiting'"))[0].status).toBe("SUCCESS");
    expect((await state()).effects).toBe(1);
  });

  it("races two independent Workers without producing duplicate effective plans", async () => {
    for (let i = 0; i < 8; i++) await event(`race-${i}`);
    let active = 0, max = 0;
    const execute = async (m: EntityManager) => {
      active++; max = Math.max(max, active);
      try { await new Promise(resolve => setTimeout(resolve, 20)); return await effect(m); }
      finally { active--; }
    };
    await Promise.all([make(execute).processOutbox(tenant), make(execute).processOutbox(tenant)]);
    await retryNow(); await make(execute).processOutbox(tenant);
    expect(max).toBe(1); expect((await state()).effects).toBe(1);
    expect((await db.query("SELECT count(*)::integer n FROM mps_reconciliation_outbox WHERE status='SUCCESS'"))[0].n).toBe(8);
    expect((await db.query("SELECT count(*)::integer n FROM mps_sync_logs WHERE status='SUCCESS'"))[0].n).toBe(8);
  });

  it.each([2, 5, 10])("coalesces %i same-scope events but records verified SUCCESS for every idempotency key", async count => {
    for (let i = 0; i < count; i++) await event(`group-${i}`, "execution-rollup", tenant, scope);
    const execute = jest.fn(effect); await make(execute).processOutbox(tenant);
    expect(execute).toHaveBeenCalledTimes(1);
    const [s] = await db.query(`SELECT count(*)::integer n FROM mps_reconciliation_outbox o JOIN mps_sync_logs l
      ON l.tenant_id=o.tenant_id AND l.idempotency_key=o.idempotency_key WHERE o.tenant_id=$1 AND o.status='SUCCESS' AND l.status='SUCCESS'`, [tenant]);
    expect(s.n).toBe(count);
  });

  it("acknowledges a duplicate only from verified SUCCESS without executing or generating another plan", async () => {
    const execute = jest.fn(effect), runner = make(execute); await event(); await runner.processOutbox(tenant);
    await db.query("UPDATE mps_reconciliation_outbox SET status='FAILED',next_attempt_at=clock_timestamp() WHERE tenant_id=$1", [tenant]);
    await runner.processOutbox(tenant); expect(execute).toHaveBeenCalledTimes(1);
    const s = await state(); expect(s.effects).toBe(1); expect(s.log.attempts).toBe(1); expect(s.event.status).toBe("SUCCESS");
  });

  it.each(["SKIPPED", "BLOCKED", "DISABLED"] as const)("never treats explicit %s as full success", async status => {
    await event(); const runner = make(async () => ({ count: 0, status })); await runner.processOutbox(tenant);
    const s = await state(); expect(s.log.status).toBe("FAILED"); expect(s.event.status).toBe("FAILED");
    expect(s.log.error_message).toContain(status); expect(s.config.status).toBe(status === "DISABLED" ? "DISABLED" : "FAILED");
  });

  it("records disabled automatic execution without invoking business logic, while retaining explicit manual override", async () => {
    await db.query("UPDATE mps_sync_configs SET enabled=false WHERE tenant_id=$1", [tenant]); await event();
    const execute = jest.fn(effect), runner = make(execute); await runner.processOutbox(tenant);
    expect(execute).not.toHaveBeenCalled(); expect((await state()).event.status).toBe("FAILED");
    expect((await run(runner, "manual-override", "MANUAL")).status).toBe("SUCCESS");
  });

  it.each(["plan-projections", "shipping-to-base"])("reports protected conflicts in %s as BLOCKED while preserving committed partial progress", async key => {
    const metrics: Record<string, number> = key === "plan-projections" ? { skipped: 1 } : { base_conflicts: 1 };
    const runner = make(async m => ({ ...await effect(m), status: "SUCCESS", metrics }));
    const result = await run(runner, "fixture-key", "EVENT", key); expect(result.status).toBe("BLOCKED");
    const [log] = await db.query("SELECT status FROM mps_sync_logs WHERE tenant_id=$1 AND idempotency_key='fixture-key'", [tenant]);
    expect(log.status).toBe("FAILED"); expect((await state()).effects).toBe(1);
  });

  it("keeps intentional ERP admission filters distinct from task-level blocked results", async () => {
    const result = await run(make(async () => ({ count: 0, metrics: { blocked_by_source_database: 100 } })), "fixture-key", "SCHEDULED", "erp-orders");
    expect(result.status).toBe("SUCCESS");
  });

  it("rejects malformed or contradictory execution outcomes", async () => {
    for (const raw of [undefined, { count: -1 }, { count: 0, status: "UNKNOWN" }, { count: 0, status: "SUCCESS", skipped: true }]) {
      const runner = make(async () => raw as SyncOutcome);
      await expect(run(runner, `invalid-${String(raw?.count)}-${String(raw?.status)}`)).rejects.toThrow();
    }
    expect((await db.query("SELECT count(*)::integer n FROM mps_sync_logs WHERE status='SUCCESS'"))[0].n).toBe(0);
  });

  it("rejects a reused idempotency key with a different execution scope", async () => {
    const runner = make(); await run(runner, "scope-key", "EVENT", "execution-rollup", scope);
    await expect(run(runner, "scope-key", "EVENT", "execution-rollup", { ...scope, processCode: "packaging" })).rejects.toThrow("范围不一致");
  });

  it("preserves legacy SUCCESS/FAILED contradictions and unleased RUNNING without replay or rewriting", async () => {
    const e = await event(); const [config] = await db.query("SELECT id FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key='execution-rollup'", [tenant]);
    await db.query(`INSERT INTO mps_sync_logs(tenant_id,sync_config_id,sync_key,run_type,status,started_at,idempotency_key,created_by,updated_by)
      VALUES($1,$2,'execution-rollup','EVENT','FAILED',clock_timestamp()-interval '2 days','fixture-key',$3,$3)`, [tenant, config.id, actor]);
    await db.query("UPDATE mps_reconciliation_outbox SET status='SUCCESS' WHERE id=$1", [e.id]);
    const legacy = await event("legacy-running");
    await db.query("UPDATE mps_reconciliation_outbox SET status='RUNNING',updated_at=clock_timestamp()-interval '2 days' WHERE id=$1", [legacy.id]);
    const before = await db.query("SELECT * FROM mps_reconciliation_outbox ORDER BY id");
    const execute = jest.fn(effect); expect(await make(execute).processOutbox(tenant)).toBe(0); expect(execute).not.toHaveBeenCalled();
    expect(await db.query("SELECT * FROM mps_reconciliation_outbox ORDER BY id")).toEqual(before);
    expect((await state()).log.status).toBe("FAILED");
  });

  it("does not infer verified success from a pre-migration SUCCESS log", async () => {
    const runner = make(); await run(runner);
    await db.query("UPDATE mps_sync_logs SET attempts=0 WHERE tenant_id=$1", [tenant]);
    await expect(run(runner)).rejects.toThrow("历史SUCCESS");
  });

  it("can really retry a legacy FAILED log when a retryable event is explicitly delivered", async () => {
    const [config] = await db.query("SELECT id FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key='execution-rollup'", [tenant]);
    await db.query(`INSERT INTO mps_sync_logs(tenant_id,sync_config_id,sync_key,run_type,status,started_at,idempotency_key,error_message,created_by,updated_by)
      VALUES($1,$2,'execution-rollup','EVENT','FAILED',clock_timestamp(),'fixture-key','legacy synthetic failure',$3,$3)`, [tenant, config.id, actor]);
    await event(); const execute = jest.fn(effect); await make(execute).processOutbox(tenant);
    expect(execute).toHaveBeenCalledTimes(1); expect((await state()).log).toMatchObject({ status: "SUCCESS", attempts: 1 });
  });

  it("does not reclaim a historical RUNNING log merely because its configuration looks idle", async () => {
    const [config] = await db.query("SELECT id FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key='execution-rollup'", [tenant]);
    await db.query(`INSERT INTO mps_sync_logs(tenant_id,sync_config_id,sync_key,run_type,status,started_at,idempotency_key,created_by,updated_by)
      VALUES($1,$2,'execution-rollup','EVENT','RUNNING',clock_timestamp()-interval '2 days','fixture-key',$3,$3)`, [tenant, config.id, actor]);
    const before = await state(); await expect(run(make())).rejects.toThrow("历史RUNNING");
    expect((await state()).log).toEqual(before.log); expect((await state()).config).toEqual(before.config);
  });

  it("cannot turn an unverified SUCCESS return into a successful outbox acknowledgement", async () => {
    await event(); const runner = make();
    jest.spyOn(runner, "run").mockResolvedValue({ syncKey: "execution-rollup", status: "SUCCESS", count: 1, repeated: false, metrics: null });
    await runner.processOutbox(tenant); expect((await state()).event.status).toBe("FAILED");
    expect((await state()).event.last_error).toContain("未经日志");
  });

  it("maintains tenant isolation even with identical idempotency keys", async () => {
    await event(); await event("fixture-key", "execution-rollup", "OTHER-TENANT"); await make().processOutbox(tenant);
    expect((await db.query("SELECT status FROM mps_reconciliation_outbox WHERE tenant_id='OTHER-TENANT'"))[0].status).toBe("PENDING");
  });

  it("retains the system consumer's cross-tenant crash recovery while scoping each write transaction", async () => {
    await db.query(`INSERT INTO mps_sync_configs(tenant_id,sync_key,name,created_by,updated_by)
      VALUES('OTHER-TENANT','execution-rollup','合成其它租户',$1,$1) ON CONFLICT DO NOTHING`, [actor]);
    await event(); await event("fixture-key", "execution-rollup", "OTHER-TENANT");
    await make().processAvailableTenants();
    const rows = await db.query("SELECT tenant_id,status FROM mps_sync_logs ORDER BY tenant_id");
    expect(rows).toEqual([{tenant_id:"OTHER-TENANT",status:"SUCCESS"},{tenant_id:tenant,status:"SUCCESS"}]);
    expect((await state()).effects).toBe(2);
  });

  it("preserves the 30-minute schedule and recovers only managed expired configurations", async () => {
    const runner = make(); await run(runner);
    expect((await runner.dueConfigurations(tenant)).some((r: any) => r.sync_key === "execution-rollup")).toBe(false);
    await db.query("UPDATE mps_sync_configs SET last_started_at=clock_timestamp()-interval '31 minutes' WHERE tenant_id=$1", [tenant]);
    expect((await runner.dueConfigurations(tenant)).some((r: any) => r.sync_key === "execution-rollup")).toBe(true);
    await db.query("UPDATE mps_sync_configs SET status='RUNNING',lease_expires_at=NULL WHERE tenant_id=$1", [tenant]);
    expect(await runner.dueConfigurations(tenant)).toEqual([]);
    await expect(run(runner)).rejects.toThrow("历史RUNNING");
  });

  it("rolls back business changes if success metadata or audit cannot commit", async () => {
    await db.query(`CREATE FUNCTION fixture_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='mps-sync.attempt_finished' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_audit_fail()`);
    try { await expect(run(make())).rejects.toThrow(); expect((await state()).effects).toBe(0); }
    finally { await db.query("DROP TRIGGER fixture_audit_fail ON audit_logs; DROP FUNCTION fixture_audit_fail()"); }
    await expire(); expect((await run(make())).status).toBe("SUCCESS"); expect((await state()).effects).toBe(1);
  });

  it("keeps the new metadata on application rollback instead of deleting lease evidence", async () => {
    await expect(new Leases().down()).rejects.toThrow("前向修复");
  });

  it("executes the actual base-to-weekly and rollup commands transactionally without duplicating plans or changing report facts", async () => {
    const base = (await db.query(`INSERT INTO mps_base_plans(tenant_id,division_id,order_number,item_code,item_name,delivery_number,
      planned_quantity,latest_customer_due_date,latest_review_due_date,product_attribute,surface_nature,manufacturing_method,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER','SYN-ITEM','合成品项',1,10,'2026-12-20','2026-12-01','五金','烤漆','自制',$3,$3) RETURNING id`, [tenant, division, actor]))[0];
    const service = new MasterPlanSyncService(db);
    await service.run(tenant, "base-to-weekly", "MANUAL", actor, "合成用户", "base-a");
    await service.run(tenant, "base-to-weekly", "MANUAL", actor, "合成用户", "base-b");
    const [week] = await db.query("SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2", [tenant, base.id]);
    expect((await db.query("SELECT count(*)::integer n FROM mps_weekly_plans WHERE tenant_id=$1", [tenant]))[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::integer n FROM mps_weekly_process_plans WHERE tenant_id=$1", [tenant]))[0].n).toBe(10);
    await db.query(`INSERT INTO mps_process_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,division_id,
      process_code,process_name,production_date,planned_quantity,production_quantity,created_by,updated_by)
      VALUES($1,$2,'SYN-ORDER','SYN-ITEM','合成品项',1,$3,'bending','折弯','2026-11-01',10,3,$4,$4)`, [tenant, week.id, division, actor]);
    const facts = await db.query("SELECT * FROM mps_process_reports WHERE tenant_id=$1", [tenant]);
    await service.run(tenant, "execution-rollup", "EVENT", actor, "合成用户", "rollup-fact", { weeklyPlanId: week.id, processCode: "bending" });
    expect(await db.query("SELECT * FROM mps_process_reports WHERE tenant_id=$1", [tenant])).toEqual(facts);
    expect((await db.query("SELECT process_config_locked_at FROM mps_weekly_plans WHERE id=$1", [week.id]))[0].process_config_locked_at).not.toBeNull();
  });

  it("preserves the real SQL failure and retries the actual plan generator without leaving partial plans", async () => {
    await db.query(`INSERT INTO mps_base_plans(tenant_id,division_id,order_number,item_code,delivery_number,
      planned_quantity,latest_customer_due_date,latest_review_due_date,product_attribute,surface_nature,manufacturing_method,created_by,updated_by)
      VALUES($1,$2,'SYN-FAIL','SYN-ITEM',1,10,'2026-12-20','2026-12-01','五金','烤漆','自制',$3,$3)`, [tenant, division, actor]);
    await db.query(`CREATE FUNCTION fixture_process_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='synthetic process constraint'; END $$;
      CREATE TRIGGER fixture_process_fail BEFORE INSERT ON mps_weekly_process_plans FOR EACH ROW EXECUTE FUNCTION fixture_process_fail()`);
    const service = new MasterPlanSyncService(db);
    try { await expect(service.run(tenant, "base-to-weekly", "MANUAL", actor, "合成用户", "actual-retry")).rejects.toMatchObject({ code: "23514" }); }
    finally { await db.query("DROP TRIGGER fixture_process_fail ON mps_weekly_process_plans; DROP FUNCTION fixture_process_fail()"); }
    expect((await db.query("SELECT count(*)::integer n FROM mps_weekly_plans WHERE tenant_id=$1", [tenant]))[0].n).toBe(0);
    expect((await db.query("SELECT error_message FROM mps_sync_logs WHERE idempotency_key='actual-retry'"))[0].error_message).toContain("23514");
    await service.run(tenant, "base-to-weekly", "MANUAL", actor, "合成用户", "actual-retry");
    expect((await db.query("SELECT status,attempts FROM mps_sync_logs WHERE idempotency_key='actual-retry'"))[0]).toMatchObject({ status: "SUCCESS", attempts: 2 });
    expect((await db.query("SELECT count(*)::integer n FROM mps_weekly_plans WHERE tenant_id=$1", [tenant]))[0].n).toBe(1);
  });
});
