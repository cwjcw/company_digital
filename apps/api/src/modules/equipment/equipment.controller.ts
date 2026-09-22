import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentExportService } from "./equipment-export.service";
import { EquipmentImportService } from "./equipment-import.service";
import { EquipmentQueryService } from "./equipment.query.service";
import type { EquipmentActor } from "./equipment.types";

type EquipmentRequest = Request & { user: any; requestId: string };

@ApiTags("设备管理")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("equipment")
export class EquipmentController {
  constructor(
    private readonly application: EquipmentApplicationService,
    private readonly queries: EquipmentQueryService,
    private readonly imports: EquipmentImportService,
    private readonly exports: EquipmentExportService
  ) {}

  private actor(request: EquipmentRequest): EquipmentActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: request.user?.sub ?? null,
      username: request.user?.displayName ?? request.user?.username ?? "unknown", permissions: request.user?.permissions ?? [],
      isSystemAdmin: request.user?.isSystemAdmin === true,
      moduleAdminCodes: request.user?.moduleAdminCodes ?? [],
      tableDataScopes: request.user?.tableDataScopes ?? [], requestId: request.requestId
    };
  }

  @Get("assets") listAssets(@Query() query: any, @Req() request: EquipmentRequest) { return this.queries.listAssets(query, this.actor(request)); }
  @Post("assets") createAsset(@Body() body: any, @Req() request: EquipmentRequest) { return this.application.createAsset(body, this.actor(request)); }
  @Patch("assets/:id") updateAsset(@Param("id") id: string, @Body() body: any, @Req() request: EquipmentRequest) { return this.application.updateAsset(id, body, this.actor(request)); }
  @Delete("assets/:id") disableAsset(@Param("id") id: string, @Query("expectedVersion") queryVersion: string | undefined, @Body() body: { expectedVersion?: number } | undefined, @Req() request: EquipmentRequest) {
    return this.application.disableAsset(id, this.expectedVersion(queryVersion, body), this.actor(request));
  }

  @Get("status-reports") listStatus(@Query() query: any, @Req() request: EquipmentRequest) { return this.queries.listStatus(query, this.actor(request)); }
  @Post("status-reports") createStatus(@Body() body: any, @Req() request: EquipmentRequest) { return this.application.createStatus(body, this.actor(request)); }
  @Patch("status-reports/:id") updateStatus(@Param("id") id: string, @Body() body: any, @Req() request: EquipmentRequest) { return this.application.updateStatus(id, body, this.actor(request)); }
  @Delete("status-reports/:id") disableStatus(@Param("id") id: string, @Query("expectedVersion") queryVersion: string | undefined, @Body() body: { expectedVersion?: number } | undefined, @Req() request: EquipmentRequest) {
    return this.application.disableStatus(id, this.expectedVersion(queryVersion, body), this.actor(request));
  }
  @Post("status-reports/import-preview") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  previewStatusImport(@UploadedFile() file: Express.Multer.File, @Req() request: EquipmentRequest) { return this.imports.previewStatus(file, this.actor(request)); }
  @Post("status-reports/import-confirm")
  confirmStatusImport(@Body() body: any, @Req() request: EquipmentRequest) { return this.imports.confirmStatus(body, this.actor(request)); }
  @Get("status-reports/import-template")
  async statusImportTemplate(@Req() request: EquipmentRequest, @Res() response: Response) {
    const buffer = await this.exports.statusTemplate(this.actor(request)); this.sendWorkbook(response, "设备状态填报导入模板.xlsx", buffer);
  }
  @Get("status-reports/export")
  async statusExport(@Query() query: Record<string, unknown>, @Req() request: EquipmentRequest, @Res() response: Response) {
    const buffer = await this.exports.statusExport(query, this.actor(request)); this.sendWorkbook(response, "设备状态填报.xlsx", buffer);
  }

  @Get("options") options(@Req() request: EquipmentRequest) { return this.queries.assetFormOptions(this.actor(request)); }
  @Get("status-options") statusOptions(@Req() request: EquipmentRequest) { return this.queries.statusFormOptions(this.actor(request)); }
  @Get("dashboard") dashboard(@Query() query: Record<string, unknown>, @Req() request: EquipmentRequest) { return this.queries.dashboard(query, this.actor(request)); }

  private sendWorkbook(response: Response, filename: string, buffer: Buffer) {
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`); response.send(buffer);
  }

  private expectedVersion(queryVersion: string | undefined, body: { expectedVersion?: number } | undefined) {
    const value = Number(queryVersion ?? body?.expectedVersion);
    if (!Number.isInteger(value) || value < 1) throw new BadRequestException("删除请求缺少有效的数据版本，请刷新后重试");
    return value;
  }
}
