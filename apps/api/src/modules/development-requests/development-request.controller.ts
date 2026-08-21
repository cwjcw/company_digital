import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { DevelopmentRequestService } from "./development-request.service";
import type { DevelopmentActor } from "./development-request.workflow";

type DevelopmentRequestHttpRequest = Request & { user: any };

@ApiTags("需求与开发")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("development-requests")
export class DevelopmentRequestController {
  constructor(private readonly service: DevelopmentRequestService) {}
  private actor(req: DevelopmentRequestHttpRequest): DevelopmentActor {
    return { id: req.user.sub, name: req.user.displayName ?? req.user.username, roles: req.user.roles ?? [] };
  }

  @Get() list(@Query("scope") scope: string | undefined, @Query("search") search: string | undefined, @Req() req: DevelopmentRequestHttpRequest) { return this.service.list(this.actor(req), scope, search); }
  @Get("people") people() { return this.service.people(); }
  @Get(":id") detail(@Param("id") id: string, @Req() req: DevelopmentRequestHttpRequest) { return this.service.detail(id, this.actor(req)); }
  @Post() create(@Body() body: any, @Req() req: DevelopmentRequestHttpRequest) { return this.service.create(body, this.actor(req)); }
  @Patch(":id/resubmit") resubmit(@Param("id") id: string, @Body() body: any, @Req() req: DevelopmentRequestHttpRequest) { return this.service.resubmit(id, body, this.actor(req)); }
  @Post(":id/requester-decision") requesterDecision(@Param("id") id: string, @Body() body: { approved: boolean; comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.requesterDecision(id, Boolean(body.approved), body.comment, this.actor(req)); }
  @Post(":id/assign") assign(@Param("id") id: string, @Body() body: { handlerId?: string; handlerManagerId?: string; comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.assign(id, body.handlerId, body.handlerManagerId, body.comment, this.actor(req)); }
  @Post(":id/plan") submitPlan(@Param("id") id: string, @Body() body: any, @Req() req: DevelopmentRequestHttpRequest) { return this.service.submitPlan(id, body, this.actor(req)); }
  @Post(":id/handler-manager-decision") handlerManagerDecision(@Param("id") id: string, @Body() body: { approved: boolean; comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.handlerManagerDecision(id, Boolean(body.approved), body.comment, this.actor(req)); }
}
