import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import original from "../../data-source";
import { AuthGuard } from "../../auth";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MASTER_PLAN_SYSTEM_USER_ID } from "./master-plan.sync.service";
import { linkNewDemandRecord } from "./master-plan.demand-links";
import { reconcileAllocationPlans } from "./master-plan.allocation-projection";
import { AllocationProjectionYieldError, yieldAllocationProjectionToWaitingWriters } from "./master-plan.allocation-projection-lock";
import { reconcileMonthlyBasePlans } from "./master-plan.monthly-base";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MasterPlanController } from "./master-plan.controller";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";
import { MasterPlanWorkOrderService } from "./master-plan.work-order.service";
import { OrderAllocationConfigService } from "./order-allocation-config.service";
import { MasterPlanLifecycleService } from "./master-plan.lifecycle.service";
import { MasterPlanDemandLinkService } from "./master-plan.demand-link.service";
import { MasterPlanDemandQuantityService } from "./master-plan.demand-quantity.service";
import type { MasterPlanActor } from "./master-plan.types";

const integration=process.env.KDOS_POSTGRES_INTEGRATION==="true"?describe:describe.skip;
integration("Allocation division transfer actual PostgreSQL, isolated fixture",()=>{
  let db:DataSource,service:MasterPlanApplicationService,httpApp:INestApplication,tenant:string,sourceDivision:string,targetDivision:string,routeSourceDivision:string,routeTargetDivision:string,temporaryProcurementId:string|undefined,allocationId:string,contendedAllocationId:string,inboundAllocationId:string,monthlyAllocationId:string,monthlyPlanId:string,baseAllocationId:string,baseMonthlyId:string,shippingPlanId:string,basePlanId:string,weeklyAllocationId:string,weeklyMonthlyId:string,weeklyShippingId:string,weeklyBaseId:string,weeklyPlanId:string,safeAllocationId:string,safeMonthlyId:string,safeShippingId:string,safeBaseId:string,safeWeeklyPlanId:string,key:string,monthlyKey:string,baseKey:string,safeWeeklyKey:string;
  const actor=():MasterPlanActor=>({tenantId:tenant,userId:MASTER_PLAN_SYSTEM_USER_ID,username:"isolated-test",permissions:["*"],isSystemAdmin:true,moduleAdminCodes:[],tableDataScopes:[],requestId:`transfer-test-${key}`,source:"web"});
  const previousTenantCode=process.env.KDOS_DEFAULT_TENANT_CODE;
  beforeAll(async()=>{
    const options=original.options;if(options.type!=="postgres")throw new Error("Requires isolated PostgreSQL");
    db=new DataSource({...options,entities:[],migrations:[],subscribers:[],poolSize:2});await db.initialize();
    tenant=`MPS-DIV-TRANSFER-${Date.now()}`;
    process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
    sourceDivision="0199bb00-0000-7000-8000-000000000101";targetDivision="0199bb00-0000-7000-8000-000000000102";
    routeSourceDivision=randomUUID();routeTargetDivision=randomUUID();
    allocationId="0199bb00-0000-7000-8000-000000000103";contendedAllocationId="0199bb00-0000-7000-8000-000000000128";inboundAllocationId="0199bb00-0000-7000-8000-000000000105";monthlyAllocationId="0199bb00-0000-7000-8000-000000000106";monthlyPlanId="0199bb00-0000-7000-8000-000000000107";baseAllocationId="0199bb00-0000-7000-8000-000000000110";baseMonthlyId="0199bb00-0000-7000-8000-000000000111";shippingPlanId="0199bb00-0000-7000-8000-000000000112";basePlanId="0199bb00-0000-7000-8000-000000000113";weeklyAllocationId="0199bb00-0000-7000-8000-000000000115";weeklyMonthlyId="0199bb00-0000-7000-8000-000000000116";weeklyShippingId="0199bb00-0000-7000-8000-000000000117";weeklyBaseId="0199bb00-0000-7000-8000-000000000118";weeklyPlanId="0199bb00-0000-7000-8000-000000000119";safeAllocationId="0199bb00-0000-7000-8000-000000000121";safeMonthlyId="0199bb00-0000-7000-8000-000000000122";safeShippingId="0199bb00-0000-7000-8000-000000000123";safeBaseId="0199bb00-0000-7000-8000-000000000124";safeWeeklyPlanId="0199bb00-0000-7000-8000-000000000126";key="0199bb00-0000-7000-8000-000000000104";monthlyKey="0199bb00-0000-7000-8000-000000000109";baseKey="0199bb00-0000-7000-8000-000000000114";safeWeeklyKey="0199bb00-0000-7000-8000-000000000127";
    await db.query("INSERT INTO organization_units(id,name,level,enabled) VALUES($1,'隔离源事业部',1,true),($2,'隔离目标事业部',1,true),($3,'隔离工序源事业部',1,true),($4,'隔离工序目标事业部',1,true)",[sourceDivision,targetDivision,routeSourceDivision,routeTargetDivision]);
    await db.query("INSERT INTO users(id,username,display_name,password_hash,enabled,must_change_password) VALUES('0199bb00-0000-7000-8000-000000000108','transfer-test-actor','隔离测试用户','!',true,false)");
    await db.query(`INSERT INTO mps_sync_configs(tenant_id,sync_key,name,created_by,updated_by)
      VALUES($1,'shipping-to-base','隔离交期转基础计划',$2::uuid,$2::uuid),($1,'base-to-weekly','隔离基础转周计划',$2::uuid,$2::uuid)`,[tenant,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-TEST-ORDER','TRANSFER-TEST-ITEM','TEST-CUSTOMER','隔离测试品项','已审核',50,$3::uuid,$4::uuid,$4::uuid,true)`,[allocationId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-TEST-ORDER','TRANSFER-TEST-ITEM-2','TEST-CUSTOMER','同订单第二品项','已审核',20,$3::uuid,$4::uuid,$4::uuid,true)`,[contendedAllocationId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-INBOUND-ORDER','TRANSFER-INBOUND-ITEM','TEST-CUSTOMER','无工序任务但有入库','已审核',12,$3::uuid,$4::uuid,$4::uuid,true)`,[inboundAllocationId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_monthly_plans(tenant_id,allocation_id,order_number,item_code,division_id,required_quantity,cumulative_inbound_quantity,created_by,updated_by)
      VALUES($1,$2::uuid,'TRANSFER-INBOUND-ORDER','TRANSFER-INBOUND-ITEM',$3::uuid,12,3,$4::uuid,$4::uuid)`,[tenant,inboundAllocationId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-MONTH-ORDER','TRANSFER-MONTH-ITEM','TEST-CUSTOMER','人工计划字段保留','已审核',25,$3::uuid,$4::uuid,$4::uuid,true)`,[monthlyAllocationId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_monthly_plans(id,tenant_id,allocation_id,order_number,item_code,division_id,customer_code,item_name,required_quantity,pending_quantity,remark,latest_customer_due_date,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TRANSFER-MONTH-ORDER','TRANSFER-MONTH-ITEM',$4::uuid,'TEST-CUSTOMER','人工计划字段保留',25,25,'手工维护备注','2026-12-31',$5::uuid,$5::uuid)`,[monthlyPlanId,tenant,monthlyAllocationId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [allocation]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,monthlyAllocationId]);
      await linkNewDemandRecord(manager,'mps-order-allocations',allocation,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-fixture-${tenant}`);
    });
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-BASE-ORDER','TRANSFER-BASE-ITEM','TEST-CUSTOMER','基础人工字段','已审核',40,$3::uuid,$4::uuid,$4::uuid,true)`,[baseAllocationId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_monthly_plans(id,tenant_id,allocation_id,order_number,item_code,division_id,customer_code,item_name,required_quantity,pending_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TRANSFER-BASE-ORDER','TRANSFER-BASE-ITEM',$4::uuid,'TEST-CUSTOMER','基础人工字段',40,40,$5::uuid,$5::uuid)`,[baseMonthlyId,tenant,baseAllocationId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [allocation]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,baseAllocationId]);
      await linkNewDemandRecord(manager,'mps-order-allocations',allocation,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-base-fixture-${tenant}`);
    });
    await db.query(`INSERT INTO mps_shipping_plans(id,tenant_id,monthly_plan_id,customer_code,order_number,item_code,delivery_number,item_name,order_date,latest_customer_due_date,planned_quantity,division_id,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TEST-CUSTOMER','TRANSFER-BASE-ORDER','TRANSFER-BASE-ITEM',1,'基础人工字段','2026-10-01','2026-12-20',40,$4::uuid,$5::uuid,$5::uuid)`,[shippingPlanId,tenant,baseMonthlyId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_base_plans(id,tenant_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,planned_quantity,latest_review_due_date,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,$4::uuid,'TEST-CUSTOMER','TRANSFER-BASE-ORDER','TRANSFER-BASE-ITEM','基础人工字段',1,'2026-10-01','2026-12-20',40,'2026-11-30',$5::uuid,$5::uuid)`,[basePlanId,tenant,shippingPlanId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [base]=await manager.query("SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,basePlanId]);
      await linkNewDemandRecord(manager,'mps-base-plans',base,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-base-link-fixture-${tenant}`);
    });
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-WEEK-ORDER','TRANSFER-WEEK-ITEM','TEST-CUSTOMER','周计划测试','已审核',20,$3::uuid,$4::uuid,$4::uuid,true)`,[weeklyAllocationId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_monthly_plans(id,tenant_id,allocation_id,order_number,item_code,division_id,customer_code,item_name,required_quantity,pending_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TRANSFER-WEEK-ORDER','TRANSFER-WEEK-ITEM',$4::uuid,'TEST-CUSTOMER','周计划测试',20,20,$5::uuid,$5::uuid)`,[weeklyMonthlyId,tenant,weeklyAllocationId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [allocation]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,weeklyAllocationId]);
      await linkNewDemandRecord(manager,'mps-order-allocations',allocation,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-week-fixture-${tenant}`);
    });
    await db.query(`INSERT INTO mps_shipping_plans(id,tenant_id,monthly_plan_id,customer_code,order_number,item_code,delivery_number,item_name,order_date,latest_customer_due_date,planned_quantity,division_id,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TEST-CUSTOMER','TRANSFER-WEEK-ORDER','TRANSFER-WEEK-ITEM',1,'周计划测试','2026-10-01','2026-12-20',20,$4::uuid,$5::uuid,$5::uuid)`,[weeklyShippingId,tenant,weeklyMonthlyId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_base_plans(id,tenant_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,planned_quantity,latest_review_due_date,manufacturing_method,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,$4::uuid,'TEST-CUSTOMER','TRANSFER-WEEK-ORDER','TRANSFER-WEEK-ITEM','周计划测试',1,'2026-10-01','2026-12-20',20,'2026-11-30','自制',$5::uuid,$5::uuid)`,[weeklyBaseId,tenant,weeklyShippingId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [base]=await manager.query("SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,weeklyBaseId]);
      await linkNewDemandRecord(manager,'mps-base-plans',base,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-week-base-link-${tenant}`);
    });
    await db.query(`INSERT INTO mps_weekly_plans(id,tenant_id,base_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,latest_customer_due_date,latest_review_due_date,planned_quantity,pending_quantity,manufacturing_method,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,$4::uuid,'TEST-CUSTOMER','TRANSFER-WEEK-ORDER','TRANSFER-WEEK-ITEM','周计划测试',1,'2026-12-20','2026-11-30',20,20,'自制',$5::uuid,$5::uuid)`,[weeklyPlanId,tenant,weeklyBaseId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-SAFE-WEEK-ORDER','TRANSFER-SAFE-WEEK-ITEM','TEST-CUSTOMER','安全周计划迁移','已审核',18,$3::uuid,$4::uuid,$4::uuid,true)`,[safeAllocationId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_monthly_plans(id,tenant_id,allocation_id,order_number,item_code,division_id,customer_code,item_name,required_quantity,pending_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TRANSFER-SAFE-WEEK-ORDER','TRANSFER-SAFE-WEEK-ITEM',$4::uuid,'TEST-CUSTOMER','安全周计划迁移',18,18,$5::uuid,$5::uuid)`,[safeMonthlyId,tenant,safeAllocationId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [allocation]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeAllocationId]);
      await linkNewDemandRecord(manager,'mps-order-allocations',allocation,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-safe-week-fixture-${tenant}`);
    });
    await db.query(`INSERT INTO mps_shipping_plans(id,tenant_id,monthly_plan_id,customer_code,order_number,item_code,delivery_number,item_name,order_date,latest_customer_due_date,planned_quantity,division_id,created_by,updated_by)
      VALUES('0199bb00-0000-7000-8000-000000000123',$1,$2::uuid,'TEST-CUSTOMER','TRANSFER-SAFE-WEEK-ORDER','TRANSFER-SAFE-WEEK-ITEM',1,'安全周计划迁移','2026-10-01','2026-12-20',18,$3::uuid,$4::uuid,$4::uuid)`,[tenant,safeMonthlyId,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_base_plans(id,tenant_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,planned_quantity,latest_review_due_date,manufacturing_method,product_attribute,surface_nature,created_by,updated_by)
      VALUES('0199bb00-0000-7000-8000-000000000124',$1,'0199bb00-0000-7000-8000-000000000123'::uuid,$2::uuid,'TEST-CUSTOMER','TRANSFER-SAFE-WEEK-ORDER','TRANSFER-SAFE-WEEK-ITEM','安全周计划迁移',1,'2026-10-01','2026-12-20',18,'2026-11-30','自制','五金','毛坯',$3::uuid,$3::uuid)`,[tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [base]=await manager.query("SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id='0199bb00-0000-7000-8000-000000000124'::uuid",[tenant]);
      await linkNewDemandRecord(manager,'mps-base-plans',base,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-safe-week-base-fixture-${tenant}`);
    });
    await db.query(`INSERT INTO mps_weekly_plans(id,tenant_id,base_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,latest_customer_due_date,latest_review_due_date,planned_quantity,pending_quantity,manufacturing_method,created_by,updated_by)
      VALUES($1::uuid,$2,'0199bb00-0000-7000-8000-000000000124'::uuid,$3::uuid,'TEST-CUSTOMER','TRANSFER-SAFE-WEEK-ORDER','TRANSFER-SAFE-WEEK-ITEM','安全周计划迁移',1,'2026-12-20','2026-11-30',18,18,'自制',$4::uuid,$4::uuid)`,[safeWeeklyPlanId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    const sync=new MasterPlanSyncService(db);
    service=new MasterPlanApplicationService(db,Object.assign(sync,{processOutbox:jest.fn().mockResolvedValue(undefined)}) as never);
    const module=await Test.createTestingModule({controllers:[MasterPlanController],providers:[
      {provide:MasterPlanQueryService,useValue:new MasterPlanQueryService(db,{listEnabled:async()=>[
        {id:sourceDivision,name:"隔离源事业部",pathLabel:"隔离源事业部"},{id:targetDivision,name:"隔离目标事业部",pathLabel:"隔离目标事业部"},
        {id:routeSourceDivision,name:"隔离路线源事业部",pathLabel:"隔离路线源事业部"},{id:routeTargetDivision,name:"隔离路线目标事业部",pathLabel:"隔离路线目标事业部"}
      ]} as never)},
      {provide:MasterPlanApplicationService,useValue:service},{provide:MasterPlanSyncService,useValue:sync},
      {provide:MasterPlanSpreadsheetService,useValue:{}},{provide:MasterPlanWorkOrderService,useValue:{}},
      {provide:OrderAllocationConfigService,useValue:{}},{provide:MasterPlanLifecycleService,useValue:{}},
      {provide:MasterPlanDemandLinkService,useValue:{}},{provide:MasterPlanDemandQuantityService,useValue:{}}
    ]}).overrideGuard(AuthGuard).useValue({canActivate:(context:any)=>{
      const req=context.switchToHttp().getRequest();req.user={sub:MASTER_PLAN_SYSTEM_USER_ID,username:"isolated-http",displayName:"隔离HTTP用户",permissions:["*"],isSystemAdmin:true};
      req.requestId=`transfer-http-${randomUUID()}`;return true;
    }}).compile();
    httpApp=module.createNestApplication();httpApp.setGlobalPrefix("api/v1");await httpApp.init();
  },30000);
  afterAll(async()=>{
    await httpApp?.close();
    if(db?.isInitialized){
      await db.transaction(async manager=>{
        await manager.query("SET LOCAL session_replication_role='replica'");
        await manager.query("DELETE FROM mps_reconciliation_outbox WHERE tenant_id=$1",[tenant]);
        await manager.query("DELETE FROM idempotency_keys WHERE key LIKE $1",[`mps-allocation-division-transfer:${tenant}:%`]);
        await manager.query("DELETE FROM mps_sync_logs WHERE tenant_id=$1",[tenant]);
        await manager.query("DELETE FROM mps_sync_configs WHERE tenant_id=$1",[tenant]);
        await manager.query("DELETE FROM audit_logs WHERE tenant_id=$1",[tenant]);
        await manager.query("DELETE FROM mps_data_exceptions WHERE tenant_id=$1",[tenant]);
        await manager.query("DELETE FROM mps_base_plans WHERE tenant_id=$1 AND order_number='TRANSFER-LEGACY-DIRECT-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number='TRANSFER-LEGACY-DIRECT-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND order_number='TRANSFER-LEGACY-DIRECT-ORDER'",[tenant]);
        if(temporaryProcurementId)await manager.query("DELETE FROM organization_units WHERE id=$1::uuid",[temporaryProcurementId]);
        await manager.query("DELETE FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id IN(SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND order_number='TRANSFER-ROUTE-ORDER')",[tenant]);
        await manager.query("DELETE FROM mps_three_day_work_orders WHERE tenant_id=$1 AND order_number='TRANSFER-ROUTE-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_weekly_plans WHERE tenant_id=$1 AND order_number='TRANSFER-ROUTE-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_base_plans WHERE tenant_id=$1 AND order_number='TRANSFER-ROUTE-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_shipping_plans WHERE tenant_id=$1 AND order_number='TRANSFER-ROUTE-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number='TRANSFER-ROUTE-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_group_plans WHERE tenant_id=$1 AND order_number='TRANSFER-ROUTE-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND order_number='TRANSFER-ROUTE-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_division_process_configs WHERE tenant_id=$1",[tenant]);
        await manager.query("DELETE FROM mps_group_plans WHERE tenant_id=$1 AND order_number=ANY($2::text[])",[tenant,["TRANSFER-TEST-ORDER","TRANSFER-INBOUND-ORDER","TRANSFER-MONTH-ORDER","TRANSFER-BASE-ORDER","TRANSFER-SAFE-WEEK-ORDER"]]);
        await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number='TRANSFER-INBOUND-ORDER'",[tenant]);
        await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,monthlyPlanId]);
        await manager.query("DELETE FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,basePlanId]);
        await manager.query("DELETE FROM mps_shipping_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,shippingPlanId]);
        await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,baseMonthlyId]);
        await manager.query("DELETE FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,weeklyPlanId]);
        await manager.query("DELETE FROM mps_technical_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,weeklyPlanId]);
        await manager.query("DELETE FROM mps_material_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,weeklyPlanId]);
        await manager.query("DELETE FROM mps_outsourcing_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,weeklyPlanId]);
        await manager.query("DELETE FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,weeklyPlanId]);
        await manager.query("DELETE FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,weeklyPlanId]);
        await manager.query("DELETE FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,weeklyBaseId]);
        await manager.query("DELETE FROM mps_shipping_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,weeklyShippingId]);
        await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,weeklyMonthlyId]);
        await manager.query("DELETE FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,safeWeeklyPlanId]);
        await manager.query("DELETE FROM mps_technical_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,safeWeeklyPlanId]);
        await manager.query("DELETE FROM mps_material_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,safeWeeklyPlanId]);
        await manager.query("DELETE FROM mps_outsourcing_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,safeWeeklyPlanId]);
        await manager.query("DELETE FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,safeWeeklyPlanId]);
        await manager.query("DELETE FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeWeeklyPlanId]);
        await manager.query("DELETE FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeBaseId]);
        await manager.query("DELETE FROM mps_shipping_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeShippingId]);
        await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeMonthlyId]);
        await manager.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenant,[inboundAllocationId,monthlyAllocationId,allocationId,contendedAllocationId]]);
        await manager.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,baseAllocationId]);
        await manager.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,weeklyAllocationId]);
        await manager.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeAllocationId]);
        await manager.query("DELETE FROM users WHERE id='0199bb00-0000-7000-8000-000000000108'");
      await manager.query("DELETE FROM organization_units WHERE id=ANY($1::uuid[])",[[sourceDivision,targetDivision,routeSourceDivision,routeTargetDivision]]);
      });
      await db.destroy();
    }
    if(previousTenantCode===undefined)delete process.env.KDOS_DEFAULT_TENANT_CODE;else process.env.KDOS_DEFAULT_TENANT_CODE=previousTenantCode;
  });

  it("commits only the source allocation with audit and outbox, reloads the saved division, and is idempotent",async()=>{
    const preview=await service.previewAllocationDivisionTransfer(allocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(preview).toMatchObject({canTransfer:true,allocatedQuantity:"50",monthlyPlanCount:0,basePlanCount:0,weeklyPlanCount:0,hasInbound:false});
    const input={targetDivisionId:targetDivision,expectedVersion:1,previewFingerprint:preview.previewFingerprint,reason:"隔离验证事业部变更",idempotencyKey:key};
    await expect(service.confirmAllocationDivisionTransfer(allocationId,input,actor())).resolves.toMatchObject({status:"PENDING",version:2});
    const [row]=await db.query("SELECT division_id,allocated_quantity,version FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,allocationId]);
    expect(row).toMatchObject({division_id:targetDivision,allocated_quantity:"50.0000",version:2});
    expect(await db.query("SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND record_id=$2 AND action='division_transfer.confirmed'",[tenant,allocationId])).toHaveLength(1);
    expect(await db.query("SELECT 1 FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND sync_key='plan-projections' AND record_id=$2::uuid",[tenant,allocationId])).toHaveLength(1);
    await expect(service.confirmAllocationDivisionTransfer(allocationId,input,actor())).resolves.toMatchObject({status:"PENDING",repeated:true});
    expect(await db.query("SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND record_id=$2 AND action='division_transfer.confirmed'",[tenant,allocationId])).toHaveLength(1);
    await expect(service.allocationDivisionTransferStatus(allocationId,key,actor())).resolves.toMatchObject({status:"PENDING",version:2});
    await db.query("UPDATE mps_reconciliation_outbox SET status='SUCCESS',completed_at=now() WHERE tenant_id=$1 AND idempotency_key=$2",[tenant,(await db.query("SELECT response_json->>'outboxKey' key FROM idempotency_keys WHERE key=$1",[`mps-allocation-division-transfer:${tenant}:${MASTER_PLAN_SYSTEM_USER_ID}:${key}`]))[0].key]);
    await expect(service.allocationDivisionTransferStatus(allocationId,key,actor())).resolves.toMatchObject({
      status:"SUCCESS",version:2,
      stages:{allocation:"COMMITTED",groupAndMonthly:"SUCCESS",base:"NOT_APPLICABLE",weekly:"NOT_APPLICABLE",processTasks:"NOT_APPLICABLE"}
    });
  });

  it("yields a tenant projection lock so a second item in the same order transfers promptly",async()=>{
    const [current]=await db.query("SELECT division_id,version FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,contendedAllocationId]);
    const destination=String(current.division_id)===sourceDivision?targetDivision:sourceDivision;
    const preview=await service.previewAllocationDivisionTransfer(contendedAllocationId,{targetDivisionId:destination,expectedVersion:Number(current.version)},actor());
    expect(preview.canTransfer).toBe(true);
    const requestId=randomUUID();
    const owner=db.createQueryRunner();
    await owner.connect();await owner.startTransaction();
    await owner.manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
    await owner.manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${tenant}:mps-allocation-projection`]);
    await owner.manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${tenant}:mps-existing-monthly-inbound`]);
    const confirmedAt=Date.now();
    const confirm=service.confirmAllocationDivisionTransfer(contendedAllocationId,{targetDivisionId:destination,expectedVersion:Number(current.version),
      previewFingerprint:preview.previewFingerprint,reason:"隔离并发锁让行测试",idempotencyKey:requestId},actor());
    let queued=false,queuedDetectedAt=0;
    let releasedAt=0;
    try{
      for(let attempt=0;attempt<100;attempt++){
        try{await yieldAllocationProjectionToWaitingWriters(owner.manager,tenant);}
        catch(error){if(error instanceof AllocationProjectionYieldError){queued=true;queuedDetectedAt=Date.now();break;}throw error;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(queued).toBe(true);
      await expect(yieldAllocationProjectionToWaitingWriters(owner.manager,tenant)).rejects.toBeInstanceOf(AllocationProjectionYieldError);
    }finally{
      if(owner.isTransactionActive)await owner.rollbackTransaction();releasedAt=Date.now();await owner.release();
    }
    await expect(confirm).resolves.toMatchObject({status:"PENDING",version:Number(current.version)+1});
    expect(Date.now()-confirmedAt).toBeLessThan(3000);
    const [saved]=await db.query("SELECT division_id,version FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,contendedAllocationId]);
    expect(saved).toMatchObject({division_id:destination,version:Number(current.version)+1});
    console.log(`allocation-transfer contention: confirm=${Date.now()-confirmedAt}ms; queued-writer-detected-to-release=${releasedAt-queuedDetectedAt}ms`);
  });

  it("does not classify monthly accumulated inbound without process tasks as a no-execution transfer",async()=>{
    const preview=await service.previewAllocationDivisionTransfer(inboundAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(preview.hasInbound).toBe(true);
    expect(preview.canTransfer).toBe(false);
    expect(preview.reasons).toContain("检测到入库事实，需核对其来源与归属");
    expect(preview.weeklyPlanCount).toBe(0);
  });

  it("moves a formally linked monthly plan in one audited transaction and projection keeps its identity and quantity",async()=>{
    const targetConflictAllocationId=randomUUID(),targetConflictMonthlyId=randomUUID(),secondSourceId=randomUUID();
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-MONTH-ORDER','TRANSFER-MONTH-ITEM','TEST-CUSTOMER','目标冲突来源','已审核',25,$3::uuid,$4::uuid,$4::uuid,true)`,[targetConflictAllocationId,tenant,targetDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_monthly_plans(id,tenant_id,allocation_id,order_number,item_code,division_id,required_quantity,pending_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TRANSFER-MONTH-ORDER','TRANSFER-MONTH-ITEM',$4::uuid,25,25,$5::uuid,$5::uuid)`,[targetConflictMonthlyId,tenant,targetConflictAllocationId,targetDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    const targetConflict=await service.previewAllocationDivisionTransfer(monthlyAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(targetConflict).toMatchObject({canTransfer:false,targetMonthlyPlanCount:1});
    expect(targetConflict.reasons).toContain("目标事业部已存在同订单品项计划，需先核对冲突");
    await db.transaction(async manager=>{
      await manager.query("SET LOCAL session_replication_role='replica'");
      await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,targetConflictMonthlyId]);
      await manager.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,targetConflictAllocationId]);
    });
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-MONTH-ORDER','TRANSFER-MONTH-ITEM','TEST-CUSTOMER','第二条分配来源','已审核',5,$3::uuid,$4::uuid,$4::uuid,true)`,[secondSourceId,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    const multipleSources=await service.previewAllocationDivisionTransfer(monthlyAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(multipleSources.canTransfer).toBe(false);
    expect(multipleSources.reasons).toContain("同订单品项存在多条有效分配来源，不能单独迁移月度计划");
    await db.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,secondSourceId]);
    const stalePreview=await service.previewAllocationDivisionTransfer(monthlyAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(stalePreview).toMatchObject({canTransfer:true,monthlyPlanCount:1,basePlanCount:0,weeklyPlanCount:0,hasInbound:false});
    await db.query("UPDATE mps_order_allocations SET version=2 WHERE tenant_id=$1 AND id=$2::uuid",[tenant,monthlyAllocationId]);
    await expect(service.confirmAllocationDivisionTransfer(monthlyAllocationId,{targetDivisionId:targetDivision,expectedVersion:1,
      previewFingerprint:stalePreview.previewFingerprint,reason:"隔离验证过期预览",idempotencyKey:monthlyKey},actor())).rejects.toThrow("订单分配记录已变化，请重新预览");
    const preview=await service.previewAllocationDivisionTransfer(monthlyAllocationId,{targetDivisionId:targetDivision,expectedVersion:2},actor());
    expect(preview).toMatchObject({canTransfer:true,monthlyPlanCount:1,basePlanCount:0,weeklyPlanCount:0,hasInbound:false});
    const result=await service.confirmAllocationDivisionTransfer(monthlyAllocationId,{targetDivisionId:targetDivision,expectedVersion:2,
      previewFingerprint:preview.previewFingerprint,reason:"隔离验证无执行月度计划迁移",idempotencyKey:monthlyKey},actor());
    expect(result.persisted).toMatchObject({allocationDivisionId:targetDivision,monthlyPlanId,monthlyDivisionId:targetDivision});
    await expect(service.confirmAllocationDivisionTransfer(monthlyAllocationId,{targetDivisionId:targetDivision,expectedVersion:2,
      previewFingerprint:preview.previewFingerprint,reason:"隔离验证无执行月度计划迁移",idempotencyKey:monthlyKey},actor())).resolves.toMatchObject({repeated:true});
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      await reconcileAllocationPlans(manager,tenant,MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试");
    });
    const [saved]=await db.query(`SELECT a.division_id allocation_division_id,a.allocated_quantity,a.monthly_plan_id,
      m.id monthly_id,m.division_id monthly_division_id,m.required_quantity,m.remark,m.latest_customer_due_date::text due_date
      FROM mps_order_allocations a JOIN mps_monthly_plans m ON m.tenant_id=a.tenant_id AND m.id=a.monthly_plan_id
      WHERE a.tenant_id=$1 AND a.id=$2::uuid`,[tenant,monthlyAllocationId]);
    expect(saved).toMatchObject({allocation_division_id:targetDivision,allocated_quantity:"25.0000",monthly_plan_id:monthlyPlanId,
      monthly_id:monthlyPlanId,monthly_division_id:targetDivision,required_quantity:"25.0000",remark:"手工维护备注",due_date:"2026-12-31"});
    expect(await db.query("SELECT id FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number='TRANSFER-MONTH-ORDER' AND item_code='TRANSFER-MONTH-ITEM'",[tenant])).toHaveLength(1);
    expect(await db.query("SELECT 1 FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number='TRANSFER-MONTH-ORDER' AND division_id=$2::uuid",[tenant,targetDivision])).toHaveLength(1);
    const [group]=await db.query("SELECT required_quantity,primary_division_id FROM mps_group_plans WHERE tenant_id=$1 AND order_number='TRANSFER-MONTH-ORDER'",[tenant]);
    expect(group).toMatchObject({required_quantity:"25.0000",primary_division_id:targetDivision});
  });

  it("moves the unique legacy base plan directly linked to its monthly ID without inventing a shipping parent",async()=>{
    const allocation=randomUUID(),monthly=randomUUID(),base=randomUUID(),ambiguousBase=randomUUID(),procurement=randomUUID(),transferKey=randomUUID();temporaryProcurementId=procurement;
    await db.query("INSERT INTO organization_units(id,name,level,enabled) VALUES($1,'采购部',3,true)",[procurement]);
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,supplier_name,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-LEGACY-DIRECT-ORDER','TRANSFER-LEGACY-DIRECT-ITEM','供应链','TEST-CUSTOMER','历史月度直连基础计划','已审核',27,$3::uuid,$4::uuid,$4::uuid,true)`,[allocation,tenant,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_monthly_plans(id,tenant_id,allocation_id,order_number,item_code,division_id,customer_code,item_name,required_quantity,pending_quantity,remark,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TRANSFER-LEGACY-DIRECT-ORDER','TRANSFER-LEGACY-DIRECT-ITEM',$4::uuid,'TEST-CUSTOMER','历史月度直连基础计划',27,27,'人工保留',$5::uuid,$5::uuid)`,[monthly,tenant,allocation,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [row]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,allocation]);
      await linkNewDemandRecord(manager,'mps-order-allocations',row,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`legacy-direct-fixture-${tenant}`);
    });
    await db.query(`INSERT INTO mps_base_plans(id,tenant_id,monthly_plan_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,planned_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,NULL,$4::uuid,'TEST-CUSTOMER','TRANSFER-LEGACY-DIRECT-ORDER','TRANSFER-LEGACY-DIRECT-ITEM','历史月度直连基础计划','001',27,$5::uuid,$5::uuid)`,[base,tenant,monthly,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_base_plans(id,tenant_id,monthly_plan_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,planned_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,NULL,$4::uuid,'TEST-CUSTOMER','TRANSFER-LEGACY-DIRECT-ORDER','TRANSFER-LEGACY-DIRECT-ITEM','重复历史批次','002',27,$5::uuid,$5::uuid)`,[ambiguousBase,tenant,monthly,sourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    const ambiguous=await service.previewAllocationDivisionTransfer(allocation,{targetDivisionId:procurement,expectedVersion:1},actor());
    expect(ambiguous.canTransfer).toBe(false);expect(ambiguous.reasons).toContain("存在多个交期/批次计划，当前无法无歧义地逐链迁移");
    await db.transaction(async manager=>{await manager.query("SET LOCAL session_replication_role='replica'");await manager.query("DELETE FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,ambiguousBase]);});
    await db.transaction(async manager=>{await manager.query("SET LOCAL session_replication_role='replica'");await manager.query(`INSERT INTO mps_base_plans(id,tenant_id,monthly_plan_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,planned_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,NULL,$4::uuid,'TEST-CUSTOMER','TRANSFER-LEGACY-DIRECT-ORDER','TRANSFER-LEGACY-DIRECT-ITEM','异事业部隐藏父记录','002',27,$5::uuid,$5::uuid)`,[ambiguousBase,tenant,monthly,routeSourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);});
    const hiddenParent=await service.previewAllocationDivisionTransfer(allocation,{targetDivisionId:procurement,expectedVersion:1},actor());
    expect(hiddenParent.canTransfer).toBe(false);expect(hiddenParent.reasons).toContain("基础计划与月度/交期计划正式父关系不完整或冲突");
    await db.transaction(async manager=>{await manager.query("SET LOCAL session_replication_role='replica'");await manager.query("DELETE FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,ambiguousBase]);});
    const preview=await service.previewAllocationDivisionTransfer(allocation,{targetDivisionId:procurement,expectedVersion:1},actor());
    expect(preview).toMatchObject({canTransfer:true,monthlyPlanCount:1,shippingPlanCount:0,basePlanCount:1,weeklyPlanCount:0});
    const confirmed=await service.confirmAllocationDivisionTransfer(allocation,{targetDivisionId:procurement,expectedVersion:1,
      previewFingerprint:preview.previewFingerprint,reason:"迁移有唯一月度ID父关系的历史基础计划",idempotencyKey:transferKey},actor());
    expect(confirmed.persisted).toMatchObject({allocationDivisionId:procurement,monthlyPlanId:monthly,monthlyDivisionId:procurement,
      shippingPlanId:null,basePlanId:base,baseDivisionId:procurement});
    const [saved]=await db.query(`SELECT a.division_id allocation_division,a.allocated_quantity,a.monthly_plan_id,m.division_id monthly_division,m.required_quantity,
      b.id base_id,b.division_id base_division,b.monthly_plan_id base_monthly_id,b.shipping_plan_id,b.delivery_number,b.planned_quantity
      FROM mps_order_allocations a JOIN mps_monthly_plans m ON m.tenant_id=a.tenant_id AND m.id=a.monthly_plan_id
      JOIN mps_base_plans b ON b.tenant_id=m.tenant_id AND b.monthly_plan_id=m.id
      WHERE a.tenant_id=$1 AND a.id=$2::uuid`,[tenant,allocation]);
    expect(saved).toMatchObject({allocation_division:procurement,allocated_quantity:"27.0000",monthly_plan_id:monthly,monthly_division:procurement,
      required_quantity:"27.0000",base_id:base,base_division:procurement,base_monthly_id:monthly,shipping_plan_id:null,delivery_number:"001",planned_quantity:"27.0000"});
    expect(await db.query("SELECT 1 FROM mps_shipping_plans WHERE tenant_id=$1 AND monthly_plan_id=$2::uuid",[tenant,monthly])).toHaveLength(0);
    await db.transaction(async manager=>{
      await manager.query("SET LOCAL session_replication_role='replica'");
      await manager.query("DELETE FROM audit_logs WHERE tenant_id=$1 AND record_id=ANY($2::text[])",[tenant,[allocation,monthly,base]]);
      await manager.query("DELETE FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND record_id=$2::uuid",[tenant,allocation]);
      await manager.query("DELETE FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,base]);
      await manager.query("DELETE FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,monthly]);
      await manager.query("DELETE FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,allocation]);
      await manager.query("DELETE FROM organization_units WHERE id=$1::uuid",[procurement]);
    });
    temporaryProcurementId=undefined;
  });

  it("moves one explicitly linked monthly, shipping, and base chain without replacing IDs or manual fields",async()=>{
    const preview=await service.previewAllocationDivisionTransfer(baseAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(preview).toMatchObject({canTransfer:true,monthlyPlanCount:1,shippingPlanCount:1,basePlanCount:1,weeklyPlanCount:0});
    await service.confirmAllocationDivisionTransfer(baseAllocationId,{targetDivisionId:targetDivision,expectedVersion:1,
      previewFingerprint:preview.previewFingerprint,reason:"隔离验证月度和基础计划迁移",idempotencyKey:baseKey},actor());
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      await reconcileAllocationPlans(manager,tenant,MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试");
      await reconcileMonthlyBasePlans(manager,tenant,MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试",[baseMonthlyId]);
    });
    const [chain]=await db.query(`SELECT a.division_id allocation_division,m.id monthly_id,m.division_id monthly_division,
      s.id shipping_id,s.division_id shipping_division,b.id base_id,b.division_id base_division,b.planned_quantity,b.latest_review_due_date::text review_due,b.delivery_number
      FROM mps_order_allocations a JOIN mps_monthly_plans m ON m.tenant_id=a.tenant_id AND m.id=a.monthly_plan_id
      JOIN mps_shipping_plans s ON s.tenant_id=m.tenant_id AND s.monthly_plan_id=m.id
      JOIN mps_base_plans b ON b.tenant_id=s.tenant_id AND b.shipping_plan_id=s.id
      WHERE a.tenant_id=$1 AND a.id=$2::uuid`,[tenant,baseAllocationId]);
    expect(chain).toMatchObject({allocation_division:targetDivision,monthly_id:baseMonthlyId,monthly_division:targetDivision,
      shipping_id:shippingPlanId,shipping_division:targetDivision,base_id:basePlanId,base_division:targetDivision,
      planned_quantity:"40.0000",review_due:"2026-11-30",delivery_number:"1"});
  });

  it("recalculates an existing unstarted process snapshot for the target division while retaining matching task IDs and manual fields",async()=>{
    const routeKey=randomUUID();
    const routeAllocationId=randomUUID(),routeMonthlyId=randomUUID(),routeShippingId=randomUUID(),routeBaseId=randomUUID(),routeWeeklyId=randomUUID();
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-ROUTE-ORDER','TRANSFER-ROUTE-ITEM','TEST-CUSTOMER','既有工序快照','已审核',18,$3::uuid,$4::uuid,$4::uuid,true)`,[routeAllocationId,tenant,routeSourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_monthly_plans(id,tenant_id,allocation_id,order_number,item_code,division_id,customer_code,item_name,required_quantity,pending_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TRANSFER-ROUTE-ORDER','TRANSFER-ROUTE-ITEM',$4::uuid,'TEST-CUSTOMER','既有工序快照',18,18,$5::uuid,$5::uuid)`,[routeMonthlyId,tenant,routeAllocationId,routeSourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const [row]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,routeAllocationId]);await linkNewDemandRecord(manager,'mps-order-allocations',row,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-route-allocation-link-${tenant}`);});
    await db.query(`INSERT INTO mps_shipping_plans(id,tenant_id,monthly_plan_id,customer_code,order_number,item_code,delivery_number,item_name,order_date,latest_customer_due_date,planned_quantity,division_id,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TEST-CUSTOMER','TRANSFER-ROUTE-ORDER','TRANSFER-ROUTE-ITEM',1,'既有工序快照','2026-10-01','2026-12-20',18,$4::uuid,$5::uuid,$5::uuid)`,[routeShippingId,tenant,routeMonthlyId,routeSourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_base_plans(id,tenant_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,planned_quantity,latest_review_due_date,manufacturing_method,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,$4::uuid,'TEST-CUSTOMER','TRANSFER-ROUTE-ORDER','TRANSFER-ROUTE-ITEM','既有工序快照',1,'2026-10-01','2026-12-20',18,'2026-11-30','自制',$5::uuid,$5::uuid)`,[routeBaseId,tenant,routeShippingId,routeSourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const [row]=await manager.query("SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,routeBaseId]);await linkNewDemandRecord(manager,'mps-base-plans',row,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-route-base-link-${tenant}`);});
    await db.query(`INSERT INTO mps_weekly_plans(id,tenant_id,base_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,latest_customer_due_date,latest_review_due_date,planned_quantity,pending_quantity,manufacturing_method,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,$4::uuid,'TEST-CUSTOMER','TRANSFER-ROUTE-ORDER','TRANSFER-ROUTE-ITEM','既有工序快照',1,'2026-12-20','2026-11-30',18,18,'自制',$5::uuid,$5::uuid)`,[routeWeeklyId,tenant,routeBaseId,routeSourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    const workOrderId=randomUUID();
    await db.query(`INSERT INTO mps_three_day_work_orders(id,tenant_id,weekly_plan_id,division_id,customer_code,order_number,item_code,item_name,required_quantity,blank_completion_date,image_refs,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,$4::uuid,'TEST-CUSTOMER','TRANSFER-ROUTE-ORDER','TRANSFER-ROUTE-ITEM','既有工序快照',18,'2026-11-10','[{"ref":"fixture-image"}]'::jsonb,$5::uuid,$5::uuid)`,[workOrderId,tenant,routeWeeklyId,routeSourceDivision,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.query(`INSERT INTO mps_division_process_configs(tenant_id,division_id,process_code,cycle_days,default_enabled,sequence,created_by)
      VALUES($1,$2::uuid,'cutting',2,true,1,$3::uuid),($1,$2::uuid,'machining',1,true,2,$3::uuid),($1,$2::uuid,'packaging',1,true,3,$3::uuid),
      ($1,$4::uuid,'cutting',3,true,1,$3::uuid),($1,$4::uuid,'bending',2,true,2,$3::uuid),($1,$4::uuid,'packaging',1,true,3,$3::uuid)`,
    [tenant,routeSourceDivision,MASTER_PLAN_SYSTEM_USER_ID,routeTargetDivision]);
    const cuttingTaskId=randomUUID(),machiningTaskId=randomUUID(),packagingTaskId=randomUUID();
    await db.transaction(async manager=>{await manager.query("SELECT set_config('app.mps_process_config_write_mode','CONFIRM',true)");await manager.query(`INSERT INTO mps_weekly_process_plans(id,tenant_id,weekly_plan_id,process_code,process_name,sequence,cycle_days,due_date,status,exception_text,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'cutting','下料',1,2,'2026-11-05','延期','保留的人工异常说明',$5::uuid,$6),
      ($4::uuid,$2,$3::uuid,'machining','机加',2,1,'2026-11-20','未开始',NULL,$5::uuid,$6),
      ($7::uuid,$2,$3::uuid,'packaging','包装',3,1,'2026-11-25','未开始',NULL,$5::uuid,$6)`,
    [cuttingTaskId,tenant,routeWeeklyId,machiningTaskId,MASTER_PLAN_SYSTEM_USER_ID,MASTER_PLAN_SYSTEM_USER_ID,packagingTaskId]);});
    const completedWorkOrder=await service.previewAllocationDivisionTransfer(routeAllocationId,{targetDivisionId:routeTargetDivision,expectedVersion:1},actor());
    expect(completedWorkOrder.canTransfer).toBe(false);
    expect(completedWorkOrder.reasons).toContain("周计划存在生产执行事实，不能按未开工计划迁移");
    await db.query("UPDATE mps_three_day_work_orders SET blank_completion_date=NULL WHERE tenant_id=$1 AND id=$2::uuid",[tenant,workOrderId]);
    await db.query(`INSERT INTO mps_process_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,process_code,process_name,production_date,planned_quantity,production_quantity,created_by)
      VALUES($1,$2::uuid,'TRANSFER-ROUTE-ORDER','TRANSFER-ROUTE-ITEM','既有工序快照',1,'cutting','下料','2026-11-12',18,1,$3::uuid)`,[tenant,routeWeeklyId,MASTER_PLAN_SYSTEM_USER_ID]);
    const reported=await service.previewAllocationDivisionTransfer(routeAllocationId,{targetDivisionId:routeTargetDivision,expectedVersion:1},actor());
    expect(reported.canTransfer).toBe(false);
    expect(reported.reasons).toContain("周计划存在生产执行事实，不能按未开工计划迁移");
    await db.query("DELETE FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,routeWeeklyId]);
    await db.query("UPDATE mps_weekly_plans SET process_config_locked_at=NULL WHERE tenant_id=$1 AND id=$2::uuid",[tenant,routeWeeklyId]);
    await db.transaction(async manager=>{await manager.query("SELECT set_config('app.mps_process_config_write_mode','CONFIRM',true)");await manager.query("UPDATE mps_weekly_process_plans SET cycle_days=7 WHERE tenant_id=$1 AND id=$2::uuid",[tenant,machiningTaskId]);});
    const manualConflict=await service.previewAllocationDivisionTransfer(routeAllocationId,{targetDivisionId:routeTargetDivision,expectedVersion:1},actor());
    expect(manualConflict.canTransfer).toBe(false);
    expect(manualConflict.reasons).toContain("工序 machining 的人工cycleDays与目标路线冲突");
    await db.transaction(async manager=>{await manager.query("SELECT set_config('app.mps_process_config_write_mode','CONFIRM',true)");await manager.query("UPDATE mps_weekly_process_plans SET cycle_days=1 WHERE tenant_id=$1 AND id=$2::uuid",[tenant,machiningTaskId]);});
    await db.query("CREATE TABLE mps_test_process_task_reference(task_id uuid NOT NULL REFERENCES mps_weekly_process_plans(id))");
    try {
      await db.query("INSERT INTO mps_test_process_task_reference(task_id) VALUES($1::uuid)",[machiningTaskId]);
      const referencedTask=await service.previewAllocationDivisionTransfer(routeAllocationId,{targetDivisionId:routeTargetDivision,expectedVersion:1},actor());
      expect(referencedTask.canTransfer).toBe(false);
      expect(referencedTask.reasons).toContain("工序任务表存在外键引用，不能自动移除路线差异工序");
    } finally {
      await db.query("DROP TABLE mps_test_process_task_reference");
    }
    const preview=await service.previewAllocationDivisionTransfer(routeAllocationId,{targetDivisionId:routeTargetDivision,expectedVersion:1},actor());
    expect(preview).toMatchObject({canTransfer:true,weeklyPlanCount:1,executionWeeklyPlanCount:0});
    expect(preview.processRouteChanges[0]).toMatchObject({canMigrate:true,changes:{added:[expect.objectContaining({processCode:"bending"})],removed:[expect.objectContaining({processCode:"machining"})]}});
    expect(preview.processRouteChanges[0].manualAdjustments).toContainEqual(expect.objectContaining({processCode:"cutting",field:"dueDate",willPreserve:true}));
    const confirmInput={targetDivisionId:routeTargetDivision,expectedVersion:1,previewFingerprint:preview.previewFingerprint,
      reason:"隔离验证预览后新增入库应阻断",idempotencyKey:routeKey};
    await db.query("UPDATE mps_weekly_plans SET allocated_inbound_quantity=1 WHERE tenant_id=$1 AND id=$2::uuid",[tenant,routeWeeklyId]);
    await expect(service.confirmAllocationDivisionTransfer(routeAllocationId,confirmInput,actor())).rejects.toThrow("预览后相关数据已变化");
    await db.query("UPDATE mps_weekly_plans SET allocated_inbound_quantity=0 WHERE tenant_id=$1 AND id=$2::uuid",[tenant,routeWeeklyId]);
    const currentPreview=await service.previewAllocationDivisionTransfer(routeAllocationId,{targetDivisionId:routeTargetDivision,expectedVersion:1},actor());
    const result=await service.confirmAllocationDivisionTransfer(routeAllocationId,{targetDivisionId:routeTargetDivision,expectedVersion:1,
      previewFingerprint:currentPreview.previewFingerprint,reason:"隔离验证已有工序快照迁移",idempotencyKey:routeKey},actor());
    expect(result.persisted).toMatchObject({allocationDivisionId:routeTargetDivision,monthlyDivisionId:routeTargetDivision});
    const storageKey=`mps-allocation-division-transfer:${tenant}:${MASTER_PLAN_SYSTEM_USER_ID}:${routeKey}`;
    const [idempotency]=await db.query("SELECT response_json->>'outboxKey' outbox_key FROM idempotency_keys WHERE key=$1",[storageKey]);
    await db.query("UPDATE mps_reconciliation_outbox SET status='SUCCESS',completed_at=now() WHERE tenant_id=$1 AND idempotency_key=$2",[tenant,idempotency.outbox_key]);
    await expect(service.allocationDivisionTransferStatus(routeAllocationId,routeKey,actor())).resolves.toMatchObject({status:"SUCCESS",
      stages:{allocation:"COMMITTED",groupAndMonthly:"SUCCESS",base:"COMMITTED",weekly:"COMMITTED",processTasks:"COMMITTED"}});
    const tasks=await db.query(`SELECT id,process_code,sequence,cycle_days,due_date::text due_date,status,exception_text,daily_reported_quantity
      FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY sequence`,[tenant,routeWeeklyId]);
    const [workOrder]=await db.query("SELECT division_id,required_quantity,image_refs,blank_completion_date FROM mps_three_day_work_orders WHERE tenant_id=$1 AND id=$2::uuid",[tenant,workOrderId]);
    expect(workOrder).toMatchObject({division_id:routeTargetDivision,required_quantity:"18.0000",image_refs:[{ref:"fixture-image"}],blank_completion_date:null});
    expect(tasks.map((row:any)=>row.process_code)).toEqual(["cutting","bending","packaging"]);
    expect(tasks[0]).toMatchObject({id:cuttingTaskId,sequence:1,cycle_days:3,due_date:"2026-11-05",status:"延期",exception_text:"保留的人工异常说明",daily_reported_quantity:"0.0000"});
    expect(tasks[2]).toMatchObject({id:packagingTaskId,sequence:3,cycle_days:1});
    expect(tasks.some((row:any)=>row.id===machiningTaskId)).toBe(false);
    expect(await db.query("SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND record_id=$2 AND action='mps-weekly-process-plans.division_transfer_reconfigured'",[tenant,cuttingTaskId])).toHaveLength(1);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      await reconcileAllocationPlans(manager,tenant,MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试");
      await reconcileMonthlyBasePlans(manager,tenant,MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试",[routeBaseId]);
    });
    const sync=new MasterPlanSyncService(db);
    const syncResult=await sync.run(tenant,"base-to-weekly","MANUAL",MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试",`transfer-existing-route-sync-${tenant}`,{basePlanIds:[routeBaseId]});
    expect(syncResult).toMatchObject({status:"SUCCESS"});
    const afterSync=await db.query("SELECT id,process_code FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY process_code",[tenant,routeWeeklyId]);
    expect(afterSync.map((row:any)=>row.process_code).sort()).toEqual(["bending","cutting","packaging"]);
    expect(afterSync.find((row:any)=>row.process_code==="cutting")?.id).toBe(cuttingTaskId);
    expect(await db.query("SELECT 1 FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,routeWeeklyId])).toHaveLength(0);
  });

  it("blocks a taskless weekly plan with inbound, then migrates a separate unexecuted weekly chain and initializes target rules",async()=>{
    await db.query(`INSERT INTO mps_material_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,material_name,received,actual_inbound_date,created_by,updated_by,division_id)
      VALUES($1,$2::uuid,'TRANSFER-WEEK-ORDER','TRANSFER-WEEK-ITEM','周计划测试',1,'五金',true,'2026-11-12',$3::uuid,$3::uuid,$4::uuid)`,[tenant,weeklyPlanId,MASTER_PLAN_SYSTEM_USER_ID,sourceDivision]);
    const receivedMaterial=await service.previewAllocationDivisionTransfer(weeklyAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(receivedMaterial.canTransfer).toBe(false);
    expect(receivedMaterial.reasons).toContain("周计划存在生产执行事实，不能按未开工计划迁移");
    await db.transaction(async manager=>{await manager.query("SET LOCAL session_replication_role='replica'");await manager.query("DELETE FROM mps_material_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,weeklyPlanId]);});
    await db.query(`INSERT INTO mps_outsourcing_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,purchase_order_number,status,created_by,updated_by,division_id)
      VALUES($1,$2::uuid,'TRANSFER-WEEK-ORDER','TRANSFER-WEEK-ITEM','周计划测试',1,'SYNTHETIC-PO-1','进行中',$3::uuid,$3::uuid,$4::uuid)`,[tenant,weeklyPlanId,MASTER_PLAN_SYSTEM_USER_ID,sourceDivision]);
    const purchaseOrder=await service.previewAllocationDivisionTransfer(weeklyAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(purchaseOrder.canTransfer).toBe(false);
    expect(purchaseOrder.reasons).toContain("周计划存在生产执行事实，不能按未开工计划迁移");
    await db.transaction(async manager=>{await manager.query("SET LOCAL session_replication_role='replica'");await manager.query("DELETE FROM mps_outsourcing_reports WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,weeklyPlanId]);});
    await db.query("UPDATE mps_weekly_plans SET allocated_inbound_quantity=2 WHERE tenant_id=$1 AND id=$2::uuid",[tenant,weeklyPlanId]);
    const inboundPreview=await service.previewAllocationDivisionTransfer(weeklyAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(inboundPreview).toMatchObject({canTransfer:false,hasInbound:true,weeklyPlanCount:1});
    expect(inboundPreview.executionWeeklyPlanCount).toBe(1);
    expect(await db.query("SELECT 1 FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,weeklyPlanId])).toHaveLength(0);
    const preview=await service.previewAllocationDivisionTransfer(safeAllocationId,{targetDivisionId:targetDivision,expectedVersion:1},actor());
    expect(preview).toMatchObject({canTransfer:true,monthlyPlanCount:1,shippingPlanCount:1,basePlanCount:1,weeklyPlanCount:1,executionWeeklyPlanCount:0});
    await service.confirmAllocationDivisionTransfer(safeAllocationId,{targetDivisionId:targetDivision,expectedVersion:1,
      previewFingerprint:preview.previewFingerprint,reason:"隔离验证未开工周计划迁移",idempotencyKey:safeWeeklyKey},actor());
    const sync=new MasterPlanSyncService(db);
    const syncResult=await sync.run(tenant,"base-to-weekly","MANUAL",MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试",
      `transfer-weekly-${tenant}`,{basePlanIds:[safeBaseId]});
    expect(syncResult).toMatchObject({status:"SUCCESS",metrics:{eligible_batches:1,process_snapshots_initialized:1,process_tasks_initialized:10}});
    const [saved]=await db.query(`SELECT w.id,w.division_id,b.id base_id,s.id shipping_id,m.id monthly_id,w.planned_quantity,w.allocated_inbound_quantity
      FROM mps_weekly_plans w JOIN mps_base_plans b ON b.tenant_id=w.tenant_id AND b.id=w.base_plan_id
      JOIN mps_shipping_plans s ON s.tenant_id=b.tenant_id AND s.id=b.shipping_plan_id
      JOIN mps_monthly_plans m ON m.tenant_id=s.tenant_id AND m.id=s.monthly_plan_id
      WHERE w.tenant_id=$1 AND w.id=$2::uuid`,[tenant,safeWeeklyPlanId]);
    expect(saved).toMatchObject({id:safeWeeklyPlanId,division_id:targetDivision,base_id:safeBaseId,shipping_id:safeShippingId,monthly_id:safeMonthlyId,planned_quantity:"18.0000",allocated_inbound_quantity:"0.0000"});
    const tasks=await db.query("SELECT process_code FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY sequence",[tenant,safeWeeklyPlanId]);
    expect(tasks.map((task:Record<string,unknown>)=>task.process_code)).toEqual(["cutting","machining","bending","spotWelding","welding","woodworking","grinding","blank","surfaceTreatment","packaging"]);
  });

  it("blocks a target-division plan collision and enforces tenant and division-update permissions",async()=>{
    const [allocation]=await db.query("SELECT division_id,version FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,allocationId]);
    const conflictingTarget=String(allocation.division_id)===targetDivision?sourceDivision:targetDivision;
    const conflictingAllocationId=randomUUID(),conflictingMonthlyId=randomUUID();
    await db.query(`INSERT INTO mps_order_allocations(id,tenant_id,order_number,item_code,customer_code,item_name,order_status,allocated_quantity,division_id,created_by,updated_by,manually_maintained)
      VALUES($1::uuid,$2,'TRANSFER-TEST-ORDER','TRANSFER-TEST-ITEM','TEST-CUSTOMER','目标事业部冲突来源','已审核',50,$3::uuid,$4::uuid,$4::uuid,true)`,
      [conflictingAllocationId,tenant,conflictingTarget,MASTER_PLAN_SYSTEM_USER_ID]);
    await db.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [source]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,conflictingAllocationId]);
      await linkNewDemandRecord(manager,'mps-order-allocations',source,'0199bb00-0000-7000-8000-000000000108','隔离测试用户',`transfer-conflicting-source-${tenant}`);
    });
    await db.query(`INSERT INTO mps_monthly_plans(id,tenant_id,allocation_id,order_number,item_code,division_id,required_quantity,created_by,updated_by)
      VALUES($1::uuid,$2,$3::uuid,'TRANSFER-TEST-ORDER','TRANSFER-TEST-ITEM',$4::uuid,50,$5::uuid,$5::uuid)`,
      [conflictingMonthlyId,tenant,conflictingAllocationId,conflictingTarget,MASTER_PLAN_SYSTEM_USER_ID]);
    const conflict=await service.previewAllocationDivisionTransfer(allocationId,{targetDivisionId:conflictingTarget,expectedVersion:Number(allocation.version)},actor());
    expect(conflict.canTransfer).toBe(false);
    expect(conflict.reasons).toContain("目标事业部已存在同订单品项计划，需先核对冲突");

    const noDivisionPermission={...actor(),isSystemAdmin:false,moduleAdminCodes:[],permissions:[]};
    await expect(service.previewAllocationDivisionTransfer(allocationId,{targetDivisionId:conflictingTarget},noDivisionPermission))
      .rejects.toThrow("没有订单分配事业部变更权限");
    const otherTenant={...actor(),tenantId:`OTHER-${tenant}`};
    await expect(service.previewAllocationDivisionTransfer(allocationId,{targetDivisionId:conflictingTarget},otherTenant))
      .rejects.toThrow("订单分配记录不存在");
  });

  it("preserves process task IDs for an identical route and repeated formal sync",async()=>{
    const [allocation]=await db.query("SELECT division_id,version FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeAllocationId]);
    const destination=String(allocation.division_id)===targetDivision?sourceDivision:targetDivision;
    const before=await db.query("SELECT id,process_code FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY process_code",[tenant,safeWeeklyPlanId]);
    const preview=await service.previewAllocationDivisionTransfer(safeAllocationId,{targetDivisionId:destination,expectedVersion:Number(allocation.version)},actor());
    expect(preview.canTransfer).toBe(true);
    expect(preview.processRouteChanges[0].changes.added).toEqual([]);
    expect(preview.processRouteChanges[0].changes.removed).toEqual([]);
    await service.confirmAllocationDivisionTransfer(safeAllocationId,{targetDivisionId:destination,expectedVersion:Number(allocation.version),
      previewFingerprint:preview.previewFingerprint,reason:"验证相同路线稳定关联",idempotencyKey:randomUUID()},actor());
    const sync=new MasterPlanSyncService(db);
    await sync.run(tenant,"base-to-weekly","MANUAL",MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试",`same-route-sync-a-${tenant}`,{basePlanIds:[safeBaseId]});
    await sync.run(tenant,"base-to-weekly","MANUAL",MASTER_PLAN_SYSTEM_USER_ID,"KDOS隔离测试",`same-route-sync-b-${tenant}`,{basePlanIds:[safeBaseId]});
    const after=await db.query("SELECT id,process_code FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY process_code",[tenant,safeWeeklyPlanId]);
    expect(after).toEqual(before);
    expect(after).toHaveLength(10);
  });

  it("serves preview, confirm, status and persisted allocation/monthly/base/weekly/process reads through HTTP",async()=>{
    const [current]=await db.query("SELECT division_id,version FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeAllocationId]);
    const destination=String(current.division_id)===targetDivision?sourceDivision:targetDivision;
    const list=()=>request(httpApp.getHttpServer()).get("/api/v1/master-plan-system/resources/mps-order-allocations").query({search:"TRANSFER-SAFE-WEEK-ORDER"});
    const allocationBefore=await list().expect(200);
    expect(allocationBefore.body.rows.some((row:any)=>row.id===safeAllocationId)).toBe(true);
    const preview=await request(httpApp.getHttpServer()).post(`/api/v1/master-plan-system/resources/mps-order-allocations/${safeAllocationId}/division-transfer/preview`)
      .send({targetDivisionId:destination,expectedVersion:Number(current.version)}).expect(201);
    expect(preview.body).toMatchObject({canTransfer:true,monthlyPlanCount:1,basePlanCount:1,weeklyPlanCount:1,executionWeeklyPlanCount:0});
    const idempotencyKey=randomUUID();
    const confirmed=await request(httpApp.getHttpServer()).post(`/api/v1/master-plan-system/resources/mps-order-allocations/${safeAllocationId}/division-transfer/confirm`)
      .send({targetDivisionId:destination,expectedVersion:Number(current.version),previewFingerprint:preview.body.previewFingerprint,reason:"隔离HTTP端到端验收",idempotencyKey}).expect(201);
    expect(confirmed.body).toMatchObject({status:"PENDING",allocationId:safeAllocationId});
    const status=await request(httpApp.getHttpServer()).get(`/api/v1/master-plan-system/resources/mps-order-allocations/${safeAllocationId}/division-transfer/${idempotencyKey}`).expect(200);
    expect(status.body.status).toBe("PENDING");
    const [saved]=await db.query(`SELECT a.division_id allocation_division,m.division_id monthly_division,s.division_id shipping_division,
      b.division_id base_division,w.division_id weekly_division,a.allocated_quantity,m.required_quantity,b.planned_quantity,w.planned_quantity weekly_quantity
      FROM mps_order_allocations a JOIN mps_monthly_plans m ON m.tenant_id=a.tenant_id AND m.allocation_id=a.id
      JOIN mps_shipping_plans s ON s.tenant_id=m.tenant_id AND s.monthly_plan_id=m.id
      JOIN mps_base_plans b ON b.tenant_id=s.tenant_id AND b.shipping_plan_id=s.id
      JOIN mps_weekly_plans w ON w.tenant_id=b.tenant_id AND w.base_plan_id=b.id WHERE a.tenant_id=$1 AND a.id=$2::uuid`,[tenant,safeAllocationId]);
    expect([saved.allocation_division,saved.monthly_division,saved.shipping_division,saved.base_division,saved.weekly_division].map(String)).toEqual([destination,destination,destination,destination,destination]);
    expect([saved.allocated_quantity,saved.required_quantity,saved.planned_quantity,saved.weekly_quantity]).toEqual(["18.0000","18.0000","18.0000","18.0000"]);
    for(const resource of ["mps-monthly-plans","mps-shipping-plans","mps-base-plans","mps-weekly-plans","mps-weekly-process-plans"]){
      const response=await request(httpApp.getHttpServer()).get(`/api/v1/master-plan-system/resources/${resource}`)
        .query(resource==="mps-weekly-process-plans"?{pageSize:200}:{search:"TRANSFER-SAFE-WEEK-ORDER"}).expect(200);
      const matching=resource==="mps-weekly-process-plans"?response.body.rows.filter((row:any)=>row.weeklyPlanId===safeWeeklyPlanId):response.body.rows;
      if(matching.length===0)throw new Error(`No HTTP rows returned for ${resource}`);
    }
    const taskCount=await db.query("SELECT count(*)::int count FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[tenant,safeWeeklyPlanId]);
    expect(taskCount[0].count).toBe(10);
    const reloaded=await list().expect(200);
    expect(reloaded.body.rows.find((row:any)=>row.id===safeAllocationId)?.divisionId).toBe(destination);
  });

  it("rolls back every plan and audit mutation when a downstream weekly update fails",async()=>{
    const [allocation]=await db.query("SELECT division_id,version FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[tenant,safeAllocationId]);
    const destination=String(allocation.division_id)===targetDivision?sourceDivision:targetDivision;
    const preview=await service.previewAllocationDivisionTransfer(safeAllocationId,{targetDivisionId:destination,expectedVersion:Number(allocation.version)},actor());
    expect(preview.canTransfer).toBe(true);
    const [auditBefore]=await db.query("SELECT count(*)::int count FROM audit_logs WHERE tenant_id=$1 AND record_id=$2 AND action='division_transfer.confirmed'",[tenant,safeAllocationId]);
    await db.query(`CREATE OR REPLACE FUNCTION test_abort_weekly_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'isolated transfer rollback'; END; $$`);
    await db.query("CREATE TRIGGER test_abort_weekly_transfer BEFORE UPDATE ON mps_weekly_plans FOR EACH ROW EXECUTE FUNCTION test_abort_weekly_transfer()");
    const idempotencyKey=randomUUID();
    try {
      await expect(service.confirmAllocationDivisionTransfer(safeAllocationId,{targetDivisionId:destination,expectedVersion:Number(allocation.version),
        previewFingerprint:preview.previewFingerprint,reason:"验证事务回滚",idempotencyKey},actor())).rejects.toThrow("isolated transfer rollback");
    } finally {
      await db.query("DROP TRIGGER IF EXISTS test_abort_weekly_transfer ON mps_weekly_plans");
      await db.query("DROP FUNCTION IF EXISTS test_abort_weekly_transfer()");
    }
    const [persisted]=await db.query(`SELECT a.division_id allocation_division,m.division_id monthly_division,s.division_id shipping_division,
      b.division_id base_division,w.division_id weekly_division
      FROM mps_order_allocations a JOIN mps_monthly_plans m ON m.tenant_id=a.tenant_id AND m.allocation_id=a.id
      JOIN mps_shipping_plans s ON s.tenant_id=m.tenant_id AND s.monthly_plan_id=m.id
      JOIN mps_base_plans b ON b.tenant_id=s.tenant_id AND b.shipping_plan_id=s.id
      JOIN mps_weekly_plans w ON w.tenant_id=b.tenant_id AND w.base_plan_id=b.id
      WHERE a.tenant_id=$1 AND a.id=$2::uuid`,[tenant,safeAllocationId]);
    expect(persisted).toEqual({allocation_division:allocation.division_id,monthly_division:allocation.division_id,shipping_division:allocation.division_id,base_division:allocation.division_id,weekly_division:allocation.division_id});
    expect(await db.query("SELECT 1 FROM idempotency_keys WHERE key=$1",[`mps-allocation-division-transfer:${tenant}:${MASTER_PLAN_SYSTEM_USER_ID}:${idempotencyKey}`])).toHaveLength(0);
    const [auditAfter]=await db.query("SELECT count(*)::int count FROM audit_logs WHERE tenant_id=$1 AND record_id=$2 AND action='division_transfer.confirmed'",[tenant,safeAllocationId]);
    expect(auditAfter.count).toBe(auditBefore.count);
  });
});
