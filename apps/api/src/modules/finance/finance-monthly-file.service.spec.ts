import { financeAccessFingerprint, financeMonthlyFilename } from './finance-monthly-file.service';
import { NotificationService } from '../notifications/notification.service';
import { notificationEventDefinition } from '../notifications/notification-event.registry';

describe('Finance daily monthly attachment identity', () => {
  it.each([['2026-01','2026年1月接单统计-生管.xlsx'],['2026-10','2026年10月接单统计-生管.xlsx'],['2027-12','2027年12月接单统计-生管.xlsx']])('names the original report period %s', (period, filename) => {
    expect(financeMonthlyFilename(period)).toBe(filename);
  });
  it.each(['2026-00','2026-13','2026-1','2024-12','2101-01','../2026-10','2026-10\n'])('rejects invalid filename periods %s', period => {
    expect(() => financeMonthlyFilename(period)).toThrow();
  });
  it('fingerprints effective tenant/user permissions and scopes without depending on ordering', () => {
    const a={tenantId:'T',userId:'U',permissions:['read','export'],tableDataScopes:[{resource:'monthly',scope:'ALL',actions:['read']}],moduleAdminCodes:['finance']};
    expect(financeAccessFingerprint(a)).toBe(financeAccessFingerprint({...a,permissions:['export','read']}));
    for (const changed of [{...a,tenantId:'OTHER'},{...a,userId:'OTHER'},{...a,permissions:['read']},{...a,tableDataScopes:[]},{...a,moduleAdminCodes:[]}]) expect(financeAccessFingerprint(changed)).not.toBe(financeAccessFingerprint(a));
  });
  it('renders existing saved text configuration without rewriting it when attachments are added', () => {
    const service=new NotificationService({} as never),config={messageType:'text',template:'{yearMonth} {orderTotal}',recipientTargets:[{type:'USER',userId:'U'}]};
    const before=JSON.stringify(config);
    expect((service as any).renderContent({config},notificationEventDefinition('finance.monthly.daily_summary'),{yearMonth:'2026-10',orderTotal:'123.45'})).toBe('2026-10 123.45');
    expect(JSON.stringify(config)).toBe(before);
  });
});
