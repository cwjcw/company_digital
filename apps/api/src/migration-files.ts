import fs from 'node:fs';
import path from 'node:path';

/** Both source CLI and compiled CLI load only timestamped migration implementations. */
export function discoverMigrationFiles(directory: string): string[] {
  const preferredExtension = path.extname(__filename) === '.ts' ? '.ts' : '.js';
  const implementations = new Map<string, string>();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{13}-[A-Za-z][A-Za-z0-9]*\.(?:ts|js)$/.test(entry.name)) continue;
    const extension = path.extname(entry.name);
    const stem = entry.name.slice(0, -extension.length);
    if (!implementations.has(stem) || extension === preferredExtension) implementations.set(stem, entry.name);
  }
  return [...implementations.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, name]) => path.join(directory, name));
}

/** Production phase A is an explicit two-file set, never all pending migrations. */
export function phaseAMigrationFiles(directory: string): string[] {
  const files=discoverMigrationFiles(directory).filter(file=>/(?:1722920118000-MpsSyncLeases|1722920119000-MpsExecutionFactProtection)\.(?:ts|js)$/.test(path.basename(file)));
  if(files.length!==2)throw new Error('Phase A requires exactly migration118 and119 implementations');
  return files;
}

/** Independent unified-ID release: exactly121+122, never pending lifecycle120. */
export function unifiedCoreMigrationFiles(directory:string):string[]{
 const files=discoverMigrationFiles(directory).filter(f=>/(?:1722920121000-MpsDemandLinks|1722920122000-MpsReviewBatchApplications)\.(?:ts|js)$/.test(path.basename(f)));
 if(files.length!==2)throw Error('Unified core requires exactly121 and122');return files;
}

/** Service-only first-link authorization repair. Never includes lifecycle120 or performance123. */
export function demandLinkServiceMigrationFiles(directory:string):string[]{
 const files=discoverMigrationFiles(directory).filter(f=>/1722920122500-MpsDemandLinkServiceAuth\.(?:ts|js)$/.test(path.basename(f)));
 if(files.length!==1)throw Error('Demand-link service authorization requires exactly migration1722920122500');return files;
}

/** Performance/schema maintenance release: exactly123. */
export function syncMaintenanceMigrationFiles(directory:string):string[]{
  const files=discoverMigrationFiles(directory).filter(f=>/1722920123000-MpsSyncMaintenance\.(?:ts|js)$/.test(path.basename(f)));
  if(files.length!==1)throw Error('Sync maintenance requires exactly123');
  return files;
}

/** Destructive review independence release: exactly124, never part of default pending selection. */
export function reviewDueIndependenceMigrationFiles(directory:string):string[]{
  const files=discoverMigrationFiles(directory).filter(f=>/1722920124000-MpsReviewDueDateIndependent\.(?:ts|js)$/.test(path.basename(f)));
  if(files.length!==1)throw Error('Review due independence requires exactly124');
  return files;
}

/** Additive R&D BOM report prerequisite; runs exactly 125 and never the general pending set. */
export function rdBomReportMigrationFiles(directory: string): string[] {
  const files = discoverMigrationFiles(directory).filter(file => /1722920125000-MpsAllocationCustomerDueDate\.(?:ts|js)$/.test(path.basename(file)));
  if (files.length !== 1) throw new Error('R&D BOM report requires exactly migration 125');
  return files;
}

/** E10 BOM index storage only; does not include general pending migrations. */
export function rdBomMasterIndexMigrationFiles(directory: string): string[] {
  const files = discoverMigrationFiles(directory).filter(file => /1722920127000-RdBomMasterIndex\.(?:ts|js)$/.test(path.basename(file)));
  if (files.length !== 1) throw new Error('R&D BOM master index requires exactly migration127');
  return files;
}

/** The audited demand-identity repair is an isolated one-migration release. */
export function auditedDemandIdentityTransferMigrationFiles(directory: string): string[] {
  const files = discoverMigrationFiles(directory).filter(file => /1722920128000-MpsAuditedDemandIdentityTransfer\.(?:ts|js)$/.test(path.basename(file)));
  if (files.length !== 1) throw new Error('Audited demand identity transfer requires exactly migration 128');
  return files;
}
