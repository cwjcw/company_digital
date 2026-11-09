import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DataSource, type QueryRunner } from 'typeorm';
import { discoverMigrationFiles, phaseAMigrationFiles } from '../../migration-files';
import { MpsDemandLinks1722920121000 as Links } from '../../migrations/1722920121000-MpsDemandLinks';
import { MpsReviewBatchApplications1722920122000 as Applications } from '../../migrations/1722920122000-MpsReviewBatchApplications';
import { MpsSyncMaintenance1722920123000 as Maintenance } from '../../migrations/1722920123000-MpsSyncMaintenance';

const integration=process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET?describe:describe.skip;
const socket=process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET;
const tenant='REVIEW-INDEPENDENCE-SYNTHETIC',user='0199bd00-0000-7000-8000-000000000001',division='0199bd00-0000-7000-8000-000000000002';

integration('review due-date independence migration: isolated PostgreSQL',()=>{
  let db:DataSource;
  beforeAll(async()=>{
    if(!socket?.endsWith('/test/mps_sync_reliability/pg_socket'))throw Error('Only the dedicated network-none PostgreSQL socket is allowed');
    const common={type:'postgres' as const,host:socket,username:'postgres',entities:[],logging:false as const};
    const admin=new DataSource({...common,database:'postgres'});await admin.initialize();
    try{await admin.query('DROP DATABASE IF EXISTS mps_review_independent_test WITH (FORCE)');await admin.query('CREATE DATABASE mps_review_independent_test');}finally{await admin.destroy();}
    const dir=path.join(__dirname,'../../migrations'),all=discoverMigrationFiles(dir);
    db=new DataSource({...common,database:'mps_review_independent_test',migrations:all.filter(file=>Number(path.basename(file).slice(0,13))<=1722920117000)});await db.initialize();
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');expect(await db.runMigrations({transaction:'all'})).toHaveLength(117);await db.destroy();
    db=new DataSource({...common,database:'mps_review_independent_test',migrations:phaseAMigrationFiles(dir)});await db.initialize();
    expect((await db.runMigrations({transaction:'all'})).map(row=>row.name)).toEqual(['MpsSyncLeases1722920118000','MpsExecutionFactProtection1722920119000']);
    const qr={query:(sql:string,args?:unknown[])=>db.query(sql,args)} as QueryRunner;
    for(const Migration of [Links,Applications,Maintenance])await new Migration().up(qr);
    await db.query(`INSERT INTO users(id,tenant_id,username,display_name,password_hash) VALUES($1,$2,'review-synthetic','合成维护用户','synthetic-invalid-hash')`,[user,tenant]);
    await db.query(`INSERT INTO organization_units(id,name,level) VALUES($1,'事业三部',1)`,[division]);
    const [allocation]=await db.query(`INSERT INTO mps_order_allocations(tenant_id,division_id,order_number,item_code,customer_code,allocated_quantity,order_status,manually_maintained,created_by,updated_by)
      VALUES($1,$2,'SYN-REVIEW-ORDER','SYN-REVIEW-ITEM','SYN-CUSTOMER',20,'已审核',true,$3,$3) RETURNING id`,[tenant,division,user]);
    const [monthly]=await db.query(`INSERT INTO mps_monthly_plans(tenant_id,division_id,order_number,item_code,customer_code,allocation_id,order_date,preproduction_review_date,required_quantity,created_by,updated_by)
      VALUES($1,$2,'SYN-REVIEW-ORDER','SYN-REVIEW-ITEM','SYN-CUSTOMER',$3,'2026-10-01','2026-11-01',20,$4,$4) RETURNING id`,[tenant,division,allocation.id,user]);
    const [review]=await db.query(`INSERT INTO mps_review_due_dates(tenant_id,division_id,monthly_plan_id,order_number,batch_number,drawing_number,due_date,inbound_date,quantity,change_count,previous_inbound_date,created_by,updated_by)
      VALUES($1,$2,$3,'SYN-REVIEW-ORDER','B-1/1','SYN-REVIEW-ITEM','2026-12-01','2026-11-11',20,0,NULL,$4,$4) RETURNING id`,[tenant,division,monthly.id,user]);
    await db.query(`INSERT INTO mps_review_due_date_changes(tenant_id,review_due_date_id,old_inbound_date,new_inbound_date,change_days,change_direction,changed_by,source_kind,source_batch_id)
      VALUES($1,$2,'2026-11-10','2026-11-11',1,'LATER',$3,'MANUAL','synthetic-history')`,[tenant,review.id,user]);
    await db.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by)
      VALUES($1,$2::uuid,'Synthetic user','mps-review-due-dates',$3,'review_due_date.import_created','{}','review-migration-test','api',$2::uuid,$2::uuid)`,[tenant,user,review.id]);
    await db.query(`INSERT INTO migrations(timestamp,name) VALUES
      (1722920121000,'MpsDemandLinks1722920121000'),
      (1722920122000,'MpsReviewBatchApplications1722920122000'),
      (1722920122500,'MpsDemandLinkServiceAuth1722920122500'),
      (1722920123000,'MpsSyncMaintenance1722920123000')`);
    const result=spawnSync(process.execPath,[path.join(__dirname,'../../../dist/migrate-review-due-independence.js')],{env:{...process.env,DATABASE_HOST:socket!,DATABASE_PORT:'5432',DATABASE_USER:'postgres',DATABASE_PASSWORD:'',DATABASE_NAME:'mps_review_independent_test'},encoding:'utf8',timeout:30000});
    expect(result.status).toBe(0);expect(result.stdout).toContain('MpsReviewDueDateIndependent1722920124000');
  },180000);
  afterAll(async()=>{if(db?.isInitialized)await db.destroy();});

  it('clears old business and detail history without changing plans or deleting system audit',async()=>{
    expect((await db.query(`SELECT count(*)::int n FROM mps_review_due_dates WHERE tenant_id=$1`,[tenant]))[0].n).toBe(0);
    expect((await db.query(`SELECT count(*)::int n FROM mps_review_due_date_changes WHERE tenant_id=$1`,[tenant]))[0].n).toBe(0);
    expect((await db.query(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='review_due_date.import_created'`,[tenant]))[0].n).toBe(1);
    const [columns]=await db.query(`SELECT array_agg(attname ORDER BY attname) names FROM pg_attribute WHERE attrelid='mps_review_due_dates'::regclass AND attname IN('due_date','change_count','previous_inbound_date','monthly_plan_id','source_division_id','source_order_number','source_batch_number','source_drawing_number') AND NOT attisdropped`);
    expect(columns.names).toBeNull();
    expect((await db.query("SELECT to_regclass('mps_review_base_plan_links') relation"))[0].relation).toBeNull();
    const [monthly]=await db.query('SELECT id,order_date::text,preproduction_review_date::text,required_quantity FROM mps_monthly_plans WHERE tenant_id=$1',[tenant]);
    const [allocation]=await db.query('SELECT id,allocated_quantity FROM mps_order_allocations WHERE tenant_id=$1',[tenant]);
    expect(monthly).toMatchObject({order_date:'2026-10-01',preproduction_review_date:'2026-11-01',required_quantity:'20.0000'});
    expect(allocation.allocated_quantity).toBe('20.0000');
    const [inserted]=await db.query(`INSERT INTO mps_review_due_dates(tenant_id,division_id,order_number,batch_number,drawing_number,order_date,customer_due_date,inbound_date,quantity,created_by,updated_by)
      VALUES($1,$2,'LOCAL-ORDER','B/1','LOCAL-ITEM','2026-11-01','2026-12-01','2026-12-03',2,$3,$3) RETURNING id`,[tenant,division,user]);
    expect(inserted.id).toBeDefined();
  });

  it('keeps new review rows local and preserves allocation/base stable-demand protections',async()=>{
    await db.query("UPDATE mps_monthly_plans SET order_date='2026-10-02',preproduction_review_date='2026-11-02' WHERE tenant_id=$1",[tenant]);
    const [row]=await db.query(`SELECT order_date::text,customer_due_date::text FROM mps_review_due_dates WHERE tenant_id=$1 AND order_number='LOCAL-ORDER'`,[tenant]);
    expect(row).toEqual({order_date:'2026-11-01',customer_due_date:'2026-12-01'});
    const [readiness]=await db.query(`SELECT to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NOT NULL validator,
      (SELECT count(*)::int FROM pg_attribute WHERE attrelid IN('mps_order_allocations'::regclass,'mps_base_plans'::regclass) AND attname='monthly_plan_id' AND NOT attisdropped) parent_links,
      (SELECT count(*)::int FROM pg_trigger WHERE tgrelid IN('mps_order_allocations'::regclass,'mps_base_plans'::regclass) AND tgname='ab_mps_demand_link' AND tgenabled='O') guards`);
    expect(readiness).toEqual({validator:true,parent_links:2,guards:2});
    const [defs]=await db.query("SELECT pg_get_functiondef('mps_assert_demand_link(text,jsonb)'::regprocedure) body,pg_get_functiondef('mps_guard_demand_parent()'::regprocedure) parent");
    expect(defs.body).not.toContain('mps_review_due_dates');expect(defs.parent).not.toContain('mps_review_due_dates');
  });

  it('allows a business delete with its module detail rows while retaining system audit',async()=>{
    const [row]=await db.query(`SELECT id FROM mps_review_due_dates WHERE tenant_id=$1 AND order_number='LOCAL-ORDER'`,[tenant]);
    await db.query(`INSERT INTO mps_review_due_date_changes(tenant_id,review_due_date_id,old_inbound_date,new_inbound_date,change_days,change_direction,changed_by,source_kind,source_batch_id)
      VALUES($1,$2,'2026-12-03','2026-12-04',1,'LATER',$3,'MANUAL','local-delete-test')`,[tenant,row.id,user]);
    const runner=db.createQueryRunner();await runner.connect();await runner.startTransaction();
    try{
      await runner.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.review_due_delete_authorized','true',true)",[tenant]);
      await runner.query('DELETE FROM mps_review_due_date_changes WHERE tenant_id=$1 AND review_due_date_id=$2',[tenant,row.id]);
      await runner.query('DELETE FROM mps_review_due_dates WHERE tenant_id=$1 AND id=$2',[tenant,row.id]);
      await runner.commitTransaction();
    }catch(error){await runner.rollbackTransaction();throw error;}finally{await runner.release();}
    expect((await db.query(`SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='review_due_date.import_created'`,[tenant]))[0].n).toBe(1);
  });
});
