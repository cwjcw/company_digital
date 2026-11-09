import { MpsAllocationCustomerDueDate1722920125000 } from '../../migrations/1722920125000-MpsAllocationCustomerDueDate';
import { rdBomReportMigrationFiles } from '../../migration-files';
import path from 'node:path';

describe('order allocation customer due date migration', () => {
  it('selects only migration 125 for the production migration entrypoint', () => {
    expect(rdBomReportMigrationFiles(path.resolve(__dirname, '../../migrations')).map(file => path.basename(file))).toEqual([
      '1722920125000-MpsAllocationCustomerDueDate.ts'
    ]);
  });

  it('adds only an empty nullable date column and never imports ERP values', async () => {
    const queries: string[] = [];
    const migration = new MpsAllocationCustomerDueDate1722920125000();
    await migration.up({ query: async (sql: string) => { queries.push(sql); return []; } } as never);
    expect(queries.join('\n')).toContain('ADD COLUMN customer_due_date date NULL');
    expect(queries.join('\n')).not.toMatch(/UPDATE\s+mps_order_allocations|mps_erp_order_lines|SALES_ORDER_DOC/i);
  });

  it('blocks destructive rollback that could discard manually maintained dates', async () => {
    await expect(new MpsAllocationCustomerDueDate1722920125000().down()).rejects.toThrow('may contain business values');
  });
});
