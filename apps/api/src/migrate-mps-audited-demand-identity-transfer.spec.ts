import { parseMigration128Args } from './migrate-mps-audited-demand-identity-transfer';

const base = ['--environment=isolated', '--expected-host=127.0.0.1', '--expected-database=four_department_tracker', '--migration=1722920128000'];

describe('Migration 128 strict runner contract', () => {
  it('requires one explicit mode and exactly migration 128', () => {
    expect(() => parseMigration128Args(base)).toThrow();
    expect(() => parseMigration128Args([...base, '--preflight', '--migration=1722920120000'])).toThrow();
    expect(() => parseMigration128Args([...base, '--preflight', '--execute'])).toThrow();
    expect(parseMigration128Args([...base, '--preflight']).migration).toBe('1722920128000');
  });

  it('requires exact production confirmation and rejects missing target details', () => {
    const production = base.filter(value => !value.startsWith('--environment='));
    expect(() => parseMigration128Args([...production, '--environment=production', '--execute'])).toThrow();
    expect(parseMigration128Args([...production, '--environment=production', '--execute', '--confirm=APPLY-MIGRATION-128-to-four_department_tracker']).mode).toBe('execute');
    expect(() => parseMigration128Args(['--environment=isolated', '--migration=1722920128000', '--preflight'])).toThrow();
  });
});
