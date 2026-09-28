import { BadRequestException, Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { TablePrintService } from "./table-print.service";
import type { TableFilterActor } from "../filtering/table-filter.registry";

type ExportRequest = Request & { user: any };

/** KN-EXPORT-001：标准业务表统一 XLSX 导出入口；权限与取数边界由平台服务端重新校验。 */
@ApiTags("标准表格导出平台")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("table-exports")
export class TableExportController {
  constructor(private readonly exports: TablePrintService) {}

  @Get("capabilities")
  capabilities(@Req() request: ExportRequest) {
    return this.exports.exportCapabilities(this.actor(request));
  }

  @Get(":resource")
  async export(@Param("resource") resource: string, @Query() query: Record<string, string | undefined>, @Req() request: ExportRequest, @Res() response: Response) {
    const workbook = await this.exports.exportXlsx(resource, {
      search: query.search,
      filterGroup: this.parseJson(query.filterGroup, "导出筛选条件格式无效"),
      sortField: query.sortField,
      sortOrder: query.sortOrder,
      context: this.parseObject(query.context, "导出上下文格式无效"),
      columnKeys: query.columnKeys
    }, this.actor(request));
    const label = resource === "supervision-projects" ? "督办项目" : resource === "supervision-tasks" ? "督办任务" : resource;
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${label}.xlsx`)}`);
    response.send(workbook);
  }

  private parseJson(raw: string | undefined, message: string): unknown {
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { throw new BadRequestException(message); }
  }

  private parseObject(raw: string | undefined, message: string) {
    if (!raw) return {};
    const value = this.parseJson(raw, message);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(message);
    return value as Record<string, unknown>;
  }

  private actor(request: ExportRequest): TableFilterActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: request.user?.sub ?? null,
      displayName: request.user?.displayName ?? undefined,
      username: request.user?.username ?? undefined,
      permissions: request.user?.permissions ?? [],
      roles: request.user?.roles ?? [],
      isSystemAdmin: request.user?.isSystemAdmin === true,
      moduleAdminCodes: request.user?.moduleAdminCodes ?? [],
      tableDataScopes: request.user?.tableDataScopes ?? []
    };
  }
}
