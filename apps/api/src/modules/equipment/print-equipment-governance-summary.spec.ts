import { dailySummary, DAILY_DIVISIONS } from './print-equipment-governance-summary';

describe('equipment daily adapter uses the unchanged dashboard', () => {
  const payload = () => ({ filters: { divisions: DAILY_DIVISIONS.map((name, i) => ({ id: `unit-${i}`, name: name.startsWith('事业') ? `凯南${name}` : name })) }, metrics: { firstBatchMonitoringEquipment: 123, runtimeMinutes: 111, plannedRuntimeMinutes: 120, faultMinutes: 9, utilizationRate: 88.8 }, divisionRows: [], operationsMonitoring: { yesterday: { filledEquipmentCount: 699 }, sevenDayTrend: { total: [] } } });
  it('selects all five stable IDs and seven explicit dates, preserves dashboard figures', async () => {
    const dashboard = jest.fn().mockResolvedValue(payload());
    const out = await dailySummary({ dashboard }, '2026-10-29', 'TENANT_TEST');
    expect(dashboard).toHaveBeenCalledTimes(8);
    expect(out.days.map(day => day.date)).toEqual(['2026-10-23','2026-10-24','2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29']);
    for (const [input, actor] of dashboard.mock.calls.slice(1)) {
      expect(input.periodType).toBe('day'); expect(actor.tenantId).toBe('TENANT_TEST');
      expect(actor.permissions).toEqual(['equipment-dashboard:*:read']);
      expect(actor.tableDataScopes[0].rules[0]).toEqual({ fieldKey:'divisionId', operator:'IN', value:['unit-0','unit-1','unit-2','unit-3','unit-4'] });
    }
    expect(out.days[6].metrics).toEqual(payload().metrics); expect(out.reporting).toEqual(payload().operationsMonitoring);
    expect(out).not.toHaveProperty('filters'); expect(out).not.toHaveProperty('equipmentRows');
  });
  it('rejects invalid date and ambiguous organization instead of widening scope', async () => {
    const data = payload(); data.filters.divisions.push({id:'another-unit',name:'事业一部'});
    const dashboard = jest.fn().mockResolvedValue(data);
    await expect(dailySummary({ dashboard }, '2026-02-30', 'T')).rejects.toThrow('有效');
    expect(dashboard).not.toHaveBeenCalled();
    await expect(dailySummary({ dashboard }, '2026-10-29', 'T')).rejects.toThrow('归属不明确');
    expect(dashboard).toHaveBeenCalledTimes(1);
  });
  it('missing units receive no guessed identity; errors propagate without fallback data', async () => {
    const data = payload(); data.filters.divisions = [];
    const dashboard = jest.fn().mockResolvedValue(data);
    const out = await dailySummary({ dashboard }, '2027-01-01', 'T');
    expect(out.startDate).toBe('2026-12-26'); expect(out.divisions).toEqual(DAILY_DIVISIONS);
    expect(dashboard.mock.calls[1][1].tableDataScopes[0].rules[0].value).toEqual([]);
    await expect(dailySummary({ dashboard: jest.fn().mockRejectedValue(new Error('query unavailable')) }, '2026-10-29', 'T')).rejects.toThrow('query unavailable');
  });
});
