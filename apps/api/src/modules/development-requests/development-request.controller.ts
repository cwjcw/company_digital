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
    return { id: req.user.sub, name: req.user.displayName ?? req.user.username, roles: req.user.roles ?? [], isSystemAdmin: req.user.isSystemAdmin === true, moduleAdminCodes: req.user.moduleAdminCodes ?? [] };
  }

  @Get() list(@Query("scope") scope: string | undefined, @Query("search") search: string | undefined, @Req() req: DevelopmentRequestHttpRequest) { return this.service.list(this.actor(req), scope, search); }
  @Get("people") people() { return this.service.people(); }
  @Get("config") config() { return this.service.runtimeConfig(); }
  @Get(":id") detail(@Param("id") id: string, @Req() req: DevelopmentRequestHttpRequest) { return this.service.detail(id, this.actor(req)); }
  @Post() create(@Body() body: any, @Req() req: DevelopmentRequestHttpRequest) { return this.service.create(body, body.submit !== false, this.actor(req)); }
  @Patch(":id/draft") updateDraft(@Param("id") id: string, @Body() body: any, @Req() req: DevelopmentRequestHttpRequest) { return this.service.updateDraft(id, body, body.submit === true, this.actor(req)); }
  @Post(":id/submit") submitDraft(@Param("id") id: string, @Req() req: DevelopmentRequestHttpRequest) { return this.service.submitDraft(id, this.actor(req)); }
  @Post(":id/withdraw") withdraw(@Param("id") id: string, @Body() body: { comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.withdraw(id, body.comment, this.actor(req)); }
  @Post(":id/return") returnTo(@Param("id") id: string, @Body() body: { targetStatus?: string; comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.returnTo(id, body.targetStatus, body.comment, this.actor(req)); }
  @Post(":id/reject") reject(@Param("id") id: string, @Body() body: { comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.reject(id, body.comment, this.actor(req)); }
  @Patch(":id/resubmit") resubmit(@Param("id") id: string, @Body() body: any, @Req() req: DevelopmentRequestHttpRequest) { return this.service.resubmit(id, body, this.actor(req)); }
  @Post(":id/requester-decision") requesterDecision(@Param("id") id: string, @Body() body: { approved: boolean; comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.requesterDecision(id, body.approved === true, body.comment, this.actor(req)); }
  @Post(":id/assign") assign(@Param("id") id: string, @Body() body: { handlerId?: string; handlerManagerId?: string; comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.assign(id, body.handlerId, body.handlerManagerId, body.comment, this.actor(req)); }
  @Post(":id/plan") submitPlan(@Param("id") id: string, @Body() body: any, @Req() req: DevelopmentRequestHttpRequest) { return this.service.submitPlan(id, body, this.actor(req)); }
  @Post(":id/handler-manager-decision") handlerManagerDecision(@Param("id") id: string, @Body() body: { approved: boolean; comment?: string }, @Req() req: DevelopmentRequestHttpRequest) { return this.service.handlerManagerDecision(id, body.approved === true, body.comment, this.actor(req)); }
}
