import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { SupplyChainApplicationService } from "./supply-chain.application.service";
import { SupplyChainQueryService } from "./supply-chain.query.service";
import type { SupplyChainActor } from "./supply-chain.types";

type SupplyChainRequest = Request & { user: any; requestId: string };

@ApiTags("供应链")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("supply-chain")
export class SupplyChainController {
  constructor(private readonly application: SupplyChainApplicationService, private readonly queries: SupplyChainQueryService) {}

  @Get("suppliers")
  listSuppliers(@Query() query: Record<string, unknown>, @Req() request: SupplyChainRequest) {
    return this.queries.listSuppliers(query, this.actor(request));
  }

  @Post("suppliers/import")
  importSuppliers(@Body() body: Record<string, unknown>, @Req() request: SupplyChainRequest) {
    return this.application.importTplusSuppliers(body, this.actor(request));
  }

  private actor(request: SupplyChainRequest): SupplyChainActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: request.user?.sub ?? null,
      username: request.user?.displayName ?? request.user?.username ?? "unknown", permissions: request.user?.permissions ?? [],
      isSystemAdmin: request.user?.isSystemAdmin === true, moduleAdminCodes: request.user?.moduleAdminCodes ?? [],
      tableDataScopes: request.user?.tableDataScopes ?? [], requestId: request.requestId,
      source: request.user?.apiKeyId ? "api" : "web"
    };
  }
}
