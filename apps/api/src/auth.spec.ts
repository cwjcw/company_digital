import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { AuthService } from "./auth";
import { AuditLog, PasswordResetRequest, RefreshToken, User } from "./entities";

function queryBuilder(result: unknown[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result)
  };
}

describe("AuthService dynamic organization roles", () => {
  function setup(enabled = true, administratorGrant: { systemAdmin: boolean; moduleCodes: string[] } | null = null) {
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
    const administratorGrants = { findOneBy: jest.fn().mockResolvedValue(administratorGrant) };
    const refreshTokens = { save: jest.fn().mockResolvedValue({}) };
    const jwt = {
      signAsync: jest.fn().mockResolvedValueOnce("short-access-token").mockResolvedValueOnce("refresh-token"),
      decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 })
    };
    const service = new AuthService(
      users as never, userRoles as never, roles as never, permissions as never, scopes as never,
      organizationScopes as never, permissionGroupSubjects as never, organizationUnits as never,
      administratorGrants as never, refreshTokens as never, {} as never, {} as never, {} as never, jwt as never
    );
    return { service, user, jwt, refreshTokens };
  }

  it("grants a role from the user's current department without a static user-role row", async () => {
    const claims = await setup().service.claimsForEnabledUser("user-1");
    expect(claims.roles).toEqual(["营销角色"]);
    expect(claims.permissions).toContain("orders:*:read");
  });

  it("rejects a departed or disabled user before reusing token claims", async () => {
    await expect(setup(false).service.claimsForEnabledUser("user-1")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("grants every table action in only the assigned module without using an ordinary permission group", async () => {
    const claims = await setup(true, { systemAdmin: false, moduleCodes: ["planning"] }).service.claimsForEnabledUser("user-1");
    expect(claims.isSystemAdmin).toBe(false);
    expect(claims.moduleAdminCodes).toEqual(["planning"]);
    expect(claims.permissions).toContain("monthly-plan:*:update");
    expect(claims.permissions).toContain("planning.admin.manage");
    expect(claims.permissions).not.toContain("business-customer-mapping:*:update");
    expect(claims.permissions).not.toContain("*");
  });

  it("keeps the bearer token small and returns authorization only in the session body", async () => {
    const { service, user, jwt, refreshTokens } = setup(true, { systemAdmin: false, moduleCodes: ["planning"] });
    const result = await (service as any).issueTokens(user);
    expect(result.accessToken).toBe("short-access-token");
    expect(result.user.permissions).toContain("monthly-plan:*:update");
    expect(jwt.signAsync.mock.calls[0]![0]).toEqual({
      sub: "user-1", type: "access", jti: expect.any(String)
    });
    expect(jwt.signAsync.mock.calls[0]![0]).not.toHaveProperty("permissions");
    expect(jwt.signAsync.mock.calls[0]![0]).not.toHaveProperty("tableDataScopes");
    expect(refreshTokens.save).toHaveBeenCalledTimes(1);
  });
});

describe("AuthService password rules", () => {
  function setupTransactionalAuth(user: Record<string, any>, latestReset: Record<string, any> | null = null) {
    const userQuery = { setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(user) };
    const userRepository = { createQueryBuilder: jest.fn().mockReturnValue(userQuery) };
    const latestQuery = { where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(latestReset) };
    const resetRepository = { createQueryBuilder: jest.fn().mockReturnValue(latestQuery), save: jest.fn(async (value) => ({ id: "reset-1", createdAt: new Date(), ...value })) };
    const refreshUpdate = { update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), execute: jest.fn().mockResolvedValue({}) };
    const refreshRepository = { createQueryBuilder: jest.fn().mockReturnValue(refreshUpdate) };
    const manager = {
      getRepository: jest.fn((entity) => entity === User ? userRepository : entity === PasswordResetRequest ? resetRepository : entity === RefreshToken ? refreshRepository : {}),
      save: jest.fn(async (_entity, value) => value)
    };
    const users = { manager: { transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)) } };
    const mail = { sendTemporaryPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      users as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, mail as never, {} as never
    );
    return { service, users, userQuery, resetRepository, refreshUpdate, manager, mail };
  }

  it("requires an account before querying users or sending mail", async () => {
    const users = { manager: { transaction: jest.fn() } };
    const mail = { sendTemporaryPassword: jest.fn() };
    const service = new AuthService(
      users as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, mail as never, {} as never
    );
    await expect(service.requestPasswordReset("", "user@example.com", "127.0.0.1", "request-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(users.manager.transaction).not.toHaveBeenCalled();
    expect(mail.sendTemporaryPassword).not.toHaveBeenCalled();
  });

  it("rejects a new password that is the same as the current password before storing anything", async () => {
    const user = { id: "user-1", username: "member", displayName: "测试用户", passwordHash: await bcrypt.hash("Current123", 4), mustChangePassword: false };
    const { service, manager } = setupTransactionalAuth(user);
    await expect(service.changePassword("user-1", "Current123", "Current123", "user@example.com")).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("requires and stores the latest recovery email when an authenticated user changes password", async () => {
    const user = {
      id: "user-1", username: "member", displayName: "测试用户", email: "old@example.com",
      passwordHash: await bcrypt.hash("Current123", 4), mustChangePassword: true,
      passwordResetFailures: 10, passwordResetLockedAt: new Date(), version: 3
    };
    const { service, manager, refreshUpdate } = setupTransactionalAuth(user);
    jest.spyOn(service as any, "issueTokens").mockResolvedValue({ accessToken: "access", refreshToken: "refresh", user: {} });
    await expect(service.changePassword("user-1", "Current123", "NextPassword456", " NEW@example.com ")).resolves.toMatchObject({ accessToken: "access" });
    expect(user.email).toBe("new@example.com");
    expect(user.passwordResetFailures).toBe(0);
    expect(user.passwordResetLockedAt).toBeNull();
    expect(user.mustChangePassword).toBe(false);
    expect(refreshUpdate.execute).toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
      action: "password.changed",
      beforeJson: { recoveryEmail: "ol***@example.com" },
      afterJson: expect.objectContaining({ recoveryEmail: "ne***@example.com", passwordResetLockCleared: true })
    }));
  });

  it("sends an exact 8-character compliant password and stores only bcrypt hashes", async () => {
    const currentPasswordHash = await bcrypt.hash("Current123", 4);
    const user = { id: "user-1", username: "member", displayName: "测试用户", enabled: true, email: "user@example.com", passwordHash: currentPasswordHash, mustChangePassword: false, passwordResetFailures: 3, passwordResetLockedAt: null, version: 2 };
    const { service, userQuery, resetRepository, manager, mail } = setupTransactionalAuth(user);
    await expect(service.requestPasswordReset(" member ", "USER@example.com", "127.0.0.1", "request-1"))
      .resolves.toMatchObject({ status: "ok", email: "us***@example.com", temporaryPasswordLength: 8, mustChangePassword: true });
    const mailedPassword = mail.sendTemporaryPassword.mock.calls[0]![2];
    expect(mailedPassword).toMatch(/^(?=.{8}$)(?=.*[A-Za-z])(?=.*\d)\S+$/);
    expect(userQuery.andWhere).toHaveBeenCalledWith("user.username = :username", { username: "member" });
    expect(await bcrypt.compare(mailedPassword, user.passwordHash)).toBe(true);
    expect(user.passwordHash).not.toBe(mailedPassword);
    expect(user.mustChangePassword).toBe(true);
    expect(user.passwordResetFailures).toBe(0);
    expect(user.passwordResetLockedAt).toBeNull();
    const resetRecord = resetRepository.save.mock.calls[0]![0];
    expect(resetRecord.codeHash).not.toBe(mailedPassword);
    expect(await bcrypt.compare(mailedPassword, resetRecord.codeHash)).toBe(true);
    expect(manager.save).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
      action: "password_reset.temporary_password_sent",
      afterJson: expect.objectContaining({ temporaryPasswordLength: 8, mustChangePassword: true, refreshTokensRevoked: true })
    }));
  });

  it("counts a wrong recovery email and reports the remaining attempts", async () => {
    const user = {
      id: "user-1", username: "member", displayName: "测试用户", enabled: true, email: "correct@example.com",
      passwordHash: await bcrypt.hash("Current123", 4), passwordResetFailures: 3, passwordResetLockedAt: null, version: 1
    };
    const { service, manager, mail } = setupTransactionalAuth(user);
    await expect(service.requestPasswordReset("member", "wrong@example.com", "127.0.0.1", "request-2"))
      .rejects.toThrow("邮箱与账号不一致，还剩 6 次尝试");
    expect(user.passwordResetFailures).toBe(4);
    expect(user.passwordResetLockedAt).toBeNull();
    expect(mail.sendTemporaryPassword).not.toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
      action: "password_reset.email_verification_failed",
      afterJson: expect.objectContaining({ failedAttempts: 4, remainingAttempts: 6, locked: false })
    }));
  });

  it("counts an invalid email format and reports the remaining attempts", async () => {
    const user = {
      id: "user-1", username: "member", displayName: "测试用户", enabled: true, email: "correct@example.com",
      passwordHash: await bcrypt.hash("Current123", 4), passwordResetFailures: 0, passwordResetLockedAt: null, version: 1
    };
    const { service, mail } = setupTransactionalAuth(user);
    await expect(service.requestPasswordReset("member", "not-an-email", "127.0.0.1", "request-invalid-format"))
      .rejects.toThrow("邮箱格式无效，还剩 9 次尝试");
    expect(user.passwordResetFailures).toBe(1);
    expect(mail.sendTemporaryPassword).not.toHaveBeenCalled();
  });

  it("locks password reset on the tenth wrong email and keeps the lock for later attempts", async () => {
    const user = {
      id: "user-1", username: "member", displayName: "测试用户", enabled: true, email: "correct@example.com",
      passwordHash: await bcrypt.hash("Current123", 4), passwordResetFailures: 9, passwordResetLockedAt: null, version: 1
    };
    const { service, mail } = setupTransactionalAuth(user);
    await expect(service.requestPasswordReset("member", "wrong@example.com", "127.0.0.1", "request-3"))
      .rejects.toThrow("邮箱验证已连续错误 10 次");
    expect(user.passwordResetFailures).toBe(10);
    expect(user.passwordResetLockedAt).toBeInstanceOf(Date);
    await expect(service.requestPasswordReset("member", "correct@example.com", "127.0.0.1", "request-4"))
      .rejects.toThrow("该账号找回密码功能已锁定");
    expect(mail.sendTemporaryPassword).not.toHaveBeenCalled();
  });
});

describe("AuthService portal module preferences", () => {
  function setup() {
    const user = { id: "user-1", username: "member", displayName: "测试用户", enabled: true, portalModuleOrder: ["planning"], version: 2 };
    const users = { findOneBy: jest.fn().mockResolvedValue(user), save: jest.fn(async (value) => value) };
    const audits = { save: jest.fn().mockResolvedValue({}) };
    const service = new AuthService(
      users as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, audits as never, {} as never, {} as never
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
