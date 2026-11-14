import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { NotificationInternalRequest } from "../notifications/notification.internal.guard";
import { NotificationInternalGuard } from "../notifications/notification.internal.guard";
import { MasterPlanExceptionNotificationService } from "./master-plan-exception-notification.service";

@Controller("internal/master-plan/notifications")
@UseGuards(NotificationInternalGuard)
export class MasterPlanExceptionNotificationInternalController {
  constructor(private readonly notifications: MasterPlanExceptionNotificationService) {}

  @Post("summary")
  queueSummary(@Req() request: NotificationInternalRequest, @Body() body: Record<string, unknown>) {
    const kind = body.kind;
    if (kind !== "initial" && kind !== "daily") throw new BadRequestException("汇总类型无效");
    return this.notifications.queueSummaryJob(String(request.notificationTenantId), kind);
  }
}
