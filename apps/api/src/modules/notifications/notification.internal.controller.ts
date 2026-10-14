import { BadRequestException, Body, Get, Res, Optional, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { OrderAllocationDeliveryService } from "./order-allocation.delivery.service";
import { ApiTags } from "@nestjs/swagger";
import { NotificationInternalGuard, NotificationInternalRequest } from "./notification.internal.guard";
import { NotificationService } from "./notification.service";
import type { NotificationDeliveryResult } from "./notification.types";

type InternalBody = Record<string, unknown>;

@ApiTags("内部通知 Dispatcher")
@UseGuards(NotificationInternalGuard)
@Controller("internal/notifications")
export class NotificationInternalController {
  constructor(private readonly notifications: NotificationService, @Optional() private readonly allocationDelivery?: OrderAllocationDeliveryService) {}

  @Get(":id/attachments/:attachmentId")
  async attachment(@Param("id") id:string,@Param("attachmentId") attachmentId:string,@Req() request:NotificationInternalRequest,@Res() response:Response) {
    if(!this.allocationDelivery) throw new BadRequestException("附件服务未配置");
    const file=await this.allocationDelivery.attachment(this.tenant(request),id,attachmentId,this.worker(request));
    response.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition",`attachment; filename="${file.filename}"`);
    response.setHeader("Cache-Control","no-store");response.send(file.content);
  }

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
    return {
      deliveryId,
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
