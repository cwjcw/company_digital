import { DataSource, type QueryRunner } from "typeorm";
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
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import type { MasterPlanActor } from "./master-plan.types";

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
      CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text,actor_id uuid,actor_name text,resource text,record_id uuid,action text,before_json jsonb,after_json jsonb,request_id text,source text,created_by uuid,updated_by uuid,created_at timestamptz DEFAULT clock_timestamp());
      INSERT INTO users(id,username,display_name)VALUES('${user}','synthetic','合成用户');
      INSERT INTO organization_units(id,name)VALUES('${division}','合成事业部'),('${other}','另一事业部');`);
    const runner={query:(sql:string,params?:unknown[])=>db.query(sql,params)} as QueryRunner;
    for(const Migration of [Initial,Integrity,ShippingReference,Manual,Divisions,Eligibility,Identity,Codes,Routing,Dates,Change])await new Migration().up(runner);
    await db.query(`ALTER TABLE mps_reconciliation_outbox ADD COLUMN IF NOT EXISTS record_id uuid,ADD COLUMN IF NOT EXISTS scope_json jsonb;
      ALTER TABLE mps_base_plans ADD COLUMN IF NOT EXISTS blank_completion_date date,ADD COLUMN IF NOT EXISTS packaging_completion_date date;
      ALTER TABLE mps_process_cycles ADD COLUMN IF NOT EXISTS blank_days integer;
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
    const [issue]=await db.query("SELECT * FROM mps_data_exceptions WHERE active");expect(issue.message).toContain("多个基础计划批次");
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
});
