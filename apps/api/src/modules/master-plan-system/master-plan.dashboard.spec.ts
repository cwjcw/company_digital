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
  beforeEach(() => { permissions = []; transaction.mockClear(); jest.restoreAllMocks(); });
  afterAll(async () => { await app.close(); });
  it("requires independent dashboard read for aggregate and candidates; monthly read grants nothing", async () => {
    permissions = ["mps-monthly-plans:*:read"];
    await request(app.getHttpServer()).get("/master-plan-system/dashboard").expect(403);
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/candidates?field=divisionId").expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("read alone cannot export", async () => {
    permissions = [`${resource}:*:read`];
    await request(app.getHttpServer()).get("/master-plan-system/dashboard/export").expect(403); expect(transaction).not.toHaveBeenCalled();
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
    for(const url of ["?orderNumbers=broken","?itemCodes=%7B%7D","?orderNumber=legacy","?dateType=ORDER&datePeriod=DAY&dateValue=2026-02-30","?dateType=bad","/table?tableKey=unknown","/export?tableKey=unknown"])await request(app.getHttpServer()).get("/master-plan-system/dashboard"+url).expect(400);
    jest.spyOn(exporter,"export").mockResolvedValueOnce(Buffer.from("fixture"));
    const response=await request(app.getHttpServer()).get("/master-plan-system/dashboard/export?tableKey=process-execution").expect(200);
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="mps_process_execution_\d{8}\.xlsx"$/);
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
