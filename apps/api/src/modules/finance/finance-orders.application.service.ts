import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import DecimalBase from 'decimal.js';
const Decimal=DecimalBase.clone({precision:40});
import { financeOrderFields, financeOrderMinimumDate } from '@kdos/contracts';
import { FinanceOrderReader } from '../../integrations/e10/finance-order.reader';
import { FinanceRepository } from './finance.repository';
import { AuditLog } from '../../entities';
import type { FinanceActor } from './finance.types';
import { orderAuthorize, orderField, orderScope } from './finance-orders.types';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateOrderPage(rows:unknown):Record<string,any>[] {
 if(!Array.isArray(rows)||rows.length>500)throw new BadRequestException('E10分页内容无效');
 const seen=new Set<string>();
 return rows.map(r=>{
  if(!r||typeof r!=='object'||!uuid.test(r.sourceOrderId)||!uuid.test(r.sourceLineId)||seen.has(r.sourceLineId))throw new BadRequestException('E10来源键无效或重复');seen.add(r.sourceLineId);
  // Header state is independent of the original delivery-schedule closeCode.
  // NULL/unknown codes retain their previous statistical treatment; only '1' is excluded by the shared view.
  if(!Object.prototype.hasOwnProperty.call(r,'headerCloseCode'))throw new BadRequestException('E10订单头结束状态缺失，请全量重新读取');
  if(r.headerCloseCode!==null&&(typeof r.headerCloseCode!=='string'||r.headerCloseCode.length>20))throw new BadRequestException('E10订单头结束状态无效');
  if(typeof r.hasSpecifiedCloseSchedule!=='boolean')throw new BadRequestException('E10品项指定结束状态缺失或无效，请全量重新读取');
  for(const f of financeOrderFields){
   if(!(f.key in r))throw new BadRequestException(`E10缺少字段：${f.label}`);
   const v=r[f.key];if(v===null)continue;
   if(f.type==='number'&&(typeof v!=='string'&&typeof v!=='number'||!new Decimal(v).isFinite()))throw new BadRequestException(`E10数值无效：${f.label}`);
   if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))throw new BadRequestException(`E10日期无效：${f.label}`);
   if(f.type==='boolean'&&typeof v!=='boolean')throw new BadRequestException('E10含税值无效');
   if(f.type==='text'&&(typeof v!=='string'||v.length>10000))throw new BadRequestException(`E10文本无效：${f.label}`);
  }
  if(!r.orderDate||r.orderDate<financeOrderMinimumDate||!r.customerCode||!r.orderNo||r.sequence==null||r.yearMonth!==r.orderDate.slice(0,7))throw new BadRequestException('E10订单日期/年月/客户/单号/序号无效');
  if(['localGross','localNet','localTax'].some(k=>r[k]===null)||!new Decimal(r.localNet).plus(r.localTax).equals(r.localGross))throw new BadRequestException('E10本币金额无法勾稽');
  r._issues=[...(Number(r.scheduleCount)<1?['交货计划缺失']:[]),...(r.closeCode==='冲突'?['结束码冲突']:[])];
  return r;
 });
}
@Injectable()
export class FinanceOrdersApplicationService implements OnModuleInit {
 constructor(private readonly repository:FinanceRepository,private readonly reader:FinanceOrderReader){}
 async onModuleInit(){
  // A process restart cannot silently leave an apparently running manual refresh.
  const tenant=process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN';
  await this.repository.transaction(tenant,m=>m.query("UPDATE finance_e10_runs SET status='FAILED',completed_at=now(),error_summary='服务重启中断；可重新刷新，已发布数据保留' WHERE tenant_id=$1 AND status='RUNNING'",[tenant]));
 }
 async refresh(actor:FinanceActor,input:Record<string,unknown>={}){
  if(Object.keys(input).some(k=>!["mode","resumeId"].includes(k))||input.mode&&!['FULL','INCREMENTAL'].includes(String(input.mode)))throw new BadRequestException("刷新模式无效");
  orderAuthorize(actor,'finance-e10-lines','update');orderAuthorize(actor,'finance-e10-lines');
  // Refresh changes a shared read model: partial scopes or hidden source fields cannot submit it.
  if(!actor.userId||orderScope(actor,'finance-e10-lines',[],'update')!=='1=1'||financeOrderFields.some(f=>!orderField(actor,'finance-e10-lines',f.key)))throw new ConflictException('刷新需要全部数据范围和完整源字段权限');
  const run=await this.repository.transaction(actor.tenantId,async m=>{
   await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`finance-e10:${actor.tenantId}`]);
   await m.query("UPDATE finance_e10_runs SET status='FAILED',completed_at=now(),error_summary='读取已超时中断；请继续或全量重试' WHERE tenant_id=$1 AND status='RUNNING' AND started_at<now()-interval '20 minutes'",[actor.tenantId]);
   if((await m.query("SELECT id FROM finance_e10_runs WHERE tenant_id=$1 AND status='RUNNING'",[actor.tenantId])).length)throw new ConflictException('E10数据正在刷新');
   const options:Record<string,unknown>={};const mode=String(input.mode??'FULL');
   if(mode==='INCREMENTAL'){
    const [last]=await m.query("SELECT source_summary FROM finance_e10_runs WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY completed_at DESC LIMIT 1",[actor.tenantId]);
    if(!last?.source_summary?.observedAt)throw new BadRequestException('请先全量读取初始化历史数据');options.since=last.source_summary.observedAt;
   }
   if(input.resumeId){
    if(!uuid.test(String(input.resumeId)))throw new BadRequestException('断点标识无效');
    const [old]=await m.query("SELECT * FROM finance_e10_runs WHERE tenant_id=$1 AND id=$2 AND status='FAILED' FOR UPDATE",[actor.tenantId,input.resumeId]);
    if(!old||!old.page_count)throw new BadRequestException('没有可恢复的分页数据');
    await m.query("UPDATE finance_e10_runs SET status='RUNNING',started_at=now(),completed_at=NULL,error_summary=NULL,actor_id=$3 WHERE tenant_id=$1 AND id=$2",[actor.tenantId,old.id,actor.userId]);
    return {id:old.id,options:{cursor:old.cursor,since:old.source_summary?.since,watermark:old.source_summary?.observedAt},pageNo:old.page_count};
   }
   const [r]=await m.query("INSERT INTO finance_e10_runs(tenant_id,status,actor_id,mode) VALUES($1,'RUNNING',$2,$3) RETURNING id",[actor.tenantId,actor.userId,mode]);
   Object.assign(r,{options,pageNo:0});
   await m.save(AuditLog,{tenantId:actor.tenantId,actorId:actor.userId,actorName:actor.username,resource:'finance-e10-lines',recordId:r.id,action:'finance.e10.refresh.started',requestId:actor.requestId,source:actor.source??'web',afterJson:{minimumOrderDate:financeOrderMinimumDate}});return r;
  });
  // Explicit user command only; no timer, scheduler, or worker polling is introduced.
  void this.execute(run.id,actor,run.options,run.pageNo).catch(()=>undefined);
  return {id:run.id,status:'RUNNING'};
 }
 private async execute(id:string,actor:FinanceActor,options?:Record<string,unknown>,startPage=0){
  let source:Record<string,any>|undefined;let complete=false;let pageNo=startPage;let stage='EXTRACT';
  try{
   await this.reader.read(async page=>{
    if(page.kind==='source'){
     if(source||page.localCurrency!=='RMB'||typeof page.database!=='string'||!Array.isArray(page.coverage))throw new Error('E10来源摘要无效');source=page;if(options?.watermark)page.observedAt=options.watermark;
     await this.repository.transaction(actor.tenantId,m=>m.query('UPDATE finance_e10_runs SET source_summary=$3::jsonb WHERE tenant_id=$1 AND id=$2',[actor.tenantId,id,JSON.stringify(page)]));
    }else if(page.kind==='page'){
     if(!source||complete)throw new Error('E10读取顺序无效');const rows=validateOrderPage(page.rows);pageNo++;
     await this.repository.transaction(actor.tenantId,async m=>{
      await m.query('INSERT INTO finance_e10_pages(tenant_id,run_id,page,payload) VALUES($1,$2,$3,$4::jsonb)',[actor.tenantId,id,pageNo,JSON.stringify(rows)]);
      await m.query('UPDATE finance_e10_runs SET page_count=$3,line_count=line_count+$4,cursor=$5::jsonb WHERE tenant_id=$1 AND id=$2',[actor.tenantId,id,pageNo,rows.length,JSON.stringify(page.cursor)]);
     });
    }else if(page.kind==='complete'){complete=true;}else throw new Error('E10读取契约无效');
   },options);
   if(!source||!complete)throw new Error('E10读取未完成');
   stage='PUBLISH';await this.publish(id,source,actor);
  }catch(_error){await this.repository.transaction(actor.tenantId,async m=>{
   const summary=_error instanceof BadRequestException?_error.message:stage==='PUBLISH'?'E10发布对账失败；原数据保留，请全量重试或检查异常':'E10只读采集失败；原数据保留，请检查连接后继续读取';
   await m.query("UPDATE finance_e10_runs SET status='FAILED',completed_at=now(),error_summary=$3 WHERE tenant_id=$1 AND id=$2",[actor.tenantId,id,summary]);
   await m.save(AuditLog,{tenantId:actor.tenantId,actorId:actor.userId,actorName:actor.username,resource:'finance-e10-lines',recordId:id,action:'finance.e10.refresh.failed',requestId:actor.requestId,source:actor.source??'web',afterJson:{status:'FAILED'}});
  });}
 }
 private publish(id:string,source:Record<string,any>,actor:FinanceActor){return this.repository.transaction(actor.tenantId,async m=>{
  await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`finance-e10:${actor.tenantId}`]);
  // A pre-upgrade failed run can retain old pages even when resumed by the new adapter.
  // Never publish a partial header-state capture; retain the previous read model and require FULL.
  const [{invalidHeader}]=await m.query(`SELECT EXISTS(
   SELECT 1 FROM finance_e10_pages p CROSS JOIN LATERAL jsonb_array_elements(p.payload) x
   WHERE p.tenant_id=$1 AND p.run_id=$2 AND (NOT (x ? 'headerCloseCode')
    OR jsonb_typeof(x->'headerCloseCode') NOT IN ('string','null') OR length(x->>'headerCloseCode')>20
    OR NOT (x ? 'hasSpecifiedCloseSchedule') OR jsonb_typeof(x->'hasSpecifiedCloseSchedule')<>'boolean')
  ) AS "invalidHeader"`,[actor.tenantId,id]);
  if(invalidHeader)throw new BadRequestException('E10订单或品项结束状态缺失或无效，请全量重新读取');
  // Reconcile independent source totals before exposing any new page to readers.
  const rows=await m.query(`SELECT left(x->>'yearMonth',4)::integer AS "year",count(*)::integer lines,sum((x->>'localGross')::numeric)::text amount,count(DISTINCT x->>'sourceLineId')::integer unique_lines
   FROM finance_e10_pages p CROSS JOIN LATERAL jsonb_array_elements(p.payload) x WHERE tenant_id=$1 AND run_id=$2 GROUP BY 1`,[actor.tenantId,id]);
  if(rows.some((r:any)=>!source.coverage.some((cov:any)=>Number(cov.year)===r.year)))throw new Error("E10来源年度对账失败");
  for(const cov of source.coverage){const got=rows.find((r:any)=>r.year===cov.year);
   if(Number(cov.lines)>0&&(!got||got.lines!==Number(cov.lines)||got.lines!==got.unique_lines||!new Decimal(got.amount).equals(cov.localGross)))throw new Error('E10独立源对账失败');}
  const [{count}]=await m.query(`WITH previous AS MATERIALIZED (
 SELECT l.source_line_id,l.payload FROM finance_e10_lines l WHERE l.tenant_id=$1 AND l.source_database=$3), changed AS (
   INSERT INTO finance_e10_lines(tenant_id,source_database,source_order_id,source_line_id,payload,source_modified_at,last_run_id,created_by,updated_by)
   SELECT $1,$3,(x->>'sourceOrderId')::uuid,(x->>'sourceLineId')::uuid,x,GREATEST(x->>'headerModifiedAt',x->>'lineModifiedAt',x->>'scheduleModifiedAt'),$2,$4,$4
   FROM finance_e10_pages p CROSS JOIN LATERAL jsonb_array_elements(p.payload) x WHERE p.tenant_id=$1 AND p.run_id=$2
   ON CONFLICT(tenant_id,source_database,source_line_id) DO UPDATE SET source_order_id=EXCLUDED.source_order_id,payload=EXCLUDED.payload,source_modified_at=EXCLUDED.source_modified_at,last_run_id=EXCLUDED.last_run_id,source_missing=false,
    updated_by=EXCLUDED.updated_by,updated_at=now(),version=finance_e10_lines.version+1
   WHERE finance_e10_lines.payload IS DISTINCT FROM EXCLUDED.payload OR finance_e10_lines.source_missing
   RETURNING id,source_line_id,version,payload)
   , audited AS (INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source)
    SELECT $1,$4,$5,'finance-e10-lines',c.id,'finance.e10.line.updated',p.payload,c.payload||jsonb_build_object('runId',$2::text,'version',c.version),$6,$7 FROM changed c LEFT JOIN previous p ON p.source_line_id=c.source_line_id RETURNING id)
   SELECT count(*)::integer count FROM audited`,[actor.tenantId,id,source.database,actor.userId,actor.username,actor.requestId,actor.source??'web']);
  // Unchanged replays keep business versions/audits unchanged; only observation metadata advances.
  await m.query(`UPDATE finance_e10_lines l SET last_run_id=$2,source_missing=false WHERE l.tenant_id=$1 AND l.source_database=$3 AND EXISTS(
   SELECT 1 FROM finance_e10_pages p CROSS JOIN LATERAL jsonb_array_elements(p.payload) x WHERE p.tenant_id=$1 AND p.run_id=$2 AND (x->>'sourceLineId')::uuid=l.source_line_id)`,[actor.tenantId,id,source.database]);
  if(source.mode!=='INCREMENTAL') await m.query(`WITH missing AS(UPDATE finance_e10_lines SET source_missing=true,version=version+1,updated_at=now(),updated_by=$4 WHERE tenant_id=$1 AND source_database=$3 AND last_run_id<>$2 AND NOT source_missing RETURNING id)
   INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source)
   SELECT $1,$4,$5,'finance-e10-lines',id,'finance.e10.source.missing','{"sourceMissing":false}'::jsonb,'{"sourceMissing":true}'::jsonb,$6,$7 FROM missing`,[actor.tenantId,id,source.database,actor.userId,actor.username,actor.requestId,actor.source??'web']);
  await m.query("UPDATE finance_e10_runs SET status='SUCCESS',completed_at=now(),changed_count=$3 WHERE tenant_id=$1 AND id=$2",[actor.tenantId,id,count]);
  await m.save(AuditLog,{tenantId:actor.tenantId,actorId:actor.userId,actorName:actor.username,resource:'finance-e10-lines',recordId:id,action:'finance.e10.refresh.completed',requestId:actor.requestId,source:actor.source??'web',afterJson:{changedCount:count,pages:rows.reduce((n:number,r:any)=>n+r.lines,0)}});
  // Pages are no longer needed after publish; durable cursor, counts, source totals and audits remain.
  await m.query('DELETE FROM finance_e10_pages WHERE tenant_id=$1 AND run_id=$2',[actor.tenantId,id]);
 });}
}
