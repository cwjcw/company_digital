import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AbnormalOrderReader } from '../../integrations/abnormal-orders/abnormal-order.reader';
import { NotificationService } from '../notifications/notification.service';
import { abnormalExpenseCategorySeeds } from '@kdos/contracts';
import { abnormalOrderSources, mergeOrderSources, normalizeOrderSource } from './abnormal-order.domain';

@Injectable()
export class AbnormalOrderSyncService {
 constructor(private readonly db:DataSource,private readonly reader:AbnormalOrderReader,private readonly notifications:NotificationService){}
 async reportInterrupted(tenant:string){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tenant))throw Error('ABNORMAL_ORDER_TENANT_INVALID');
  const r=this.db.createQueryRunner();await r.connect();let locked=false;
  try{
   await r.query("SELECT set_config('app.tenant_id',$1,false)",[tenant]);
   locked=(await r.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[`abnormal-order:${tenant}`]))[0].locked;
   if(!locked)throw Error('ABNORMAL_ORDER_ALREADY_RUNNING');
   await r.startTransaction();
   try{
    const rows=await r.query("SELECT id FROM abnormal_cost_order_sync_runs WHERE tenant_id=$1 AND status='RUNNING' FOR UPDATE",[tenant]);
    for(const row of rows){
     await r.query("UPDATE abnormal_cost_order_sync_runs SET status='FAILED',finished_at=now(),error_code='ABNORMAL_ORDER_INTERRUPTED' WHERE tenant_id=$1 AND id=$2",[tenant,row.id]);
     const [last]=await r.query("SELECT finished_at FROM abnormal_cost_order_sync_runs WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY finished_at DESC LIMIT 1",[tenant]);
     await this.notifications.enqueueEvent(tenant,{eventType:'erp.sync.failed',channel:'WECHAT_WORK',dedupKey:`abnormal-order-failure:${row.id}`,payload:{sourceName:'三个ERP',syncTask:'异常费用独立订单每日差异同步',failedAt:new Date().toISOString(),failedPhase:'超时/进程中断',errorReason:'ABNORMAL_ORDER_INTERRUPTED（旧快照保留）',lastSuccessfulAt:last?.finished_at??'无成功记录',runId:row.id},createdBy:null},r.manager);
    }
    await r.commitTransaction();return {interrupted:rows.length};
   }catch(e){await r.rollbackTransaction();throw e;}
  }finally{try{if(locked)await r.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`abnormal-order:${tenant}`]);}finally{await r.query('RESET app.tenant_id').catch(()=>undefined);await r.release();}}
 }
 async sync(tenant:string){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tenant))throw Error('ABNORMAL_ORDER_TENANT_INVALID');
  const r=this.db.createQueryRunner();await r.connect();let locked=false,runId:string|undefined;
  const results:Array<Record<string,unknown>>=[];
  try{
   await r.query("SELECT set_config('app.tenant_id',$1,false)",[tenant]);
   locked=(await r.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[`abnormal-order:${tenant}`]))[0].locked;
   if(!locked)throw Error('ABNORMAL_ORDER_ALREADY_RUNNING');
   await r.query("UPDATE abnormal_cost_order_sync_runs SET status='FAILED',finished_at=now(),error_code='ABNORMAL_ORDER_INTERRUPTED' WHERE tenant_id=$1 AND status='RUNNING'",[tenant]);
   runId=(await r.query("INSERT INTO abnormal_cost_order_sync_runs(tenant_id,status) VALUES($1,'RUNNING') RETURNING id",[tenant]))[0].id;
   const sources:ReturnType<typeof normalizeOrderSource>[]=[];
   for(const source of abnormalOrderSources){
    try{const normalized=normalizeOrderSource(source,await this.reader.read(source));sources.push(normalized);const counts=Object.fromEntries(Object.entries(normalized).filter(([key])=>!['items','lines'].includes(key)));results.push({source,status:'SUCCESS',...counts});}
    catch(e){results.push({source,status:'FAILED',errorCode:e instanceof Error&&/^ABNORMAL_ORDER_[A-Z_]+$/.test(e.message)?e.message:'ABNORMAL_ORDER_SOURCE_FAILED'});}
    await r.query('UPDATE abnormal_cost_order_sync_runs SET sources=$3::jsonb WHERE tenant_id=$1 AND id=$2',[tenant,runId,JSON.stringify(results)]);
   }
   if(results.some(s=>s.status!=='SUCCESS'))throw Error('ABNORMAL_ORDER_SOURCE_FAILED');
   const merged=mergeOrderSources(sources);
   // A truly empty, verified source is accepted. All sources must have completed both passes.
   await r.startTransaction();
   try{
    // Serialize with request validation's share lock: no request can validate half a publication.
    await r.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`abnormal-order-publish:${tenant}`]);
    await r.query(`CREATE TEMP TABLE abnormal_order_stage(order_no text,item_code text,item_name text,required_quantity numeric(38,14),order_date date,customer_due_date date,source text,source_line_ids jsonb,conflicts jsonb,PRIMARY KEY(order_no,item_code)) ON COMMIT DROP`);
    for(let i=0;i<merged.items.length;i+=1000)await r.query(`INSERT INTO abnormal_order_stage SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(order_no text,item_code text,item_name text,required_quantity numeric(38,14),order_date date,customer_due_date date,source text,source_line_ids jsonb,conflicts jsonb)`,[JSON.stringify(merged.items.slice(i,i+1000))]);
    const differs=`(o.item_name,o.required_quantity,o.order_date,o.customer_due_date,o.source,o.source_line_ids,o.conflicts,o.is_active) IS DISTINCT FROM (s.item_name,s.required_quantity,s.order_date,s.customer_due_date,s.source,s.source_line_ids,s.conflicts,true)`;
    const [counts]=await r.query(`SELECT count(*) FILTER(WHERE o.id IS NULL)::int added,count(*) FILTER(WHERE o.id IS NOT NULL AND ${differs})::int updated,count(*) FILTER(WHERE o.id IS NOT NULL AND o.source<>s.source)::int sourceChanges FROM abnormal_order_stage s LEFT JOIN abnormal_cost_order_items o ON o.tenant_id=$1 AND o.order_no=s.order_no AND o.item_code=s.item_code`,[tenant]);
    const [inactive]=await r.query(`SELECT count(*)::int invalidated FROM abnormal_cost_order_items o WHERE o.tenant_id=$1 AND o.source<>'SYSTEM_FIXED' AND o.is_active AND NOT EXISTS(SELECT 1 FROM abnormal_order_stage s WHERE s.order_no=o.order_no AND s.item_code=o.item_code)`,[tenant]);
    await r.query(`INSERT INTO abnormal_cost_order_source_changes(tenant_id,item_id,batch_id,old_source,new_source) SELECT $1,o.id,$2::uuid,o.source,s.source FROM abnormal_order_stage s JOIN abnormal_cost_order_items o ON o.tenant_id=$1 AND o.order_no=s.order_no AND o.item_code=s.item_code WHERE o.source<>s.source AND o.source<>'SYSTEM_FIXED'`,[tenant,runId]);
    await r.query(`UPDATE abnormal_cost_order_items o SET item_name=s.item_name,required_quantity=s.required_quantity,order_date=s.order_date,customer_due_date=s.customer_due_date,source=s.source,source_line_ids=s.source_line_ids,conflicts=s.conflicts,is_active=true,deleted_at=NULL,sync_batch_id=$2::uuid,last_synced_at=now(),updated_at=now(),updated_by='abnormal-order-sync',version=o.version+1 FROM abnormal_order_stage s WHERE o.tenant_id=$1 AND o.order_no=s.order_no AND o.item_code=s.item_code AND o.source<>'SYSTEM_FIXED' AND ${differs}`,[tenant,runId]);
    await r.query(`INSERT INTO abnormal_cost_order_items(tenant_id,order_no,item_code,item_name,required_quantity,order_date,customer_due_date,source,source_line_ids,conflicts,sync_batch_id,last_synced_at) SELECT $1,s.*,$2::uuid,now() FROM abnormal_order_stage s ON CONFLICT(tenant_id,order_no,item_code) DO NOTHING`,[tenant,runId]);
    await r.query(`UPDATE abnormal_cost_order_items o SET is_active=false,deleted_at=now(),updated_at=now(),version=version+1,sync_batch_id=$2::uuid,last_synced_at=now() WHERE o.tenant_id=$1 AND o.source<>'SYSTEM_FIXED' AND o.is_active AND NOT EXISTS(SELECT 1 FROM abnormal_order_stage s WHERE s.order_no=o.order_no AND s.item_code=o.item_code)`,[tenant,runId]);
    await r.query(`UPDATE abnormal_cost_order_items SET sync_batch_id=$2::uuid,last_synced_at=now() WHERE tenant_id=$1 AND source<>'SYSTEM_FIXED' AND is_active`,[tenant,runId]);
    // Idempotent initialization never changes existing human-maintained category state.
    await r.query(`INSERT INTO abnormal_cost_order_items(tenant_id,order_no,item_code,item_name,required_quantity,order_date,customer_due_date,source) VALUES($1,'虚拟订单','虚拟品号','虚拟品名',0,'2026-01-01','2026-01-01','SYSTEM_FIXED') ON CONFLICT DO NOTHING`,[tenant]);
    await r.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`abnormal-basic:${tenant}:abnormal-expense-categories`]);
    for(const [major,sub] of abnormalExpenseCategorySeeds)await r.query('INSERT INTO abnormal_expense_categories(tenant_id,major_category,sub_category) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenant,major,sub]);
    await r.query('DELETE FROM abnormal_cost_order_source_lines WHERE tenant_id=$1',[tenant]);
    for(let s=0;s<sources.length;s++)for(let i=0;i<sources[s].lines.length;i+=1000)await r.query(`INSERT INTO abnormal_cost_order_source_lines SELECT $1,$2,x->>'source_line_id',x,$3::uuid FROM jsonb_array_elements($4::jsonb) x`,[tenant,abnormalOrderSources[s],runId,JSON.stringify(sources[s].lines.slice(i,i+1000))]);
    const metrics={...counts,...inactive,beforeDedup:merged.beforeDedup,crossConflicts:merged.crossConflicts,total:merged.items.length,validLines:sources.reduce((n,s)=>n+s.validLines,0),read:sources.reduce((n,s)=>n+s.read,0)};
    await r.query("UPDATE abnormal_cost_order_sync_runs SET status='SUCCESS',finished_at=now(),sources=$3::jsonb,metrics=$4::jsonb WHERE tenant_id=$1 AND id=$2::uuid",[tenant,runId,JSON.stringify(results),JSON.stringify(metrics)]);
    await r.query(`INSERT INTO audit_logs(tenant_id,resource,record_id,action,after_json,source,updated_by) VALUES($1,'abnormal-cost-orders',$2,'abnormal.orders.synchronized',$3::jsonb,'system','abnormal-order-sync')`,[tenant,runId,JSON.stringify(metrics)]);
    await r.commitTransaction();return {status:'SUCCESS',runId,sources:results,metrics};
   }catch(e){await r.rollbackTransaction();throw e;}
  }catch(e){
   if(runId){
    await r.query("UPDATE abnormal_cost_order_sync_runs SET status='FAILED',finished_at=now(),sources=$3::jsonb,error_code='ABNORMAL_ORDER_SYNC_FAILED' WHERE tenant_id=$1 AND id=$2::uuid",[tenant,runId,JSON.stringify(results)]);
    const [last]=await r.query("SELECT finished_at FROM abnormal_cost_order_sync_runs WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY finished_at DESC LIMIT 1",[tenant]);
    await this.notifications.enqueueEvent(tenant,{eventType:'erp.sync.failed',channel:'WECHAT_WORK',dedupKey:`abnormal-order-failure:${runId}`,payload:{sourceName:results.filter(s=>s.status==='FAILED').map(s=>s.source).join('、')||'三个ERP',syncTask:'异常费用独立订单每日差异同步',failedAt:new Date().toISOString(),failedPhase:'读取/校验/原子发布',errorReason:'ABNORMAL_ORDER_SYNC_FAILED（旧订单快照保留）',lastSuccessfulAt:last?.finished_at??'无成功记录',runId},createdBy:null});
   }
   throw Error(e instanceof Error&&e.message.startsWith('ABNORMAL_ORDER_')?e.message:'ABNORMAL_ORDER_SYNC_FAILED');
  }finally{try{if(locked)await r.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`abnormal-order:${tenant}`]);}finally{await r.query('RESET app.tenant_id').catch(()=>undefined);await r.release();}}
 }
}
