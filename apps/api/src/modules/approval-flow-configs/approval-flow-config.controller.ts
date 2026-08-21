import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { ApprovalFlowConfigService } from "./approval-flow-config.service";

type UserRequest = Request & { user: any };

@ApiTags("审批流程配置")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("approval-flow-configs")
export class ApprovalFlowConfigController {
  constructor(private readonly service: ApprovalFlowConfigService) {}

  @Get() list(@Req() req: UserRequest) { return this.service.list(req.user.roles ?? []); }
  @Patch(":flowKey") update(@Param("flowKey") flowKey: string, @Body() body: any, @Req() req: UserRequest) {
    return this.service.update(flowKey, body, { name: req.user.displayName ?? req.user.username, roles: req.user.roles ?? [] });
  }
}
