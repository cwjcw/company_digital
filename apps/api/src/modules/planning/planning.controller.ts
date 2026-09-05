import { Body, Controller, Get, Headers, Ip, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../../auth";
import { PlanningApplicationService } from "./planning.application.service";
import { PlanQueryService } from "./planning.query.service";
import type { CreatePlanItemInput, PlanItemPatch, PlanningActor } from "./planning.types";
import { PlanningImportService } from "./planning-import.service";
import { PlanningExportService } from "./planning-export.service";
import { PlanningImageService } from "./planning-image.service";

type PlanningRequest = Request & { user: any; requestId: string };
function actor(req: PlanningRequest, tenantCode: string | undefined, ip: string): PlanningActor {
  return {
    tenantCode: tenantCode || process.env.KDOS_DEFAULT_TENANT_CODE || "KAINAN",
    userId: req.user?.sub ?? null, permissions: req.user?.permissions ?? [], roles: req.user?.roles ?? [],
    tableDataScopes: req.user?.tableDataScopes ?? [], managedOrganizationUnitIds: req.user?.managedOrganizationUnitIds ?? [],
    requestId: req.requestId, traceId: String(req.headers["x-trace-id"] ?? req.requestId), ip,
    source: req.user?.apiKeyId ? "API" : "WEB"
  };
}

@ApiTags("Planning Center")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("planning")
export class PlanningController {
  constructor(private readonly commands: PlanningApplicationService, private readonly queries: PlanQueryService, private readonly imports: PlanningImportService, private readonly exports: PlanningExportService, private readonly images: PlanningImageService) {}
  private actor(req: PlanningRequest, tenant: string | undefined, ip: string) { return actor(req, tenant, ip); }

  @Get("fields") fields(@Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.queries.fields(this.actor(req, tenant, ip)); }
  @Get("organization-options") organizationOptions(@Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.queries.organizationOptions(this.actor(req, tenant, ip)); }
  @Get("periods") periods(@Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.queries.listPeriods(this.actor(req, tenant, ip)); }
  @Get("periods/by-month") byMonth(@Query("year", ParseIntPipe) year: number, @Query("month", ParseIntPipe) month: number, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.queries.getPeriodByMonth(year, month, this.actor(req, tenant, ip)); }
  @Get("on-hand-summary") onHandSummary(@Query("year", ParseIntPipe) year: number, @Query("month", ParseIntPipe) month: number, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.queries.getOnHandSummary(year, month, this.actor(req, tenant, ip)); }
  @Post("periods") createPeriod(@Body() body: { year: number; month: number }, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.createPeriod(Number(body.year), Number(body.month), this.actor(req, tenant, ip)); }
  @Get("periods/:periodId") getPeriod(@Param("periodId") periodId: string, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.queries.getPlanPeriod(periodId, this.actor(req, tenant, ip)); }
  @Post("periods/:periodId/versions") createVersion(@Param("periodId") periodId: string, @Body() body: { basedOnVersionId?: string | null }, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.createVersion(periodId, body.basedOnVersionId ?? null, this.actor(req, tenant, ip)); }
  @Post("periods/:periodId/versions/:versionId/publish") publish(@Param("periodId") periodId: string, @Param("versionId") versionId: string, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.publish(periodId, versionId, this.actor(req, tenant, ip)); }
  @Post("periods/:periodId/versions/:versionId/lock") lock(@Param("periodId") periodId: string, @Param("versionId") versionId: string, @Body() body: { reason: string }, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.lock(periodId, versionId, body.reason ?? "", this.actor(req, tenant, ip)); }
  @Post("periods/:periodId/versions/:versionId/unlock") unlock(@Param("periodId") periodId: string, @Param("versionId") versionId: string, @Body() body: { reason: string }, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.unlock(periodId, versionId, body.reason ?? "", this.actor(req, tenant, ip)); }
  @Get("versions/:versionId/items") items(@Param("versionId") versionId: string, @Query() query: Record<string, string | undefined>, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) {
    let filters: Record<string, string> = {};
    try { const parsed = JSON.parse(query.filters ?? "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) filters = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")])); } catch { filters = {}; }
    const input = { versionId, orderNumber: query.orderNumber, itemNumber: query.itemNumber, search: query.search, filters, sortField: query.sortField, sortOrder: query.sortOrder === "desc" ? "desc" as const : "asc" as const };
    if (!query.page && !query.pageSize) return this.queries.searchPlanItems(input, this.actor(req, tenant, ip));
    return this.queries.searchPlanItemsPage({ ...input, page: Number(query.page ?? 1), pageSize: Number(query.pageSize ?? 50) }, this.actor(req, tenant, ip));
  }
  @Post("versions/:versionId/items") createItem(@Param("versionId") versionId: string, @Body() body: CreatePlanItemInput, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.createItem(versionId, body, this.actor(req, tenant, ip)); }
  @Post("versions/:versionId/imports/preview") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 100 * 1024 * 1024 } }))
  previewImport(@Param("versionId") versionId: string, @UploadedFile() file: Express.Multer.File, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.imports.preview(versionId, file, this.actor(req, tenant, ip)); }
  @Post("imports/:jobId/confirm") confirmImport(@Param("jobId") jobId: string, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.confirmImport(jobId, this.actor(req, tenant, ip)); }
  @Get("versions/:versionId/export") async export(@Param("versionId") versionId: string, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string, @Res() response: Response) {
    const buffer = await this.exports.export(versionId, this.actor(req, tenant, ip));
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename="kdos-plan-${versionId}.xlsx"`); response.send(buffer);
  }
  @Patch("items/:itemId") updateItem(@Param("itemId") itemId: string, @Body() body: PlanItemPatch, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.updateItem(itemId, body, this.actor(req, tenant, ip)); }
  @Post("items/:itemId/images") @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 15 * 1024 * 1024 } }))
  addImage(@Param("itemId") itemId: string, @UploadedFile() file: Express.Multer.File, @Body("expectedVersion") expectedVersion: string, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.images.add(itemId, file, Number(expectedVersion), this.actor(req, tenant, ip)); }
  @Post("versions/:versionId/items/bulk") bulk(@Param("versionId") versionId: string, @Body() body: { updates: Array<{ id: string } & PlanItemPatch> }, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.bulkUpdate(versionId, body.updates ?? [], this.actor(req, tenant, ip)); }
  @Post("versions/:versionId/reorder") reorder(@Param("versionId") versionId: string, @Body() body: { itemIds: string[] }, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.commands.reorder(versionId, body.itemIds ?? [], this.actor(req, tenant, ip)); }
  @Get("versions/:versionId/risks") risks(@Param("versionId") versionId: string, @Query("days") days: string | undefined, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.queries.getPlanRiskSummary(versionId, Math.min(Math.max(Number(days ?? 7), 1), 90), this.actor(req, tenant, ip)); }
  @Get("versions/:versionId/process-progress") processes(@Param("versionId") versionId: string, @Req() req: PlanningRequest, @Headers("x-tenant-code") tenant: string | undefined, @Ip() ip: string) { return this.queries.getProcessProgress(versionId, this.actor(req, tenant, ip)); }
}
