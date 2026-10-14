import { ExecutionContext } from "@nestjs/common";
import { NotificationInternalGuard } from "./notification.internal.guard";
import { NotificationInternalController } from "./notification.internal.controller";
import express from "express";
import request from "supertest";

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
  it("downloads Chinese allocation filenames through a valid UTF8 HTTP header", async () => {
    const filename="订单分配_261014164230_事业一部.xlsx";
    const delivery={attachment:jest.fn().mockResolvedValue({filename,content:Buffer.from("PK-test")})};
    const controller=new NotificationInternalController({} as never,delivery as never);
    const app=express();
    app.get("/file",(_req,res)=>{void controller.attachment("outbox","attachment",{notificationTenantId:"KAINAN",notificationWorkerId:"worker"} as never,res);});
    const response=await request(app).get("/file").buffer(true).parse((res,callback)=>{
      const chunks:Buffer[]=[];res.on("data",chunk=>chunks.push(Buffer.from(chunk)));res.on("end",()=>callback(null,Buffer.concat(chunks)));
    }).expect(200);
    const header=response.headers["content-disposition"];
    expect(header).toContain('filename="order-allocation.xlsx"');
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1])).toBe(filename);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual(Buffer.from("PK-test"));
    expect(delivery.attachment).toHaveBeenCalledWith("KAINAN","outbox","attachment","worker");
  });
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
