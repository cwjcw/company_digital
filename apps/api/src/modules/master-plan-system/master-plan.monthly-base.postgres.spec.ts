import { DataSource, type QueryRunner } from "typeorm";
import { randomUUID } from "node:crypto";
import { MasterPlanSystem1722920047000 as Initial } from "../../migrations/1722920047000-MasterPlanSystem";
import { MasterPlanIntegrityAndOutbox1722920048000 as Integrity } from "../../migrations/1722920048000-MasterPlanIntegrityAndOutbox";
import { MasterPlanShippingMonthlyReference1722920049000 as ShippingReference } from "../../migrations/1722920049000-MasterPlanShippingMonthlyReference";
import { MasterPlanManualCreationAndDailyReporting1722920050000 as Manual } from "../../migrations/1722920050000-MasterPlanManualCreationAndDailyReporting";
import { MasterPlanReportDivisions1722920051000 as Divisions } from "../../migrations/1722920051000-MasterPlanReportDivisions";
import { MasterPlanExecutionEligibility1722920052000 as Eligibility } from "../../migrations/1722920052000-MasterPlanExecutionEligibility";
import { MasterPlanWeeklyIdentity1722920056000 as Identity } from "../../migrations/1722920056000-MasterPlanWeeklyIdentity";
import { MasterPlanDeliveryCodeAuto1722920075000 as Codes } from "../../migrations/1722920075000-MasterPlanDeliveryCodeAuto";
import { MpsProcessRoutingV11722920107000 as Routing } from "../../migrations/1722920107000-MpsProcessRoutingV1";
import { MpsProcessDueDateRefreshV11722920108000 as Dates } from "../../migrations/1722920108000-MpsProcessDueDateRefresh";
import { MpsMonthlyBaseGeneration1722920111000 as Change } from "../../migrations/1722920111000-MpsMonthlyBaseGeneration";
import { MasterPlanThreeDayWorkOrders1722920063000 as WorkOrders } from "../../migrations/1722920063000-MasterPlanThreeDayWorkOrders";
import { MpsSyncLeases1722920118000 as Leases } from "../../migrations/1722920118000-MpsSyncLeases";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import type { MasterPlanActor } from "./master-plan.types";
import { reconcileMonthlyBasePlans } from "./master-plan.monthly-base";

const socket=process.env.KDOS_MONTHLY_BASE_TEST_SOCKET;
const integration=socket?describe:describe.skip;
const id=(n:number)=>`0199bc00-0000-7000-8000-${String(n).padStart(12,"0")}`;
const tenant="MONTHLY-BASE-TEST",division=id(1),other=id(2),user=id(3);
const actor:MasterPlanActor={tenantId:tenant,userId:user,username:"合成用户",permissions:["*"],isSystemAdmin:true,tableDataScopes:[],requestId:"fixture",source:"web"};

