import { randomUUID } from 'node:crypto';
import { readMpsLifecycleAvailability } from './master-plan.lifecycle-availability';
import { MasterPlanLifecycleService } from './master-plan.lifecycle.service';
import type { MasterPlanActor } from './master-plan.types';

const actor: MasterPlanActor = { tenantId: 'SYN-AVAILABILITY', userId: '0199bd00-0000-7000-8000-000000000001', username: '合成管理员', isSystemAdmin: true, permissions: ['*'], tableDataScopes: [], source: 'web', requestId: 'synthetic' };
describe('lifecycle deployment availability', () => {
  const originalSecret = process.env.JWT_ACCESS_SECRET, originalGate = process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED;
  beforeEach(() => { process.env.JWT_ACCESS_SECRET = 'synthetic-capability-test'; delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED; });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = originalSecret;
    if (originalGate === undefined) delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED; else process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED = originalGate;
  });
  const catalog = (schemaReady: boolean, protectionReady = true) => ({ query: jest.fn(async () => [{ schema_ready: schemaReady, protection_ready: protectionReady }]) }) as never;
  it('keeps schema readiness separate from an enabled write flag, even for administrators', async () => {
    process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED = 'true';
    const result = await readMpsLifecycleAvailability(catalog(false), 'mps-weekly-plans');
    expect(result).toMatchObject({ schemaReady: false, serviceReady: true, writesEnabled: true, previewAvailable: false, historicalCorrectionAvailable: false });
    expect(Object.values(result.operations).every(op => !op.previewAvailable && !op.confirmEnabled)).toBe(true);
  });
  it('allows safe previews with full schema while leaving writes disabled', async () => {
    const result = await readMpsLifecycleAvailability(catalog(true), 'mps-weekly-plans');
    expect(result).toMatchObject({ schemaReady: true, serviceReady: true, writesEnabled: false, previewAvailable: true });
    expect(result.operations.CANCEL).toMatchObject({ writeSupported: true, confirmEnabled: false });
  });
  it.each(['protection', 'signing'])('keeps the service unavailable when %s is missing', async missing => {
    if (missing === 'signing') delete process.env.JWT_ACCESS_SECRET;
    expect(await readMpsLifecycleAvailability(catalog(true, missing !== 'protection'), 'mps-weekly-plans')).toMatchObject({ schemaReady: true, serviceReady: false, previewAvailable: false });
  });
  it('does not advertise unfinished parent cancellation as writable', async () => {
    process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED = 'true';
    const result = await readMpsLifecycleAvailability(catalog(true), 'mps-base-plans');
    expect(result.operations.CANCEL).toMatchObject({ previewAvailable: true, writeSupported: false, confirmEnabled: false });
    expect(result.operations.HOLD.confirmEnabled).toBe(true);
  });
  it('reports a capability probe failure as 503 without leaking database details', async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error('sensitive internal connection detail')) };
    await expect(readMpsLifecycleAvailability(db, 'mps-weekly-plans')).rejects.toMatchObject({ status: 503, message: '计划状态操作的服务检查暂不可用，请稍后重试' });
  });
  it.each(['HOLD', 'CANCEL', 'RESTORE', 'CANCEL_REMAINING'] as const)('rejects %s preview and confirmation before reading any plan on schema A', async operation => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT set_config')) return [];
      if (sql.startsWith('WITH plans')) return [{ schema_ready: false, protection_ready: true }];
      throw Error('A business query ran before the schema gate');
    });
    const db = { query, transaction: async (_isolation: string, work: (manager: { query: typeof query }) => Promise<unknown>) => work({ query }) };
    const service = new MasterPlanLifecycleService(db as never);
    const id = randomUUID();
    await expect(service.preview('mps-weekly-plans', id, operation, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.confirm('mps-weekly-plans', id, { operation, expectedVersion: 1, reason: '合成测试', idempotencyKey: randomUUID(), previewToken: 'synthetic' }, actor)).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT set_config') || sql.startsWith('WITH plans'))).toBe(true);
  });
});
