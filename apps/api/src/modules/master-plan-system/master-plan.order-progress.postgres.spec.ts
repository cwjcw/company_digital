import { DataSource, type QueryRunner } from "typeorm";
import ExcelJS from "exceljs";
import original from "../../data-source";
import { tablePermissionFieldsFor, mpsOrderProgressResource as resource } from "@kdos/contracts";
import { MasterPlanOrderProgressService, type OrderProgressQuery } from "./master-plan.order-progress.service";
import { MasterPlanOrderProgressExportService } from "./master-plan.order-progress-export.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import type { MasterPlanActor } from "./master-plan.types";

const integration=process.env.KDOS_POSTGRES_INTEGRATION==="true"?describe:describe.skip;
const tenant="ORDER-PROGRESS-REV3B-TEST",id=(n:number)=>`0199bb00-0000-7000-8000-${String(n).padStart(12,"0")}`,division=id(1),other=id(2);
const actor:MasterPlanActor={tenantId:tenant,userId:id(99),username:"fixture",permissions:["*"],tableDataScopes:[],requestId:"rev3b-test",source:"web"};
integration("Order progress actual PostgreSQL, temporary fixture tables only",()=>{
  let db:DataSource,runner:QueryRunner,service:MasterPlanOrderProgressService;
  const audit=jest.fn().mockResolvedValue(undefined);
  beforeAll(async()=>{
    const options=original.options;if(options.type!=="postgres")throw new Error("Requires PostgreSQL");
    db=new DataSource({...options,entities:[],migrations:[],subscribers:[],poolSize:1});await db.initialize();runner=db.createQueryRunner();await runner.connect();await runner.startTransaction();
    for(const t of ["mps_group_plans","mps_monthly_plans","mps_order_allocations","mps_erp_order_lines","mps_shipping_plans","mps_base_plans","mps_weekly_plans","mps_weekly_process_plans","mps_process_reports","mps_technical_reports","mps_material_reports","mps_outsourcing_reports","organization_units"])await runner.query(`CREATE TEMP TABLE ${t} AS SELECT * FROM public.${t} WITH NO DATA`);
    const insert=async(table:string,value:Record<string,unknown>)=>{const e=Object.entries({tenant_id:tenant,created_by:actor.userId,...value});await runner.query(`INSERT INTO ${table}(${e.map(([k])=>k).join(",")}) VALUES(${e.map((_,i)=>`$${i+1}`).join(",")})`,e.map(([,v])=>v))};
    await runner.query("INSERT INTO organization_units(id,name)VALUES($1,'事业甲'),($2,'事业乙')",[division,other]);
    for(const [n,order,pending,div]of [[10,"ORDER-A",800,division],[11,"COMPLETE",0,division],[12,"NO-MONTHLY",100,division],[13,"STALE-COVERAGE",0,division],[14,"OTHER",100,other],[15,"FOREIGN",100,division]]as const)await insert("mps_group_plans",{id:id(n),order_number:order,primary_division_id:div,customer_code:"C1",order_date:"2026-10-01",required_quantity:1000,completed_quantity:200,pending_quantity:pending,completion_rate:n===10?"0.1234":pending===0?1:0,...(n===15?{tenant_id:tenant+"-OTHER"}:{})});
    const common={division_id:division,customer_code:"C1",order_date:"2026-10-01",order_number:"ORDER-A",item_code:"ITEM-A",item_name:"测试品项",latest_customer_due_date:"2026-10-20"};
    await insert("mps_monthly_plans",{...common,id:id(20),allocation_id:id(30),required_quantity:500,cumulative_inbound_quantity:125,pending_quantity:375,completion_rate:"0.25"});
    await insert("mps_monthly_plans",{...common,id:id(21),allocation_id:id(34),item_code:"ITEM-B",required_quantity:100,cumulative_inbound_quantity:100,pending_quantity:0,completion_rate:1});
    await insert("mps_monthly_plans",{...common,id:id(22),allocation_id:id(35),order_number:"COMPLETE",required_quantity:100,cumulative_inbound_quantity:100,pending_quantity:0,completion_rate:1});
    await insert("mps_monthly_plans",{...common,id:id(23),division_id:other,allocation_id:id(36),order_number:"OTHER",required_quantity:100,cumulative_inbound_quantity:0,pending_quantity:100,completion_rate:0});
    for(const [n,qty,order,div]of [[30,500,"ORDER-A",division],[31,50,"ORDER-A",division],[32,60,"ORDER-A",division],[33,40,"STALE-COVERAGE",division],[36,100,"OTHER",other]]as const)await insert("mps_order_allocations",{customer_code:"C1",order_date:"2026-10-01",item_code:"ITEM-A",item_name:"测试品项",id:id(n),allocated_quantity:qty,order_number:order,division_id:div});
    for(const n of [0,1]){
      await insert("mps_shipping_plans",{...common,id:id(40+n),monthly_plan_id:id(20),delivery_number:String(n+1).padStart(3,"0"),planned_quantity:n===0?200:100});
      await insert("mps_base_plans",{...common,id:id(45+n),shipping_plan_id:id(40+n),delivery_number:String(n+1).padStart(3,"0"),planned_quantity:n===0?200:100});
      await insert("mps_weekly_plans",{...common,id:id(50+n),manufacturing_method:"自制",base_plan_id:id(45+n),delivery_number:String(n+1).padStart(3,"0"),planned_quantity:n===0?200:100,pending_quantity:100,hardware_due_date:"2020-01-01",wood_due_date:"2020-01-01"});
    }
    await insert("mps_weekly_plans",{...common,id:id(52),division_id:other,base_plan_id:null,delivery_number:"003",planned_quantity:100,pending_quantity:100});
    for(const [n,weekly,code,quantity]of [[60,50,"cutting",100],[61,50,"cutting",155],[62,51,"packaging",525],[63,52,"cutting",1000],[64,50,"cutting",9999]]as const)await insert("mps_process_reports",{id:id(n),division_id:n===63?other:division,order_number:"ORDER-A",item_code:"ITEM-A",item_name:"测试品项",weekly_plan_id:id(weekly),process_code:code,production_quantity:quantity,production_date:"2026-10-15",exception_text:n===61?"人工工序异常":null,...(n===64?{tenant_id:tenant+"-OTHER"}:{})});
    for(const [n,weekly,code,status]of [[70,50,"cutting","已完成"],[71,51,"packaging","延期"]]as const)await insert("mps_weekly_process_plans",{id:id(n),weekly_plan_id:id(weekly),process_code:code,status,exception_text:"计划提示不得算异常",execution_enabled:true});
    await insert("mps_technical_reports",{division_id:division,order_number:"ORDER-A",item_code:"ITEM-A",item_name:"测试品项",id:id(80),weekly_plan_id:id(50),status:"延期",drawing_due_date:"2020-01-01",exception_text:"人工技术异常"});
    await insert("mps_material_reports",{division_id:division,order_number:"ORDER-A",item_code:"ITEM-A",item_name:"测试品项",id:id(81),weekly_plan_id:id(50),material_name:"五金",received:true,actual_inbound_date:"2026-10-15"});
    await insert("mps_outsourcing_reports",{division_id:division,order_number:"ORDER-A",item_code:"ITEM-A",item_name:"测试品项",id:id(82),weekly_plan_id:id(51),status:"进行中",execution_enabled:true});
    await insert("mps_erp_order_lines",{id:id(90),order_number:"NO-MONTHLY",item_code:"ERP-ITEM",item_name:"未建计划来源",customer_code:"C1",order_date:"2026-10-01",source_active:true,order_quantity:100});
    await insert("mps_group_plans",{id:id(16),order_number:"REPEAT-ERP",primary_division_id:division,customer_code:"C1",order_date:"2026-10-01",required_quantity:100,completed_quantity:0,pending_quantity:100,completion_rate:0});
    await insert("mps_monthly_plans",{...common,id:id(24),allocation_id:id(37),order_number:"REPEAT-ERP",required_quantity:100,cumulative_inbound_quantity:0,pending_quantity:100,completion_rate:0});
    for(const n of [91,92])await insert("mps_erp_order_lines",{id:id(n),order_number:"REPEAT-ERP",item_code:"ITEM-A",item_name:"独立重复来源",source_active:true,order_quantity:50,order_date:"2026-10-01",customer_code:"C1"});
    const adapter={query:(s:string,p?:unknown[])=>runner.query(s,p),transaction:async(...args:unknown[])=>(args[args.length-1]as(m:unknown)=>unknown)({query:(s:string,p?:unknown[])=>s==="SET TRANSACTION READ ONLY"?Promise.resolve([]):runner.query(s,p)})};
    const formal=new MasterPlanQueryService(adapter as never,{listEnabled:async()=>[{id:division,name:"事业甲",pathLabel:"事业甲"},{id:other,name:"事业乙",pathLabel:"事业乙"}]}as never);
    service=new MasterPlanOrderProgressService(adapter as never,formal);
  },30000);
  beforeEach(async()=>{await runner.query("SAVEPOINT test_case")});
  afterEach(async()=>{await runner.query("ROLLBACK TO SAVEPOINT test_case");await runner.query("RELEASE SAVEPOINT test_case")});
  afterAll(async()=>{if(runner?.isTransactionActive)await runner.rollbackTransaction();await runner?.release();if(db?.isInitialized)await db.destroy()});
  const page=(kind:"orders"|"items",q:OrderProgressQuery={},who=actor)=>service.page(q,who,kind);
  it("defaults to unfinished orders, preserves missing monthly and stale coverage without inventing completion",async()=>{
    const r=await page("orders");expect(r.rows.map(r=>r.id)).toEqual(expect.arrayContaining([id(10),id(12),id(13)]));expect(r.rows.map(r=>r.id)).not.toContain(id(11));expect(r.rows.map(r=>r.id)).not.toContain(id(15));
    expect(r.rows.find(r=>r.id===id(10))).toMatchObject({orderCompletionRate:"0.1234",orderCompletedQuantity:"200.0000",orderPendingQuantity:"800.0000"});
    expect((await page("orders",{onlyUnfinishedOrders:"false"})).rows.map(r=>r.id)).toContain(id(11));
  });
  it("keeps independent repeated allocation rows; default hides completed items; absent monthly quantities are NULL",async()=>{
    const r=await page("items",{orderId:id(10)});expect(r.rows.map(r=>r.id)).toEqual([id(20),id(31),id(32)]);
    for(const n of [31,32])expect(r.rows.find(r=>r.id===id(n))).toMatchObject({sourceKind:"订单分配",requiredQuantity:null,pendingQuantity:null,planStatus:"尚未建立月计划",cuttingProductionProgress:null});
    expect((await page("items",{orderId:id(10),onlyUnfinishedItems:"false"})).rows.map(r=>r.id)).toContain(id(21));
    expect((await page("items",{orderId:id(12)})).rows[0]).toMatchObject({id:id(90),sourceKind:"ERP订单行",sourceQuantity:"100.0000",requiredQuantity:null});
  });
  it("repeated independent ERP source lines survive even when one monthly aggregate exists, without assigning its progress twice",async()=>{
    const rows=(await page("items",{orderId:id(16)})).rows;expect(rows).toHaveLength(3);expect(rows.map(r=>r.id)).toEqual(expect.arrayContaining([id(24),id(91),id(92)]));
    for(const row of rows.filter(r=>r.sourceKind==="ERP订单行"))expect(row).toMatchObject({planStatus:"来源行与月计划关联待核实",requiredQuantity:null,cuttingProductionProgress:null});
  });
  it("multiple deliveries and repeated reports SUM once: 255/500=51%, 525/500=105%; 300 dispatched is not denominator",async()=>{
    const row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;
    expect(Number(row.dispatchedWeeklyQuantity)).toBe(300);expect(Number(row.cuttingReportedQuantity)).toBe(255);expect(Number(row.cuttingProductionProgress)).toBe(.51);expect(Number(row.packagingProductionProgress)).toBe(1.05);expect(Number(row.packagingReportedQuantity)).toBe(525);
    expect(row).toMatchObject({cuttingStatus:"已完成",packagingStatus:"延期",cuttingLastReportDate:"2026-10-15",itemCompletionRate:"0.2500"});
  });
  it("综合进度以两道有效快照与入库三个阶段等权，跨周同工序去重且封顶",async()=>{
    const row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;
    expect(Number(row.itemProductionProgress)).toBeCloseTo((.25+.51+1)/3,10);
    expect(row.itemProgressBasis).toContain("下料"); expect(row.itemProgressBasis).toContain("包装");
    expect(row.itemProgressBasis).not.toContain("焊接");
    expect(Number(row.packagingProductionProgress)).toBe(1.05); // raw report metric stays truthful
  });
  it("已确认示例：三道工序全报完而未入库为75%",async()=>{
    await runner.query("UPDATE mps_monthly_plans SET cumulative_inbound_quantity=0 WHERE id=$1",[id(20)]);
    await runner.query("UPDATE mps_process_reports SET production_quantity=500 WHERE tenant_id=$1 AND weekly_plan_id=$2 AND process_code='cutting'",[tenant,id(50)]);
    await runner.query("INSERT INTO mps_weekly_process_plans(id,tenant_id,weekly_plan_id,process_code,execution_enabled) VALUES($1,$2,$3,'machining',true)",[id(73),tenant,id(50)]);
    await runner.query("INSERT INTO mps_process_reports(id,tenant_id,division_id,weekly_plan_id,process_code,production_quantity) VALUES($1,$2,$3,$4,'machining',500)",[id(66),tenant,division,id(50)]);
    expect(Number((await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!.itemProductionProgress)).toBe(.75);
  });
  it("入库覆盖缺报工阶段；全量入库100%，不补写历史报工",async()=>{
    await runner.query("UPDATE mps_monthly_plans SET cumulative_inbound_quantity=400 WHERE id=$1",[id(20)]);
    let row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;
    expect(Number(row.itemProductionProgress)).toBeCloseTo((.8+.8+1)/3,10);
    expect(Number(row.cuttingReportedQuantity)).toBe(255);
    await runner.query("UPDATE mps_monthly_plans SET cumulative_inbound_quantity=500 WHERE id=$1",[id(20)]);
    row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;expect(Number(row.itemProductionProgress)).toBe(1);
  });
  it("未选工序不参与综合进度，数量变更按最新需求重算",async()=>{
    await runner.query("UPDATE mps_weekly_process_plans SET execution_enabled=false WHERE process_code='packaging'");
    await runner.query("INSERT INTO mps_weekly_process_plans(id,tenant_id,weekly_plan_id,process_code,execution_enabled) VALUES($1,$2,$3,'cutting',true)",[id(72),tenant,id(51)]);
    const row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;
    expect(Number(row.itemProductionProgress)).toBeCloseTo((.25+.51)/2,10);
    await runner.query("UPDATE mps_monthly_plans SET required_quantity=1000 WHERE id=$1",[id(20)]);
    expect(Number((await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!.itemProductionProgress)).toBeCloseTo((.125+.255)/2,10);
  });
  it("纯外协只按入库，无有效工艺或无效需求不冒报进度",async()=>{
    await runner.query("UPDATE mps_weekly_plans SET manufacturing_method='外协' WHERE id IN ($1,$2)",[id(50),id(51)]);
    let row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;
    expect(Number(row.itemProductionProgress)).toBe(.25);
    await runner.query("UPDATE mps_weekly_plans SET manufacturing_method='中心外购' WHERE id IN ($1,$2)",[id(50),id(51)]);
    expect(Number((await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!.itemProductionProgress)).toBe(.25);
    await runner.query("UPDATE mps_weekly_plans SET manufacturing_method=NULL WHERE id IN ($1,$2)",[id(50),id(51)]);
    row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;
    expect(row.itemProductionProgress).toBeNull(); expect(row.itemProgressBasis).toContain("待核实");
    await runner.query("UPDATE mps_monthly_plans SET required_quantity=0 WHERE id=$1",[id(20)]);
    expect((await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!.itemProductionProgress).toBeNull();
  });
  it("部分交期缺少有效快照时不以剩余交期工序冒充完整路线",async()=>{
    await runner.query("UPDATE mps_weekly_process_plans SET execution_enabled=false WHERE weekly_plan_id=$1",[id(51)]);
    const row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;
    expect(row.itemProductionProgress).toBeNull();expect(row.itemProgressBasis).toContain("部分周计划");
  });
  it("订单包含已完成但被列表隐藏的品项；缺计划阻止不完整平均，品号筛选不改订单口径",async()=>{
    let row=(await page("orders",{orderId:id(10)})).rows[0]!;
    expect(row.orderProductionProgress).toBeNull(); expect(row).not.toHaveProperty("orderProgressBasis");
    await runner.query("DELETE FROM mps_order_allocations WHERE id IN ($1,$2)",[id(31),id(32)]);
    row=(await page("orders",{orderId:id(10),itemCodes:["ITEM-A"]})).rows[0]!;
    expect(Number(row.orderProductionProgress)).toBeCloseTo(((.25+.51+1)/3+1)/2,10);
  });
  it("formal preparation status, absent records and absent process tasks stay distinguishable; only manual exceptions",async()=>{
    const row=(await page("items",{orderId:id(10),itemId:id(20)})).rows[0]!;
    expect(row).toMatchObject({technicalStatus:"延期",hardwareStatus:"已完成",woodStatus:null,outsourcingStatus:"进行中",machiningStatus:null,machiningTaskCount:0});
    expect(row.exceptionSummary).toContain("人工技术异常");expect(row.exceptionSummary).toContain("人工工序异常");expect(row.exceptionSummary).not.toContain("计划提示");expect(JSON.stringify(row)).not.toContain("不适用");
  });
  it("server pagination, independent item paging, numeric sorting, exact multi-select and date scope",async()=>{
    expect((await page("orders",{page:2,pageSize:50})).rows).toEqual([]);
    expect((await page("items",{orderId:id(10),page:2,pageSize:50})).total).toBe(3);
    expect((await page("items",{orderId:id(10),itemCodes:["ITEM-B"],onlyUnfinishedItems:"false"})).rows.map(r=>r.id)).toEqual([id(21)]);
    expect((await page("orders",{orderNumbers:["ORDER-A"],dateType:"ORDER",datePeriod:"MONTH",dateValue:"2026-10"})).rows.map(r=>r.id)).toEqual([id(10)]);
    expect((await page("orders",{dateType:"ORDER",datePeriod:"YEAR",dateValue:"2025"})).total).toBe(0);
    expect((await page("items",{orderId:id(10),sortField:"sourceQuantity",sortOrder:"desc"})).rows.map(r=>r.id)).toEqual([id(32),id(31),id(20)]);
  });
  const scoped=()=>({...actor,permissions:[`${resource}:*:read`,`${resource}:*:export`,...tablePermissionFieldsFor(resource).map(f=>`${resource}:${f.key}:read`)],tableDataScopes:[{resource,scope:"CUSTOM",actions:["read"],rules:[{fieldKey:"divisionId",operator:"EQ",value:division}]},{resource,scope:"ALL",actions:["export"]}]});
  it("tenant and CUSTOM division scope bound orders/items/candidates; read ∩ export is enforced",async()=>{
    const who=scoped();expect((await page("orders",{},who)).rows.map(r=>r.id)).not.toContain(id(14));expect((await page("items",{orderId:id(14)},who)).total).toBe(0);
    expect((await service.candidates("orderNumber","OTHER",{},who)).options).toEqual([]);
    expect((await service.page({},who,"orders","export",true)).rows.map(r=>r.id)).not.toContain(id(14));
    const narrowed={...who,tableDataScopes:[{resource,scope:"ALL",actions:["read"]},{resource,scope:"CUSTOM",actions:["export"],rules:[{fieldKey:"divisionId",operator:"EQ",value:division}]}]};
    expect((await page("orders",{},narrowed)).rows.map(r=>r.id)).toContain(id(14));expect((await service.page({},narrowed,"orders","export",true)).rows.map(r=>r.id)).not.toContain(id(14));
    expect((await page("orders",{},{...actor,tenantId:tenant+"-NO-DATA"})).total).toBe(0);
  });
  it("field dependencies crop rows, ratios and sorting; input cannot probe hidden fields",async()=>{
    const who=scoped();who.permissions=who.permissions.filter(p=>![`${resource}:cuttingReportedQuantity:read`,`${resource}:itemName:read`].includes(p));
    const row=(await page("items",{orderId:id(10),itemId:id(20)},who)).rows[0]!;expect(row.itemName).toBeUndefined();expect(row.cuttingReportedQuantity).toBeUndefined();expect(row.cuttingProductionProgress).toBeUndefined();expect(row.itemProductionProgress).toBeUndefined();expect(row.itemProgressBasis).toBeUndefined();
    expect((await page("orders",{},who)).rows[0]!.orderProductionProgress).toBeUndefined();
    await expect(page("items",{sortField:"cuttingProductionProgress"},who)).rejects.toThrow("排序字段权限");
  });
  it("formal detail preserves both weekly delivery IDs and report facts; rejects fabricated item/order, tenant and original read bypass",async()=>{
    const input={orderId:id(10),itemId:id(20)};
    const w=await service.detail("mps-weekly-plans",input,actor);expect(w.rows.map((r:Record<string,unknown>)=>r.deliveryNumber)).toEqual(["001","002"]);
    const p=await service.detail("mps-process-reports",input,actor);expect(p.total).toBe(3);
    const tasks=await service.detail("mps-weekly-process-plans",input,actor);expect(JSON.stringify(tasks.rows)).not.toContain("计划提示不得算异常");
    await expect(service.detail("mps-process-reports",input,scoped())).rejects.toThrow("查看权限");
    await expect(service.detail("mps-weekly-plans",{orderId:id(10),itemId:id(23)},actor)).rejects.toThrow("没有该品项");
    const detailScoped=scoped();detailScoped.permissions.push("mps-weekly-plans:*:read");
    await expect(service.detail("mps-weekly-plans",{orderId:id(14),itemId:id(23)},detailScoped)).rejects.toThrow("没有该品项");
  });
  it("both XLSX exports inherit all top filters, ignore expansion/page and omit UUID/tenant; null is not zero",async()=>{
    const exporter=new MasterPlanOrderProgressExportService(service,{recordOrderProgressExport:audit}as never);
    for(const key of ["orders","items"]){const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.export(key,{orderNumbers:["ORDER-A"],orderId:id(14),itemId:id(23),page:10},actor)as never);const sheet=book.worksheets[0]!;expect(sheet.rowCount-1).toBe(key==="orders"?1:3);const values=JSON.stringify(sheet.getSheetValues());expect(values).not.toContain("0199bb00");expect(values).not.toContain("tenant");if(key==="items"){
      expect(values).toContain("0.51");
      const headers=sheet.getRow(1).values as unknown[];const col=headers.indexOf("综合生产进度");
      expect(col).toBeGreaterThan(0);expect(sheet.getColumn(col).numFmt).toBe("0.0%");
      expect(typeof sheet.getRow(2).getCell(col).value).toBe("number");
      expect(Number(sheet.getRow(2).getCell(col).value)).toBeCloseTo((.25+.51+1)/3,10);
    }}
    expect(audit).toHaveBeenCalledTimes(2);
  });
});
