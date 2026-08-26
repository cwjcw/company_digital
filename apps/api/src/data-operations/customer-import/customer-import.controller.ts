import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { CustomerImportApplicationService } from "./customer-import.application.service";
import type { CustomerDataSnapshot } from "./customer-import.types";

type UserRequest = Request & { user: any; requestId: string };

@ApiTags("客户数据导入")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("data-operations/customer-imports")
export class CustomerImportController {
  constructor(private readonly application: CustomerImportApplicationService) {}

  @Post("snapshot")
  importSnapshot(@Body() body: CustomerDataSnapshot, @Req() req: UserRequest) {
    const permissions = req.user.permissions ?? [];
    const sourcePermission = body?.source === "tplus" ? "tplus-sales-orders:*:import" : "customer-data-import:*:import";
    if (!(permissions.includes("*") || permissions.includes("customer-data-import:*:import") || permissions.includes(sourcePermission))) {
      throw new ForbiddenException("API Key 没有客户数据导入权限");
    }
    return this.application.importSnapshot(body, {
      userId: req.user.sub, displayName: req.user.displayName ?? req.user.username, requestId: req.requestId,
      source: req.user.apiKeyId ? "API" : "WEB"
    });
  }
}
