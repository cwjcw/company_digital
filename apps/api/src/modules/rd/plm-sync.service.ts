import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlmClient,PlmFetchError } from '../../integrations/plm/plm.client';
import { calculatePlmDashboard } from './plm-progress.calculator';
@Injectable()
export class PlmSyncService {
 constructor(private readonly db:DataSource,private readonly client:PlmClient){}
 async sync(tenant:string){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tenant))throw new Error('PLM_TENANT_INVALID');
  const r=this.db.createQueryRunner();await r.connect();let locked=false,run:string|undefined;
  try{
   await r.query("SELECT set_config('app.tenant_id',$1,false)",[tenant]);
   const [lock]=await r.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked",['rd-plm:'+tenant]);
   if(!lock.locked)throw new PlmFetchError('PLM_SYNC_ALREADY_RUNNING');locked=true;
   await r.startTransaction();
   try{
    await r.query("UPDATE rd_plm_sync_runs SET status='FAILED',finished_at=now(),error_code='PLM_SYNC_INTERRUPTED' WHERE tenant_id=$1 AND status='RUNNING'",[tenant]);
    const [row]=await r.query("INSERT INTO rd_plm_sync_runs(tenant_id,status) VALUES($1,'RUNNING') RETURNING id::text",[tenant]);run=row.id;
    await r.query("INSERT INTO rd_plm_snapshot(tenant_id,last_status,last_started_at) VALUES($1,'RUNNING',now()) ON CONFLICT(tenant_id) DO UPDATE SET last_status='RUNNING',last_started_at=now(),last_error_code=NULL",[tenant]);
    await r.commitTransaction();
   }catch(e){await r.rollbackTransaction();throw e;}
   const raw=await this.client.fetchSnapshot(),dashboard=calculatePlmDashboard(raw.summary,raw.detail),k=dashboard.kpis;
   await r.startTransaction();
   try{
    await r.query("UPDATE rd_plm_snapshot SET snapshot_id=$2,raw_summary=$3::jsonb,raw_detail=$4::jsonb,dashboard=$5::jsonb,last_status='SUCCESS',last_success_at=now(),last_error_code=NULL WHERE tenant_id=$1",[tenant,run,JSON.stringify(raw.summary),JSON.stringify(raw.detail),JSON.stringify(dashboard)]);
    await r.query("UPDATE rd_plm_sync_runs SET status='SUCCESS',finished_at=now(),system_count=$3,detail_count=$4,milestone_count=$5,task_count=$6 WHERE tenant_id=$1 AND id=$2",[tenant,run,k.total,k.detail,k.ms,k.task]);
    await r.commitTransaction();
   }catch(e){await r.rollbackTransaction();throw e;}
   return {status:'SUCCESS' as const,source:'A1-PLM',snapshotId:run,interfaces:2,systemCount:k.total,detailCount:k.detail,milestoneCount:k.ms,taskCount:k.task};
  }catch(error){
   const code=error instanceof PlmFetchError?error.code:error instanceof Error&&error.message==='PLM_RESPONSE_INVALID'?'PLM_RESPONSE_INVALID':'PLM_SYNC_FAILED';
   if(run){await r.startTransaction();try{await r.query("UPDATE rd_plm_snapshot SET last_status='FAILED',last_error_code=$2 WHERE tenant_id=$1",[tenant,code]);await r.query("UPDATE rd_plm_sync_runs SET status='FAILED',finished_at=now(),error_code=$3 WHERE tenant_id=$1 AND id=$2",[tenant,run,code]);await r.commitTransaction();}catch{await r.rollbackTransaction();}}
   throw new PlmFetchError(code);
  }finally{try{if(locked)await r.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['rd-plm:'+tenant]);await r.query('RESET app.tenant_id');}finally{await r.release();}}
 }
}
