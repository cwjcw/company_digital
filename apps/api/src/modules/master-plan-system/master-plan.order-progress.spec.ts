import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { DataSource } from "typeorm";
import request from "supertest";
import { AuthGuard } from "../../auth";
import { MasterPlanOrderProgressService } from "./master-plan.order-progress.service";
import { MasterPlanOrderProgressController } from "./master-plan.order-progress.controller";
import { MasterPlanOrderProgressExportService } from "./master-plan.order-progress-export.service";
import { mpsOrderProgressResource as resource, tablePermissionFieldsFor } from "@kdos/contracts";

describe("Order progress independent HTTP authorization",()=>{
  let app:INestApplication,permissions:string[],service:MasterPlanOrderProgressService,exporter:MasterPlanOrderProgressExportService;const transaction=jest.fn();
  beforeAll(async()=>{service=new MasterPlanOrderProgressService({transaction}as unknown as DataSource,{}as never);exporter=new MasterPlanOrderProgressExportService(service,{}as never);
    const m=await Test.createTestingModule({controllers:[MasterPlanOrderProgressController],providers:[{provide:MasterPlanOrderProgressService,useValue:service},{provide:MasterPlanOrderProgressExportService,useValue:exporter}]}).overrideGuard(AuthGuard).useValue({canActivate:(ctx:{switchToHttp():{getRequest():{user:object}}})=>{ctx.switchToHttp().getRequest().user={permissions,tableDataScopes:[]};return true}}).compile();app=m.createNestApplication();await app.init()});
  beforeEach(()=>{permissions=[];transaction.mockClear();jest.restoreAllMocks()});afterAll(async()=>app.close());
  it("old overview/monthly permission grants no access to new meta/orders/items/candidates/export",async()=>{
    permissions=["mps-overview-dashboard:*:read","mps-monthly-plans:*:read"];
    for(const path of ["meta","orders","items","candidates?field=orderNumber","export/orders","export/items"])await request(app.getHttpServer()).get('/master-plan-system/order-progress/'+path).expect(403);expect(transaction).not.toHaveBeenCalled();
  });
  it("read without export is 403 before SQL; metadata exposes only independently granted fields",async()=>{
    permissions=[`${resource}:*:read`,`${resource}:orderNumber:read`];
    const meta=await request(app.getHttpServer()).get('/master-plan-system/order-progress/meta').expect(200);expect(meta.body).toEqual({visibleFields:["orderNumber"],canExport:false});
    for(const key of ["orders","items"])await request(app.getHttpServer()).get('/master-plan-system/order-progress/export/'+key).expect(403);expect(transaction).not.toHaveBeenCalled();
  });
  it("whitelists IDs, date, multi-select, sort, boolean and export kinds",async()=>{
    permissions=["*"];
    for(const path of ["orders?orderId=wrong","items?itemId=wrong","orders?divisionId=事业甲","orders?orderNumbers=broken","orders?itemCodes=%7B%7D","orders?dateType=ORDER&datePeriod=DAY&dateValue=2026-02-30","orders?dateType=SQL","orders?sortField=sql","orders?sortOrder=drop","orders?onlyUnfinishedOrders=bad","export/sql","candidates?field=sql","detail/sql"])await request(app.getHttpServer()).get('/master-plan-system/order-progress/'+path).expect(400);expect(transaction).not.toHaveBeenCalled();
  });
  it("hidden filter/sort/unfinished dependencies reject before querying",async()=>{
    permissions=[`${resource}:*:read`];for(const path of ["orders?customerCode=C1","orders?sortField=orderNumber","orders","items","candidates?field=itemCode"])await request(app.getHttpServer()).get('/master-plan-system/order-progress/'+path).expect(403);expect(transaction).not.toHaveBeenCalled();
  });
  it("rejects malformed CUSTOM scope without dropping any unknown rules",()=>{
    const actor={tenantId:"TEST",userId:null,username:"test",permissions:[`${resource}:*:read`,...tablePermissionFieldsFor(resource).map(f=>`${resource}:${f.key}:read`)],tableDataScopes:[{resource,scope:"CUSTOM",rules:[{fieldKey:"divisionId",operator:"EQ",value:"事业甲"}]}],requestId:"test",source:"web"as const};
    expect(()=>service.querySql({},actor,"orders")).toThrow("自定义数据范围");
  });
  it("returns independent English filenames for each export",async()=>{
    permissions=["*"];jest.spyOn(exporter,"export").mockResolvedValue(Buffer.from("fixture"));
    for(const key of ["orders","items"]){const r=await request(app.getHttpServer()).get('/master-plan-system/order-progress/export/'+key).expect(200);expect(r.headers['content-disposition']).toMatch(new RegExp(`mps_${key==='orders'?'order':'item'}_progress_\\d{8}\\.xlsx`))}
  });
});
