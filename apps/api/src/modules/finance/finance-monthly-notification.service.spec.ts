import { ForbiddenException } from '@nestjs/common';
import { FinanceMonthlyNotificationService } from './finance-monthly-notification.service';
import type { FinanceActor } from './finance.types';

const actor: FinanceActor = { tenantId: 'SYNTHETIC', userId: '0199e000-0000-7000-8000-000000000001', username: 'fixture', requestId: 'fixture', permissions: [], moduleAdminCodes: ['finance'] };
const instant = new Date('2026-10-20T00:30:00Z');
const fixture = () => {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT id FROM notification_rules')) return [{ id: 'rule-1' }];
    if (sql.includes('WITH selected')) return [{ order_count: 2, order_total: '123456.78', departments: [{ department: '业务一部', orders: 2, amount: '123456.78' }], last_read_at: '2026-10-20T00:07:00Z' }];
    return [];
  });
  const manager = { query }, repository = { transaction: jest.fn(async (_: string, work: (m: typeof manager) => unknown) => work(manager)) };
  const notifications = { enqueueEvent: jest.fn().mockResolvedValue({ created: true }) };
  return { query, manager, notifications, service: new FinanceMonthlyNotificationService(repository as never, notifications as never) };
};

describe('Finance monthly daily summary', () => {
  it('uses the Shanghai business month across UTC month boundaries and exact cents', async () => {
    const f=fixture(),payload=await f.service.preview(actor,new Date('2026-10-31T16:30:00Z'));
    expect(payload).toMatchObject({yearMonth:'2026-11',orderCount:'2',orderTotal:'123,456.78',occurredAt:'2026-11-01 00:30:00',lastReadAt:'2026-10-20 08:07:00'});
    expect(payload.departmentSummary).toBe('业务一部：2单 / 123,456.78元');
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('FROM finance_e10_order_monthly_movements'),['SYNTHETIC','2026-11']);
    expect(f.notifications.enqueueEvent).not.toHaveBeenCalled();
  });
  it('does not dispatch before 08:30 Shanghai time',async()=>{
    const f=fixture();expect(await f.service.dispatch(actor,new Date('2026-10-20T00:29:59Z'))).toMatchObject({skipped:'BEFORE_SCHEDULE',enqueued:0});expect(f.query).not.toHaveBeenCalled();
  });
  it('does not enqueue or compute financial data when rules are disabled or missing',async()=>{
    const f=fixture();f.query.mockImplementation(async()=>[]);
    expect(await f.service.dispatch(actor,instant)).toMatchObject({skipped:'NO_ENABLED_RULE',enqueued:0});
    expect(f.notifications.enqueueEvent).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes('WITH selected'))).toBe(false);
  });
  it('uses one tenant/day/rule key for concurrent and retry-safe transactional enqueue',async()=>{
    const f=fixture();expect(await f.service.dispatch(actor,instant)).toMatchObject({enqueued:1});
    expect(f.notifications.enqueueEvent).toHaveBeenCalledWith('SYNTHETIC',expect.objectContaining({ruleId:'rule-1',eventType:'finance.monthly.daily_summary',dedupKey:'finance-monthly-summary:rule-1:2026-10-20',channel:'WECHAT_WORK'}),f.manager);
    f.notifications.enqueueEvent.mockResolvedValue({created:false});expect(await f.service.dispatch(actor,instant)).toMatchObject({enqueued:0});
  });
  it('propagates enqueue failure so the enclosing command transaction can roll back',async()=>{
    const f=fixture();f.notifications.enqueueEvent.mockRejectedValue(new Error('synthetic failure'));
    await expect(f.service.dispatch(actor,instant)).rejects.toThrow('synthetic failure');
  });
  it('initializes a disabled audited rule without overwriting an existing rule',async()=>{
    const f=fixture();expect(await f.service.initialize(actor)).toMatchObject({created:false});
    expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
    f.query.mockImplementation(async(sql:string)=>sql.includes('INSERT INTO notification_rules')?[{id:'new-rule'}]:[]);
    expect(await f.service.initialize(actor)).toMatchObject({created:true});
    expect(f.query.mock.calls.some(([sql])=>sql.includes("'FIXED_USERS',false"))).toBe(true);
    expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO audit_logs'))).toBe(true);
  });
  it('rejects ordinary and unrelated module administrators',async()=>{
    const f=fixture(),unauthorized={...actor,moduleAdminCodes:['planning']};
    await expect(f.service.dispatch(unauthorized,instant)).rejects.toThrow(ForbiddenException);
    await expect(f.service.initialize(unauthorized)).rejects.toThrow(ForbiddenException);
    await expect(f.service.preview(unauthorized)).rejects.toThrow(ForbiddenException);
  });
});
