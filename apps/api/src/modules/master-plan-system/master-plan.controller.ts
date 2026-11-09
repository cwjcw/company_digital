import { MasterPlanDemandQuantityService } from './master-plan.demand-quantity.service';
import type { MpsQuantityRequest, MpsQuantityConfirm } from '@kdos/contracts';
import { MasterPlanDemandLinkService } from "./master-plan.demand-link.service";
import { mpsDemandLinkResources, type MpsBindDemandRequest } from "@kdos/contracts";
import { MasterPlanLifecycleService } from "./master-plan.lifecycle.service";
import { mpsLifecycleResources, type MpsLifecycleOperation } from "@kdos/contracts";
import { OrderAllocationConfigService } from "./order-allocation-config.service";
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MasterPlanWorkOrderService } from "./master-plan.work-order.service";
import type { MasterPlanActor } from "./master-plan.types";
import { reviewDueDateExportFilename } from '@kdos/contracts';

type MasterPlanRequest = Request & { user: any; requestId: string };

@ApiTags("主计划系统")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("master-plan-system")
export class MasterPlanController {
  constructor(private readonly queries: MasterPlanQueryService, private readonly application: MasterPlanApplicationService, private readonly sync: MasterPlanSyncService, private readonly spreadsheets: MasterPlanSpreadsheetService, private readonly workOrders: MasterPlanWorkOrderService, private readonly allocationConfig: OrderAllocationConfigService, private readonly lifecycle: MasterPlanLifecycleService, private readonly demandLinks: MasterPlanDemandLinkService, private readonly quantities: MasterPlanDemandQuantityService) {}

  @Get('demands/:id/quantities')
  demandQuantities(@Param('id') id:string,@Req() r:MasterPlanRequest){return this.quantities.read(id,this.actor(r));}
  @Post('demands/:id/quantities/preview')
  previewQuantities(@Param('id') id:string,@Body() b:MpsQuantityRequest,@Req() r:MasterPlanRequest){return this.quantities.preview(id,b,this.actor(r));}
  @Post('demands/:id/quantities/confirm')
  confirmQuantities(@Param('id') id:string,@Body() b:MpsQuantityConfirm,@Req() r:MasterPlanRequest){return this.quantities.confirm(id,b,this.actor(r));}
  @Get('demands/:id/quantities/status/:eventId')
  quantityStatus(@Param('id') id:string,@Param('eventId') eventId:string,@Req() r:MasterPlanRequest){return this.quantities.status(id,eventId,this.actor(r));}

  @Get("resources/:resource/:id/demand-link")
  demandLink(@Param("resource") resource:string,@Param("id") id:string,@Req() request:MasterPlanRequest) { return this.demandLinks.info(resource,id,this.actor(request)); }

  @Post("resources/:resource/:id/demand-link")
  bindDemand(@Param("resource") resource:string,@Param("id") id:string,@Body() body:MpsBindDemandRequest,@Req() request:MasterPlanRequest) { return this.demandLinks.bind(resource,id,body,this.actor(request)); }

  @Get("demands/:id")
  demandTarget(@Param("id") id:string,@Req() request:MasterPlanRequest) { return this.demandLinks.target(id,this.actor(request)); }

  @Post("resources/:resource/:id/lifecycle/preview")
  previewLifecycle(@Param("resource") resource:string,@Param("id") id:string,@Body("operation") operation:MpsLifecycleOperation,@Req() request:MasterPlanRequest) {
    return this.lifecycle.preview(resource,id,operation,this.actor(request));
  }

  @Post("resources/:resource/:id/lifecycle/confirm")
  confirmLifecycle(@Param("resource") resource:string,@Param("id") id:string,@Body() body:Parameters<MasterPlanLifecycleService['confirm']>[2],@Req() request:MasterPlanRequest) {
    return this.lifecycle.confirm(resource,id,body,this.actor(request));
  }

  @Post("resources/mps-process-reports/:id/correct-history")
  async correctReportHistory(@Param("id") id:string,@Body() body:Record<string,unknown>,@Req() request:MasterPlanRequest) {
    await this.lifecycle.assertAvailable('mps-process-reports');
    return this.application.correctHistoricalReport(id,body,this.actor(request));
  }

