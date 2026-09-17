import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { TablePrintService, type TablePrintQuery } from "./table-print.service";
import type { TableFilterActor } from "../filtering/table-filter.registry";

type PrintRequest = Request & { user: any; requestId: string };

/**
 * KN-PRINT-001 平台统一打印接口：所有标准表格共用一个入口，业务模块不得自建打印查询。
 * 打印只读（不写任何业务数据），并且后端重新校验 batch_print / read / tenant / data scope / 字段读权限。
 */
@ApiTags("表格打印平台")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("table-prints")
export class TablePrintController {
  constructor(private readonly prints: TablePrintService) {}

  @Get("capabilities")
  capabilities(@Req() request: PrintRequest) {
    return this.prints.capabilities(this.actor(request));
  }

  @Get("manifest")
  manifest(@Query() query: Record<string, string | undefined>, @Req() request: PrintRequest) {
    return this.prints.manifest(String(query.resource ?? ""), this.queryOf(query), this.actor(request));
  }

  @Post("render")
  render(@Body() body: Record<string, unknown>, @Req() request: PrintRequest) {
    return this.prints.render(String(body.resource ?? ""), {
      search: body.search,
      filterGroup: body.filterGroup,
      sortField: body.sortField,
      sortOrder: body.sortOrder,
      context: (body.context ?? {}) as Record<string, unknown>,
      rangeType: body.rangeType,
      selectedIds: body.selectedIds,
      columnKeys: body.columnKeys
    }, this.actor(request));
  }

  private queryOf(query: Record<string, string | undefined>): TablePrintQuery {
    return {
      search: query.search,
      filterGroup: query.filterGroup,
      sortField: query.sortField,
      sortOrder: query.sortOrder,
      context: this.parseContext(query.context),
      rangeType: query.rangeType,
      selectedIds: query.selectedIds,
      columnKeys: query.columnKeys
    };
  }

  private parseContext(raw: string | undefined) {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      return parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException("打印上下文格式无效");
    }
  }

  private actor(request: PrintRequest): TableFilterActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: request.user?.sub ?? null,
      permissions: request.user?.permissions ?? [],
      roles: request.user?.roles ?? [],
      isSystemAdmin: request.user?.isSystemAdmin === true,
      moduleAdminCodes: request.user?.moduleAdminCodes ?? [],
      tableDataScopes: request.user?.tableDataScopes ?? []
    };
  }
}
