import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { NotificationAdminService, type NotificationAdminActor } from "./notification-admin.service";

type NotificationRequest = Request & { user: any; requestId: string };

@ApiTags("消息中心")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("notifications")
export class NotificationAdminController {
  constructor(private readonly service: NotificationAdminService) {}
  @Get("events") events(@Req() request: NotificationRequest) { return this.service.availableEvents(this.actor(request)); }
  @Get("routes/events") routeEvents(@Req() request: NotificationRequest) { return this.service.availableGroupRouteEvents(this.actor(request)); }
  @Get("recipient-users") recipientUsers(@Req() request: NotificationRequest) { return this.service.recipientUsers(this.actor(request)); }
  @Get("recipient-options") recipientOptions(@Req() request: NotificationRequest) { return this.service.recipientOptions(this.actor(request)); }
  @Get("template-variables") variables(@Query("eventType") eventType: string, @Req() request: NotificationRequest) { return this.service.templateVariables(this.actor(request), eventType); }
  @Get("rules") rules(@Query() query: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.listRules(this.actor(request), query); }
  @Get("rules/:id") rule(@Param("id") id: string, @Req() request: NotificationRequest) { return this.service.detail(this.actor(request), id); }
  @Get("rules/:id/recipient-preview") recipientPreview(@Param("id") id: string, @Req() request: NotificationRequest) { return this.service.recipientPreview(this.actor(request), id); }
  @Post("rules") create(@Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.create(this.actor(request), body); }
  @Patch("rules/:id") update(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.update(this.actor(request), id, body); }
  @Post("rules/:id/test") test(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.testSend(this.actor(request), id, body); }
  @Get("delivery-logs") logs(@Query() query: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.logs(this.actor(request), query); }
  @Get("failures") failures(@Query() query: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.logs(this.actor(request), query, true); }
  @Post("outbox/:id/retry") retry(@Param("id") id: string, @Req() request: NotificationRequest) { return this.service.retry(this.actor(request), id); }
  @Get("management-access") managementAccess(@Req() request: NotificationRequest) { const actor=this.actor(request); return { groupWebhooks:this.service.groupWebhookAccess(actor), recipientGroups:this.service.recipientGroupAccess(actor), routes:this.service.routeAccess(actor) }; }
  @Get("group-webhooks") groupWebhooks(@Req() request: NotificationRequest) { return this.service.listGroupWebhooks(this.actor(request)); }
  @Post("group-webhooks") createGroupWebhook(@Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.createGroupWebhook(this.actor(request), body); }
  @Patch("group-webhooks/:id") updateGroupWebhook(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.updateGroupWebhook(this.actor(request), id, body); }
  @Post("group-webhooks/:id/delete") deleteGroupWebhook(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.deleteGroupWebhook(this.actor(request), id, Number(body.expectedVersion)); }
  @Post("group-webhooks/:id/test") testGroupWebhook(@Param("id") id: string, @Req() request: NotificationRequest) { return this.service.testGroupWebhook(this.actor(request), id); }
  @Get("recipient-groups") recipientGroups(@Req() request: NotificationRequest) { return this.service.listRecipientGroups(this.actor(request)); }
  @Post("recipient-groups") createRecipientGroup(@Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.createRecipientGroup(this.actor(request), body); }
  @Patch("recipient-groups/:id") updateRecipientGroup(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.updateRecipientGroup(this.actor(request),id,body); }
  @Post("recipient-groups/:id/delete") deleteRecipientGroup(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.deleteRecipientGroup(this.actor(request),id,Number(body.expectedVersion)); }
  @Get("routes") routes(@Req() request: NotificationRequest) { return this.service.listRoutes(this.actor(request)); }
  @Post("routes") saveRoute(@Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.saveRoute(this.actor(request), body); }
  @Post("routes/:id/delete") deleteRoute(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.deleteRoute(this.actor(request), id, Number(body.expectedVersion)); }

  private actor(request: NotificationRequest): NotificationAdminActor { return { tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: request.user?.sub ?? null, name: request.user?.displayName ?? request.user?.username ?? "unknown", username: request.user?.username ?? "unknown", requestId: request.requestId, isSystemAdmin: request.user?.isSystemAdmin === true, moduleAdminCodes: request.user?.moduleAdminCodes ?? [], permissions: request.user?.permissions ?? [] }; }
}
