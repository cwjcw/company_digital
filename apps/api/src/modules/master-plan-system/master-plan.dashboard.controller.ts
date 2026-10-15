import { Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
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
  @Get("candidates") candidates(@Query("field") field: string, @Query("search") search: string, @Query() input: DashboardQuery, @Req() req: Request) { return this.dashboard.candidates(field, search, input, this.actor(req)); }
  @Get("export") async export(@Query() input: DashboardQuery, @Req() req: Request, @Res() res: Response) {
    const buffer = await this.exports.export(input, this.actor(req));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent("主计划综合大屏.xlsx")}`); res.send(buffer);
  }
  private actor(req: Request): MasterPlanActor {
    const request = req as Request & { user: { sub?: string; username?: string; displayName?: string; permissions?: string[]; isSystemAdmin?: boolean; moduleAdminCodes?: string[]; tableDataScopes?: MasterPlanActor["tableDataScopes"]; apiKeyId?: string }; requestId: string };
    const u = request.user;
    return { tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: u?.sub ?? null, username: u?.displayName ?? u?.username ?? "unknown", permissions: u?.permissions ?? [], isSystemAdmin: u?.isSystemAdmin, moduleAdminCodes: u?.moduleAdminCodes, tableDataScopes: u?.tableDataScopes ?? [], requestId: request.requestId, source: u?.apiKeyId ? "system" : "web" };
  }
}
