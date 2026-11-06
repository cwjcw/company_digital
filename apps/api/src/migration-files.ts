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
