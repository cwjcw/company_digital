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
  @Get("recipient-users") recipientUsers(@Req() request: NotificationRequest) { return this.service.recipientUsers(this.actor(request)); }
  @Get("template-variables") variables(@Query("eventType") eventType: string, @Req() request: NotificationRequest) { return this.service.templateVariables(this.actor(request), eventType); }
  @Get("rules") rules(@Query() query: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.listRules(this.actor(request), query); }
  @Get("rules/:id") rule(@Param("id") id: string, @Req() request: NotificationRequest) { return this.service.detail(this.actor(request), id); }
  @Post("rules") create(@Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.create(this.actor(request), body); }
  @Patch("rules/:id") update(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.update(this.actor(request), id, body); }
  @Post("rules/:id/test") test(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.testSend(this.actor(request), id, body); }
  @Get("delivery-logs") logs(@Query() query: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.logs(this.actor(request), query); }
  @Get("failures") failures(@Query() query: Record<string, unknown>, @Req() request: NotificationRequest) { return this.service.logs(this.actor(request), query, true); }
  @Post("outbox/:id/retry") retry(@Param("id") id: string, @Req() request: NotificationRequest) { return this.service.retry(this.actor(request), id); }

  private actor(request: NotificationRequest): NotificationAdminActor { return { tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: request.user?.sub ?? null, name: request.user?.displayName ?? request.user?.username ?? "unknown", username: request.user?.username ?? "unknown", requestId: request.requestId, isSystemAdmin: request.user?.isSystemAdmin === true, moduleAdminCodes: request.user?.moduleAdminCodes ?? [] }; }
}