  @Get("order-allocation-notification-config")
  allocationNotificationConfig(@Req() request: MasterPlanRequest) { return this.allocationConfig.read(this.actor(request)); }

  @Post("order-allocation-notification-config/:kind")
  saveAllocationNotificationConfig(@Param("kind") kind: string, @Body() body: Record<string, unknown>, @Req() request: MasterPlanRequest) { return kind === "test" ? this.allocationConfig.testDelivery(body, this.actor(request)) : this.allocationConfig.save(kind, body, this.actor(request)); }

  @Get("resources/:resource/meta")
  async metadata(@Param("resource") resource: string, @Req() request: MasterPlanRequest) {
    const rawMetadata = this.queries.metadata(resource, this.actor(request));
    const metadata = (mpsDemandLinkResources as readonly string[]).includes(resource) ? {...rawMetadata,demandLinks:await this.demandLinks.availability(resource,this.actor(request))} : rawMetadata;
    if (!(mpsLifecycleResources as readonly string[]).includes(resource) && resource !== 'mps-process-reports') return metadata;
    const lifecycle = await this.lifecycle.availability(resource);
    return { ...metadata, ...(resource==='mps-monthly-plans'||resource==='mps-base-plans'?{quantities:await this.quantities.availability(this.actor(request))}:{}), lifecycle, fields: lifecycle.schemaReady ? metadata.fields : metadata.fields.filter(field => field.key !== 'lifecycleStatus') };
  }

  @Get("references/weekly-plans")
  weeklyPlanOptions(@Query("search") search: string, @Req() request: MasterPlanRequest) { return this.queries.weeklyPlanOptions(search, this.actor(request)); }

  @Get("references/organizations")
  organizationOptions(@Query("resource") resource: string, @Req() request: MasterPlanRequest) { return this.queries.organizationOptions(resource, this.actor(request)); }

  /** 类型化高级筛选的字段候选值（受资源读权限、字段读权限、租户与数据范围约束）。 */
  @Get("references/candidates")
  fieldCandidates(@Query("resource") resource: string, @Query("field") field: string, @Query("search") search: string, @Query("limit") limit: string, @Query("view") view: string, @Req() request: MasterPlanRequest) {
    return this.queries.fieldCandidates(resource, field, search, limit, this.actor(request), view);
  }

  @Get("resources/:resource")
  list(@Param("resource") resource: string, @Query() query: Record<string, unknown>, @Req() request: MasterPlanRequest) { return this.queries.list(resource, query, this.actor(request)); }

  @Get("resources/:resource/import-template")
  async importTemplate(@Param("resource") resource: string, @Query() query: Record<string, unknown>, @Req() request: MasterPlanRequest, @Res() response: Response) {
    const mode = String(query.mode ?? "CREATE").toUpperCase();
    const suffix = mode === "UPDATE" ? "-更新模板" : "-新增模板";
    this.sendWorkbook(response, resource === "mps-review-due-dates" ? "mps_review_due_dates_import_template.xlsx" : `${resource}${suffix}.xlsx`, await this.spreadsheets.template(resource, this.actor(request), query.view, mode, query));
  }

  @Post("resources/:resource/import-preview") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  importPreview(@Param("resource") resource: string, @Query("view") view: string, @UploadedFile() file: Express.Multer.File, @Req() request: MasterPlanRequest) { return this.spreadsheets.preview(resource, file, this.actor(request), view); }

  @Post("resources/:resource/import-confirm")
  importConfirm(@Param("resource") resource: string, @Body("previewId") previewId: string, @Req() request: MasterPlanRequest) { return this.spreadsheets.confirm(resource, previewId, this.actor(request)); }

  @Get("resources/:resource/export")
  async export(@Param("resource") resource: string, @Query() query: Record<string, unknown>, @Req() request: MasterPlanRequest, @Res() response: Response) { this.sendWorkbook(response, resource==='mps-review-due-dates'?reviewDueDateExportFilename():`${resource}.xlsx`, await this.spreadsheets.export(resource, query, this.actor(request))); }

  @Post("resources/:resource")
  create(@Param("resource") resource: string, @Body() body: Record<string, unknown>, @Req() request: MasterPlanRequest) { return this.application.create(resource, body, this.actor(request)); }

