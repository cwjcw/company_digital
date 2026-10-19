import { BadRequestException,ConflictException,ForbiddenException,Injectable,OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FinanceMovementReader } from '../../integrations/e10/finance-movement.reader';
import { FinanceRepository } from './finance.repository';
import { FinanceOrdersApplicationService } from './finance-orders.application.service';
import { financeAdmin,FinanceActor } from './finance.types';
import { AuditLog } from '../../entities';
import { calculateMovements,MovementFact,MovementEvent,sourceTime } from './finance-movements.calculator';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class FinanceMovementsApplicationService implements OnModuleInit {
 constructor(private readonly repository:FinanceRepository,private readonly reader:FinanceMovementReader,private readonly orders:FinanceOrdersApplicationService){}
 async onModuleInit(){await this.repository.transaction(process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN',m=>m.query("UPDATE finance_e10_movement_runs SET status='FAILED',completed_at=now(),error_summary='服务重启中断，请重新读取；已发布台账保留' WHERE tenant_id=$1::varchar AND status='RUNNING'",[process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN']));}
 async refresh(a:FinanceActor,input:Record<string,unknown>={}){
  if(!financeAdmin(a)||!a.userId)throw new ForbiddenException('台账读取需要财务模块管理员权限');
  if(Object.keys(input).some(k=>k!=='mode')||input.mode&&!['FULL','INCREMENTAL'].includes(String(input.mode)))throw new BadRequestException('台账读取模式无效');
  const run=await this.repository.transaction(a.tenantId,async m=>{
   await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1::varchar,0))',[`finance-movements:${a.tenantId}`]);
   await m.query("UPDATE finance_e10_movement_runs SET status='FAILED',completed_at=now(),error_summary='读取超时，可安全重试' WHERE tenant_id=$1::varchar AND status='RUNNING' AND started_at<now()-interval '25 minutes'",[a.tenantId]);
   if((await m.query("SELECT id FROM finance_e10_movement_runs WHERE tenant_id=$1::varchar AND status='RUNNING'",[a.tenantId])).length)throw new ConflictException('变更台账正在读取');
   const [last]=await m.query("SELECT source_summary FROM finance_e10_movement_runs WHERE tenant_id=$1::varchar AND status='SUCCESS' ORDER BY completed_at DESC LIMIT 1",[a.tenantId]);
   const mode=last&&input.mode!=='FULL'?'INCREMENTAL':'FULL';
   const [r]=await m.query("INSERT INTO finance_e10_movement_runs(tenant_id,actor_id,status,mode) VALUES($1::varchar,$2,'RUNNING',$3) RETURNING id",[a.tenantId,a.userId,mode]);
   await m.save(AuditLog,{tenantId:a.tenantId,actorId:a.userId,actorName:a.username,resource:'finance-e10-changes',recordId:r.id,action:'finance.movements.started',source:a.source??'web',requestId:a.requestId,afterJson:{mode}});
   return {id:r.id,mode,since:mode==='INCREMENTAL'?last.source_summary.observedAt:undefined};
  });
  void this.execute(a,run).catch(()=>undefined);return {id:run.id,status:'RUNNING'};
 }
 private async execute(a:FinanceActor,run:{id:string;mode:string;since?:string}){
  let source:MovementFact|undefined,complete=false,page=0;
  try{
   // Reuse the unchanged production command for the current balance; no second 34-column algorithm.
   const [last]=await this.repository.query("SELECT id FROM finance_e10_runs WHERE tenant_id=$1::varchar AND status='SUCCESS' LIMIT 1",[a.tenantId]);
   const balance=await this.orders.refresh(a,{mode:last?'INCREMENTAL':'FULL'});
   for(let i=0;;i++){
    const [r]=await this.repository.query('SELECT status FROM finance_e10_runs WHERE tenant_id=$1::varchar AND id=$2',[a.tenantId,balance.id]);
    if(r?.status==='SUCCESS')break;if(r?.status==='FAILED'||i>4500)throw new Error('Balance refresh failed');
    await new Promise(resolve=>setTimeout(resolve,200));
   }
   await this.reader.read(async p=>{
    if(p.kind==='source'){
     if(source||p.localCurrency!=='RMB'||typeof p.database!=='string'||!sourceTime(p.observedAt))throw new Error('Source invalid');source=p;
    }else if(['state','change','log'].includes(p.kind)){
     if(!source||complete||!Array.isArray(p.rows)||p.rows.length>500)throw new Error('Page invalid');
     for(const r of p.rows)if(!r||!guid.test(r.sourceKey)||p.kind!=='log'&&(!guid.test(r.orderId)||!guid.test(r.lineId)))throw new Error('Identity invalid');
     await this.repository.transaction(a.tenantId,m=>m.query('INSERT INTO finance_e10_movement_pages(tenant_id,run_id,page,kind,payload) VALUES($1::varchar,$2,$3,$4,$5::jsonb)',[a.tenantId,run.id,++page,p.kind,JSON.stringify(p.rows)]));
    }else if(p.kind==='complete'){if(source&&sourceTime(p.observedAt))source.observationEndAt=p.observedAt;if(complete)throw new Error('Duplicate completion');complete=true;}else throw new Error('Protocol invalid');
   },{since:run.since});
   if(!source||!complete)throw new Error('Incomplete source stream');
   await this.publish(a,run.id,source);
  }catch{
   await this.repository.transaction(a.tenantId,async m=>{
    await m.query("UPDATE finance_e10_movement_runs SET status='FAILED',completed_at=now(),error_summary='E10台账读取失败，原台账保留，请检查数据源后重试' WHERE tenant_id=$1::varchar AND id=$2",[a.tenantId,run.id]);
    await m.save(AuditLog,{tenantId:a.tenantId,actorId:a.userId,actorName:a.username,resource:'finance-e10-changes',recordId:run.id,action:'finance.movements.failed',source:a.source??'web',requestId:a.requestId,afterJson:{status:'FAILED'}});
   });
  }
 }
 private publish(a:FinanceActor,id:string,source:MovementFact){return this.repository.transaction(a.tenantId,async m=>{
  await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1::varchar,0))',[`finance-movements:${a.tenantId}`]);
  const [running]=await m.query("SELECT id FROM finance_e10_movement_runs WHERE tenant_id=$1::varchar AND id=$2 AND status='RUNNING' FOR UPDATE",[a.tenantId,id]);if(!running)throw new Error('Run no longer active');
  const oldFacts=await m.query("SELECT f.kind,f.payload,f.observed_at,coalesce(r.source_summary->>'observationEndAt',f.observed_at) observed_until FROM finance_e10_movement_facts f JOIN finance_e10_movement_runs r ON r.tenant_id=f.tenant_id AND r.id=f.last_run_id WHERE f.tenant_id=$1::varchar AND f.source_database=$2",[a.tenantId,source.database]);
  const oldStates=oldFacts.filter((f:any)=>f.kind==='state').map((f:any)=>({...f.payload,_observedAt:f.observed_at,_observedUntil:f.observed_until}));
  const previous:MovementEvent[]=(await m.query("SELECT payload FROM finance_e10_change_events WHERE tenant_id=$1::varchar AND source_database=$2 AND active",[a.tenantId,source.database])).map((r:any)=>r.payload);
  const pages=await m.query('SELECT kind,payload FROM finance_e10_movement_pages WHERE tenant_id=$1::varchar AND run_id=$2 ORDER BY page',[a.tenantId,id]);
  const fresh:Record<string,MovementFact[]>={state:[],change:[],log:[]};for(const p of pages)fresh[p.kind].push(...p.payload);
  // A duplicated page/key must never silently overwrite another source record.
  for(const [kind,rr] of Object.entries(fresh)){const unique=new Map<string,MovementFact>();for(const f of rr){if(unique.has(f.sourceKey)&&hash(unique.get(f.sourceKey))!==hash(f))throw new Error('Conflicting fact key');unique.set(f.sourceKey,f);}fresh[kind]=[...unique.values()];}
  for(const kind of ['state','change','log']){
   for(let i=0;i<fresh[kind].length;i+=500){const rr=fresh[kind].slice(i,i+500).map(payload=>({key:payload.sourceKey,payload,hash:hash(payload)}));
    if(kind==='state')await m.query(`INSERT INTO finance_e10_movement_snapshots(tenant_id,source_database,source_line_id,run_id,payload,observed_at,created_by)
     SELECT $1::varchar,$2,(x->>'key')::uuid,$3,x->'payload',$4,$5 FROM jsonb_array_elements($6::jsonb) x
     WHERE NOT EXISTS(SELECT 1 FROM finance_e10_movement_facts f WHERE f.tenant_id=$1::varchar AND f.source_database=$2 AND f.kind='state' AND f.source_key=x->>'key' AND f.content_hash=x->>'hash')`,[a.tenantId,source.database,id,source.observedAt,a.userId,JSON.stringify(rr)]);
    await m.query(`INSERT INTO finance_e10_movement_facts(tenant_id,source_database,kind,source_key,payload,content_hash,observed_at,last_run_id,created_by,updated_by)
     SELECT $1::varchar,$2,$3,x->>'key',x->'payload',x->>'hash',$4,$5,$6,$6 FROM jsonb_array_elements($7::jsonb) x
     ON CONFLICT(tenant_id,source_database,kind,source_key) DO UPDATE SET payload=EXCLUDED.payload,content_hash=EXCLUDED.content_hash,observed_at=EXCLUDED.observed_at,last_run_id=EXCLUDED.last_run_id,
      updated_by=EXCLUDED.updated_by,updated_at=CASE WHEN finance_e10_movement_facts.content_hash<>EXCLUDED.content_hash THEN now() ELSE finance_e10_movement_facts.updated_at END,
      version=finance_e10_movement_facts.version+CASE WHEN finance_e10_movement_facts.content_hash<>EXCLUDED.content_hash THEN 1 ELSE 0 END`,[a.tenantId,source.database,kind,source.observedAt,id,a.userId,JSON.stringify(rr)]);
   }
  }
  const merged=(kind:string)=>{const all=new Map(oldFacts.filter((r:any)=>r.kind===kind).map((r:any)=>[r.payload.sourceKey,r.payload]));for(const f of fresh[kind])all.set(f.sourceKey,f);return [...all.values()] as MovementFact[];};
  const end=source.observationEndAt??source.observedAt;
  const events=calculateMovements(fresh.change,merged('log'),merged('state'),oldStates,previous,end.slice(0,7)===source.observedAt.slice(0,7)?end:undefined,id,source.observedAt);
  // Observed comparisons must only use states genuinely read in this run, not retained old rows.
  const freshKeys=new Set(fresh.state.map(f=>f.lineId));const final=events.filter(e=>e.timeBasis!=='OBSERVED'||freshKeys.has(e.lineId));
  let changed=0;
  for(let i=0;i<final.length;i+=300){const payload=final.slice(i,i+300).map(e=>({...e,hash:hash(e)}));
   const [count]=await m.query(`WITH previous AS MATERIALIZED(SELECT event_key,id,content_hash,evidence,change_amount,source_time FROM finance_e10_change_events WHERE tenant_id=$1::varchar AND source_database=$2),
    changed AS(INSERT INTO finance_e10_change_events(tenant_id,source_database,event_key,source_order_id,source_line_id,source_document_id,order_no,order_date,customer_code,item_code,change_no,effective_at,source_time,year_month,change_kind,time_basis,amount_before,amount_after,change_amount,raw_change,included,evidence,payload,content_hash,created_by,updated_by)
    SELECT $1::varchar,$2,x->>'eventKey',(x->>'orderId')::uuid,(x->>'lineId')::uuid,(x->>'documentId')::uuid,x->>'orderNo',(x->>'orderDate')::date,x->>'customerCode',x->>'itemCode',x->>'changeNo',
    (left(x->>'sourceTime',26)||'+08:00')::timestamptz,x->>'sourceTime',left(x->>'sourceTime',7),x->>'changeKind',x->>'timeBasis',(x->>'amountBefore')::numeric,(x->>'amountAfter')::numeric,(x->>'changeAmount')::numeric,(x->>'rawChange')::numeric,(x->>'included')::boolean,x->'evidence',x-'hash',x->>'hash',$3,$3
    FROM jsonb_array_elements($4::jsonb) x ON CONFLICT(tenant_id,source_database,event_key) DO UPDATE SET
    source_order_id=EXCLUDED.source_order_id,source_line_id=EXCLUDED.source_line_id,source_document_id=EXCLUDED.source_document_id,order_no=EXCLUDED.order_no,order_date=EXCLUDED.order_date,item_code=EXCLUDED.item_code,change_no=EXCLUDED.change_no,change_kind=EXCLUDED.change_kind,time_basis=EXCLUDED.time_basis,source_time=EXCLUDED.source_time,effective_at=EXCLUDED.effective_at,year_month=EXCLUDED.year_month,customer_code=EXCLUDED.customer_code,amount_before=EXCLUDED.amount_before,amount_after=EXCLUDED.amount_after,change_amount=EXCLUDED.change_amount,raw_change=EXCLUDED.raw_change,included=EXCLUDED.included,evidence=EXCLUDED.evidence,payload=EXCLUDED.payload,content_hash=EXCLUDED.content_hash,updated_by=EXCLUDED.updated_by,updated_at=now(),version=finance_e10_change_events.version+1
    WHERE finance_e10_change_events.content_hash<>EXCLUDED.content_hash RETURNING id,event_key,evidence,change_amount,source_time),
    audited AS(INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source)
    SELECT $1::varchar,$3,$5,'finance-e10-changes',c.id,'finance.movements.event.updated',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('evidence',p.evidence,'amount',p.change_amount,'time',p.source_time) END,
    jsonb_build_object('evidence',c.evidence,'amount',c.change_amount,'time',c.source_time),$6,$7 FROM changed c LEFT JOIN previous p ON p.event_key=c.event_key RETURNING id)
    SELECT count(*)::integer count FROM audited`,[a.tenantId,source.database,a.userId,JSON.stringify(payload),a.username,a.requestId,a.source??'web']);changed+=count.count;
  }
  await m.query("UPDATE finance_e10_movement_runs SET status='SUCCESS',completed_at=now(),source_summary=$3::jsonb,changed_count=$4 WHERE tenant_id=$1::varchar AND id=$2",[a.tenantId,id,JSON.stringify({database:source.database,observedAt:source.observedAt,observationEndAt:end,mode:source.mode,facts:Object.fromEntries(Object.entries(fresh).map(([k,v])=>[k,v.length]))}),changed]);
  await m.save(AuditLog,{tenantId:a.tenantId,actorId:a.userId,actorName:a.username,resource:'finance-e10-changes',recordId:id,action:'finance.movements.completed',source:a.source??'web',requestId:a.requestId,afterJson:{changedCount:changed}});
  await m.query('DELETE FROM finance_e10_movement_pages WHERE tenant_id=$1::varchar AND run_id=$2',[a.tenantId,id]);
 });}
}
