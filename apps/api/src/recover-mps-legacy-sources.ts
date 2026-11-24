import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import dataSource from './data-source';
import { MasterPlanSyncService } from './modules/master-plan-system/master-plan.sync.service';

async function run() {
  const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? 'KAINAN';
  const batchId = process.argv[2] ?? randomUUID();
  const maxPages = Number(process.argv[3] ?? 500);
  const db = dataSource;
  await db.initialize();
  try {
    const result = await new MasterPlanSyncService(db).recoverVerifiedLegacyHistory(tenantId, batchId, maxPages);
    console.log(JSON.stringify(result, null, 2));
    if (result.maxPagesReached || result.outboxProcessed !== result.outboxSucceeded || result.pendingRecoveryEvents > 0) process.exitCode = 2;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) run().catch(error => {
  console.error(error instanceof Error ? error.message : 'MPS historical source recovery failed');
  process.exitCode = 1;
});
