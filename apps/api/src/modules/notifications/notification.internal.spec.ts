import { ExecutionContext } from "@nestjs/common";
import { NotificationInternalGuard } from "./notification.internal.guard";
import { NotificationInternalController } from "./notification.internal.controller";

function context(headers: Record<string, string | undefined>) {
  const request = { header: (name: string) => headers[name.toLowerCase()] };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext & { request: typeof request };
}

describe("NotificationInternalGuard", () => {
  const original = process.env.KDOS_NOTIFICATION_INTERNAL_TOKEN;
  afterEach(() => {
    if (original == null) delete process.env.KDOS_NOTIFICATION_INTERNAL_TOKEN;
    else process.env.KDOS_NOTIFICATION_INTERNAL_TOKEN = original;
  });

  it("requires the internal token, tenant and worker headers", () => {
    process.env.KDOS_NOTIFICATION_INTERNAL_TOKEN = "secret";
    const requestContext = context({
      "x-kdos-internal-token": "secret",
      "x-kdos-tenant-id": "KAINAN",
      "x-kdos-worker-id": "dispatcher-1"
    });
    expect(new NotificationInternalGuard().canActivate(requestContext)).toBe(true);
    const request = requestContext.switchToHttp().getRequest() as Record<string, unknown>;
    expect(request.notificationTenantId).toBe("KAINAN");
    expect(request.notificationWorkerId).toBe("dispatcher-1");
  });

  it("rejects a wrong token", () => {
    process.env.KDOS_NOTIFICATION_INTERNAL_TOKEN = "secret";
    expect(() => new NotificationInternalGuard().canActivate(context({
      "x-kdos-internal-token": "wrong", "x-kdos-tenant-id": "KAINAN", "x-kdos-worker-id": "dispatcher-1"
    }))).toThrow("内部通知接口未授权");
  });
});

describe("NotificationInternalController", () => {
  it("reports exactly one delivery ID", async () => {
    const notifications = { markDeliverySuccess: jest.fn().mockResolvedValue({ status: "PROCESSING" }) };
    const controller = new NotificationInternalController(notifications as never);
    const request = { notificationTenantId: "KAINAN", notificationWorkerId: "dispatcher-1" };
    await controller.success("00000000-0000-7000-8000-000000000002", request as never, {
      deliveryId: "00000000-0000-7000-8000-000000000003",
      errcode: "0",
      errmsg: "ok"
    });
    expect(notifications.markDeliverySuccess).toHaveBeenCalledWith(
      "KAINAN",
      "00000000-0000-7000-8000-000000000002",
      "dispatcher-1",
      { deliveryId: "00000000-0000-7000-8000-000000000003", errcode: "0", errmsg: "ok", providerMessageId: undefined }
    );
  });
});
