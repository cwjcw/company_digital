import { FinanceE10SpecifiedItems1722920096000 } from '../../migrations/1722920096000-FinanceE10SpecifiedItems';
import { FinanceE10SpecifiedClose1722920095000 } from '../../migrations/1722920095000-FinanceE10SpecifiedClose';
import { FinanceE10SourcePresenceAndTimestamps1722920105000 } from '../../migrations/1722920105000-FinanceE10SourcePresenceAndTimestamps';

describe('Finance specified-close policy migration', () => {
  it('filters the shared order relation by exact header state and tenant/account/order identity, preserving old review rules', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new FinanceE10SpecifiedClose1722920095000().up({ query } as never);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('CREATE OR REPLACE VIEW finance_e10_monthly WITH(security_invoker=true)');
    for (const key of ['tenant_id', 'source_database', 'source_order_id']) expect(sql).toContain(`source.${key}=record.${key}`);
    expect(sql).toContain("source.payload->>'headerCloseCode'='1'");
    for (const condition of ['NOT record.conflict', 'NOT record.duplicate_sequence', 'NOT record.duplicate_order_no', 'record.missing_lines=0', 'record.issue_lines=0']) expect(sql).toContain(condition);
    expect(sql).not.toMatch(/approved|ApproveStatus|close_code|DELETE|UPDATE|DROP|finance_e10_raw/i);
  });
  it('rolls back only the view without changing retained source items or formal order aggregation', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new FinanceE10SpecifiedClose1722920095000().down({ query } as never);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain('SELECT record.* FROM finance_e10_orders_all record');
    expect(String(query.mock.calls[0][0])).not.toMatch(/headerCloseCode|DELETE|UPDATE|DROP/i);
  });
});

describe('Finance E10 source-presence and KDOS timestamp migration',()=>{
 it('keeps evidence while projecting only current source identities and persisted timestamps',async()=>{
  const query=jest.fn();await new FinanceE10SourcePresenceAndTimestamps1722920105000().up({query} as never);const sql=query.mock.calls.map(call=>String(call[0])).join('\n');
  expect(sql).toContain('CREATE TABLE finance_e10_presence_pages');
  expect(sql).toContain('FORCE ROW LEVEL SECURITY');
  expect(sql).toContain('HAVING count(*) FILTER(WHERE NOT source_missing)>0');
  expect(sql).toContain('FROM finance_e10_lines WHERE NOT source_missing GROUP BY');
  expect(sql).toContain('WHERE NOT item.source_missing');
  expect(sql).toContain('line.source_line_id=e.source_line_id AND NOT line.source_missing');
  expect(sql).toContain('e.included AND coalesce(q.eligible,false) AND line.id IS NOT NULL AS included');
  expect(sql).not.toContain('AND record.missing_lines=0');
  expect(sql).toContain('l.created_at,l.updated_at');
  expect(sql).toContain('min(leg.created_at) created_at,max(leg.updated_at) updated_at');
  expect(sql).toContain("(VALUES('createdAt'),('updatedAt'))");
  expect(sql).not.toMatch(/current_timestamp|\bnow\(\).*created_at/i);
 });
 it('does not offer a destructive rollback for retained financial evidence',async()=>{await expect(new FinanceE10SourcePresenceAndTimestamps1722920105000().down()).rejects.toThrow('Retain');});
});

describe('Finance specified-close item policy migration',()=>{
 it('recalculates the shared monthly view from retained stable source items without changing raw/review views',async()=>{
  const query=jest.fn().mockResolvedValue(undefined);
  await new FinanceE10SpecifiedItems1722920096000().up({query} as never);
  const sql=String(query.mock.calls[0][0]);
  expect(sql).toContain("item.close_code IS DISTINCT FROM '1'");
  expect(sql).toContain("source.payload->>'hasSpecifiedCloseSchedule'");
  expect(sql).toContain('sum(item.local_gross)::numeric(28,2) order_total');
  expect(sql).toContain('record.id,record.tenant_id');
  expect(sql).toContain("source.payload->>'headerCloseCode'='1'");
  expect(sql).toContain('retained.issue_lines=0');
  expect(sql).not.toMatch(/(?:UPDATE|DELETE|INSERT|DROP) /i);
  expect(sql).not.toContain('CREATE OR REPLACE VIEW finance_e10_orders_all');
 });
 it('down restores the previous header-only view without discarding retained source data',async()=>{
  const query=jest.fn().mockResolvedValue(undefined);
  await new FinanceE10SpecifiedItems1722920096000().down({query} as never);
  expect(String(query.mock.calls[0][0])).toContain("source.payload->>'headerCloseCode'='1'");
  expect(String(query.mock.calls[0][0])).not.toContain('hasSpecifiedCloseSchedule');
 });
});
