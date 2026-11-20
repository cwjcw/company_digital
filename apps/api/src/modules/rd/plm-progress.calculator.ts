import Decimal from 'decimal.js';
import type { PlmDashboard, PlmProject } from '@kdos/contracts';
type Obj = Record<string, unknown>;
const invalid = () => new Error('PLM_RESPONSE_INVALID');
function obj(value:unknown):Obj { if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Obj; }
function list(value:unknown):unknown[] {if(!Array.isArray(value))throw invalid();return value;}
function text(value:unknown,required=false):string|null {if(value==null||value===''){if(required)throw invalid();return null;}if(typeof value!=='string'||value.length>2000)throw invalid();return value;}
function number(value:unknown,max=Number.MAX_SAFE_INTEGER):number {if((typeof value!=='number'&&typeof value!=='string')||value==='')throw invalid();const n=Number(value);if(!Number.isFinite(n)||n<0||n>max)throw invalid();return n;}
function date(value:unknown):string|null {const s=text(value);if(s&&!/^\d{4}-\d{2}-\d{2}$/.test(s))throw invalid();return s;}
function count(value:unknown):number {const n=number(value);if(!Number.isSafeInteger(n))throw invalid();return n;}
/** Original ZIP aggregation, with strict structure validation before any snapshot write. */
export function calculatePlmDashboard(rawSummary:unknown,rawDetail:unknown):PlmDashboard {
 const s=obj(rawSummary),d=obj(rawDetail);
 if(s.success===false||d.success===false||s.error||d.error)throw invalid();
 const total=count(s.allPjNum),stages=list(s.datas).map(value=>{const r=obj(value);return {name:text(r.name,true)!,y:count(r.y)};});
 if(stages.reduce((sum,r)=>sum+r.y,0)!==total)throw invalid();
 const items=list(d.datas);if(items.length>10000||items.length>total)throw invalid();
 const tasks=new Map<string,number>(),managers=new Map<string,number>(),months=new Map<string,number>();
 const projects:PlmProject[]=items.map(value=>{
  const r=obj(value),milestones=r.mileStoneInfo==null?[]:list(r.mileStoneInfo).map(obj);let taskCount=0;
  for(const m of milestones) for(const task of m.taskProgress==null?[]:list(m.taskProgress)){
   taskCount++;const users=obj(task).pjTaskManagesUsers;
   const names=Array.isArray(users)?users:typeof users==='string'&&users.trim()?[users.trim()]:users==null||users===''?[]:(()=>{throw invalid();})();
   for(const name of names){const n=text(name,true)!;tasks.set(n,(tasks.get(n)??0)+1);}
  }
  const manager=text(r.pjMangerUsers_Format),start=date(r.pjStartDate);
  if(manager)managers.set(manager,(managers.get(manager)??0)+1);
  if(start)months.set(start.slice(0,7),(months.get(start.slice(0,7))??0)+1);
  return {no:text(r.pjNo,true)!,name:text(r.pjName,true)!,manager,start,end:date(r.pjEndDate),progress:number(r.pjProgress??0,100),health:text(r.roundColor),msRed:milestones.filter(m=>m.color==='red').length,msGreen:milestones.filter(m=>m.color==='green').length,msCount:milestones.length,taskCount};
 });
 const ranked=(map:Map<string,number>)=>[...map].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
 return {summary:{allPjNum:total,datas:stages},kpis:{total,detail:items.length,ms:projects.reduce((n,p)=>n+p.msCount,0),task:projects.reduce((n,p)=>n+p.taskCount,0),avgProgress:new Decimal((projects.reduce((sum,p)=>sum+p.progress,0)/Math.max(projects.length,1)).toPrecision(100)).toDecimalPlaces(1,Decimal.ROUND_HALF_EVEN).toNumber(),redProjects:projects.filter(p=>p.health==='red').length},projects,managers:ranked(managers),taskManagers:ranked(tasks).slice(0,10),startMonths:[...months].sort(([a],[b])=>a.localeCompare(b)).map(([month,count])=>({month,count}))};
}
