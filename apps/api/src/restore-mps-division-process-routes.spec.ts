import { standardProcesses } from '@tracker/shared';
import { inferRoutes } from './restore-mps-division-process-routes';

const snapshotRows = (weeklyPlanId: string, divisionId = 'SYN-DIVISION') => standardProcesses.map(process => ({
  division_id: divisionId, division_name: '合成事业部', weekly_plan_id: weeklyPlanId,
  process_code: process.code, process_name: process.name, sequence: process.order,
  cycle_days: null, execution_enabled: true
}));

describe('historical division process route inference', () => {
  it('accepts only the same complete canonical 10-process snapshot as evidence', () => {
    const routes = inferRoutes([...snapshotRows('WEEK-1'), ...snapshotRows('WEEK-2')]);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ divisionId: 'SYN-DIVISION', weeklySnapshots: 2, repeatedSnapshots: 2, processes: expect.any(Array) });
    expect(routes[0]!.processes.map(process => [process.process_code, process.sequence])).toEqual(standardProcesses.map(process => [process.code, process.order]));
  });

  it.each([
    ['partial route', snapshotRows('WEEK-1').slice(1)],
    ['different process order', snapshotRows('WEEK-1').map((row, index) => index === 2 ? { ...row, sequence: 99 } : row)],
    ['different process name', snapshotRows('WEEK-1').map((row, index) => index === 2 ? { ...row, process_name: '其他' } : row)],
    ['disabled process', snapshotRows('WEEK-1').map((row, index) => index === 2 ? { ...row, execution_enabled: false } : row)],
    ['inconsistent snapshots', [...snapshotRows('WEEK-1'), ...snapshotRows('WEEK-2').map((row, index) => index === 2 ? { ...row, cycle_days: 2 } : row)]]
  ])('refuses to infer from %s', (_name, rows) => {
    expect(inferRoutes(rows as ReturnType<typeof snapshotRows>)).toEqual([]);
  });
});
