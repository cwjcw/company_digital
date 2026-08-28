import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { AuthService } from "./auth";

function queryBuilder(result: unknown[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result)
  };
}

describe("AuthService dynamic organization roles", () => {
  function setup(enabled = true) {
    const user = {
      id: "user-1", username: "member", displayName: "部门成员", enabled,
      departmentPaths: [["凯南", "营销中心", "业务部"]], division: null, mustChangePassword: false
    };
    const users = { findOneBy: jest.fn().mockResolvedValue(user) };
    const userRoles = { findBy: jest.fn().mockResolvedValue([]) };
    const roleQuery = jest.fn()
      .mockReturnValueOnce(queryBuilder([]))
      .mockReturnValueOnce(queryBuilder([{ id: "role-organization", name: "营销角色" }]));
    const roles = { createQueryBuilder: roleQuery };
    const permissions = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder([{ resource: "orders", fieldKey: "*", read: true }])) };
    const scopes = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder([])) };
    const organizationScopes = { find: jest.fn().mockResolvedValue([{ roleId: "role-organization", organizationUnitId: "marketing" }]) };
    const permissionGroupSubjects = { find: jest.fn().mockResolvedValue([]) };
    const organizationUnits = { find: jest.fn().mockResolvedValue([
      { id: "company", name: "凯南", parentId: null },
      { id: "marketing", name: "营销中心", parentId: "company" },
      { id: "sales", name: "业务部", parentId: "marketing" }
    ]) };
    const service = new AuthService(
      users as never, userRoles as never, roles as never, permissions as never, scopes as never,
      organizationScopes as never, permissionGroupSubjects as never, organizationUnits as never,
      {} as never, {} as never, {} as never, {} as never, {} as never
    );
    return { service };
  }

  it("grants a role from the user's current department without a static user-role row", async () => {
    const claims = await setup().service.claimsForEnabledUser("user-1");
    expect(claims.roles).toEqual(["营销角色"]);
    expect(claims.permissions).toContain("orders:*:read");
  });

  it("rejects a departed or disabled user before reusing token claims", async () => {
    await expect(setup(false).service.claimsForEnabledUser("user-1")).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("AuthService password rules", () => {
  it("rejects a new password that is the same as the current password before storing anything", async () => {
    const user = { id: "user-1", displayName: "测试用户", passwordHash: await bcrypt.hash("Current123", 4), mustChangePassword: false };
    const users = { findOneBy: jest.fn().mockResolvedValue(user), save: jest.fn() };
    const service = new AuthService(
      users as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never
    );
    await expect(service.changePassword("user-1", "Current123", "Current123")).rejects.toBeInstanceOf(BadRequestException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it("stores only a bcrypt hash of the emailed reset code", async () => {
    const user = { id: "user-1", displayName: "测试用户", enabled: true, email: "user@example.com", mobile: "13800000000" };
    const userQuery = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(user) };
    const users = { createQueryBuilder: jest.fn().mockReturnValue(userQuery) };
    const latestQuery = { where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(null) };
    const resetRequests = { createQueryBuilder: jest.fn().mockReturnValue(latestQuery), save: jest.fn(async (value) => ({ id: "reset-1", createdAt: new Date(), ...value })), remove: jest.fn() };
    const audits = { save: jest.fn().mockResolvedValue({}) };
    const mail = { sendPasswordResetCode: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      users as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, resetRequests as never, audits as never, mail as never, {} as never
    );
    await expect(service.requestPasswordReset("13800000000", "user@example.com", "127.0.0.1", "request-1")).resolves.toMatchObject({ phoneVerified: true, email: "us***@example.com" });
    const stored = resetRequests.save.mock.calls[0]![0];
    expect(stored.codeHash).toMatch(/^\$2[aby]\$/);
    expect(stored.codeHash).not.toMatch(/^\d{6}$/);
    expect(mail.sendPasswordResetCode).toHaveBeenCalledWith("user@example.com", "测试用户", expect.stringMatching(/^\d{6}$/));
  });
});

describe("AuthService portal module preferences", () => {
  function setup() {
    const user = { id: "user-1", username: "member", displayName: "测试用户", enabled: true, portalModuleOrder: ["planning"], version: 2 };
    const users = { findOneBy: jest.fn().mockResolvedValue(user), save: jest.fn(async (value) => value) };
    const audits = { save: jest.fn().mockResolvedValue({}) };
    const service = new AuthService(
      users as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, audits as never, {} as never, {} as never
    );
    return { service, user, users, audits };
  }

  it("stores a normalized order for only the current user and audits the preference change", async () => {
    const { service, user, users, audits } = setup();
    await expect(service.updatePortalModuleOrder("user-1", ["profile", "planning", "profile"], "request-1"))
      .resolves.toMatchObject({ order: ["profile", "planning", "cockpit", "data", "marketing", "hr", "workflow", "system"] });
    expect(user.portalModuleOrder.slice(0, 2)).toEqual(["profile", "planning"]);
    expect(users.save).toHaveBeenCalledWith(user);
    expect(audits.save).toHaveBeenCalledWith(expect.objectContaining({ actorId: "user-1", action: "portal.module_order.updated", requestId: "request-1" }));
  });

  it("rejects unknown module identifiers", async () => {
    await expect(setup().service.updatePortalModuleOrder("user-1", ["planning", "unknown"], "request-2")).rejects.toBeInstanceOf(BadRequestException);
  });
});