integration("monthly to base on isolated PostgreSQL (no production settings)",()=>{
  let db:DataSource,service:MasterPlanSyncService,application:MasterPlanApplicationService,queries:MasterPlanQueryService;
  const run=()=> (service as any).shippingToBase(tenant,user,"合成用户");
  const weeks=()=> (service as any).baseToWeekly(tenant,user,user);
  const insert=async(table:string,values:Record<string,unknown>)=>{
    const entries=Object.entries({tenant_id:tenant,created_by:user,updated_by:user,...values});
    return (await db.query(`INSERT INTO ${table}(${entries.map(([k])=>k).join(",")}) VALUES(${entries.map((_,i)=>`$${i+1}`).join(",")}) RETURNING *`,entries.map(([,v])=>v)))[0];
  };
  const month=async(item="ITEM-A",values:Record<string,unknown>={})=>{
    const order=String(values.order_number??"ORDER-A"),who=String(values.tenant_id??tenant);
    await insert("mps_order_allocations",{tenant_id:who,order_number:order,item_code:item,allocated_quantity:10,division_id:division});
    return insert("mps_monthly_plans",{tenant_id:who,order_number:order,item_code:item,item_name:"合成品项",division_id:division,customer_code:"C1",required_quantity:10,pending_quantity:7,order_date:"2026-10-01",latest_customer_due_date:"2026-11-03",...values});
  };
  const bases=()=>db.query("SELECT *,latest_customer_due_date::text AS latest_customer_due_date,blank_completion_date::text AS blank_completion_date FROM mps_base_plans WHERE tenant_id=$1 ORDER BY item_code,delivery_number",[tenant]);
  beforeAll(async()=>{
    if(!socket?.endsWith("/test/monthly_base_generation/pg_socket"))throw Error("Only the dedicated test socket is permitted");
    db=new DataSource({type:"postgres",host:socket,username:"postgres",database:"monthly_base_test",entities:[],poolSize:4,extra:{options:"-c search_path=monthly_base_fixture,public"}});await db.initialize();
    await db.query("DROP SCHEMA IF EXISTS monthly_base_fixture CASCADE; CREATE SCHEMA monthly_base_fixture");
    await db.query(`CREATE TABLE supply_chain_suppliers(id uuid PRIMARY KEY);
      CREATE TABLE users(id uuid PRIMARY KEY,username text UNIQUE,display_name text,password_hash text,enabled boolean DEFAULT true,must_change_password boolean,created_by uuid,updated_by uuid);
      CREATE TABLE organization_units(id uuid PRIMARY KEY,name text,enabled boolean DEFAULT true);
      CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text,actor_id uuid,actor_name text,resource text,record_id varchar,action text,before_json jsonb,after_json jsonb,request_id text,source text,created_by uuid,updated_by uuid,created_at timestamptz DEFAULT clock_timestamp());
      INSERT INTO users(id,username,display_name)VALUES('${user}','synthetic','合成用户');
      INSERT INTO organization_units(id,name)VALUES('${division}','合成事业部'),('${other}','另一事业部');`);
    const runner={query:(sql:string,params?:unknown[])=>db.query(sql,params)} as QueryRunner;
    for(const Migration of [Initial,Integrity,ShippingReference,Manual,Divisions,Eligibility,Identity,Codes,Routing,Dates,WorkOrders,Change])await new Migration().up(runner);
    await new Leases().up(runner);
    await db.query(`ALTER TABLE mps_reconciliation_outbox ADD COLUMN IF NOT EXISTS record_id uuid,ADD COLUMN IF NOT EXISTS scope_json jsonb;
      ALTER TABLE mps_sync_logs ADD COLUMN IF NOT EXISTS metrics jsonb;
      ALTER TABLE mps_base_plans ADD COLUMN IF NOT EXISTS monthly_plan_id uuid;
      ALTER TABLE mps_base_plans ADD COLUMN IF NOT EXISTS blank_completion_date date,ADD COLUMN IF NOT EXISTS packaging_completion_date date;
      ALTER TABLE mps_process_cycles ADD COLUMN IF NOT EXISTS blank_days integer;
      CREATE FUNCTION mps_weekly_has_execution(t varchar,w uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
      CREATE TABLE idempotency_keys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key varchar NOT NULL UNIQUE,request_hash varchar NOT NULL,response_json jsonb NOT NULL,created_by uuid,updated_by uuid,created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO mps_system_settings(tenant_id,setting_key,name,value_json,created_by,updated_by) VALUES('MONTHLY-BASE-TEST','shipping_temporary_unlock_until','合成临时解锁','"2040-01-01T00:00:00Z"','0199bc00-0000-7000-8000-000000000003','0199bc00-0000-7000-8000-000000000003');
      UPDATE mps_system_settings SET value_json='"2040-01-01T00:00:00Z"' WHERE setting_key='shipping_temporary_unlock_until';`);
    service=new MasterPlanSyncService(db);
    const consumer={processOutbox:async()=>0};
    application=new MasterPlanApplicationService(db,consumer as never,{enqueueEvent:async()=>null} as never);
    const directory={listEnabled:async()=>[{id:division,name:"合成事业部",pathLabel:"合成事业部"},{id:other,name:"另一事业部",pathLabel:"另一事业部"}]};
    queries=new MasterPlanQueryService(db,directory as never);
    for(const [code,seq,days]of [["cutting",1,2],["bending",2,3],["packaging",3,1]]as const)await insert("mps_division_process_configs",{division_id:division,process_code:code,sequence:seq,cycle_days:days,default_enabled:true});
  },30000);
  beforeEach(async()=>{
    await db.query("TRUNCATE mps_order_allocations,mps_shipping_plans,mps_base_plans,mps_delivery_code_counters,mps_reconciliation_outbox,mps_data_exceptions,audit_logs,mps_item_process_routes CASCADE");
  });
  afterAll(async()=>{if(db?.isInitialized)await db.destroy()});

  it("creates from monthly demand without any shipment, and preserves review date as pending",async()=>{
    await month();expect((await run()).metrics).toMatchObject({base_created:1,base_conflicts:0});
    const [base]=await bases();expect(base.planned_quantity).toBe("10.0000");expect(base.shipping_plan_id).toBeNull();expect(base.latest_review_due_date).toBeNull();
    expect(base.latest_customer_due_date).toBe("2026-11-03");
    await weeks();expect((await db.query("SELECT * FROM mps_weekly_plans")).length).toBe(0);
    const page=await queries.list("mps-base-plans",{search:"ORDER-A"},actor);expect(page.total).toBe(1);expect(page.rows[0].weeklyPlanMissingFields).toContain("最迟评审交期");
  });
  // This fixture intentionally omits Migration121; stable demand-link authorization has dedicated migration tests.
  it("saves partial web, batch and Excel base edits without BLOCKED; complete admission wakes only its base and creates tasks",async()=>{
    await month("ITEM-PARTIAL");await month("ITEM-READY");await run();const [base]=await db.query("SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND item_code='ITEM-PARTIAL'",[tenant]);
    await db.query("UPDATE mps_base_plans SET latest_review_due_date='2026-11-20',product_attribute='五金',surface_nature='烤漆',manufacturing_method='自制' WHERE tenant_id=$1 AND item_code='ITEM-READY'",[tenant]);
    const [readyBase]=await db.query("SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND item_code='ITEM-READY'",[tenant]);
    expect(base.latest_customer_due_date).toBeTruthy();expect(base.latest_review_due_date).toBeNull();
    await db.query("DELETE FROM mps_reconciliation_outbox WHERE tenant_id=$1",[tenant]);
    await db.query(`INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)
      VALUES($1,'base-to-weekly','合成周计划任务',true,30,$2,$2) ON CONFLICT(tenant_id,sync_key) DO UPDATE SET enabled=true,status='SUCCESS'`,[tenant,user]);
    const request=()=>({...actor,requestId:randomUUID()});
    let current=base;
    const save=async(values:Record<string,unknown>)=>{
      const result=await application.update('mps-base-plans',String(current.id),{...values,expectedVersion:Number(current.version)},request());
      current=(await db.query('SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id=$2',[tenant,current.id]))[0];
      const [event]=await db.query(`SELECT id,scope_json,status,idempotency_key FROM mps_reconciliation_outbox WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[tenant]);
      expect(event.scope_json).toEqual({basePlanIds:[current.id]});
      await service.processOutbox();
      const [receipt]=await db.query(`SELECT o.status,l.status AS log_status,l.metrics FROM mps_reconciliation_outbox o
        JOIN mps_sync_logs l ON l.tenant_id=o.tenant_id AND l.sync_key=o.sync_key AND l.idempotency_key=o.idempotency_key WHERE o.id=$1`,[event.id]);
      expect(receipt.status).toBe('SUCCESS');expect(receipt.log_status).toBe('SUCCESS');
      expect(receipt.metrics.waiting_admission_batches ?? 0).toBeGreaterThanOrEqual(0);
      return result;
    };
    await save({latestReviewDueDate:'2026-11-20'});
    expect(await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,current.id])).toHaveLength(0);
    const page=await queries.list('mps-base-plans',{search:'ITEM-PARTIAL'},actor);expect(page.rows[0].weeklyPlanState).toBe('待完善');expect(page.rows[0].weeklyPlanMissingFields).toContain('产品属性');

    const batchResult=await application.batchUpdate('mps-base-plans',{records:[{id:current.id,expectedVersion:Number(current.version)},{id:readyBase.id,expectedVersion:Number(readyBase.version)}],fieldKey:'productAttribute',value:'五金',idempotencyKey:randomUUID()},request());
    current=(await db.query('SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id=$2',[tenant,current.id]))[0];
    const [batchEvent]=await db.query(`SELECT id,scope_json FROM mps_reconciliation_outbox WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[tenant]);
    expect(batchEvent.scope_json).toEqual({basePlanIds:[current.id,readyBase.id]});await service.processOutbox();
    expect(batchResult.succeeded).toBe(2);
    expect((await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,current.id]))).toHaveLength(0);
    const [peerWeekly]=await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,readyBase.id]);
    expect(peerWeekly).toMatchObject({base_plan_id:readyBase.id,planned_quantity:'10.0000',manufacturing_method:'自制'});

    await application.importUpdates('mps-base-plans',[{id:current.id,expectedVersion:Number(current.version),values:{surfaceNature:'烤漆'}}],'a'.repeat(64),request());
    current=(await db.query('SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id=$2',[tenant,current.id]))[0];
    const [excelEvent]=await db.query(`SELECT id,scope_json FROM mps_reconciliation_outbox WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[tenant]);
    expect(excelEvent.scope_json).toEqual({basePlanIds:[current.id]});await service.processOutbox();
    expect((await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,current.id]))).toHaveLength(0);

    await save({manufacturingMethod:'自制'});
    const [weekly]=await db.query('SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=$2',[tenant,current.id]);
    expect(weekly).toMatchObject({base_plan_id:current.id,planned_quantity:'10.0000',manufacturing_method:'自制'});
    expect(await db.query('SELECT id FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2',[tenant,weekly.id])).toHaveLength(3);
    expect(await db.query('SELECT id FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=$2',[tenant,weekly.id])).toHaveLength(0);
  });
  it("creates a zero-quantity base only when that monthly row is explicitly allowlisted",async()=>{
    const zero=await month("ITEM-ZERO",{required_quantity:0,pending_quantity:0});
    await month("ITEM-ZERO-UNLISTED",{required_quantity:0,pending_quantity:0});
    expect((await run()).metrics.base_created).toBe(0);expect(await bases()).toHaveLength(0);
    await db.transaction(manager=>reconcileMonthlyBasePlans(manager,tenant,user,"合成管理员",[zero.id],[zero.id],false));
    const rows=await bases();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({order_number:"ORDER-A",item_code:"ITEM-ZERO",planned_quantity:"0.0000"});
    expect((await db.query("SELECT * FROM mps_reconciliation_outbox")).length).toBe(0);
  });
  it("repeated and concurrent sync does not duplicate plans, consume more codes or append audits",async()=>{
    await month();await Promise.all([run(),run()]);const [base]=await bases();
    const [{count}]=await db.query("SELECT count(*)::int count FROM audit_logs");expect((await run()).count).toBe(0);
    expect(await bases()).toHaveLength(1);expect((await bases())[0].id).toBe(base.id);
    expect((await db.query("SELECT count(*)::int count FROM audit_logs"))[0].count).toBe(count);
    expect((await db.query("SELECT next_number::text n FROM mps_delivery_code_counters"))[0].n).toBe("2");
  });
  it("rolls back creation and delivery counters if the required audit write fails",async()=>{
    await month();
    await db.query(`CREATE FUNCTION reject_fixture_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$;
      CREATE TRIGGER reject_fixture_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_fixture_audit()`);
    try {
      await expect(run()).rejects.toThrow("synthetic audit failure");
      expect(await bases()).toHaveLength(0);
      expect(await db.query("SELECT * FROM mps_delivery_code_counters")).toHaveLength(0);
    } finally {
      await db.query("DROP TRIGGER reject_fixture_audit ON audit_logs; DROP FUNCTION reject_fixture_audit()");
    }
  });
  it("handles multiple items and tenant boundaries; a date/month change keeps the same base identity",async()=>{
    await month("ITEM-A");await month("ITEM-B");await month("ITEM-A",{tenant_id:"OTHER-TENANT"});await run();
    const before=await bases();expect(before).toHaveLength(2);expect((await db.query("SELECT * FROM mps_base_plans WHERE tenant_id='OTHER-TENANT'")).length).toBe(0);
    await db.query("UPDATE mps_monthly_plans SET order_date='2026-11-01',required_quantity=12,latest_customer_due_date='2026-12-01' WHERE tenant_id=$1 AND item_code='ITEM-A'",[tenant]);
    await run();const after=await bases();expect(after).toHaveLength(2);expect(after[0].id).toBe(before[0].id);expect(after[0].planned_quantity).toBe("12.0000");
  });
  it("reuses the unique legacy shipment base while retaining manual quantity, dates, identity and linkage",async()=>{
    await month();const ship=await insert("mps_shipping_plans",{order_number:"ORDER-A",item_code:"ITEM-A",customer_code:"C1",division_id:division,delivery_number:"009",planned_quantity:4,latest_customer_due_date:"2026-12-02"});
    const legacy=await insert("mps_base_plans",{shipping_plan_id:ship.id,order_number:"ORDER-A",item_code:"ITEM-A",division_id:division,delivery_number:"009",planned_quantity:4,latest_customer_due_date:"2026-12-02",latest_review_due_date:"2026-11-20",blank_completion_date:"2026-11-15"});
    await run();const [row]=await bases();expect(row).toMatchObject({id:legacy.id,shipping_plan_id:ship.id,delivery_number:"009",planned_quantity:"4.0000",blank_completion_date:"2026-11-15"});
    await db.query("UPDATE mps_monthly_plans SET required_quantity=30,latest_customer_due_date='2026-12-25' WHERE tenant_id=$1",[tenant]);await run();expect((await bases())[0].planned_quantity).toBe("4.0000");
  });
  it("retains multiple batches or a division conflict, reports them and never inserts a third base",async()=>{
    await month();for(const delivery of ["001","002"])await insert("mps_base_plans",{order_number:"ORDER-A",item_code:"ITEM-A",division_id:division,delivery_number:delivery,planned_quantity:5,latest_customer_due_date:"2026-11-03"});
    expect((await run()).metrics.base_conflicts).toBe(1);expect(await bases()).toHaveLength(2);
    const [issue]=await db.query("SELECT * FROM mps_data_exceptions WHERE active");expect(issue.message).toContain("多个历史批次尚未确认需求父关系");
    await month("ITEM-B");await insert("mps_base_plans",{order_number:"ORDER-A",item_code:"ITEM-B",division_id:other,delivery_number:"001",planned_quantity:10,latest_customer_due_date:"2026-11-03"});
    expect((await run()).metrics.base_conflicts).toBe(2);expect(await bases()).toHaveLength(3);
  });
  it("keeps manual edits/clears while propagating unchanged automatic quantity/date fields",async()=>{
    await month();await run();let [base]=await bases();
    await application.update("mps-base-plans",base.id,{expectedVersion:base.version,plannedQuantity:"6",latestCustomerDueDate:"2026-12-10",blankCompletionDate:"2026-10-30"},{...actor,requestId:"manual-edit"});
    await db.query("UPDATE mps_monthly_plans SET required_quantity=20,latest_customer_due_date='2026-12-20',item_name='新的品名' WHERE tenant_id=$1",[tenant]);await run();
    [base]=await bases();expect(base.planned_quantity).toBe("6.0000");expect(base.latest_customer_due_date).toBe("2026-12-10");expect(base.item_name).toBe("新的品名");expect(base.blank_completion_date).toBe("2026-10-30");
  });
  it("permits incomplete customer dates, saves partial edits and rejects rollback until pending dates are resolved",async()=>{
    await month("ITEM-A",{latest_customer_due_date:null,customer_due_date:"2026-11-06",preproduction_review_date:"2026-10-02"});await run();const [base]=await bases();
    expect(base.latest_customer_due_date).toBeNull();expect(base.latest_review_due_date).toBeNull();
    await application.update("mps-base-plans",base.id,{expectedVersion:base.version,blankCompletionDate:"2026-10-29"},actor);await weeks();
    expect((await db.query("SELECT * FROM mps_weekly_plans")).length).toBe(0);
    await expect(db.transaction(manager=>new Change().down({query:(s,p)=>manager.query(s,p)} as QueryRunner))).rejects.toThrow("待完善客户交期");
  });
  it("completes a pending base through the actual command, then generates weekly tasks using routes and locks",async()=>{
    await month();await insert("mps_item_process_routes",{item_code:"ITEM-A",process_code:"bending",sequence:1});await insert("mps_item_process_routes",{item_code:"ITEM-A",process_code:"packaging",sequence:2});
    await run();const [base]=await bases();
    await application.update("mps-base-plans",base.id,{expectedVersion:base.version,latestReviewDueDate:"2026-11-01",productAttribute:"五金",surfaceNature:"烤漆",manufacturingMethod:"自制"},{...actor,requestId:"complete"});
    await weeks();const [weekly]=await db.query("SELECT * FROM mps_weekly_plans");expect(weekly.base_plan_id).toBe(base.id);
    const structure=await db.query("SELECT process_code,sequence,cycle_days FROM mps_weekly_process_plans ORDER BY sequence");expect(structure).toEqual([{process_code:"bending",sequence:1,cycle_days:3},{process_code:"packaging",sequence:2,cycle_days:1}]);
    const report=await insert("mps_process_reports",{weekly_plan_id:weekly.id,order_number:"ORDER-A",item_code:"ITEM-A",division_id:division,delivery_number:base.delivery_number,process_code:"bending",process_name:"折弯",production_date:"2026-10-29",production_quantity:3,planned_quantity:10});
    expect((await db.query("SELECT process_config_locked_at FROM mps_weekly_plans"))[0].process_config_locked_at).not.toBeNull();
    await db.query("UPDATE mps_monthly_plans SET required_quantity=15,latest_customer_due_date='2026-11-10' WHERE tenant_id=$1",[tenant]);await run();await weeks();
    expect((await db.query("SELECT * FROM mps_weekly_plans"))[0]).toMatchObject({id:weekly.id,base_plan_id:base.id,planned_quantity:"15.0000"});
    expect(await db.query("SELECT process_code,sequence,cycle_days FROM mps_weekly_process_plans ORDER BY sequence")).toEqual(structure);
    expect((await db.query("SELECT production_quantity FROM mps_process_reports WHERE id=$1",[report.id]))[0].production_quantity).toBe("3.0000");
    expect((await db.query("SELECT * FROM mps_shipping_plans")).length).toBe(0);
  });
  it("keeps shipping query/create/edit independent and never creates a base from a shipping-only item",async()=>{
    const ship=await application.create("mps-shipping-plans",{orderNumber:"SHIP-ONLY",itemCode:"ITEM-S",customerCode:"C1",divisionId:division,plannedQuantity:3,latestCustomerDueDate:"2026-11-10"},{...actor,requestId:"ship-create"});
    await application.update("mps-shipping-plans",ship.id,{expectedVersion:ship.version,plannedQuantity:4},{...actor,requestId:"ship-edit"});
    const page=await queries.list("mps-shipping-plans",{},actor);expect(page.total).toBe(1);expect(page.rows[0].plannedQuantity).toBe("4.0000");
    await run();expect(await bases()).toHaveLength(0);expect((await db.query("SELECT * FROM mps_reconciliation_outbox")).length).toBe(0);
  });

  const externalWeek=async(method="外协")=>{
    await month("ITEM-TRANSITION",{manufacturing_method:method});await run();
    const [base]=await bases();
    await application.update("mps-base-plans",base.id,{expectedVersion:base.version,latestReviewDueDate:"2026-11-10",productAttribute:"五金",surfaceNature:"烤漆"},{...actor,requestId:"prepare-transition"});
    await weeks();
    return {base:(await bases())[0],weekly:(await db.query("SELECT * FROM mps_weekly_plans WHERE tenant_id=$1",[tenant]))[0]};
  };
  const enableInternal=async(base:Record<string,any>)=>application.update("mps-base-plans",base.id,
    {expectedVersion:base.version,manufacturingMethod:"自制+外协"},{...actor,requestId:"enable-internal"});

  it.each(["外协","中心外购"])("initializes internal tasks after %s transitions, then supports real pending report creation",async method=>{
    const {base,weekly}=await externalWeek(method);
    expect(await db.query("SELECT * FROM mps_weekly_process_plans")).toHaveLength(0);
    await db.query("UPDATE mps_outsourcing_reports SET purchase_order_number='SYN-PO',exception_text='人工异常' WHERE weekly_plan_id=$1",[weekly.id]);
    await enableInternal(base);
    const result=await weeks();expect(result.metrics).toMatchObject({process_snapshots_initialized:1,process_tasks_initialized:3});
    const tasks=await db.query("SELECT id,process_code,sequence,cycle_days FROM mps_weekly_process_plans ORDER BY sequence");
    expect(tasks).toHaveLength(3);
    const pending=await queries.list("mps-process-reports",{view:"PENDING"},actor);expect(pending.total).toBe(3);
    expect(pending.rows.every((row:Record<string,unknown>)=>row.weeklyPlanId===weekly.id)).toBe(true);
    expect((await db.query("SELECT * FROM mps_weekly_plans"))[0].id).toBe(weekly.id);
    expect((await db.query("SELECT * FROM mps_outsourcing_reports"))[0]).toMatchObject({purchase_order_number:"SYN-PO",exception_text:"人工异常"});
    expect((await weeks()).metrics.process_tasks_initialized).toBe(0);
    expect(await db.query("SELECT id,process_code,sequence,cycle_days FROM mps_weekly_process_plans ORDER BY sequence")).toEqual(tasks);
    const report=await application.create("mps-process-reports",{weeklyPlanId:weekly.id,processCode:"cutting",productionDate:"2026-11-04",productionQuantity:"10"},{...actor,requestId:"synthetic-report"});
    expect(report.production_quantity).toBe("10.0000");
    expect((await queries.list("mps-process-reports",{view:"PENDING"},actor)).total).toBe(2);
    const facts=await db.query("SELECT id,weekly_plan_id,process_code,production_date,production_quantity,created_by FROM mps_process_reports");
    await weeks();expect(await db.query("SELECT id,weekly_plan_id,process_code,production_date,production_quantity,created_by FROM mps_process_reports")).toEqual(facts);
  });

  it('does not deadlock concurrent executors on lifecycle SHARE locks when120 is absent',async()=>{
    const {base,weekly}=await externalWeek();await enableInternal(base);
    await Promise.all([weeks(),weeks()]);
    expect(await db.query('SELECT * FROM mps_weekly_process_plans')).toHaveLength(3);
    expect(await db.query("SELECT * FROM audit_logs WHERE action='mps-weekly-plans.process_config_initialized' AND record_id=$1",[weekly.id])).toHaveLength(1);
  });

  it("initializes once under concurrent sync and does not apply later route changes",async()=>{
    const {base,weekly}=await externalWeek();await enableInternal(base);
    // Production synchronization has used the 1A runner since118. Exercise
    // that public entrypoint, including busy rejection and a real retry;
    // calling the private executor twice bypasses its lease/mutex contract.
    await db.query(`INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,created_by,updated_by)
      VALUES($1,'base-to-weekly','合成正式同步',true,$2,$2) ON CONFLICT(tenant_id,sync_key) DO UPDATE SET enabled=true`,[tenant,user]);
    const keys=['fixture-concurrent-first','fixture-concurrent-second'];
    const formal=(key:string)=>service.run(tenant,'base-to-weekly','MANUAL',user,'合成用户',key);
    const results=await Promise.allSettled(keys.map(formal));
    expect(results.some(result=>result.status==='fulfilled')).toBe(true);
    for(const [index,result]of results.entries()){
      if(result.status==='fulfilled')expect(result.value.status).toBe('SUCCESS');
      else{
        expect(result.reason).toMatchObject({status:409});
        expect(result.reason.message).toBe('该同步任务正在运行');
        expect((await formal(keys[index])).status).toBe('SUCCESS');
      }
    }
    expect(await db.query("SELECT * FROM mps_weekly_process_plans")).toHaveLength(3);
    expect((await db.query("SELECT * FROM audit_logs WHERE action='mps-weekly-plans.process_config_initialized' AND record_id=$1",[weekly.id]))).toHaveLength(1);
    const snapshot=await db.query("SELECT id,process_code,sequence,cycle_days FROM mps_weekly_process_plans ORDER BY sequence");
    await insert("mps_item_process_routes",{item_code:base.item_code,process_code:"packaging",sequence:1});
    await weeks();expect(await db.query("SELECT id,process_code,sequence,cycle_days FROM mps_weekly_process_plans ORDER BY sequence")).toEqual(snapshot);
  });

  it("preserves an explicitly confirmed empty route instead of silently enabling it",async()=>{
    const {base,weekly}=await externalWeek();
    const preview=await service.previewWeeklyProcessConfig(weekly.id,actor);
    await service.confirmWeeklyProcessConfig(weekly.id,preview,actor);
    await enableInternal(base);await weeks();
    expect(await db.query("SELECT * FROM mps_weekly_process_plans")).toHaveLength(0);
  });

  it("does not bootstrap a week with a legacy report even if its durable lock is missing",async()=>{
    const {base,weekly}=await externalWeek();
    await insert("mps_process_reports",{weekly_plan_id:weekly.id,division_id:division,order_number:weekly.order_number,item_code:weekly.item_code,delivery_number:weekly.delivery_number,process_code:"cutting",process_name:"下料",production_date:"2026-11-04",planned_quantity:10,production_quantity:1});
    // Deliberate legacy-corruption fixture, restricted to the isolated test database.
    await db.query("UPDATE mps_weekly_plans SET process_config_locked_at=NULL WHERE id=$1",[weekly.id]);
    await enableInternal(base);await weeks();
    expect(await db.query("SELECT * FROM mps_weekly_process_plans")).toHaveLength(0);
    expect((await db.query("SELECT production_quantity FROM mps_process_reports"))[0].production_quantity).toBe("1.0000");
  });

  it("preserves partial or disabled tasks instead of treating them as an uninitialized route",async()=>{
    const {base,weekly}=await externalWeek();
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.mps_process_config_write_mode','CONFIRM',true)");
      await manager.query(`INSERT INTO mps_weekly_process_plans(tenant_id,weekly_plan_id,process_code,process_name,sequence,cycle_days,execution_enabled,created_by,updated_by)
        VALUES($1,$2,'cutting','下料',1,2,false,$3,$3)`,[tenant,weekly.id,user]);
    });
    await enableInternal(base);await weeks();
    expect(await db.query("SELECT process_code,execution_enabled FROM mps_weekly_process_plans")).toEqual([{process_code:"cutting",execution_enabled:false}]);
  });

  it("records an initialized empty default route so later default changes require confirmation",async()=>{
    const {base}=await externalWeek();await enableInternal(base);
    try {
      await db.query("UPDATE mps_division_process_configs SET default_enabled=false WHERE tenant_id=$1",[tenant]);
      expect((await weeks()).metrics).toMatchObject({process_snapshots_initialized:1,process_tasks_initialized:0});
      await db.query("UPDATE mps_division_process_configs SET default_enabled=true WHERE tenant_id=$1",[tenant]);
      expect((await weeks()).metrics.process_tasks_initialized).toBe(0);
      expect(await db.query("SELECT * FROM mps_weekly_process_plans")).toHaveLength(0);
    } finally {await db.query("UPDATE mps_division_process_configs SET default_enabled=true WHERE tenant_id=$1",[tenant]);}
  });

  it("rolls back task initialization on failure and can safely retry",async()=>{
    const {base,weekly}=await externalWeek();await enableInternal(base);
    const failure=jest.spyOn(service as any,"auditProcessConfig").mockRejectedValueOnce(new Error("synthetic audit failure"));
    try {await expect(weeks()).rejects.toThrow("synthetic audit failure");} finally {failure.mockRestore();}
    expect(await db.query("SELECT * FROM mps_weekly_process_plans")).toHaveLength(0);
    expect(await db.query("SELECT * FROM audit_logs WHERE action='mps-weekly-plans.process_config_initialized' AND record_id=$1",[weekly.id])).toHaveLength(0);
    expect((await weeks()).metrics.process_tasks_initialized).toBe(3);
  });

  it("uses the same safe initializer for a single existing weekly execution refresh",async()=>{
    const {weekly}=await externalWeek();
    await db.query("UPDATE mps_weekly_plans SET manufacturing_method='自制+外协' WHERE id=$1",[weekly.id]);
    await db.transaction(manager=>service.refreshWeeklyExecution(manager,weekly.id,tenant,user,user));
    expect((await queries.list("mps-process-reports",{view:"PENDING"},actor)).total).toBe(3);
    const snapshot=await db.query("SELECT id,process_code,cycle_days,sequence FROM mps_weekly_process_plans ORDER BY sequence");
    await db.transaction(manager=>service.refreshWeeklyExecution(manager,weekly.id,tenant,user,user));
    expect(await db.query("SELECT id,process_code,cycle_days,sequence FROM mps_weekly_process_plans ORDER BY sequence")).toEqual(snapshot);
  });
});
