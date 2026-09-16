import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import type { MasterPlanActor } from "./master-plan.types";

type MasterPlanRequest = Request & { user: any; requestId: string };

@ApiTags("主计划系统")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("master-plan-system")
export class MasterPlanController {
  constructor(private readonly queries: MasterPlanQueryService, private readonly application: MasterPlanApplicationService, private readonly sync: MasterPlanSyncService, private readonly spreadsheets: MasterPlanSpreadsheetService) {}

  @Get("resources/:resource/meta")
  metadata(@Param("resource") resource: string, @Req() request: MasterPlanRequest) { return this.queries.metadata(resource, this.actor(request)); }

  @Get("references/weekly-plans")
  weeklyPlanOptions(@Query("search") search: string, @Req() request: MasterPlanRequest) { return this.queries.weeklyPlanOptions(search, this.actor(request)); }

  @Get("references/organizations")
  organizationOptions(@Query("resource") resource: string, @Req() request: MasterPlanRequest) { return this.queries.organizationOptions(resource, this.actor(request)); }

  @Get("resources/:resource")
  list(@Param("resource") resource: string, @Query() query: Record<string, unknown>, @Req() request: MasterPlanRequest) { return this.queries.list(resource, query, this.actor(request)); }

  @Get("resources/:resource/import-template")
  async importTemplate(@Param("resource") resource: string, @Query("view") view: string, @Req() request: MasterPlanRequest, @Res() response: Response) { this.sendWorkbook(response, `${resource}-导入模板.xlsx`, await this.spreadsheets.template(resource, this.actor(request), view)); }

  @Post("resources/:resource/import-preview") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  importPreview(@Param("resource") resource: string, @Query("view") view: string, @UploadedFile() file: Express.Multer.File, @Req() request: MasterPlanRequest) { return this.spreadsheets.preview(resource, file, this.actor(request), view); }

  @Post("resources/:resource/import-confirm")
  importConfirm(@Param("resource") resource: string, @Body("previewId") previewId: string, @Req() request: MasterPlanRequest) { return this.spreadsheets.confirm(resource, previewId, this.actor(request)); }

  @Get("resources/:resource/export")
  async export(@Param("resource") resource: string, @Query() query: Record<string, unknown>, @Req() request: MasterPlanRequest, @Res() response: Response) { this.sendWorkbook(response, `${resource}.xlsx`, await this.spreadsheets.export(resource, query, this.actor(request))); }

  @Post("resources/:resource")
  create(@Param("resource") resource: string, @Body() body: Record<string, unknown>, @Req() request: MasterPlanRequest) { return this.application.create(resource, body, this.actor(request)); }

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
