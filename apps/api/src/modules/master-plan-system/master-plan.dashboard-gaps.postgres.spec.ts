import { DataSource, type QueryRunner } from "typeorm";
import ExcelJS from "exceljs";
import original from "../../data-source";
import { mpsDashboardGaps, tablePermissionFieldsFor } from "@kdos/contracts";
import { MasterPlanDashboardService, type DashboardQuery } from "./master-plan.dashboard.service";
import { MasterPlanDashboardExportService } from "./master-plan.dashboard-export.service";
import type { MasterPlanActor } from "./master-plan.types";

const integration = process.env.KDOS_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;
const tenant = "DASHBOARD-REV2-FIXTURE", division = "0199aa00-0000-7000-8000-000000000001", otherDivision = "0199aa00-0000-7000-8000-000000000002";
const id = (n: number) => `0199aa00-0000-7000-8000-${String(n).padStart(12,"0")}`;
const actor: MasterPlanActor = { tenantId: tenant, userId: id(99), username: "fixture", permissions: ["*"], tableDataScopes: [], requestId: "rev2-test", source: "web" };

/** Actual PostgreSQL UUID/JSONB/anti-join semantics, without touching business data.
 * Connection-local TEMP copies have no data/foreign keys and are rolled back.
 * Service transaction settings are already provided by the enclosing fixture
 * transaction; SET TRANSACTION READ ONLY is skipped only in this test adapter.
 */
