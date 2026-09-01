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
  private actor(req: UserRequest) { return { roles: req.user.roles ?? [], isSystemAdmin: req.user.isSystemAdmin === true, moduleAdminCodes: req.user.moduleAdminCodes ?? [] }; }

  @Get() list(@Req() req: UserRequest) { return this.service.list(this.actor(req)); }
  @Get("roles") roles(@Req() req: UserRequest) { return this.service.listRoleOptions(this.actor(req)); }
  @Patch(":flowKey") update(@Param("flowKey") flowKey: string, @Body() body: any, @Req() req: UserRequest) {
    return this.service.update(flowKey, body, { name: req.user.displayName ?? req.user.username, ...this.actor(req) });
  }
}
