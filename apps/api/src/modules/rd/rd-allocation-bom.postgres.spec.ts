import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RdBomMasterIndex1722920127000 } from '../../migrations/1722920127000-RdBomMasterIndex';
import { RdTplusBomIndex1722920135000 } from '../../migrations/1722920135000-RdTplusBomIndex';
import { RdAllocationBomTracking1722920138000 } from '../../migrations/1722920138000-RdAllocationBomTracking';
import { RdAllocationBomService, allocationBomGate } from './rd-allocation-bom.service';
import { UnifiedBomQueryService } from './unified-bom.query.service';
import { allocationBomWaiting } from './rd-allocation-bom-state';
const socket=process.env.RD_BOM_INDEX_TEST_SOCKET;
(socket?describe:describe.skip)('Allocation BOM isolated PG18 migration, observation and recovery',()=>{
 let db:DataSource,service:RdAllocationBomService,day:string;
 const tenant='TEST',division=randomUUID(),gen=randomUUID(),historical=randomUUID(),unknown=randomUUID(),late=randomUUID();
 const state=async(id:string)=>(await db.query('SELECT *,allocation_date::text allocation_date,latest_completed_date::text latest_completed_date FROM rd_allocation_bom_state WHERE tenant_id=$1 AND allocation_id=$2',[tenant,id]))[0];
 const history=async(id:string)=>db.query('SELECT * FROM rd_allocation_bom_history WHERE tenant_id=$1 AND allocation_id=$2 ORDER BY state_version',[tenant,id]);
 const ready=async()=>{await db.query("UPDATE rd_allocation_bom_state SET last_attempt_at=NULL WHERE tenant_id=$1",[tenant]);};
 const process=async()=>{await ready();return service.drain(tenant);};
 const add=async(code:string,assigned=true)=>{
  const id=randomUUID();await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,division_id,order_number,item_code,order_date,order_status) VALUES($1,$2,$3,'SAME-ORDER',$4,'2026-11-20','已审核')`,[id,tenant,assigned?division:null,code]);return id;
 };
 const valid=async(source:string,code:string,on=true)=>{
  if(source==='e10-main'){
   await db.query('DELETE FROM rd_bom_master_heads WHERE tenant_id=$1 AND item_code=$2',[tenant,code]);
   if(on)await db.query(`INSERT INTO rd_bom_master_heads(tenant_id,generation_id,source_bom_id,item_id,item_code,approve_status,approve_date) VALUES($1,$2,$3,$4,$5,'Y','2026-11-22')`,[tenant,gen,randomUUID(),randomUUID(),code]);
   await db.query("UPDATE rd_bom_sync_state SET last_status='SUCCESS',last_success_at=now() WHERE tenant_id=$1",[tenant]);
  }else{
   await db.query('DELETE FROM rd_tplus_bom_heads WHERE tenant_id=$1 AND source=$2 AND item_code=$3',[tenant,source,code]);
   if(on)await db.query(`INSERT INTO rd_tplus_bom_heads(tenant_id,source,source_database,generation_id,source_bom_id,item_code,voucher_state,disabled,is_default) VALUES($1,$2,'synthetic',$3,abs(hashtext($4)),$4,189,false,false)`,[tenant,source,gen,code]);
   await db.query("UPDATE rd_tplus_bom_sync_state SET last_status='SUCCESS',last_success_at=now() WHERE tenant_id=$1 AND source=$2",[tenant,source]);
  }
 };
 beforeAll(async()=>{
  if(!socket?.startsWith('/tmp/')||!socket.includes('rd-bom-waiting'))throw Error('Dedicated isolated socket required');
  const common={type:'postgres' as const,host:socket,username:'postgres',entities:[],logging:false as const};
  const admin=new DataSource({...common,database:'postgres'});await admin.initialize();
  try{await admin.query('DROP DATABASE IF EXISTS rd_allocation_bom_test WITH (FORCE)');await admin.query('CREATE DATABASE rd_allocation_bom_test');}finally{await admin.destroy();}
  db=new DataSource({...common,database:'rd_allocation_bom_test'});await db.initialize();
  await db.query(`CREATE TABLE mps_order_allocations(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,division_id uuid,
    order_number text,item_code text,order_date date,order_status text,archived_at timestamptz,
    allocated_quantity numeric,expected_shipping_date date,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz DEFAULT now(),
    UNIQUE(tenant_id,id));
    CREATE TABLE audit_logs(tenant_id varchar(64),resource text,record_id text,action text,before_json jsonb,after_json jsonb,created_at timestamptz DEFAULT now());`);
  for(const id of [historical,unknown,late])await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,division_id,order_number,item_code,order_date,order_status,created_at) VALUES($1,$2,$3,'OLD','OLD-Y','2026-11-20','已审核','2026-11-20T05:00:00Z')`,[id,tenant,division]);
  await db.query(`INSERT INTO audit_logs(tenant_id,resource,record_id,action,after_json)VALUES($1,'mps-order-allocations',$2,'mps-order-allocations.import_created',$3::jsonb)`,[tenant,historical,JSON.stringify({divisionId:division})]);
  await db.query(`INSERT INTO audit_logs(tenant_id,resource,record_id,action,before_json,after_json,created_at)VALUES($1,'mps-order-allocations',$2,'mps-order-allocations.updated','{"divisionId":null}',$3::jsonb,'2026-11-21T16:10:00Z')`,[tenant,late,JSON.stringify({divisionId:division})]);
  const r=db.createQueryRunner();await r.connect();await r.startTransaction();
  try{await new RdBomMasterIndex1722920127000().up(r);await new RdTplusBomIndex1722920135000().up(r);await new RdAllocationBomTracking1722920138000().up(r);await r.commitTransaction();}catch(e){await r.rollbackTransaction();throw e;}finally{await r.release();}
  await db.query(`INSERT INTO rd_bom_sync_state(tenant_id,active_generation,last_status,last_success_at)VALUES($1,$2,'SUCCESS',now())`,[tenant,gen]);
  for(const source of ['tplus-kejia','tplus-kainan'])await db.query(`INSERT INTO rd_tplus_bom_sync_state(tenant_id,source,source_database,active_generation,report_enabled,last_status,last_success_at)VALUES($1,$2,'synthetic',$3,true,'SUCCESS',now())`,[tenant,source,gen]);
  service=new RdAllocationBomService(db,new UnifiedBomQueryService(db));
  day=(await db.query("SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date::text business_day"))[0].business_day;
 },30000);
 afterAll(async()=>{if(db?.isInitialized)await db.destroy();});
 it('migrates populated legacy rows with trustworthy creation/assignment evidence, leaves unknown date blank',async()=>{
  expect(await state(historical)).toMatchObject({initial_capture_eligible:false,initial_bom_status:null,allocation_date:'2026-11-20'});
  expect((await state(late)).allocation_date).toBe('2026-11-22');expect((await state(unknown)).allocation_date).toBeNull();
 });
 it('inserts before explicit activation remain historical and activation is idempotent',async()=>{
  const gap=await add('GAP');expect((await state(gap)).initial_capture_eligible).toBe(false);
  const first=await service.activate(tenant),again=await service.activate(tenant);expect(again).toEqual(first);expect(first.historical_count).toBe(4);
 });
 it('legacy Y retains provable old value without fake completion; all legacy initial states remain blank',async()=>{
  await valid('e10-main','OLD-Y');await process();
  expect(await state(historical)).toMatchObject({current_bom_status:'Y',locked_waiting_days:2,waiting_basis:'LEGACY_ORDER_APPROVAL',initial_bom_status:null,first_completed_at:null,latest_completed_at:null});
  expect((await history(historical))[0].event_kind).toBe('HISTORICAL_BASELINE');
 });
 it('new first Y captures initial Y once and locks zero',async()=>{
  const id=await add('OLD-Y');await process();expect(await state(id)).toMatchObject({initial_capture_eligible:true,initial_bom_status:'Y',current_bom_status:'Y',locked_waiting_days:0,allocation_date:day});
  expect((await state(id)).first_completed_at).not.toBeNull();
 });
 let cycle:string,firstAt:Date,firstWait:number;
 it('new N dynamically waits from allocation day and two records of same order/code never share identity',async()=>{
  cycle=await add('CYCLE',false);const another=await add('CYCLE');
  await db.query("UPDATE rd_allocation_bom_state SET allocation_date=($3::date-5),allocation_date_basis='SYNTHETIC_TEST_EVIDENCE' WHERE tenant_id=$1 AND allocation_id=$2",[tenant,cycle,day]);
  await db.query('UPDATE mps_order_allocations SET division_id=$2 WHERE id=$1',[cycle,division]);
  await process();expect((await state(cycle)).initial_bom_status).toBe('N');
  expect(allocationBomWaiting(await state(cycle),day)).toBe(5);expect(allocationBomWaiting(await state(another),day)).toBe(0);
 });
 it('N to Y locks confirmation date and records source evidence',async()=>{
  await valid('tplus-kejia','CYCLE');await process();const s=await state(cycle);firstAt=s.first_completed_at;firstWait=s.first_completed_waiting_days;
  expect(s).toMatchObject({initial_bom_status:'N',current_bom_status:'Y',locked_waiting_days:5,first_completed_waiting_days:5,latest_completed_date:day});
  expect((await history(cycle)).at(-1).evidence.sources).toHaveLength(3);
 });
 it('continuous Y preserves lock, initial state, completion timestamp and history across version/approval/source changes',async()=>{
  const before=await state(cycle),count=(await history(cycle)).length;
  await valid('tplus-kainan','CYCLE');await valid('e10-main','CYCLE');await process();
  const after=await state(cycle);expect(after.first_completed_at).toEqual(before.first_completed_at);expect(after.latest_completed_at).toEqual(before.latest_completed_at);expect(after.locked_waiting_days).toBe(5);expect(await history(cycle)).toHaveLength(count);
 });
 it('removing one source leaves Y while another effective source exists',async()=>{
  await valid('tplus-kejia','CYCLE',false);await process();expect((await state(cycle)).current_bom_status).toBe('Y');
 });
 it.each(['FAILED','RUNNING','STALE','UNINITIALIZED'])('failure protection %s retains reliable Y and lock',async mode=>{
  await valid('tplus-kainan','CYCLE',false);await valid('e10-main','CYCLE',false);
  await db.query(`UPDATE rd_tplus_bom_sync_state SET last_status=$2,last_success_at=CASE WHEN $3 THEN now()-interval '40 hours' ELSE now() END,active_generation=CASE WHEN $4 THEN NULL ELSE $5::uuid END WHERE tenant_id=$1 AND source='tplus-kejia'`,[tenant,mode==='FAILED'?'FAILED':mode==='RUNNING'?'RUNNING':'SUCCESS',mode==='STALE',mode==='UNINITIALIZED',gen]);
  expect((await process()).deferred).toBe('SOURCE_NOT_RELIABLE');expect(await state(cycle)).toMatchObject({current_bom_status:'Y',locked_waiting_days:5,pending:true,last_error:'SOURCE_NOT_RELIABLE'});
 });
 it('a batch gate prevents observing serial source intermediate snapshots',async()=>{
  const gate=db.createQueryRunner();await gate.connect();
  try{await gate.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[allocationBomGate(tenant)]);expect((await service.processPending(tenant)).deferred).toBe('BATCH_IN_PROGRESS');}finally{await gate.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[allocationBomGate(tenant)]);await gate.release();}
 });
 it('successful recovery confirms real Y to N, retaining completion history and original-date dynamic wait',async()=>{
  await db.query("UPDATE rd_tplus_bom_sync_state SET active_generation=$2,last_status='SUCCESS',last_success_at=now() WHERE tenant_id=$1",[tenant,gen]);await process();
  expect(await state(cycle)).toMatchObject({current_bom_status:'N',initial_bom_status:'N',locked_waiting_days:5,first_completed_waiting_days:firstWait});expect((await state(cycle)).first_completed_at).toEqual(firstAt);expect(allocationBomWaiting(await state(cycle),day)).toBe(5);
 });
 it('another N to Y adds a completion round and never overwrites first completion',async()=>{
  await valid('tplus-kainan','CYCLE');await process();const s=await state(cycle);expect(s.current_bom_status).toBe('Y');expect(s.first_completed_at).toEqual(firstAt);expect(s.latest_completed_at.getTime()).toBeGreaterThanOrEqual(firstAt.getTime());
  expect((await history(cycle)).map((h:any)=>h.bom_status)).toEqual(['N','Y','N','Y']);
 });
 it('duplicate and concurrent consumers do not add history or relock',async()=>{
  const before=await state(cycle),n=(await history(cycle)).length;
  await db.query('UPDATE rd_allocation_bom_state SET pending=true,last_attempt_at=NULL WHERE allocation_id=$1',[cycle]);
  const results=await Promise.allSettled([service.processPending(tenant),service.processPending(tenant)]);
  expect(results.some(r=>r.status==='fulfilled')).toBe(true);expect(await history(cycle)).toHaveLength(n);expect((await state(cycle)).latest_completed_at).toEqual(before.latest_completed_at);
 });
 it('legacy N to Y keeps initial blank after modifications, source retries and process restart',async()=>{
  const gap=(await db.query("SELECT allocation_id FROM rd_allocation_bom_state s JOIN mps_order_allocations a ON a.id=s.allocation_id WHERE a.item_code='GAP'"))[0].allocation_id;
  await valid('e10-main','GAP');await db.query("UPDATE mps_order_allocations SET expected_shipping_date='2027-01-01',division_id=$2,allocated_quantity=123 WHERE id=$1",[gap,randomUUID()]);
  service=new RdAllocationBomService(db,new UnifiedBomQueryService(db));await process();expect(await state(gap)).toMatchObject({initial_bom_status:null,current_bom_status:'Y'});
  const [n]=await db.query('SELECT count(*)::int n FROM rd_allocation_bom_state WHERE NOT initial_capture_eligible AND initial_bom_status IS NOT NULL');expect(n.n).toBe(0);
 });
 it('initial capture failures stay pending with actual recovery time and delay',async()=>{
  await db.query("UPDATE rd_bom_sync_state SET last_status='FAILED' WHERE tenant_id=$1",[tenant]);const id=await add('DELAY');await process();expect(await state(id)).toMatchObject({initial_bom_status:null,pending:true,last_error:'SOURCE_NOT_RELIABLE'});
  await db.query("UPDATE rd_allocation_bom_state SET first_eligible_at=now()-interval '2 hours' WHERE allocation_id=$1",[id]);
  await valid('e10-main','DELAY');await process();const s=await state(id);expect(s.initial_bom_status).toBe('Y');expect(s.initial_capture_delay_seconds).toBeGreaterThanOrEqual(7200);expect(s.initial_bom_checked_at.getTime()).toBeGreaterThan(s.first_eligible_at.getTime());
 });
 it('one reliable positive source can capture Y even if a different source fails',async()=>{
  await valid('e10-main','POSITIVE');await db.query("UPDATE rd_tplus_bom_sync_state SET last_status='FAILED' WHERE tenant_id=$1 AND source='tplus-kejia'",[tenant]);
  const id=await add('POSITIVE');await process();expect(await state(id)).toMatchObject({initial_bom_status:'Y',current_bom_status:'Y',locked_waiting_days:0});
  await db.query("UPDATE rd_tplus_bom_sync_state SET last_status='SUCCESS',last_success_at=now() WHERE tenant_id=$1",[tenant]);
 });
 it('first actual assignment is persisted once; reassignment/quantity/due changes never reset it',async()=>{
  const id=await add('UNASSIGNED',false);expect((await state(id)).allocation_date).toBeNull();
  await db.query('UPDATE mps_order_allocations SET division_id=$2 WHERE id=$1',[id,division]);expect((await state(id)).allocation_date).toBe(day);
  await db.query("UPDATE mps_order_allocations SET division_id=$2,allocated_quantity=42,expected_shipping_date='2027-02-01' WHERE id=$1",[id,randomUUID()]);expect((await state(id)).allocation_date).toBe(day);
 });
 it('database guards reject immutable initial/date/first-history rewrites and cross-tenant associations',async()=>{
  await expect(db.query("UPDATE rd_allocation_bom_state SET initial_bom_status='Y' WHERE allocation_id=$1",[cycle])).rejects.toThrow('IMMUTABLE');
  await expect(db.query("UPDATE rd_allocation_bom_state SET first_completed_at=now()+interval '1 day' WHERE allocation_id=$1",[cycle])).rejects.toThrow('IMMUTABLE');
  await expect(db.query("UPDATE rd_allocation_bom_state SET allocation_date=allocation_date+1 WHERE allocation_id=$1",[cycle])).rejects.toThrow('IMMUTABLE');
  await expect(db.query("INSERT INTO rd_allocation_bom_state(tenant_id,allocation_id)VALUES('OTHER',$1)",[cycle])).rejects.toThrow();
  await expect(db.query("UPDATE rd_allocation_bom_state SET initial_bom_status='Y' WHERE allocation_id=$1",[historical])).rejects.toThrow();
 });
 it('applies all three required migrations to an empty isolated schema',async()=>{
  const r=db.createQueryRunner();await r.connect();await r.startTransaction();
  try{
   await r.query('CREATE SCHEMA empty_migration');await r.query('SET LOCAL search_path=empty_migration,public');
   await r.query('CREATE TABLE empty_migration.mps_order_allocations (LIKE public.mps_order_allocations INCLUDING ALL)');
   await r.query('CREATE TABLE empty_migration.audit_logs (LIKE public.audit_logs INCLUDING ALL)');
   await new RdBomMasterIndex1722920127000().up(r);await new RdTplusBomIndex1722920135000().up(r);await new RdAllocationBomTracking1722920138000().up(r);
   expect((await r.query('SELECT count(*)::int n FROM empty_migration.rd_allocation_bom_state'))[0].n).toBe(0);
  } finally {await r.rollbackTransaction();await r.release();}
 });
 it('RLS isolates tenant state/history/capture and migration is forward-only',async()=>{
  await db.query('DROP ROLE IF EXISTS rd_allocation_bom_rls');await db.query('CREATE ROLE rd_allocation_bom_rls');await db.query('GRANT SELECT ON rd_allocation_bom_state,rd_allocation_bom_history,rd_allocation_bom_capture TO rd_allocation_bom_rls');
  const r=db.createQueryRunner();await r.connect();await r.startTransaction();
  try{await r.query('SET LOCAL ROLE rd_allocation_bom_rls');await r.query("SELECT set_config('app.tenant_id','OTHER',true)");for(const t of ['state','history','capture'])expect((await r.query(`SELECT count(*)::int n FROM rd_allocation_bom_${t}`))[0].n).toBe(0);}finally{await r.rollbackTransaction();await r.release();}
  await expect(new RdAllocationBomTracking1722920138000().down()).rejects.toThrow('Forward-only');
 });
});
