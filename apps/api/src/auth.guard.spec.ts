import { createHash } from "node:crypto";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "./auth";

function contextFor(request: any) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
}

describe("AuthGuard API Key actor", () => {
  const jwt = { verifyAsync: jest.fn() } as any;
  const moduleRef = { get: jest.fn() } as any;

  it("uses the linked person's display name as the modification actor", async () => {
    const secret = "fdt_test_key";
    const apiKeys = {
      findOneBy: jest.fn().mockResolvedValue({
        id: "key-id", name: "MES 对接", userId: "user-id", enabled: true,
        expiresAt: null, scopes: ["monthly-plan:*:update"],
        keyHash: createHash("sha256").update(secret).digest("hex")
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 })
    } as any;
    const users = {
      findOneBy: jest.fn().mockResolvedValue({
        id: "user-id", username: "zhangsan", displayName: "张三", enabled: true
      })
    } as any;
    const guard = new AuthGuard(jwt, apiKeys, users, moduleRef);
    const request: any = { headers: { "x-api-key": secret } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({
      sub: "user-id", username: "zhangsan", displayName: "张三", actorName: "张三", apiKeyId: "key-id"
    });
  });

  it("rejects an API Key whose linked person has been disabled", async () => {
    const apiKeys = {
      findOneBy: jest.fn().mockResolvedValue({ id: "key-id", name: "MES 对接", userId: "user-id", expiresAt: null, scopes: [] }),
      update: jest.fn()
    } as any;
    const users = { findOneBy: jest.fn().mockResolvedValue({ id: "user-id", enabled: false }) } as any;
    const guard = new AuthGuard(jwt, apiKeys, users, moduleRef);

    await expect(guard.canActivate(contextFor({ headers: { "x-api-key": "fdt_test_key" } })))
      .rejects.toThrow(new UnauthorizedException("API Key 关联人员已停用"));
    expect(apiKeys.update).not.toHaveBeenCalled();
  });

  it("allows legacy unlinked keys to read but rejects all writes", async () => {
    const apiKeys = {
      findOneBy: jest.fn().mockResolvedValue({ id: "key-id", name: "legacy", userId: null, expiresAt: null, scopes: ["monthly-plan:*:read"] }),
      update: jest.fn().mockResolvedValue({ affected: 1 })
    } as any;
    const users = { findOneBy: jest.fn() } as any;
    const guard = new AuthGuard(jwt, apiKeys, users, moduleRef);
    const readRequest: any = { method: "GET", headers: { "x-api-key": "legacy-key" } };
    await expect(guard.canActivate(contextFor(readRequest))).resolves.toBe(true);
    expect(readRequest.user.actorName).toBe("API Key：legacy");

    const writeRequest: any = { method: "POST", headers: { "x-api-key": "legacy-key" } };
    await expect(guard.canActivate(contextFor(writeRequest)))
      .rejects.toThrow("API Key 未关联人员，不能执行上传、新增或修改操作");
  });

  it("recomputes live roles for every bearer-token request", async () => {
    const tokenJwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: "user-id", exp: 123 }) } as any;
    const liveAuth = { claimsForEnabledUser: jest.fn().mockResolvedValue({ sub: "user-id", roles: ["营销角色"], permissions: ["orders:*:read"] }) } as any;
    const liveModuleRef = { get: jest.fn().mockReturnValue(liveAuth) } as any;
    const guard = new AuthGuard(tokenJwt, {} as any, {} as any, liveModuleRef);
    const request: any = { headers: { authorization: "Bearer token" } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(liveAuth.claimsForEnabledUser).toHaveBeenCalledWith("user-id");
    expect(request.user).toMatchObject({ roles: ["营销角色"], permissions: ["orders:*:read"] });
  });
});
