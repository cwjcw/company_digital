import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { DataSource } from "typeorm";
import request from "supertest";
import { AuthGuard } from "../../auth";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanDashboardController } from "./master-plan.dashboard.controller";
import { MasterPlanDashboardService } from "./master-plan.dashboard.service";
import { MasterPlanDashboardExportService } from "./master-plan.dashboard-export.service";
import type { MasterPlanActor } from "./master-plan.types";
import { masterPlanResourceDefinitions, tableFilterResourceCapabilityOf, tablePermissionFieldsFor, tableResourceRegistry } from "@kdos/contracts";

const resource = "mps-overview-dashboard";
const base: MasterPlanActor = { tenantId: "KAINAN", userId: null, username: "test", permissions: [], tableDataScopes: [], requestId: "test", source: "web" };
describe("Master plan overview HTTP authorization", () => {
  let app: INestApplication; let permissions: string[]; let exporter: MasterPlanDashboardExportService; const transaction = jest.fn();
  beforeAll(async () => {
    const db = { transaction } as unknown as DataSource;
    const service = new MasterPlanDashboardService(db);
    exporter=new MasterPlanDashboardExportService(service,new MasterPlanApplicationService(db,{} as never));
    const module = await Test.createTestingModule({ controllers: [MasterPlanDashboardController], providers: [
      { provide: MasterPlanDashboardService, useValue: service }, { provide: MasterPlanDashboardExportService, useValue: exporter }
    ] }).overrideGuard(AuthGuard).useValue({ canActivate: (ctx: { switchToHttp(): { getRequest(): { user: object } } }) => { ctx.switchToHttp().getRequest().user = { permissions, tableDataScopes: [] }; return true; } }).compile();
    app = module.createNestApplication(); await app.init();
  });
  beforeEach(() => { permissions = []; transaction.mockReset(); jest.restoreAllMocks(); });
  afterAll(async () => { await app.close(); });
  it("requires independent dashboard read for aggregate and candidates; monthly read grants nothing", async () => {
    permissions = ["mps-monthly-plans:*:read"];
    await request(app.getHttpServer()).get("/master-plan-system/dashboard").expect(403);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/summary").expect(403);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/candidates?field=divisionId").expect(403);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/gap-counts").expect(403);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/gaps?type=no-inbound").expect(403);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/reports/plan-readiness").expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("gap-only endpoint returns only allowed fields/counts and never overview aggregates", async () => {
    permissions = [`${resource}:*:read`];
    transaction.mockImplementation(async (_level: string, fn: (manager: unknown) => unknown) => fn({ query: async (sql: string) => sql.startsWith("WITH") ? [{ data: { gaps: { "no-inbound": 42 } } }] : [] }));
    const response = await request(app.getHttpServer()).get("/master-plan-system/dashboard/gap-counts").expect(200);
    expect(Object.keys(response.body).sort()).toEqual(["gaps", "generatedAt", "visibleFields"]);
    expect(response.body.gaps).toEqual({}); // Operation permission grants no metric fields.
    transaction.mockReset();
  });
  it("all nine exports reject callers without export, including export without read", async () => {
    for (const p of [[`${resource}:*:read`], [`${resource}:*:export`]]) {
      permissions = p;
      for (const gap of (await import("@kdos/contracts")).mpsDashboardGaps) await request(app.getHttpServer()).get(`/master-plan-system/dashboard/export?tableKey=${gap.key}`).expect(403);
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  it("cockpit summary never returns unused risk rows or hidden metric inference", async () => {
    permissions=[`${resource}:*:read`];
    const {standardProcesses}=await import("@tracker/shared");
    const raw={orders:{orderCount:99},plans:{requiredQuantity:"100"},gaps:{overdue:7},readiness:[{status:"待完善",count:2}],auxiliary:[{key:"technical",states:[{status:"延期",count:1}]}],processes:standardProcesses.map(p=>({code:p.code,values:{requiredQuantity:"100",reportedQuantity:"0",productionProgress:"0"},states:[{status:"延期",count:1}]})),trend:[{productionDate:"2026-10-15",cuttingReportedQuantity:"5"}],divisions:[{divisionId:"hidden"}],risks:null,trendStart:"2026-10-09",trendEnd:"2026-10-15"};
    const queries:string[]=[];
    transaction.mockImplementation(async (_level:string,fn:(manager:unknown)=>unknown)=>fn({query:async(sql:string)=>{queries.push(sql);return sql.startsWith("WITH")?[{data:raw}]:[];}}));
    const response=await request(app.getHttpServer()).get("/master-plan-system/dashboard/summary").expect(200);
    expect(response.body).not.toHaveProperty("risks");expect(response.body.orders).toEqual({});expect(response.body.plans).toEqual({});expect(response.body.gaps).toEqual({});expect(response.body.trend).toEqual([]);expect(response.body.divisions).toEqual([]);
    for(const p of response.body.processes){expect(p.values).toEqual({});expect(p.states).toEqual([]);}
    expect(queries.find(sql=>sql.startsWith("WITH"))).toContain("'risks','null'::jsonb");
  });
  it("read alone cannot export", async () => {
    permissions = [`${resource}:*:read`];
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/export").expect(403); await request(app.getHttpServer()).get("/master-plan-system/dashboard/export?tableKey=no-inbound").expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("gap counts/lists require their metric and dependencies, and hidden local searches fail before SQL", async()=>{
    permissions=[`${resource}:*:read`];
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/gaps?type=no-inbound").expect(403);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/reports/plan-readiness?search=hidden").expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("invalid division, hidden filters and unknown candidates fail before SQL", async () => {
    permissions = ["*"];
    await request(app.getHttpServer()).get("/master-plan-system/dashboard?divisionId=invalid").expect(400);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/candidates?field=sql").expect(400);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard?sortField=sql").expect(400);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard?sortField=orderNumber&sortOrder=drop").expect(400);
    permissions = [`${resource}:*:read`];
    await request(app.getHttpServer()).get("/master-plan-system/dashboard?customerCode=hidden").expect(403);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard?sortField=orderNumber").expect(403); expect(transaction).not.toHaveBeenCalled();
  });
  it("validates multiselect/date/table contracts and export returns an English filename", async()=>{
    permissions=["*"];
    for(const url of ["?orderNumbers=broken","?itemCodes=%7B%7D","?orderNumber=legacy","?dateType=ORDER&datePeriod=DAY&dateValue=2026-02-30","?dateType=bad","/table?tableKey=unknown","/export?tableKey=unknown","/gaps?type=unknown","/gaps?type=missing-three-day-work-order","/reports/unknown","/reports/process-execution?processCode=legacy","/reports/process-execution?onlyIncomplete=invalid"])await request(app.getHttpServer()).get("/master-plan-system/dashboard"+url).expect(400);
    jest.spyOn(exporter,"export").mockResolvedValueOnce(Buffer.from("fixture"));
    const response=await request(app.getHttpServer()).get("/master-plan-system/dashboard/export?tableKey=process-execution").expect(200);
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="mps_process_execution_\d{8}\.xlsx"$/);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("all nine gap downloads retain English filenames", async () => {
    permissions=["*"];
    jest.spyOn(exporter,"export").mockResolvedValue(Buffer.from("fixture"));
    for(const gap of (await import("@kdos/contracts")).mpsDashboardGaps) {
      const result=await request(app.getHttpServer()).get(`/master-plan-system/dashboard/export?tableKey=${gap.key}`).expect(200);
      expect(result.headers["content-disposition"]).toMatch(new RegExp(`^attachment; filename="mps_${gap.key.replaceAll("-","_")}_\\d{8}\\.xlsx"$`));
    }
    expect(transaction).not.toHaveBeenCalled();
  });

});
describe("Overview resource and scope contract", () => {
  const service = new MasterPlanDashboardService({} as DataSource);
  it("registers an independent planning resource, real filter exemption, no CRUD resource or amount/audit fields", () => {
    expect(tableResourceRegistry.find(r => r.code === resource)?.moduleCode).toBe("planning");
    expect(masterPlanResourceDefinitions.some(r => String(r.code) === resource)).toBe(false);
    expect(tableFilterResourceCapabilityOf(resource).status).toBe("NOT_APPLICABLE");
    expect(tablePermissionFieldsFor(resource).some(f => ["orderAmount", "createdBy", "updatedBy"].includes(f.key))).toBe(false);
  });
  it("binds division UUID with the same helper for primary and receiving divisions, intersects read and export", () => {
    const div = "0199d000-0000-7000-8000-000000000010";
    const actor = { ...base, tableDataScopes: [{ resource, scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: div }] }, { resource, scope: "ALL", actions: ["export"] }] };
    for (const column of ["primary_division_id", "division_id"]) { const params: unknown[] = []; expect(service.scopeSql(actor, column, params)).toContain(`record.${column}`); expect(params).toEqual([div]); }
    const sql = service.querySql({}, { ...actor, permissions: ["*"] }, "export");
    expect(sql.sql).toContain("report_totals AS MATERIALIZED"); expect(sql.sql).toContain("sum(production_quantity)");
    expect(sql.sql).not.toContain("AVG("); expect(sql.sql).not.toContain("mps_data_exceptions");
  });
  it("rejects malformed CUSTOM rules rather than dropping conditions", () => {
    expect(() => service.scopeSql({ ...base, tableDataScopes: [{ resource, scope: "CUSTOM", rules: [{ fieldKey: "divisionId", operator: "CONTAINS", value: "事业一部" }] }] }, "division_id", [])).toThrow("大屏自定义数据范围");
  });
});
