import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import dataSource from './data-source';
import { standardProcesses } from '@tracker/shared';
import { MasterPlanApplicationService } from './modules/master-plan-system/master-plan.application.service';
import { MASTER_PLAN_SYSTEM_USER_ID, MasterPlanSyncService } from './modules/master-plan-system/master-plan.sync.service';
import type { MasterPlanActor } from './modules/master-plan-system/master-plan.types';

type SnapshotProcess = { process_code: string; process_name: string; sequence: number; cycle_days: number | null; execution_enabled: boolean };
type DivisionRoute = { divisionId: string; divisionName: string; weeklySnapshots: number; repeatedSnapshots: number; processes: SnapshotProcess[] };
type SnapshotRow = { division_id: string; division_name: string; weekly_plan_id: string } & SnapshotProcess;

export function inferRoutes(rows: SnapshotRow[]) {
  const weekly = new Map<string, { divisionId: string; divisionName: string; processes: SnapshotProcess[] }>();
  for (const row of rows) {
    let group = weekly.get(row.weekly_plan_id);
    if (!group) {
      group = { divisionId: row.division_id, divisionName: row.division_name, processes: [] };
      weekly.set(row.weekly_plan_id, group);
    }
    group.processes.push({ process_code: row.process_code, process_name: row.process_name, sequence: Number(row.sequence),
      cycle_days: row.cycle_days == null ? null : Number(row.cycle_days), execution_enabled: row.execution_enabled });
  }
  const byDivision = new Map<string, Array<{ divisionName: string; processes: SnapshotProcess[] }>>();
  for (const route of weekly.values()) {
    const list = byDivision.get(route.divisionId) ?? [];
    list.push({ divisionName: route.divisionName, processes: route.processes.sort((a, b) => a.sequence - b.sequence) });
    byDivision.set(route.divisionId, list);
  }
  const inferred: DivisionRoute[] = [];
  for (const [divisionId, snapshots] of byDivision) {
    const nonEmpty = snapshots.filter(snapshot => snapshot.processes.length > 0);
    if (!nonEmpty.length) continue;
    const first = nonEmpty[0]!.processes;
    const canonical = standardProcesses.map((process, index) => ({ process_code: process.code, process_name: process.name, sequence: process.order, cycle_days: first[index]?.cycle_days ?? null, execution_enabled: true }));
    const matchesCanonical = (processes: SnapshotProcess[]) => processes.length === standardProcesses.length
      && processes.every((process, index) => process.process_code === canonical[index]?.process_code
        && process.process_name === canonical[index]?.process_name && process.sequence === canonical[index]?.sequence
        && process.execution_enabled === true && process.cycle_days === canonical[index]?.cycle_days);
    if (!matchesCanonical(first) || nonEmpty.some(snapshot => !matchesCanonical(snapshot.processes))) continue;
    inferred.push({ divisionId, divisionName: nonEmpty[0]!.divisionName, weeklySnapshots: snapshots.length,
      repeatedSnapshots: nonEmpty.length, processes: canonical });
  }
  return inferred;
}

/** Restore only a missing division default route proven by identical historical weekly snapshots. */
async function run() {
  const mode = process.argv[2];
  const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? 'KAINAN';
  if (!['--preview', '--execute'].includes(mode ?? '')) throw new Error('Use --preview or --execute');
  const executing = mode === '--execute';
  if (executing && (process.env.KDOS_MPS_TARGETED_RESTORE_ENABLED !== 'true' || process.env.KDOS_MPS_ROUTE_RECOVERY_ENABLED !== 'true'))
    throw new Error('Refusing to execute without KDOS_MPS_TARGETED_RESTORE_ENABLED=true and KDOS_MPS_ROUTE_RECOVERY_ENABLED=true');
  const db = dataSource;
  await db.initialize();
  try {
    const [system] = await db.query('SELECT username,enabled FROM users WHERE id=$1::uuid', [MASTER_PLAN_SYSTEM_USER_ID]);
    if (system?.username !== '__kdos_system__' || system.enabled !== false) throw new Error('KDOS internal lifecycle service identity is not ready');
    const snapshots = await db.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      return manager.query(`SELECT weekly.division_id,org.name division_name,weekly.id weekly_plan_id,
        task.process_code,task.process_name,task.sequence,task.cycle_days,task.execution_enabled
        FROM mps_weekly_plans weekly JOIN organization_units org ON org.id=weekly.division_id AND org.enabled=true
        JOIN mps_weekly_process_plans task ON task.tenant_id=weekly.tenant_id AND task.weekly_plan_id=weekly.id
        WHERE weekly.tenant_id=$1
        ORDER BY weekly.division_id,weekly.id,task.sequence,task.process_code`, [tenantId]);
    });
    const candidates = inferRoutes(snapshots);
    const application = new MasterPlanApplicationService(db, new MasterPlanSyncService(db));
    const actor: MasterPlanActor = { tenantId, userId: MASTER_PLAN_SYSTEM_USER_ID, username: '__kdos_system__', isSystemAdmin: true,
      permissions: ['*'], tableDataScopes: [], source: 'system', requestId: randomUUID() };
    const result: Array<Record<string, unknown>> = [];
    for (const candidate of candidates) {
      let created = 0, existing = 0;
      for (const process of candidate.processes) {
        const [current] = await db.transaction(async manager => {
          await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
          return manager.query(`SELECT process_code,sequence,cycle_days,default_enabled FROM mps_division_process_configs
            WHERE tenant_id=$1 AND division_id=$2::uuid AND process_code=$3`, [tenantId, candidate.divisionId, process.process_code]);
        });
        if (current) {
          const currentDays = current.cycle_days == null ? null : Number(current.cycle_days);
          if (Number(current.sequence) !== process.sequence || currentDays !== process.cycle_days || current.default_enabled !== true)
            throw new Error(`Existing route config conflicts with historical evidence for ${candidate.divisionName}/${process.process_code}`);
          existing++;
          continue;
        }
        if (executing) await application.create('mps-division-process-configs', {
          divisionId: candidate.divisionId, processCode: process.process_code, defaultEnabled: true, sequence: process.sequence,
          ...(process.cycle_days == null ? {} : { cycleDays: process.cycle_days })
        }, { ...actor, requestId: randomUUID() });
        created++;
      }
      result.push({ divisionId: candidate.divisionId, divisionName: candidate.divisionName,
        historicalWeeklySnapshots: candidate.weeklySnapshots, consistentNonemptySnapshots: candidate.repeatedSnapshots,
        inferredProcessCount: candidate.processes.length, created, existing });
    }
    console.log(JSON.stringify({ mode, tenantId, candidates: result }, null, 2));
  } finally { await db.destroy(); }
}

if (require.main === module) run().catch(error => {
  console.error(error instanceof Error ? error.message : 'Historical route recovery failed');
  process.exitCode = 1;
});
