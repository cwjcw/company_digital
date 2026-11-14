import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { RdBomMasterIndex1722920127000 } from '../../migrations/1722920127000-RdBomMasterIndex';
import { RdBomMasterIndexSyncService } from './rd-bom-master-index-sync.service';

const socket=process.env.RD_BOM_INDEX_TEST_SOCKET;
const integration=socket?describe:describe.skip;
const tenant='TEST-TENANT';
const bomA='11111111-1111-4111-8111-111111111111',bomB='22222222-2222-4222-8222-222222222222',bomC='33333333-3333-4333-8333-333333333333';
const item='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const record=(id:string,approveDate='2026-01-01')=>({source_bom_id:id,item_id:item,item_code:'SYN-ITEM',owner_org_id:null,version_times:'1',approve_status:'Y',approve_date:approveDate,create_date:'2025-01-01',modified_date:'2026-01-01',last_modified_date:'2026-01-01'});
const eventScript=`let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const r=JSON.parse(raw),mode=r.mode,e=process.env.RD_BOM_TEST_EVENT||'full';const out=x=>process.stdout.write(JSON.stringify(x)+'\\n');const from=mode==='FULL'?10:r.fromVersion,to=mode==='FULL'?11:22;out({type:'begin',mode,fromVersion:from});if(mode==='FULL'){out({type:'snapshot',records:[${JSON.stringify(record(bomA))},${JSON.stringify(record(bomB))}]});}out({type:'changes_begin',fromVersion:from,toVersion:to});let rows=[];if(mode==='INCREMENTAL'&&e==='delta')rows=[{...${JSON.stringify(record(bomA,'2026-02-01'))},operation:'UPSERT',change_version:20},{...${JSON.stringify(record(bomB))},operation:'REVOKE',change_version:20},{...${JSON.stringify(record(bomC))},operation:'DELETE',change_version:20}];if(mode==='INCREMENTAL'&&e==='repeat')rows=[{...${JSON.stringify(record(bomA,'2026-02-01'))},operation:'UPSERT',change_version:21}];if(mode==='INCREMENTAL'&&e==='failure')rows=[{...${JSON.stringify(record(bomA))},operation:'DELETE',change_version:22}];if(mode==='INCREMENTAL'&&e==='delete')rows=[{...${JSON.stringify(record(bomA))},operation:'DELETE',change_version:22}];if(rows.length)out({type:'changes',records:rows});if(e==='failure'){process.exitCode=1;return;}out({type:'end',mode,toVersion:to,scanned:rows.length});});`;

