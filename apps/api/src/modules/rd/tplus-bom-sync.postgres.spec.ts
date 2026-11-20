import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { RdBomMasterIndex1722920127000 } from '../../migrations/1722920127000-RdBomMasterIndex';
import { RdTplusBomIndex1722920135000 } from '../../migrations/1722920135000-RdTplusBomIndex';
import { TplusBomSyncService } from './tplus-bom-sync.service';
import { UnifiedBomQueryService } from './unified-bom.query.service';

const socket=process.env.RD_BOM_INDEX_TEST_SOCKET;
(socket?describe:describe.skip)('T+ generation reconciliation and isolated migration',()=>{
 let db:DataSource,service:TplusBomSyncService,file:string;
 const old={python:process.env.RD_E10_PYTHON,reader:process.env.RD_TPLUS_BOM_READER};
 const worker=`let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const r=JSON.parse(raw),o=x=>console.log(JSON.stringify(x)),n=process.env.TPLUS_TEST_EVENT||'normal',e={total:n==='delete'?1:3,valid:n==='delete'?0:2};o({type:'begin',source:r.source,database:r.source==='tplus-kejia'?'UFTData418971_000003':'UFTData741219_000012',evidence:e});let rows=[{source_bom_id:1,item_id:1,item_code:n==='changed'?'RENAMED':'CODE',bom_version:'A',voucher_state:n==='delete'?181:189,disabled:false,is_default:false,source_created_at:'2026-01-01',source_modified_at:'2026-11-01',source_audited_at:'2026-11-02'}];if(n!=='delete')rows.push({...rows[0],source_bom_id:2,item_code:'SECOND',is_default:true},{...rows[0],source_bom_id:3,item_code:'DISABLED',disabled:true});o({type:'page',records:rows});if(n==='fail'){process.exitCode=1;return;}o({type:'end',source:r.source,scanned:e.total,valid:e.valid,evidence:e});});`;
 beforeAll(async()=>{
  if (!socket?.startsWith('/tmp/')||!socket.includes('rd-bom')) throw Error('Isolated socket required');
  const options={type:'postgres' as const,host:socket,username:'postgres',entities:[],logging:false as const};
  const admin=new DataSource({...options,database:'postgres'});await admin.initialize();
  try {await admin.query('CREATE DATABASE rd_tplus_bom_test');}finally{await admin.destroy();}
  db=new DataSource({...options,database:'rd_tplus_bom_test'});await db.initialize();
  const r=db.createQueryRunner();await r.connect();
  try {await new RdBomMasterIndex1722920127000().up(r);await new RdTplusBomIndex1722920135000().up(r);}finally{await r.release();}
  file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rd-bom-tplus-')),'reader.cjs');fs.writeFileSync(file,worker);
  process.env.RD_E10_PYTHON=process.execPath;process.env.RD_TPLUS_BOM_READER=file;service=new TplusBomSyncService(db);
 },30000);
 afterAll(async()=>{
  if(old.python===undefined) delete process.env.RD_E10_PYTHON;else process.env.RD_E10_PYTHON=old.python;
  if(old.reader===undefined) delete process.env.RD_TPLUS_BOM_READER;else process.env.RD_TPLUS_BOM_READER=old.reader;
  delete process.env.TPLUS_TEST_EVENT;
  if(db?.isInitialized) await db.destroy();
 });
 const state=async()=>{const [s]=await db.query("SELECT active_generation::text generation,last_status,report_enabled FROM rd_tplus_bom_sync_state WHERE tenant_id='TEST' AND source='tplus-kejia'");return s;};
 it('keeps report disabled until BOTH verified initial sources complete; activates their namespaces independently',async()=>{
  expect(await service.reconcile('TEST','tplus-kejia')).toMatchObject({status:'SUCCESS',scanned:3,valid:2,sourceVerified:true});
  await expect(service.activate('TEST')).rejects.toThrow('NOT_READY');
  expect(await new UnifiedBomQueryService(db).read('TEST',['CODE'])).toEqual({enabled:false});
  await service.reconcile('TEST','tplus-kainan');await expect(service.activate('TEST')).resolves.toMatchObject({status:'SUCCESS'});
  const [c]=await db.query('SELECT count(DISTINCT source)::int n FROM rd_tplus_bom_heads');expect(c.n).toBe(2);
  const read=await new UnifiedBomQueryService(db).read('TEST',['CODE']);expect(read.enabled&&read.match('CODE')).toMatchObject({status:'HAS_BOM',approvalDate:null,bomSources:'科加智能、凯南智能'});
 });
 it('failed halfway replacement retains old generation and rows, marks source abnormal, and can retry',async()=>{
  const before=await state();process.env.TPLUS_TEST_EVENT='fail';
  await expect(service.reconcile('TEST','tplus-kejia')).rejects.toThrow('TPLUS_BOM_INCOMPLETE');
  const after=await state();expect(after.generation).toBe(before.generation);expect(after.last_status).toBe('FAILED');
  const read=await new UnifiedBomQueryService(db).read('TEST',['CODE']);expect(read.enabled&&read.match('CODE').status).toBe('HAS_BOM');expect(read.enabled&&read.syncText).toContain('异常');
  process.env.TPLUS_TEST_EVENT='normal';await service.reconcile('TEST','tplus-kejia');expect((await state()).generation).not.toBe(before.generation);
 });
 it('reconciliation removes deleted/revoked headers only by activating a complete new generation, including code changes',async()=>{
  process.env.TPLUS_TEST_EVENT='changed';await service.reconcile('TEST','tplus-kejia');
  let read=await new UnifiedBomQueryService(db).read('TEST',['CODE','RENAMED']);
  expect(read.enabled&&read.match('RENAMED').bomSources).toBe('科加智能');expect(read.enabled&&read.match('CODE').bomSources).toBe('凯南智能');
  process.env.TPLUS_TEST_EVENT='delete';await service.reconcile('TEST','tplus-kejia');await service.reconcile('TEST','tplus-kainan');
  read=await new UnifiedBomQueryService(db).read('TEST',['CODE','RENAMED','SECOND']);
  for(const c of ['CODE','RENAMED','SECOND'])expect(read.enabled&&read.match(c).status).toBe('NO_BOM');
 });
 it('forces RLS and does not change E10 data; refuses destructive down migration',async()=>{
  const [c]=await db.query('SELECT count(*)::int n FROM rd_bom_master_heads');expect(c.n).toBe(0);
  await db.query('CREATE ROLE bom_rls_test');await db.query('GRANT USAGE ON SCHEMA public TO bom_rls_test');await db.query('GRANT SELECT ON rd_tplus_bom_heads TO bom_rls_test');
  const r=db.createQueryRunner();await r.connect();
  try {await r.query('SET ROLE bom_rls_test');await r.query("SELECT set_config('app.tenant_id','OTHER',false)");const [n]=await r.query('SELECT count(*)::int n FROM rd_tplus_bom_heads');expect(n.n).toBe(0);}
  finally {await r.query('RESET ROLE');await r.query('RESET app.tenant_id');await r.release();}
  await expect(new RdTplusBomIndex1722920135000().down()).rejects.toThrow('Forward-only');
 });
});
