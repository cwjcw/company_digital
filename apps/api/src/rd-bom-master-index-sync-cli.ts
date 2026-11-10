import 'reflect-metadata';
import dataSource from './data-source';
import { RdBomMasterIndexSyncService } from './modules/rd/rd-bom-master-index-sync.service';

async function main() {
  const tenantId = process.env.RD_BOM_INDEX_TENANT_ID;
  if (!tenantId) throw new Error('RD_BOM_INDEX_TENANT_ID_REQUIRED');
  const mode = String(process.argv[2] ?? 'INCREMENTAL').toUpperCase();
  if (mode !== 'FULL' && mode !== 'INCREMENTAL') throw new Error('RD_BOM_SYNC_MODE_INVALID');
  await dataSource.initialize();
  try {
    const result = await new RdBomMasterIndexSyncService(dataSource).sync(tenantId, mode);
    // Only safe counters and versions are emitted; no source business rows.
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await dataSource.destroy(); }
}

if (require.main === module) main().catch(error => {
  const message = error instanceof Error ? error.message : 'RD_BOM_SYNC_FAILED';
  process.stderr.write(`${message.startsWith('RD_BOM_') ? message.slice(0,120) : 'RD_BOM_SYNC_FAILED'}\n`);
  process.exitCode = 1;
});
