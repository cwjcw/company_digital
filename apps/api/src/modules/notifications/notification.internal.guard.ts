import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

export type NotificationInternalRequest = Request & {
  notificationTenantId?: string;
  notificationWorkerId?: string;
};

@Injectable()
export class NotificationInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<NotificationInternalRequest>();
    const expected = String(process.env.KDOS_NOTIFICATION_INTERNAL_TOKEN ?? "").trim();
    const provided = String(request.header("x-kdos-internal-token") ?? "").trim();
    const tenantId = String(request.header("x-kdos-tenant-id") ?? "").trim();
    const workerId = String(request.header("x-kdos-worker-id") ?? "").trim();
    if (!expected || !provided || !this.sameSecret(expected, provided) || !tenantId || tenantId.length > 64 || !workerId || workerId.length > 255) {
      throw new UnauthorizedException("内部通知接口未授权");
    }
    request.notificationTenantId = tenantId;
    request.notificationWorkerId = workerId;
    return true;
  }

  private sameSecret(expected: string, provided: string) {
    const left = Buffer.from(expected);
    const right = Buffer.from(provided);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
