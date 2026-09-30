import { Body, Controller, Get, Headers, Param, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { RdApplicationService } from "./rd.application.service";
import { RdQueryService } from "./rd.query.service";
import type { RdActor } from "./rd.types";

type RdRequest = Request & { user: any; requestId: string };

@ApiTags("研发中心")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("rd")
export class RdController {
  constructor(private readonly application: RdApplicationService, private readonly queries: RdQueryService) {}

  @Get("items") listItems(@Query() query: Record<string, unknown>, @Req() request: RdRequest) { return this.queries.listItems(query, this.actor(request)); }
  @Get("items/status") status(@Req() request: RdRequest) { return this.queries.status(this.actor(request)); }
  @Post("items/sync") sync(@Body() body: { mode?: "FULL" | "INCREMENTAL" }, @Req() request: RdRequest) { return this.application.sync(body.mode === "FULL" ? "FULL" : "INCREMENTAL", this.actor(request)); }
  @Get("material-duplicates/scans/latest") latestScan(@Req() request: RdRequest) { return this.queries.latestScan(this.actor(request)); }
  @Post("material-duplicates/check") async check(@Body() body: { itemName?: string; specification?: string; limit?: number }, @Req() request: RdRequest) {
    const abort = new AbortController(); const onAbort = () => abort.abort();
    request.on("aborted", onAbort); request.on("close", onAbort);
    try { return await this.queries.check(body, this.actor(request), abort.signal); }
    finally { request.off("aborted", onAbort); request.off("close", onAbort); }
  }
  @Post("material-duplicates/scans") startScan(@Body() body: { mode?: "FULL" | "INCREMENTAL" }, @Req() request: RdRequest) { return this.application.startScan(this.actor(request), body.mode === "FULL" ? "FULL" : "INCREMENTAL"); }
  @Get("material-duplicates/scans/:id") scan(@Param("id") id: string, @Query() query: Record<string, unknown>, @Req() request: RdRequest) { return this.queries.scan(id, query, this.actor(request)); }
  @Get("material-duplicates/scans/:id/results") scanResults(@Param("id") id: string, @Query() query: Record<string, unknown>, @Req() request: RdRequest) { return this.queries.scan(id, query, this.actor(request)); }

  private actor(request: RdRequest): RdActor { return { tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: request.user?.sub ?? null, username: request.user?.displayName ?? request.user?.username ?? "unknown", permissions: request.user?.permissions ?? [], moduleAdminCodes: request.user?.moduleAdminCodes ?? [], isSystemAdmin: request.user?.isSystemAdmin === true, tableDataScopes: request.user?.tableDataScopes ?? [], requestId: request.requestId, source: request.user?.apiKeyId ? "api" : "web" }; }
}

@Controller("internal/rd")
export class RdInternalController {
  constructor(private readonly application: RdApplicationService, private readonly queries: RdQueryService) {}

  @Post("items/sync") sync(@Headers("x-kdos-internal-token") token: string | undefined, @Headers("x-kdos-tenant-id") tenantId: string | undefined, @Body() body: { mode?: "FULL" | "INCREMENTAL" }) {
    this.assertInternal(token, tenantId);
    return this.application.sync(body.mode === "FULL" ? "FULL" : "INCREMENTAL", this.internalActor(tenantId!, "rd-n8n-sync"));
  }

  @Post("material-duplicates/scans") startScan(@Headers("x-kdos-internal-token") token: string | undefined, @Headers("x-kdos-tenant-id") tenantId: string | undefined, @Body() body: { mode?: "FULL" | "INCREMENTAL"; changedItemIds?: string[] }) {
    this.assertInternal(token, tenantId);
    return this.application.startScan(this.internalActor(tenantId!, "rd-n8n-scan"), body?.mode === "FULL" ? "FULL" : "INCREMENTAL", body?.changedItemIds);
  }

  @Get("material-duplicates/scans/:id") scanStatus(@Headers("x-kdos-internal-token") token: string | undefined, @Headers("x-kdos-tenant-id") tenantId: string | undefined, @Param("id") scanId: string) {
    this.assertInternal(token, tenantId);
    return this.queries.scanStatus(scanId, this.internalActor(tenantId!, "rd-n8n-scan-status"));
  }

  private assertInternal(token: string | undefined, tenantId: string | undefined) {
    if (!process.env.KDOS_RD_INTERNAL_TOKEN || token !== process.env.KDOS_RD_INTERNAL_TOKEN) throw new UnauthorizedException("内部同步凭据无效");
    if (!tenantId || tenantId !== (process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN")) throw new UnauthorizedException("租户不匹配");
  }

  private internalActor(tenantId: string, username: string): RdActor {
    return { tenantId, userId: "0199e000-0000-7000-8000-000000000001", username, permissions: ["*"], moduleAdminCodes: ["rd"], isSystemAdmin: true, tableDataScopes: [], requestId: `n8n-${Date.now()}`, source: "api" };
  }
}
