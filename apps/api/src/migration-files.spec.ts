import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverMigrationFiles, unifiedCoreMigrationFiles, phaseAMigrationFiles, demandLinkServiceMigrationFiles } from './migration-files';

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
  it('keeps the service repair immediately before a later performance migration without widening its allowlist',()=>{
    for(const name of ['1722920121000-MpsDemandLinks.ts','1722920122000-MpsReviewBatchApplications.ts','1722920122500-MpsDemandLinkServiceAuth.ts','1722920123000-MpsSyncMaintenance.ts'])fs.writeFileSync(path.join(directory,name),'');
    expect(discoverMigrationFiles(directory).map(file=>path.basename(file).slice(0,13))).toEqual(['1722920121000','1722920122000','1722920122500','1722920123000']);
    expect(demandLinkServiceMigrationFiles(directory).map(file=>path.basename(file).slice(0,13))).toEqual(['1722920122500']);
  });
  it('phase A excludes120 and121 even if both are pending',()=>{expect(phaseAMigrationFiles(path.join(__dirname,'migrations')).map(f=>path.basename(f).slice(0,13))).toEqual(['1722920118000','1722920119000']);});
  it('keeps all existing real migrations including the independent demand-link migration discoverable without running them', () => {
    const files = discoverMigrationFiles(path.join(__dirname, 'migrations'));
    expect(files).toHaveLength(123);
    expect(files.every(file => !file.includes('.spec.'))).toBe(true);
    expect(files.at(-1)).toContain('1722920122500-MpsDemandLinkServiceAuth');
  });
});

it('unified release excludes120 and includes only121/122',()=>{expect(unifiedCoreMigrationFiles(path.join(__dirname,'migrations')).map(f=>path.basename(f).slice(0,13))).toEqual(['1722920121000','1722920122000']);});
it('selects only the demand-link service authorization migration between122 and123',()=>{expect(demandLinkServiceMigrationFiles(path.join(__dirname,'migrations')).map(f=>path.basename(f).slice(0,13))).toEqual(['1722920122500']);});