integration('R&D BOM master index: isolated PostgreSQL full and incremental sync',()=>{
  let db:DataSource;
  let scriptPath:string;
  let oldPython:string|undefined,oldReader:string|undefined,oldEvent:string|undefined;
  beforeAll(async()=>{
    if(!socket?.startsWith('/tmp/')||!socket.includes('rd-bom'))throw new Error('Only the isolated R&D BOM PostgreSQL socket is allowed');
    const common={type:'postgres' as const,host:socket,username:'postgres',entities:[],logging:false as const};
    const admin=new DataSource({...common,database:'postgres'});await admin.initialize();
    try{await admin.query('DROP DATABASE IF EXISTS rd_bom_index_test WITH (FORCE)');await admin.query('CREATE DATABASE rd_bom_index_test');}finally{await admin.destroy();}
    db=new DataSource({...common,database:'rd_bom_index_test'});await db.initialize();
    const runner=db.createQueryRunner();await runner.connect();try{await new RdBomMasterIndex1722920127000().up(runner);}finally{await runner.release();}
    scriptPath=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rd-bom-sync-reader-')),'worker.py');fs.writeFileSync(scriptPath,eventScript,{mode:0o600});
    oldPython=process.env.RD_E10_PYTHON;oldReader=process.env.RD_ORDER_BOM_SYNC_READER;oldEvent=process.env.RD_BOM_TEST_EVENT;
    process.env.RD_E10_PYTHON=process.execPath;process.env.RD_ORDER_BOM_SYNC_READER=scriptPath;
  },30000);
  afterAll(async()=>{
    if(oldPython==null)delete process.env.RD_E10_PYTHON;else process.env.RD_E10_PYTHON=oldPython;
    if(oldReader==null)delete process.env.RD_ORDER_BOM_SYNC_READER;else process.env.RD_ORDER_BOM_SYNC_READER=oldReader;
    if(oldEvent==null)delete process.env.RD_BOM_TEST_EVENT;else process.env.RD_BOM_TEST_EVENT=oldEvent;
    if(scriptPath)fs.rmSync(path.dirname(scriptPath),{recursive:true,force:true});
    if(db?.isInitialized)await db.destroy();
  });
  const service=()=>new RdBomMasterIndexSyncService(db);
  const read=async()=>db.transaction(async manager=>{await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const rows=await manager.query('SELECT source_bom_id::text,approve_date::text FROM rd_bom_master_heads WHERE tenant_id=$1 ORDER BY source_bom_id',[tenant]);const [state]=await manager.query('SELECT active_generation::text,last_change_version::text,last_status FROM rd_bom_sync_state WHERE tenant_id=$1',[tenant]);return {rows,state};});

  it('initial full snapshot activates atomically after all pages and captures the source watermark',async()=>{
    const result=await service().sync(tenant,'FULL');const snapshot=await read();
    expect(result).toMatchObject({status:'SUCCESS',toVersion:11,inserted:2,updated:0,revoked:0,deleted:0});expect(snapshot.rows).toHaveLength(2);
    expect(snapshot.state).toMatchObject({last_change_version:'11',last_status:'SUCCESS'});
  });
  it('a failed replacement full snapshot preserves the prior active generation and watermark',async()=>{
    const before=await read();process.env.RD_BOM_TEST_EVENT='failure';
    await expect(service().sync(tenant,'FULL')).rejects.toThrow('RD_BOM_SYNC_FAILED');
    const after=await read();expect(after.rows).toEqual(before.rows);expect(after.state.active_generation).toBe(before.state.active_generation);expect(after.state.last_change_version).toBe(before.state.last_change_version);expect(after.state.last_status).toBe('FAILED');
    await db.transaction(async manager=>{await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const [row]=await manager.query('SELECT count(*)::int count FROM rd_bom_master_heads WHERE tenant_id=$1 AND generation_id<>$2',[tenant,before.state.active_generation]);expect(row.count).toBe(0);});
  });
  it('incremental approval changes, revocation, deletion, and repeated events are idempotent',async()=>{
    process.env.RD_BOM_TEST_EVENT='delta';expect(await service().sync(tenant,'INCREMENTAL')).toMatchObject({inserted:0,updated:1,revoked:1,deleted:1});
    let snapshot=await read();expect(snapshot.rows).toHaveLength(1);expect(snapshot.rows[0]).toMatchObject({source_bom_id:bomA,approve_date:'2026-02-01 00:00:00'});
    process.env.RD_BOM_TEST_EVENT='repeat';expect(await service().sync(tenant,'INCREMENTAL')).toMatchObject({inserted:0,updated:1,revoked:0,deleted:0});
    snapshot=await read();expect(snapshot.rows).toHaveLength(1);expect(snapshot.rows[0].source_bom_id).toBe(bomA);
  });
  it('a failed incremental batch leaves active rows and watermark unchanged, then retries safely',async()=>{
    const before=await read();process.env.RD_BOM_TEST_EVENT='failure';
    await expect(service().sync(tenant,'INCREMENTAL')).rejects.toThrow('RD_BOM_SYNC_FAILED');
    const failed=await read();expect(failed.rows).toEqual(before.rows);expect(failed.state.last_change_version).toBe(before.state.last_change_version);expect(failed.state.last_status).toBe('FAILED');
    const [failedRun]=await db.query(`SELECT error_count FROM rd_bom_sync_runs WHERE tenant_id=$1 AND status='FAILED' ORDER BY started_at DESC LIMIT 1`,[tenant]);expect(Number(failedRun.error_count)).toBe(1);
    process.env.RD_BOM_TEST_EVENT='delete';await service().sync(tenant,'INCREMENTAL');
    const after=await read();expect(after.rows).toHaveLength(0);expect(after.state).toMatchObject({last_change_version:'22',last_status:'SUCCESS'});
  });
});
