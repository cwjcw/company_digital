import { FinanceE10SpecifiedItems1722920096000 } from '../../migrations/1722920096000-FinanceE10SpecifiedItems';
import { FinanceE10SpecifiedClose1722920095000 } from '../../migrations/1722920095000-FinanceE10SpecifiedClose';

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
