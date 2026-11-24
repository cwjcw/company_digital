import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import dataSource from './data-source';
import { MasterPlanSyncService } from './modules/master-plan-system/master-plan.sync.service';

async function run() {
  const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? 'KAINAN';
  const batchId = process.argv[2] ?? randomUUID();
  const maxPages = Number(process.argv[3] ?? 500);
  const pageSize = Number(process.argv[4] ?? 25);
  await dataSource.initialize();
  try {
    const result = await new MasterPlanSyncService(dataSource).reconcileWeeklyBusinessReadiness(tenantId, batchId, maxPages, pageSize);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'SUCCESS' || result.maxPagesReached) process.exitCode = 2;
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) run().catch(error => {
  console.error(error instanceof Error ? error.message : 'MPS weekly business-readiness reconciliation failed');
  process.exitCode = 1;
});
