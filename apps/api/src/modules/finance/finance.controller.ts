import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { FinanceApplicationService } from "./finance.application.service";
import { FinanceQueryService } from "./finance.query.service";
import type { FinanceActor } from "./finance.types";
type FinanceRequest = Request & {
    user: any;
    requestId: string;
};
@ApiTags("财务中心")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("finance/customer-mappings")
export class FinanceController {
    constructor(private readonly application: FinanceApplicationService, private readonly queries: FinanceQueryService) { }
    @Post("manual")
    createManual(@Body() body: Record<string, unknown>, @Req() r: FinanceRequest) {
        return this.application.createManual(body, this.actor(r));
    }
    @Get("summary")
    summary(
    @Req()
    r: FinanceRequest) { return this.queries.summary(this.actor(r)); }
    @Patch(":id")
    update(
    @Param("id", ParseUUIDPipe)
    id: string, 
    @Body()
    body: Record<string, unknown>, 
    @Req()
    r: FinanceRequest) { return this.application.update(id, body, this.actor(r)); }
    @Post("ingest")
    ingest(
    @Body()
    body: Record<string, unknown>, 
    @Req()
    r: FinanceRequest) { return this.application.ingest(body, this.actor(r)); }
    @Post("sync-failure")
    failed(
    @Req()
    r: FinanceRequest) { return this.application.failed(this.actor(r)); }
    private actor(r: FinanceRequest): FinanceActor { return { tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: r.user?.sub ?? null, username: r.user?.displayName ?? r.user?.username ?? "", permissions: r.user?.permissions ?? [], isSystemAdmin: r.user?.isSystemAdmin === true, moduleAdminCodes: r.user?.moduleAdminCodes ?? [], tableDataScopes: r.user?.tableDataScopes ?? [], requestId: r.requestId, source: r.user?.apiKeyId ? "api" : "web" }; }
}
