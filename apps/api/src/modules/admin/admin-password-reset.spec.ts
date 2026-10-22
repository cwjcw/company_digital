import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { AdministratorGrant, User } from "../../entities";
import { AdminApplicationService } from "./admin-application.service";
import { AdminController } from "../../controllers";

const actor = { userId: "actor", name: "管理员", requestId: "reset-test", isSystemAdmin: true };
function setup() {
  const target = { id: "target", tenantId: "TENANT", username: "employee", enabled: false, version: 3, passwordHash: "old", passwordResetFailures: 4, passwordResetLockedAt: new Date(), mustChangePassword: false };
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn(async (entity) => entity === AdministratorGrant ? { systemAdmin: true } : { id: "actor", username: "operator", displayName: "真实管理员" }),
    findOne: jest.fn().mockResolvedValue(target), save: jest.fn(async (_entity, value) => value)
  };
  const source = { transaction: jest.fn(async (work) => work(manager)) };
  const service = new AdminApplicationService(source as never, {} as never, {} as never, {} as never, {} as never);
  return { target, manager, source, service };
}
describe("administrator manual password reset", () => {
  it("uses a tenant-scoped row lock, preserves account status, and audits only nonsecret metadata", async () => {
    const { service, target, manager } = setup();
    expect(await service.resetUserPassword("TENANT", "target", 3, actor)).toEqual({ id: "target", reset: true, mustChangePassword: true, version: 4 });
    expect(manager.findOne).toHaveBeenCalledWith(User, { where: { id: "target", tenantId: "TENANT" }, lock: { mode: "pessimistic_write" } });
    expect(target.enabled).toBe(false); expect(target.passwordResetFailures).toBe(0); expect(target.passwordResetLockedAt).toBeNull();
    expect(await bcrypt.compare("kn123456", target.passwordHash)).toBe(true);
    const audit = manager.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO audit_logs"));
    expect(audit?.[1]).toEqual(expect.arrayContaining(["TENANT", "actor", "真实管理员", "target", "reset-test", "operator"]));
    expect(JSON.stringify(audit)).not.toContain(target.passwordHash); expect(JSON.stringify(audit)).not.toContain("kn123456");
  });
  it("denies ordinary/module administrators before opening a write transaction", async () => {
    const { service, source } = setup();
    await expect(service.resetUserPassword("TENANT", "target", 3, { ...actor, isSystemAdmin: false })).rejects.toBeInstanceOf(ForbiddenException);
    expect(source.transaction).not.toHaveBeenCalled();
  });
  it("revalidates the real enabled operator and system-administrator grant", async () => {
    const { service, manager } = setup(); manager.findOneBy.mockResolvedValue(null as never);
    await expect(service.resetUserPassword("TENANT", "target", 3, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it("denies missing/cross-tenant targets without any password write", async () => {
    const { service, manager } = setup(); manager.findOne.mockResolvedValue(null);
    await expect(service.resetUserPassword("TENANT", "foreign", 3, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it("protects the primary admin account", async () => {
    const { service, target, manager } = setup(); target.username = "admin";
    await expect(service.resetUserPassword("TENANT", "target", 3, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it("rejects stale browser versions and malformed supplied versions", async () => {
    const { service, manager } = setup();
    await expect(service.resetUserPassword("TENANT", "target", 2, actor)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.resetUserPassword("TENANT", "target", "3", actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it("propagates an audit failure through the transaction boundary", async () => {
    const { service, manager } = setup(); manager.query.mockImplementation(async (sql) => { if (String(sql).includes("INSERT INTO audit_logs")) throw new Error("audit unavailable"); return []; });
    await expect(service.resetUserPassword("TENANT", "target", 3, actor)).rejects.toThrow("audit unavailable");
  });
  it("keeps the existing default-reset API compatible for callers without expectedVersion", async () => {
    const { service } = setup(); expect((await service.resetUserPassword("TENANT", "target", undefined, actor)).reset).toBe(true);
  });
  it("the controller rejects a non-system-admin and delegates authorized requests without database access", async () => {
    const application = { resetUserPassword: jest.fn().mockResolvedValue({ reset: true }) };
    const controller = new AdminController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, application as never, {} as never, {} as never);
    const request = { user: { sub: "actor", username: "operator", isSystemAdmin: false }, requestId: "r" };
    await expect(controller.resetUserPassword("target", { expectedVersion: 3 }, request as never)).rejects.toBeInstanceOf(ForbiddenException);
    request.user.isSystemAdmin = true;
    await expect(controller.resetUserPassword("target", { expectedVersion: 3 }, request as never)).resolves.toEqual({ reset: true });
    expect(application.resetUserPassword).toHaveBeenCalledWith(expect.any(String), "target", 3, expect.objectContaining({ userId: "actor", isSystemAdmin: true }));
  });
});
