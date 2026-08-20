import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AuthGuard } from "../../auth";
import { TplusOrderSnapshot, TplusOrderSyncService } from "./tplus-order-sync.service";

type UserRequest = Request & { user: any; requestId: string };

@ApiTags("T+ 数据同步")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("data-operations/tplus")
export class TplusOrderSyncController {
  constructor(private readonly sync: TplusOrderSyncService) {}

  @Post("sales-orders/snapshot")
  replaceSalesOrderSnapshot(@Body() body: TplusOrderSnapshot, @Req() req: UserRequest) {
    const permissions = req.user.permissions ?? [];
    if (!(permissions.includes("*") || permissions.includes("tplus-sales-orders:*:import"))) {
      throw new ForbiddenException("API Key 没有 T+ 销售订单同步权限");
    }
    return this.sync.replaceSnapshot(body, req.user, req.requestId);
  }
}
