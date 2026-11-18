import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import dataSource from './data-source';
import { MasterPlanLifecycleService, mpsLifecycleWritesEnabled } from './modules/master-plan-system/master-plan.lifecycle.service';
import { MASTER_PLAN_SYSTEM_USER_ID, MasterPlanSyncService } from './modules/master-plan-system/master-plan.sync.service';
import type { MasterPlanActor } from './modules/master-plan-system/master-plan.types';

type Candidate = { monthlyPlanId: string; monthlyVersion: number; basePlanId: string; baseVersion: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Controlled lifecycle restoration for reviewed legacy candidates. Input is
 * a JSON array on stdin; every row is re-previewed and confirmed by the
 * existing lifecycle Application Service. It never updates business tables
 * directly and safely resumes after partial completion.
 */
async function run() {
  const mode = process.argv[2];
  const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? 'KAINAN';
  const scanning = mode === '--scan-preview' || mode === '--scan-execute';
  const executing = mode === '--execute' || mode === '--scan-execute';
  if (!['--preview', '--execute', '--scan-preview', '--scan-execute'].includes(mode ?? '')) throw new Error('Use --preview/--execute with a reviewed manifest or --scan-preview/--scan-execute for the strict candidate query');
  if (executing && process.env.KDOS_MPS_TARGETED_RESTORE_ENABLED !== 'true')
    throw new Error('Refusing to execute without KDOS_MPS_TARGETED_RESTORE_ENABLED=true');
  if (executing && !mpsLifecycleWritesEnabled())
    throw new Error('Refusing to execute while KDOS_MPS_LIFECYCLE_WRITES_ENABLED is not true');
  // Preview only relaxes the in-process confirmation flag so the existing
  // lifecycle service can report business blockers. No confirm call is made.
  if (!executing) process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED = 'true';
  let candidates: Candidate[];
  if (scanning) candidates = [];
  else {
    let input = '';
    for await (const chunk of process.stdin) {
      input += String(chunk);
      if (input.length > 20_000_000) throw new Error('Candidate input exceeds 20 MB');
    }
    candidates = JSON.parse(input) as Candidate[];
  }
  if (!scanning && (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 10_000))
    throw new Error('Input must be an array containing 1..10000 reviewed candidates');
  const ids = candidates.flatMap(row => [row.monthlyPlanId, row.basePlanId]);
  if (candidates.some(row => !uuid.test(row.monthlyPlanId) || !uuid.test(row.basePlanId)
    || !Number.isInteger(row.monthlyVersion) || row.monthlyVersion < 1
    || !Number.isInteger(row.baseVersion) || row.baseVersion < 1)
    || new Set(ids).size !== ids.length) throw new Error('Candidate IDs or versions are invalid or duplicated');

  const db = dataSource;
  await db.initialize();
  try {
    const [service] = await db.query('SELECT username,enabled FROM users WHERE id=$1::uuid', [MASTER_PLAN_SYSTEM_USER_ID]);
    if (service?.username !== '__kdos_system__' || service.enabled !== false)
      throw new Error('KDOS internal lifecycle service identity is not ready');
    const [schema] = await db.query(`SELECT count(*)::int n FROM migrations WHERE timestamp IN (1722920120000,1722920122500)`);
    if (schema?.n !== 2) throw new Error('Lifecycle and service-auth migrations are not both applied');

    if (scanning) {
      candidates = await db.transaction(async manager => {
        await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        return manager.query(`WITH active_source AS (
          SELECT order_number,item_code,division_id,customer_code,sum(allocated_quantity) quantity,
            count(*) FILTER (WHERE id IS NOT NULL)::int source_count,
            count(*) FILTER (WHERE manually_maintained IS TRUE)::int stable_count
          FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL AND allocated_quantity>0
          GROUP BY order_number,item_code,division_id,customer_code
        )
        SELECT m.id AS "monthlyPlanId",m.version AS "monthlyVersion",b.id AS "basePlanId",b.version AS "baseVersion"
        FROM mps_monthly_plans m JOIN mps_base_plans b ON b.tenant_id=m.tenant_id AND b.monthly_plan_id=m.id
        JOIN mps_order_allocations anchor ON anchor.tenant_id=m.tenant_id AND anchor.id=m.allocation_id
        JOIN active_source source ON (source.order_number,source.item_code,source.division_id,source.customer_code)
          IS NOT DISTINCT FROM (m.order_number,m.item_code,m.division_id,m.customer_code)
        JOIN organization_units org ON org.id=m.division_id AND org.enabled=true
        WHERE m.tenant_id=$1 AND m.lifecycle_status='LEGACY_RETAINED' AND b.lifecycle_status='LEGACY_RETAINED'
          AND m.required_quantity>0 AND b.order_number=m.order_number AND b.item_code=m.item_code
          AND b.division_id=m.division_id AND b.planned_quantity=m.required_quantity
          AND anchor.archived_at IS NULL AND anchor.allocated_quantity>0 AND anchor.manually_maintained IS TRUE
          AND (anchor.order_number,anchor.item_code,anchor.division_id,anchor.customer_code)
            IS NOT DISTINCT FROM (m.order_number,m.item_code,m.division_id,m.customer_code)
          AND source.quantity=m.required_quantity AND source.stable_count=source.source_count
          AND NOT EXISTS(SELECT 1 FROM mps_order_allocations conflict_source WHERE conflict_source.tenant_id=m.tenant_id
            AND conflict_source.archived_at IS NULL AND conflict_source.allocated_quantity>0
            AND conflict_source.order_number=m.order_number AND conflict_source.item_code=m.item_code
            AND conflict_source.division_id=m.division_id AND conflict_source.customer_code IS DISTINCT FROM m.customer_code)
          AND NULLIF(btrim(b.latest_customer_due_date::text),'') IS NOT NULL
          AND NULLIF(btrim(b.latest_review_due_date::text),'') IS NOT NULL
          AND NULLIF(btrim(b.product_attribute::text),'') IS NOT NULL
          AND NULLIF(btrim(b.surface_nature::text),'') IS NOT NULL
          AND NULLIF(btrim(b.manufacturing_method::text),'') IS NOT NULL
          AND (b.manufacturing_method NOT IN ('自制','自制+外协') OR EXISTS(SELECT 1 FROM mps_division_process_configs process_config
            WHERE process_config.tenant_id=b.tenant_id AND process_config.division_id=b.division_id AND process_config.default_enabled=true))
          AND COALESCE(m.cumulative_inbound_quantity,0)=0
          AND NOT EXISTS(SELECT 1 FROM mps_weekly_plans w WHERE w.tenant_id=b.tenant_id AND w.base_plan_id=b.id)
          AND NOT EXISTS(SELECT 1 FROM erp_staging_raw_records r WHERE r.tenant_id=m.tenant_id AND r.item_code=m.item_code
            AND regexp_replace(btrim(r.order_number),'^2301-','')=regexp_replace(btrim(m.order_number),'^2301-','')
            AND r.record_type='INBOUND_LINE' AND r.source_table='ST_RDRecord_b')
        ORDER BY m.id`, [tenantId]);
      });
    }

    const actor: MasterPlanActor = { tenantId, userId: MASTER_PLAN_SYSTEM_USER_ID, username: '__kdos_system__',
      isSystemAdmin: true, permissions: ['*'], tableDataScopes: [], source: 'system', requestId: randomUUID() };
    const lifecycle = new MasterPlanLifecycleService(db);
    let previewed = 0, restoredMonthly = 0, restoredBase = 0, alreadyActive = 0, blocked = 0, weeklyBatches = 0;
    const reasons = new Map<string, number>();
    const sync = new MasterPlanSyncService(db);
    let readyBaseIds: string[] = [];
    const generateWeeklyBatch = async () => {
      if (!readyBaseIds.length || !executing) return;
      const selected = readyBaseIds;
      readyBaseIds = [];
      const signature = createHash('sha256').update(selected.join(',')).digest('hex').slice(0, 32);
      const result = await sync.run(tenantId, 'base-to-weekly', 'MANUAL', MASTER_PLAN_SYSTEM_USER_ID,
        'KDOS定向生命周期恢复', `legacy-weekly:${signature}`, { basePlanIds: selected });
      if (result.status !== 'SUCCESS') throw new Error(`Scoped base-to-weekly failed: ${result.status}`);
      weeklyBatches++;
    };
    for (const candidate of candidates) {
      const month = await lifecycle.preview('mps-monthly-plans', candidate.monthlyPlanId, 'RESTORE', actor);
      previewed++;
      if (month.currentStatus === 'ACTIVE') alreadyActive++;
      else if (!month.allowed) {
        blocked++;
        for (const reason of month.blockers) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        continue;
      }
      if (month.expectedVersion !== candidate.monthlyVersion && month.currentStatus === 'LEGACY_RETAINED')
        throw new Error(`Monthly plan ${candidate.monthlyPlanId} changed since review`);
      if (executing && month.currentStatus !== 'ACTIVE') {
        await lifecycle.confirm('mps-monthly-plans', candidate.monthlyPlanId, {
          operation: 'RESTORE', expectedVersion: month.expectedVersion, reason: '有效订单分配来源唯一、数量一致的历史计划安全恢复',
          idempotencyKey: randomUUID(), previewToken: month.previewToken
        }, actor);
        restoredMonthly++;
      }

      const base = await lifecycle.preview('mps-base-plans', candidate.basePlanId, 'RESTORE', { ...actor, requestId: randomUUID() });
      previewed++;
      if (base.currentStatus === 'ACTIVE') alreadyActive++;
      else if (!base.allowed) {
        blocked++;
        for (const reason of base.blockers) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        continue;
      }
      if (base.expectedVersion !== candidate.baseVersion && base.currentStatus === 'LEGACY_RETAINED')
        throw new Error(`Base plan ${candidate.basePlanId} changed since review`);
      if (executing && base.currentStatus !== 'ACTIVE') {
        await lifecycle.confirm('mps-base-plans', candidate.basePlanId, {
          operation: 'RESTORE', expectedVersion: base.expectedVersion, reason: '唯一有效月度来源及订单分配已通过生命周期复核',
          idempotencyKey: randomUUID(), previewToken: base.previewToken
        }, { ...actor, requestId: randomUUID() });
        restoredBase++;
      }
      if (base.currentStatus === 'ACTIVE' || (executing && base.allowed)) readyBaseIds.push(candidate.basePlanId);
      if (readyBaseIds.length >= 25) await generateWeeklyBatch();
      if ((previewed / 2) % 100 === 0) console.log(JSON.stringify({ progress: previewed / 2, total: candidates.length, restoredMonthly, restoredBase, blocked, weeklyBatches }));
    }
    await generateWeeklyBatch();
    console.log(JSON.stringify({ mode, tenantId, candidates: candidates.length, previewed, restoredMonthly, restoredBase, alreadyActive, blocked, weeklyBatches,
      blockers: Object.fromEntries(reasons) }, null, 2));
    if (executing && blocked > 0) process.exitCode = 2;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) run().catch(error => {
  console.error(error instanceof Error ? error.message : 'Legacy plan restoration failed');
  process.exitCode = 1;
});
