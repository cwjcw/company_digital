import { BadRequestException, Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { MasterPlanDashboardService, type DashboardQuery } from "./master-plan.dashboard.service";
import { MasterPlanDashboardExportService } from "./master-plan.dashboard-export.service";
import type { MasterPlanActor } from "./master-plan.types";

@Controller("master-plan-system/dashboard")
@UseGuards(AuthGuard)
export class MasterPlanDashboardController {
  constructor(private readonly dashboard: MasterPlanDashboardService, private readonly exports: MasterPlanDashboardExportService) {}
  @Get() query(@Query() input: DashboardQuery, @Req() req: Request) { return this.dashboard.dashboard(input, this.actor(req)); }
  @Get("drill") drill(@Query() input: DashboardQuery & { resourceCode?: string; filterGroup?: string; view?: string }, @Req() req: Request) { return this.dashboard.drill(input, this.actor(req)); }
  @Get("table") table(@Query() input: DashboardQuery, @Req() req: Request) { return this.dashboard.table(input, this.actor(req)); }
  @Get("gaps") gaps(@Query("type") type: string, @Query() input: DashboardQuery, @Req() req: Request) { return this.dashboard.gaps(type, input, this.actor(req)); }
  @Get("gap-counts") gapCounts(@Query() input: DashboardQuery, @Req() req: Request) { return this.dashboard.gapCounts(input, this.actor(req)); }
  @Get("reports/:reportKey") report(@Param("reportKey") key: string, @Query() input: DashboardQuery, @Req() req: Request) {
    if (!["plan-readiness", "process-execution", "risk-exception"].includes(key)) throw new BadRequestException("报表无效");
    return this.dashboard.table({ ...input, tableKey: key }, this.actor(req));
  }
  @Get("candidates") candidates(@Query("field") field: string, @Query("search") search: string, @Query() input: DashboardQuery, @Req() req: Request) { return this.dashboard.candidates(field, search, input, this.actor(req)); }
  @Get("export") async export(@Query() input: DashboardQuery, @Req() req: Request, @Res() res: Response) {
    const buffer = await this.exports.export(input, this.actor(req));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="mps_${input.tableKey!.replaceAll("-", "_")}_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).replaceAll("-", "")}.xlsx"`); res.send(buffer);
  }
  private actor(req: Request): MasterPlanActor {
    const request = req as Request & { user: { sub?: string; username?: string; displayName?: string; permissions?: string[]; isSystemAdmin?: boolean; moduleAdminCodes?: string[]; tableDataScopes?: MasterPlanActor["tableDataScopes"]; apiKeyId?: string }; requestId: string };
    const u = request.user;
    return { tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: u?.sub ?? null, username: u?.displayName ?? u?.username ?? "unknown", permissions: u?.permissions ?? [], isSystemAdmin: u?.isSystemAdmin, moduleAdminCodes: u?.moduleAdminCodes, tableDataScopes: u?.tableDataScopes ?? [], requestId: request.requestId, source: u?.apiKeyId ? "system" : "web" };
  }
}