  /**
   * KN-MPS-WO-001：3天生产工单“从周计划同步”。
   * 只能由用户主动点击触发（不注册 scheduler / mps_sync_configs 任务）；权限与数据范围在服务层校验。
   */
  @Post("resources/mps-three-day-work-orders/sync-from-weekly")
  syncThreeDayWorkOrders(@Req() request: MasterPlanRequest) { return this.workOrders.syncFromWeekly(this.actor(request)); }

  /** KN-MPS-UI-WEEKLY-EXEC-001：仅重算当前周计划的工序/外协执行任务。 */
  @Post("resources/mps-weekly-plans/:id/refresh-execution")
  refreshWeeklyExecution(@Param("id") id: string, @Req() request: MasterPlanRequest) { return this.application.refreshWeeklyExecution(id, this.actor(request)); }

  @Post("resources/mps-weekly-plans/:id/process-config/preview")
  previewWeeklyProcessConfig(@Param("id") id: string, @Req() request: MasterPlanRequest) { return this.sync.previewWeeklyProcessConfig(id, this.actor(request)); }

  @Post("resources/mps-weekly-plans/:id/process-config/confirm")
  confirmWeeklyProcessConfig(@Param("id") id: string, @Body() body: { expectedVersion: number; previewHash: string }, @Req() request: MasterPlanRequest) {
    return this.sync.confirmWeeklyProcessConfig(id, body, this.actor(request));
  }

  @Post("resources/mps-weekly-plans/process-config/batch-preview")
  previewWeeklyProcessConfigBatch(@Body() body: { weeklyPlanIds: string[] }, @Req() request: MasterPlanRequest) {
    return this.sync.previewWeeklyProcessConfigBatch(body.weeklyPlanIds, this.actor(request));
  }

  @Post("resources/mps-weekly-plans/process-config/batch-confirm")
  confirmWeeklyProcessConfigBatch(@Body() body: { plans: Array<{ weeklyPlanId: string; expectedVersion: number; previewHash: string }> }, @Req() request: MasterPlanRequest) {
    return this.sync.confirmWeeklyProcessConfigBatch(body.plans, this.actor(request));
  }

  /** One-time, audited administrator command for the confirmed 2026-11-03 Division 3 source reconciliation. */
  @Post("resources/mps-order-allocations/finalize-residual")
  finalizeDivisionThreeResidual(@Body() body: Parameters<MasterPlanApplicationService["finalizeDivisionThreeResidual"]>[0], @Req() request: MasterPlanRequest) {
    return this.application.finalizeDivisionThreeResidual(body, this.actor(request));
  }

  @Patch("resources/:resource/batch")
  batchUpdate(@Param("resource") resource: string, @Body() body: Record<string, unknown>, @Req() request: MasterPlanRequest) { return this.application.batchUpdate(resource, body, this.actor(request)); }

  @Patch("resources/:resource/:id")
  update(@Param("resource") resource: string, @Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: MasterPlanRequest) { return this.application.update(resource, id, body, this.actor(request)); }

  @Delete("resources/:resource/:id")
  remove(@Param("resource") resource: string, @Param("id") id: string, @Query("expectedVersion") expectedVersion: string, @Req() request: MasterPlanRequest) { return this.application.remove(resource, id, expectedVersion, this.actor(request)); }

  @Post("sync/:syncKey")
  manualSync(@Param("syncKey") syncKey: string, @Req() request: MasterPlanRequest) { return this.sync.manual(syncKey, this.actor(request)); }

  private actor(request: MasterPlanRequest): MasterPlanActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: request.user?.sub ?? null,
      username: request.user?.displayName ?? request.user?.username ?? "unknown", permissions: request.user?.permissions ?? [],
      isSystemAdmin: request.user?.isSystemAdmin === true, moduleAdminCodes: request.user?.moduleAdminCodes ?? [],
      tableDataScopes: request.user?.tableDataScopes ?? [], requestId: request.requestId,
      source: request.user?.apiKeyId ? "system" : "web"
    };
  }

  private sendWorkbook(response: Response, filename: string, buffer: Buffer) {
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`); response.send(buffer);
  }
}