integration("Dashboard REV2 gap/report PostgreSQL queries", () => {
  let db: DataSource, runner: QueryRunner, service: MasterPlanDashboardService;
  const audit = jest.fn().mockResolvedValue(undefined);
  beforeAll(async () => {
    const options = original.options; if (options.type !== "postgres") throw new Error("Requires PostgreSQL");
    db = new DataSource({ ...options, entities: [], migrations: [], subscribers: [], poolSize: 1 });
    await db.initialize(); runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    for (const table of ["mps_group_plans","mps_monthly_plans","mps_shipping_plans","mps_base_plans","mps_weekly_plans","mps_weekly_process_plans","mps_process_reports","mps_technical_reports","mps_material_reports","mps_outsourcing_reports","mps_reconciliation_outbox","organization_units"]) {
      await runner.query(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`);
    }
    const insert = async (table: string, values: Record<string, unknown>) => {
      const entries = Object.entries({ tenant_id: tenant, created_by: actor.userId, ...values });
      await runner.query(`INSERT INTO ${table}(${entries.map(([key])=>key).join(",")}) VALUES(${entries.map((_,i)=>`$${i+1}`).join(",")})`,entries.map(([,value])=>value));
    };
    await runner.query("INSERT INTO organization_units(id,name) VALUES($1,'事业部甲'),($2,'事业部乙')",[division,otherDivision]);
    const common = { division_id: division, customer_code: "C-1", order_date: "2026-10-01", latest_customer_due_date: "2020-01-01", item_code: "ITEM", item_name: "产品" };
    // A: a shipping row with identical order/item but a DIFFERENT parent cannot cover A.
    for (const [n,order,inbound,pending,required] of [[10,"A",0,100,100],[11,"F",60,40,100],[12,"G",100,0,100],[13,"ZERO",0,0,0],[14,"OTHER",0,100,100],[15,"FOREIGN",0,100,100]] as const) {
      await insert("mps_monthly_plans",{ ...common,id:id(n),order_number:order,required_quantity:required,cumulative_inbound_quantity:inbound,pending_quantity:pending,...(n===14?{division_id:otherDivision}:{}),...(n===15?{tenant_id:tenant+"-OTHER"}:{}) });
    }
    await insert("mps_shipping_plans",{...common,id:id(20),order_number:"A",monthly_plan_id:id(12),delivery_number:"001",planned_quantity:50});
    await insert("mps_shipping_plans",{...common,id:id(21),order_number:"A",monthly_plan_id:id(12),delivery_number:"002",planned_quantity:50});
    await insert("mps_shipping_plans",{...common,tenant_id:tenant+"-OTHER",id:id(23),order_number:"A",monthly_plan_id:id(10),delivery_number:"003",planned_quantity:100});
    await insert("mps_base_plans",{...common,tenant_id:tenant+"-OTHER",id:id(32),shipping_plan_id:id(21),order_number:"A",delivery_number:"002",planned_quantity:100});
    // B: only the first of two delivery batches has a base plan.
    await insert("mps_base_plans",{...common,id:id(30),shipping_plan_id:id(20),order_number:"A",delivery_number:"001",planned_quantity:50});
    // C: one ready base, one incomplete; a linked weekly always takes precedence.
    await insert("mps_base_plans",{...common,id:id(31),shipping_plan_id:id(21),order_number:"C",delivery_number:"002",planned_quantity:100,latest_review_due_date:"2026-10-02",product_attribute:"产品",surface_nature:"表面",manufacturing_method:"自制"});
    // Use a different unlinked shipping fixture to avoid covering B's second batch.
    await runner.query("UPDATE pg_temp.mps_base_plans SET shipping_plan_id=$1 WHERE id=$2",[id(22),id(31)]);
    for (const [n,order,quantity] of [[40,"D",100],[41,"F",100],[42,"ZERO-WEEK",0]] as const) {
      await insert("mps_weekly_plans",{...common,id:id(n),base_plan_id:id(200+n),order_number:order,delivery_number:"001",planned_quantity:quantity,pending_quantity:quantity});
    }
    await insert("mps_process_reports",{division_id:division,item_code:"ITEM",item_name:"产品",id:id(50),weekly_plan_id:id(41),order_number:"F",process_code:"cutting",production_quantity:25,production_date:"2026-10-14",exception_text:"人工异常"});
    await insert("mps_weekly_process_plans",{id:id(51),weekly_plan_id:id(41),process_code:"cutting",status:"延期",exception_text:"计划提示不能算生产异常"});
    const adapter = { transaction: async (...args: unknown[]) => (args[args.length-1] as (manager: unknown)=>unknown)({ query: (sql: string, params?: unknown[]) => sql==="SET TRANSACTION READ ONLY" ? Promise.resolve([]) : runner.query(sql,params) }) };
    service = new MasterPlanDashboardService(adapter as never);
  },30000);
  afterAll(async()=>{ if(runner?.isTransactionActive)await runner.rollbackTransaction();await runner?.release();if(db?.isInitialized)await db.destroy(); });
  const list = (key: string, input: DashboardQuery = {}, who = actor) => service.table({ ...input, tableKey:key },who);
  it("A/B/C/D/E/F/G: exact parent IDs, distinct batches, readiness, actual reports and inbound gaps",async()=>{
    expect((await list("missing-shipping-plan")).rows.map(r=>r.id)).toContain(id(10));
    expect((await list("missing-shipping-plan")).rows.map(r=>r.id)).not.toContain(id(12));
    expect((await list("missing-base-plan")).rows.map(r=>r.id)).toEqual([id(21)]);
    expect((await list("missing-weekly-plan")).rows.map(r=>r.id)).toEqual([id(31)]);
    expect((await list("plan-not-ready")).rows.map(r=>r.id)).toEqual([id(30)]);
    expect((await list("not-started-production")).rows.map(r=>r.id)).toEqual([id(40)]);
    expect((await list("no-inbound")).rows.map(r=>r.id)).toEqual(expect.arrayContaining([id(10),id(14)]));
    for (const excluded of [id(12),id(13),id(15)]) expect((await list("no-inbound")).rows.map(r=>r.id)).not.toContain(excluded);
    expect((await list("incomplete-inbound")).rows.map(r=>r.id)).toEqual([id(11)]);
    expect((await list("production-exception")).rows.map(r=>r.id)).toEqual([id(11)]);
  });
  it("all 9 KPI counts equal same-scope list totals across division/customer/order/item/date filters",async()=>{
    for(const filters of [{},{divisionId:division},{customerCode:"C-1",orderNumbers:["A"]},{itemCodes:["ITEM"],dateType:"ORDER",datePeriod:"MONTH",dateValue:"2026-10"},{dateType:"DELIVERY",datePeriod:"CUSTOM",dateFrom:"2019-01-01",dateTo:"2021-01-01"}] as DashboardQuery[]){
      const summary=await service.dashboard(filters,actor);
      const counts=await service.gapCounts({...filters,search:"local condition must not affect KPI",page:99},actor);
      expect(counts.gaps).toEqual(summary.gaps);
      expect(Object.keys(counts).sort()).toEqual(["gaps","generatedAt","visibleFields"]);
      for(const g of mpsDashboardGaps)expect((await list(g.key,filters)).total).toBe(counts.gaps[g.key]);
    }
  });
  it("tenant and dashboard read scope/export intersection apply to every count and detail",async()=>{
    const fields=tablePermissionFieldsFor("mps-overview-dashboard").map(f=>`mps-overview-dashboard:${f.key}:read`);
    const who={...actor,permissions:["mps-overview-dashboard:*:read","mps-overview-dashboard:*:export",...fields],tableDataScopes:[{resource:"mps-overview-dashboard",scope:"ALL",actions:["read"]},{resource:"mps-overview-dashboard",scope:"CUSTOM",actions:["export"],rules:[{fieldKey:"divisionId",operator:"EQ",value:division}]}]};
    expect((await list("no-inbound",{},who)).rows.map(r=>r.id)).toContain(id(14));
    const exported=await service.table({tableKey:"no-inbound"},who,"export",true);
    expect(exported.rows.map(r=>r.id)).toEqual([id(10)]);
    expect(exported.rows.map(r=>r.id)).not.toContain(id(15));
    const scoped={...who,tableDataScopes:[{resource:"mps-overview-dashboard",scope:"CUSTOM",actions:["read"],rules:[{fieldKey:"divisionId",operator:"EQ",value:division}]}]};
    expect((await list("no-inbound",{},scoped)).rows.map(r=>r.id)).toEqual([id(10)]);
  });
  it("gap counts and each list share CUSTOM division/tenant scope; empty tenant stays empty",async()=>{
    const permissions=["mps-overview-dashboard:*:read",...tablePermissionFieldsFor("mps-overview-dashboard").map(f=>`mps-overview-dashboard:${f.key}:read`)];
    for (const who of [
      {...actor,permissions,tableDataScopes:[{resource:"mps-overview-dashboard",scope:"CUSTOM",actions:["read"],rules:[{fieldKey:"divisionId",operator:"IN",value:[division]}]}]},
      {...actor,tenantId:tenant+"-EMPTY"}
    ]) {
      const counts=await service.gapCounts({},who);
      for(const gap of mpsDashboardGaps) {
        const rows=await list(gap.key,{},who);
        expect(rows.total).toBe(counts.gaps[gap.key]);
        for(const row of rows.rows)expect(row.divisionId).toBe(division);
        if(who.tenantId.endsWith("-EMPTY"))expect(rows.total).toBe(0);
      }
    }
  });
  it("server pagination/sort/search preserves full total and does not alter KPI",async()=>{
    const counts=await service.gapCounts({},actor);
    const first=await list("no-inbound",{pageSize:50,sortField:"orderNumber",sortOrder:"desc"});
    const outside=await list("no-inbound",{page:2,pageSize:50,sortField:"orderNumber",sortOrder:"desc"});
    expect(first.rows.map(r=>r.orderNumber)).toEqual(["OTHER","A"]);
    expect(outside.rows).toEqual([]);expect(outside.total).toBe(first.total);expect(outside.page).toBe(2);
    expect((await list("no-inbound",{search:"OTHER"})).total).toBe(1);
    expect((await service.gapCounts({search:"OTHER"},actor)).gaps).toEqual(counts.gaps);
  });
  it("serves two real SQL pages without loading all rows into the page response",async()=>{
    await runner.query("SAVEPOINT gap_pagination");
    try {
      await runner.query(`INSERT INTO pg_temp.mps_monthly_plans(tenant_id,id,division_id,order_number,item_code,required_quantity,cumulative_inbound_quantity,pending_quantity,created_by)
        SELECT $1,('0199bb00-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid,$2,'PAGE-'||lpad(n::text,2,'0'),'PAGE-ITEM',100,0,100,$3 FROM generate_series(1,55) n`,[tenant,division,actor.userId]);
      const filters={itemCodes:["PAGE-ITEM"]};
      const counts=await service.gapCounts(filters,actor);
      const first=await list("no-inbound",{...filters,pageSize:50,sortField:"orderNumber",sortOrder:"asc"});
      const second=await list("no-inbound",{...filters,page:2,pageSize:50,sortField:"orderNumber",sortOrder:"asc"});
      expect(counts.gaps["no-inbound"]).toBe(55);expect(first.total).toBe(55);expect(second.total).toBe(55);
      expect(first.rows).toHaveLength(50);expect(second.rows).toHaveLength(5);
      expect(first.rows[0]?.orderNumber).toBe("PAGE-01");expect(second.rows[0]?.orderNumber).toBe("PAGE-51");
      expect(new Set([...first.rows,...second.rows].map(r=>r.id)).size).toBe(55);
    } finally { await runner.query("ROLLBACK TO SAVEPOINT gap_pagination"); }
  });
  it("independent report local filters, state filters, latest report date and multiple risk types",async()=>{
    const execution=await list("process-execution",{processCode:"cutting",onlyOverdue:"true",search:"F"});
    expect(execution.total).toBe(1);expect(Number(execution.rows[0]?.reportedQuantity)).toBe(25);expect(execution.rows[0]).toMatchObject({productionDate:"2026-10-14",status:"延期"});
    const risk=await list("risk-exception",{riskType:"生产异常",search:"F"});
    expect(risk.total).toBe(1);expect(risk.rows[0]?.riskType).toBe("已延期、生产异常");
    expect((await list("risk-exception")).rows.every(r=>r.riskType!=="计划待完善")).toBe(true);
    expect((await list("plan-readiness",{search:"C"})).total).toBe(0);
  });
  it("each gap and report exports all matching rows with business labels, independently of page",async()=>{
    const exporter=new MasterPlanDashboardExportService(service,{recordDashboardExport:audit} as never);
    for(const key of [...mpsDashboardGaps.map(g=>g.key),"plan-readiness","process-execution","risk-exception","division-summary","process-summary"]){
      const input={tableKey:key,page:10,pageSize:50,divisionId:division};
      const summary=["division-summary","process-summary"].includes(key)?await service.dashboard({divisionId:division},actor):null;
      const total=key==="division-summary"?summary!.divisions.length:key==="process-summary"?summary!.processes.length:(await list(key,{divisionId:division})).total;
      const book=new ExcelJS.Workbook();await book.xlsx.load(await exporter.export(input,actor) as never);
      const sheet=book.worksheets[0]!;expect(sheet.rowCount-1).toBe(total);
      const text=JSON.stringify(sheet.getSheetValues());expect(text).not.toContain(division);expect(text).not.toContain("0199aa00");
    }
    expect(audit).toHaveBeenCalledTimes(14);
  });
});
