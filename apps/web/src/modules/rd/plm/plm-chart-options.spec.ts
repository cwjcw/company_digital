import {describe,it,expect} from 'vitest';
import type {PlmDashboard} from '@kdos/contracts';
import {oneScreenOptions,fullOptions} from './plm-chart-options';
const data:PlmDashboard={summary:{allPjNum:141,datas:[{name:'进行中',y:141}]},kpis:{total:141,detail:53,ms:172,task:1139,avgProgress:12,redProjects:50},projects:[0,20,40,60,80,100].map((progress,i)=>({no:String(i),name:'Example '+i,manager:'A',start:'2026-01-01',end:null,progress,health:'red',msRed:1,msGreen:2,msCount:3,taskCount:2})),managers:[{name:'A',count:6}],taskManagers:[{name:'A',count:12}],startMonths:[{month:'2026-01',count:6}]};
describe('ZIP chart semantics',()=>{
 it('keeps all eight charts in each view and keeps system stage totals separate from project detail',()=>{const overview=oneScreenOptions(data),full=fullOptions(data);expect(Object.keys(overview)).toHaveLength(8);expect(Object.keys(full)).toHaveLength(8);expect((overview['c-status']!.series as any)[0].data[0].value).toBe(141);expect((full['chart-status']!.series as any)[0].data[0].value).toBe(141);});
 it('preserves the supplied histogram boundaries and red/green sums',()=>{const options=oneScreenOptions(data);expect((options['c-hist']!.series as any)[0].data.map((d:any)=>d.value)).toEqual([1,1,1,1,2]);expect((options['c-msd']!.series as any)[0].data.map((d:any)=>d.value)).toEqual([6,12]);});
});
