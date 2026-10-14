#!/usr/bin/env node
// Synthetic historical data only. Requires the same isolated test socket as the allocation integration suite.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const {DataSource}=req('typeorm'),{Client}=req('pg');
const host=process.env.PMC_TEST_POSTGRES_HOST;
if(!host?.startsWith('/tmp/kdos-pmc-pg-'))throw Error('Isolated socket required');
const name='pmc_append_migration_'+Date.now(),control=new Client({host,user:'knplan',database:'postgres'});
const id=n=>'0199f100-0000-7000-8000-'+String(n).padStart(12,'0');let db;
(async()=>{
 await control.connect();await control.query(`CREATE DATABASE ${name}`);
 const dir=path.join(root,'apps/api/dist/migrations');
 db=new DataSource({type:'postgres',host,username:'knplan',database:name,migrations:fs.readdirSync(dir).filter(f=>f.endsWith('.js')&&!f.startsWith('1722920093000')).map(f=>path.join(dir,f)),logging:false});
 await db.initialize();await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');await db.runMigrations();
 await db.query("INSERT INTO users(id,username,display_name,password_hash,tenant_id) VALUES($1,'migration-fixture','测试','unused','KAINAN')",[id(1)]);
 await db.query("INSERT INTO organization_units(id,name,level,enabled) VALUES($1,'迁移测试单位',1,true)",[id(2)]);
 await db.query("INSERT INTO roles(id,name) VALUES($1,'migration-fixture')",[id(3)]);
 await db.query("INSERT INTO permissions(role_id,resource,field_key,read,update) VALUES($1,'mps-order-allocations','unallocatedQuantity',true,true)",[id(3)]);
 const fixtures=[{id:id(10),v:1,q:0,legacy:80,proof:true},{id:id(11),v:3,q:0,legacy:50,proof:true},{id:id(12),v:1,q:0,legacy:60},{id:id(13),v:1,q:20,legacy:70,proof:true}];
 await db.transaction(async m=>{
  for(const f of fixtures){
   await m.query("INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,division_id,allocated_quantity,unallocated_quantity,version,tax_included_amount,tax_included_unit_price,created_by) VALUES($1,'KAINAN',$2,'I',$3,$4,$5,$6,100.50,2.50,$7)",[f.id,'SYN-'+f.id,id(2),f.q,f.legacy,f.v,id(1)]);
   if(f.proof)await m.query("INSERT INTO audit_logs(actor_id,resource,record_id,action,after_json,request_id,source) VALUES($1,'mps-order-allocations',$2,'mps-order-allocations.import_created',$3::jsonb,'fixture-import','web')",[id(1),f.id,JSON.stringify({allocatedQuantity:f.q,unallocatedQuantity:f.legacy})]);
  }
  await m.query("INSERT INTO audit_logs(actor_id,resource,action,after_json,request_id,source) VALUES($1,'mps-order-allocations','mps-order-allocations.import_confirmed',$2::jsonb,'fixture-import','web')",[id(1),JSON.stringify({fileHash:'a'.repeat(64)})]);
 });
 await db.query("INSERT INTO mps_monthly_plans(id,tenant_id,order_number,item_code,required_quantity,division_id,created_by) SELECT $1,'KAINAN',order_number,item_code,allocated_quantity,division_id,$3 FROM mps_order_allocations WHERE id=$2",[id(20),id(10),id(1)]);
 const before=await db.query('SELECT id,order_number,item_code,tax_included_amount,tax_included_unit_price FROM mps_order_allocations ORDER BY id');
 const {AllocationAppendBatches1722920093000}=req('./dist/migrations/1722920093000-AllocationAppendBatches');
 const migration=new AllocationAppendBatches1722920093000();
 const change=method=>db.transaction(async manager=>migration[method](manager.queryRunner));
 await change('up');
 assert.deepEqual(await db.query('SELECT id,order_number,item_code,tax_included_amount,tax_included_unit_price FROM mps_order_allocations ORDER BY id'),before);
 const rows=await db.query('SELECT id,allocated_quantity,version FROM mps_order_allocations ORDER BY id');
 assert.deepEqual(rows.map(r=>[Number(r.allocated_quantity),r.version]),[[80,2],[0,3],[0,1],[20,1]]);
 assert.equal((await db.query('SELECT allocation_id FROM mps_monthly_plans WHERE id=$1',[id(20)]))[0].allocation_id,id(10));
 assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='mps-order-allocations.legacy_quantity_retired'"))[0].n,4);
 assert.equal((await db.query("SELECT count(*)::int n FROM permissions WHERE resource='mps-order-allocations' AND field_key='unallocatedQuantity'"))[0].n,0);
 console.log('PASS old schema to append schema: proof-only repair, manual/unknown protection, money/identity/FK preservation and retired grants');
 await change('down');
 assert.equal((await db.query('SELECT allocated_quantity,unallocated_quantity FROM mps_order_allocations WHERE id=$1',[id(10)]))[0].allocated_quantity,'80.0000');
 assert.equal((await db.query("SELECT count(*)::int n FROM permissions WHERE resource='mps-order-allocations' AND field_key='unallocatedQuantity'"))[0].n,1);
 await change('up');
 assert.equal((await db.query('SELECT allocated_quantity FROM mps_order_allocations WHERE id=$1',[id(10)]))[0].allocated_quantity,'80.0000');
 await db.query("INSERT INTO mps_allocation_import_batches(id,tenant_id,file_hash,source_worksheet,row_count,imported_by) VALUES($1,'KAINAN',$2,'分配',1,$3)",[id(30),'b'.repeat(64),id(1)]);
 await assert.rejects(()=>change('down'),/禁止退回旧唯一键/);
 assert.equal((await db.query('SELECT count(*)::int n FROM mps_allocation_import_batches'))[0].n,1);
 console.log('PASS conditional rollback restores historical fields/grants; corrected quantity retained; append identity forbids destructive rollback');
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(db?.isInitialized)await db.destroy();if(control._connected){await control.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await control.end();}});
