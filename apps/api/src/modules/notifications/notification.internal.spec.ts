import { ExecutionContext } from "@nestjs/common";
import { NotificationInternalGuard } from "./notification.internal.guard";

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
