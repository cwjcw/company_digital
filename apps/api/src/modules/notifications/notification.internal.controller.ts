import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { NotificationInternalGuard, NotificationInternalRequest } from "./notification.internal.guard";
import { NotificationService } from "./notification.service";
import type { NotificationDeliveryResult } from "./notification.types";

type InternalBody = Record<string, unknown>;

@ApiTags("内部通知 Dispatcher")
@UseGuards(NotificationInternalGuard)
@Controller("internal/notifications")
export class NotificationInternalController {
  constructor(private readonly notifications: NotificationService) {}

  @Post("claim")
  claim(@Req() request: NotificationInternalRequest, @Body() body: InternalBody) {
    const limit = this.optionalPositiveInteger(body.limit, 10, 20);
    return this.notifications.claimForDispatcher(this.tenant(request), this.worker(request), limit);
  }

  @Post(":id/success")
  success(@Param("id") id: string, @Req() request: NotificationInternalRequest, @Body() body: InternalBody) {
    return this.notifications.markDeliverySuccess(this.tenant(request), id, this.worker(request), this.delivery(body));
  }

  @Post(":id/failure")
  failure(@Param("id") id: string, @Req() request: NotificationInternalRequest, @Body() body: InternalBody) {
    return this.notifications.markDeliveryFailure(this.tenant(request), id, this.worker(request), this.delivery(body));
  }

  private delivery(body: InternalBody): NotificationDeliveryResult {
    const deliveryId = this.text(body.deliveryId, "deliveryId", 64);
    const deliveryIds = Array.isArray(body.deliveryIds)
      ? body.deliveryIds.map((value) => this.text(value, "deliveryId", 64)).slice(0, 500)
      : undefined;
    return {
      deliveryId,
      deliveryIds,
      providerMessageId: this.optionalText(body.providerMessageId, 255),
      errcode: this.optionalText(body.errcode, 64),
      errmsg: this.optionalText(body.errmsg, 4000)
    };
  }

  private tenant(request: NotificationInternalRequest) { return this.text(request.notificationTenantId, "tenantId", 64); }
  private worker(request: NotificationInternalRequest) { return this.text(request.notificationWorkerId, "workerId", 255); }
  private optionalPositiveInteger(value: unknown, fallback: number, max: number) {
    if (value == null) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException("limit 无效");
    return Math.min(parsed, max);
  }
  private optionalText(value: unknown, max: number) { return value == null || value === "" ? undefined : this.text(value, "value", max); }
  private text(value: unknown, name: string, max: number) {
    const text = String(value ?? "").trim();
    if (!text || text.length > max) throw new BadRequestException(`${name} 无效`);
    return text;
  }
}
