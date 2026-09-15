import { OrderScheduleImportService } from "./order-schedule-import.service";
import { Body, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { MarketingApplicationService } from "./marketing.application.service";
import { MarketingImportService } from "./marketing-import.service";
import type { BusinessCustomerMappingInput, MarketingActor, OrderScheduleInput } from "./marketing.types";

type MarketingRequest = Request & { user: any; requestId: string };

@ApiTags("营销中心")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("marketing")
export class MarketingController {
  constructor(private readonly application: MarketingApplicationService, private readonly imports: MarketingImportService, private readonly scheduleImports: OrderScheduleImportService) {}
  private actor(req: MarketingRequest, tenantCode: string | undefined, ip: string): MarketingActor {
    return { userId: req.user?.sub ?? null, username: req.user?.displayName ?? req.user?.username ?? "unknown", tenantCode: tenantCode || process.env.KDOS_DEFAULT_TENANT_CODE || "KAINAN", permissions: req.user?.permissions ?? [], managedOrganizationUnitIds: req.user?.managedOrganizationUnitIds ?? [], tableDataScopes: req.user?.tableDataScopes ?? [], requestId: req.requestId, ip };
  }
  private csv(response: Response, filename: string, headers: string[], rows: unknown[][]) {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    response.send(`\uFEFF${[headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")}`);
  }

  @Get("business-customer-mappings") listMappings(@Query() query: Record<string,string|undefined>, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { if(!query.page&&!query.pageSize)return this.application.listMappings(query.search,this.actor(req,tenant,ip));let filters={};try{filters=JSON.parse(query.filters??"{}");}catch{filters={};}return this.application.listMappingsPage({...query,page:Number(query.page),pageSize:Number(query.pageSize),filters},this.actor(req,tenant,ip)); }
  @Get("directory-users") listDirectoryUsers(@Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.listDirectoryUsers(this.actor(req, tenant, ip)); }
  @Get("directory-organizations") listDirectoryOrganizations(@Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.listDirectoryOrganizations(this.actor(req, tenant, ip)); }
  @Get("business-customer-mappings/export") async exportMappings(@Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string, @Res() response: Response) {
    const rows: any[] = await this.application.listMappings(undefined, this.actor(req, tenant, ip), "export") as any[];
    this.csv(response, "业务人员与客户对应表.csv", ["部门", "课室", "客户", "业务员"], rows.map((row) => [row.department, row.section, row.customerCode, (row.salespersonNames ?? []).join("|")]));
  }
  @Post("business-customer-mappings") saveMapping(@Body() body: BusinessCustomerMappingInput, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.saveMapping(null, body, null, this.actor(req, tenant, ip)); }
  @Patch("business-customer-mappings/:id") updateMapping(@Param("id") id: string, @Body() body: BusinessCustomerMappingInput & { expectedVersion: number }, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.saveMapping(id, body, Number(body.expectedVersion), this.actor(req, tenant, ip)); }
  @Delete("business-customer-mappings/:id") deleteMapping(@Param("id") id: string, @Body() body: { expectedVersion: number }, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.deleteMapping(id, Number(body.expectedVersion), this.actor(req, tenant, ip)); }
  @Post("business-customer-mappings/import") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
  importMappings(@UploadedFile() file: Express.Multer.File, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.imports.importMappings(file, this.actor(req, tenant, ip)); }
  @Post("business-customer-mappings/sync-departments-from-directory")
  syncMappingDepartmentsFromDirectory(@Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.syncMappingDepartmentsFromDirectory(this.actor(req, tenant, ip)); }

  @Get("order-schedules/import-template") async scheduleTemplate(@Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string, @Res() response: Response) {
    const buffer = await this.scheduleImports.template(this.actor(req, tenant, ip));
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent("订单排期导入模板.xlsx")}`);
    response.send(buffer);
  }
  @Post("order-schedules/import-preview") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  previewSchedules(@UploadedFile() file: Express.Multer.File, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.scheduleImports.preview(file, this.actor(req, tenant, ip)); }
  @Post("order-schedules/import-confirm")
  confirmSchedules(@Body() body: { token: string }, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.scheduleImports.confirm(body.token, this.actor(req, tenant, ip)); }

  @Get("order-schedules") listSchedules(@Query() query: Record<string,string|undefined>, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { if(!query.page&&!query.pageSize)return this.application.listSchedules(query.search,this.actor(req,tenant,ip));let filters={};try{filters=JSON.parse(query.filters??"{}");}catch{filters={};}return this.application.listSchedulesPage({...query,page:Number(query.page),pageSize:Number(query.pageSize),filters},this.actor(req,tenant,ip)); }
  @Get("order-schedules/export") async exportSchedules(@Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string, @Res() response: Response) {
    const rows: any[] = await this.application.listSchedules(undefined, this.actor(req, tenant, ip), "export") as any[];
    this.csv(response, "订单排期.csv", ["客户代码", "部门", "课室", "业务员", "订单编号", "品项编码", "品项名称", "客户交期", "订单总数量", "生产单位", "订单完成比例", "状态"], rows.map((row) => [row.customerCode, row.department, row.section, (row.salespersonNames ?? []).join("|"), row.orderNumber, row.itemNumber, row.itemName, row.customerDueDate, row.orderTotalQuantity, row.productionUnit, row.completionRatio, row.status === "VOID" ? "作废" : "正常"]));
  }
  @Post("order-schedules") saveSchedule(@Body() body: OrderScheduleInput, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.saveSchedule(null, body, null, this.actor(req, tenant, ip)); }
  @Patch("order-schedules/batch-due-date") batchDueDate(@Body() body: { rows: Array<{ id: string; expectedVersion: number }>; customerDueDate: string | null }, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.batchUpdateDueDate(body.rows ?? [], body.customerDueDate, this.actor(req, tenant, ip)); }
  @Post("order-schedules/batch-delete") batchDeleteSchedules(@Body() body: { rows: Array<{ id: string; expectedVersion: number }> }, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.batchDeleteSchedules(body.rows ?? [], this.actor(req, tenant, ip)); }
  @Patch("order-schedules/:id") updateSchedule(@Param("id") id: string, @Body() body: OrderScheduleInput & { expectedVersion: number }, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.saveSchedule(id, body, Number(body.expectedVersion), this.actor(req, tenant, ip)); }
  @Delete("order-schedules/:id") deleteSchedule(@Param("id") id: string, @Body() body: { expectedVersion: number }, @Req() req: MarketingRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.application.deleteSchedule(id, Number(body.expectedVersion), this.actor(req, tenant, ip)); }

}
