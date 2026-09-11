import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import type { MasterPlanActor } from "./master-plan.types";

type MasterPlanRequest = Request & { user: any; requestId: string };

@ApiTags("主计划系统")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("master-plan-system")
export class MasterPlanController {
  constructor(private readonly queries: MasterPlanQueryService, private readonly application: MasterPlanApplicationService, private readonly sync: MasterPlanSyncService) {}

  @Get("resources/:resource/meta")
  metadata(@Param("resource") resource: string, @Req() request: MasterPlanRequest) { return this.queries.metadata(resource, this.actor(request)); }

  @Get("resources/:resource")
  list(@Param("resource") resource: string, @Query() query: Record<string, unknown>, @Req() request: MasterPlanRequest) { return this.queries.list(resource, query, this.actor(request)); }

  @Post("resources/:resource")
  create(@Param("resource") resource: string, @Body() body: Record<string, unknown>, @Req() request: MasterPlanRequest) { return this.application.create(resource, body, this.actor(request)); }

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
}

