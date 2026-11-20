import {BadRequestException,ForbiddenException,Injectable} from '@nestjs/common';
import {DataSource} from 'typeorm';
import {plmProgressFields,plmProgressResource,plmProjectColumns,type PlmDashboard,type PlmProgressResponse} from '@kdos/contracts';
import {canRd,type RdActor} from './rd.types';
export function plmFieldAllowed(actor:RdActor,key:string,action='read') {return actor.isSystemAdmin||actor.permissions.includes('*')||actor.moduleAdminCodes.includes('rd')||actor.permissions.includes(`${plmProgressResource}:*:${action}`)||actor.permissions.includes(`${plmProgressResource}:${key}:${action}`);}
export function assertPlmAccess(actor:RdActor,action='read'){
 if(!canRd(actor,plmProgressResource,action)&&!plmProgressFields.some(f=>plmFieldAllowed(actor,f.key,action)))throw new ForbiddenException('没有PLM项目进度访问权限');
 if(actor.isSystemAdmin||actor.permissions.includes('*')||actor.moduleAdminCodes.includes('rd'))return;
 if(!actor.tableDataScopes.some(s=>s.resource===plmProgressResource&&(!s.actions||s.actions.includes(action))&&['ALL','NONE'].includes(s.scope)))throw new ForbiddenException('PLM报表需要全量报表数据范围，项目未映射KDOS成员或部门');
}
@Injectable()
export class PlmProgressQueryService {
 constructor(private readonly db:DataSource){}
 async read(actor:RdActor):Promise<PlmProgressResponse>{
  assertPlmAccess(actor);
  const fields=plmProgressFields.filter(f=>plmFieldAllowed(actor,f.key)).map(f=>f.key);
  const rows=await this.db.transaction(async m=>{await m.query('SET TRANSACTION READ ONLY');await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);return m.query('SELECT snapshot_id::text,last_status,last_started_at,last_success_at,last_error_code,dashboard FROM rd_plm_snapshot WHERE tenant_id=$1',[actor.tenantId]);});
  const state=rows[0],raw=state?.dashboard as PlmDashboard|undefined;
  const data=raw?{
   ...(fields.includes('overview')?{summary:raw.summary,kpis:raw.kpis}:{}),
   projects:raw.projects.map(row=>Object.fromEntries(plmProjectColumns.filter(([key])=>fields.includes(key)).map(([key])=>[key,row[key]]))),
   ...(fields.includes('overview')&&fields.includes('manager')?{managers:raw.managers}:{}),
   ...(fields.includes('overview')&&fields.includes('taskCount')?{taskManagers:raw.taskManagers}:{}),
   ...(fields.includes('overview')&&fields.includes('start')?{startMonths:raw.startMonths}:{})
  }:null;
  return {source:'A1-PLM',snapshotId:state?.snapshot_id??null,lastSuccessAt:state?.last_success_at?.toISOString()??null,lastAttemptAt:state?.last_started_at?.toISOString()??null,lastResult:state?.last_status??'NOT_INITIALIZED',stale:!state?.last_success_at||Date.now()-state.last_success_at.getTime()>60*60000,errorCode:state?.last_error_code??(state?.last_status==='RUNNING'&&Date.now()-state.last_started_at?.getTime()>5*60000?'PLM_SYNC_INTERRUPTED':null),visibleFields:fields,data};
 }
 exportColumns(requested:unknown,actor:RdActor){
  assertPlmAccess(actor);assertPlmAccess(actor,'export');
  if(typeof requested!=='string'||!requested)throw new BadRequestException('请选择导出业务列');
  const keys=requested.split(',');if(keys.length>plmProjectColumns.length||new Set(keys).size!==keys.length||keys.some(k=>!plmProjectColumns.some(([key])=>key===k)))throw new BadRequestException('导出字段无效');
  return keys.map(key=>plmProjectColumns.find(([k])=>k===key)!).filter(([key])=>plmFieldAllowed(actor,key)&&plmFieldAllowed(actor,key,'export'));
 }
}
