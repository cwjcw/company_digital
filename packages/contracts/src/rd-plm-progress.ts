import type { TablePermissionFieldDefinition } from './index';
export const plmProgressResource = 'rd-plm-project-progress';
export const plmProjectColumns = [
  ['health','状态'],['no','项目编号'],['name','项目名称'],['manager','项目经理'],
  ['start','开始日期'],['end','结束日期'],['progress','进度'],['msRed','红色里程碑'],
  ['msGreen','绿色里程碑'],['msCount','里程碑总数'],['taskCount','任务数']
] as const;
export type PlmProject = { no:string;name:string;manager:string|null;start:string|null;end:string|null;progress:number;health:string|null;msRed:number;msGreen:number;msCount:number;taskCount:number };
export type PlmDashboard = {
 summary:{allPjNum:number;datas:Array<{name:string;y:number}>};
 kpis:{total:number;detail:number;ms:number;task:number;avgProgress:number;redProjects:number};
 projects:PlmProject[];managers:Array<{name:string;count:number}>;taskManagers:Array<{name:string;count:number}>;startMonths:Array<{month:string;count:number}>;
};
export type PlmProgressResponse = {
 source:'A1-PLM';snapshotId:string|null;lastSuccessAt:string|null;lastAttemptAt:string|null;lastResult:'NOT_INITIALIZED'|'RUNNING'|'SUCCESS'|'FAILED';
 stale:boolean;errorCode:string|null;visibleFields:string[];data:(Partial<Omit<PlmDashboard,'projects'>>&{projects:Array<Partial<PlmProject>>})|null;
};
export const plmProgressFields:TablePermissionFieldDefinition[] = [
 ...plmProjectColumns.map(([key,label])=>({key,label,type:(['progress','msRed','msGreen','msCount','taskCount'].includes(key)?'number':['start','end'].includes(key)?'date':'text') as TablePermissionFieldDefinition['type'],editable:false,filterable:false})),
 {key:'overview',label:'汇总指标与分布图表',type:'structured',editable:false,filterable:false}
];
