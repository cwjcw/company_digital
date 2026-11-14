import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditedDemandIdentityTransferMigrationFiles, discoverMigrationFiles, unifiedCoreMigrationFiles, phaseAMigrationFiles, syncMaintenanceMigrationFiles, reviewDueIndependenceMigrationFiles, rdBomReportMigrationFiles, rdBomMasterIndexMigrationFiles } from './migration-files';

describe('TypeORM migration implementation discovery', () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kdos-migration-discovery-')); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });
  it('excludes tests, declarations, maps, helpers and directories while preserving numeric order', () => {
    const names = ['1722920119000-MpsExecutionFactProtection.ts', '1722920118000-MpsSyncLeases.ts',
      '1722920117000-UserTablePreferences.spec.ts', '1722920117000-UserTablePreferences.test.js',
      '1722920118000-MpsSyncLeases.d.ts', '1722920118000-MpsSyncLeases.js.map', 'helper.ts', 'README.md'];
    for (const name of names) fs.writeFileSync(path.join(directory, name), 'throw new Error("must not load helpers or tests")');
    fs.mkdirSync(path.join(directory, '1722920120000-MpsPlanLifecycle.ts'));
    expect(discoverMigrationFiles(directory).map(file => path.basename(file))).toEqual([
      '1722920118000-MpsSyncLeases.ts', '1722920119000-MpsExecutionFactProtection.ts'
    ]);
  });
  it('selects one implementation when a build directory contains both source and compiled files', () => {
    for (const extension of ['.js', '.ts']) fs.writeFileSync(path.join(directory, '1722920118000-MpsSyncLeases' + extension), '');
    expect(discoverMigrationFiles(directory)).toHaveLength(1);
  });
  it('phase A excludes120 and121 even if both are pending',()=>{expect(phaseAMigrationFiles(path.join(__dirname,'migrations')).map(f=>path.basename(f).slice(0,13))).toEqual(['1722920118000','1722920119000']);});
  it('keeps all existing real migrations including the independent demand-link migration discoverable without running them', () => {
    const files = discoverMigrationFiles(path.join(__dirname, 'migrations'));
    expect(files).toHaveLength(129);
    expect(files.every(file => !file.includes('.spec.'))).toBe(true);
    expect(files.some(file => file.includes('1722920127000-RdBomMasterIndex'))).toBe(true);
    expect(files.some(file => file.includes('1722920128000-MpsAuditedDemandIdentityTransfer'))).toBe(true);
    expect(reviewDueIndependenceMigrationFiles(path.join(__dirname, 'migrations'))).toHaveLength(1);
    expect(rdBomReportMigrationFiles(path.join(__dirname, 'migrations'))).toHaveLength(1);
    expect(rdBomMasterIndexMigrationFiles(path.join(__dirname, 'migrations'))).toHaveLength(1);
    expect(auditedDemandIdentityTransferMigrationFiles(path.join(__dirname, 'migrations')).map(file => path.basename(file))).toEqual(['1722920128000-MpsAuditedDemandIdentityTransfer.ts']);
  });
});

it('unified release excludes120 and includes only121/122',()=>{expect(unifiedCoreMigrationFiles(path.join(__dirname,'migrations')).map(f=>path.basename(f).slice(0,13))).toEqual(['1722920121000','1722920122000']);});

it('performance release selects exactly123 and leaves both earlier strict lists unchanged',()=>{
  const dir=path.join(__dirname,'migrations');
  expect(syncMaintenanceMigrationFiles(dir).map(f=>path.basename(f).slice(0,13))).toEqual(['1722920123000']);
  expect(reviewDueIndependenceMigrationFiles(dir).map(f=>path.basename(f).slice(0,13))).toEqual(['1722920124000']);
  expect(phaseAMigrationFiles(dir)).toHaveLength(2);expect(unifiedCoreMigrationFiles(dir)).toHaveLength(2);
});
