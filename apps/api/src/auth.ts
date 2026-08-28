import { createHash, randomInt, randomUUID } from "node:crypto";
import { BadRequestException, CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import bcrypt from "bcryptjs";
import { Request } from "express";
import { Repository } from "typeorm";
import { ApiKey, AuditLog, OrganizationUnit, PasswordResetRequest, Permission, PermissionGroupSubject, RefreshToken, Role, RoleDataScope, RoleOrganizationScope, User, UserRole } from "./entities";
import { planningPermissions } from "@kdos/contracts";
import { createOrganizationMembershipIndex } from "@kdos/permissions";
import { MailService } from "./mail.service";

export const PASSWORD_RULE_TEXT = "密码须为 8–64 位，至少包含一个字母和一个数字，不能包含空格，且不能与当前密码相同";
const PASSWORD_PATTERN = /^(?=.{8,64}$)(?=.*[A-Za-z])(?=.*\d)\S+$/;
const PORTAL_MODULE_IDS = ["cockpit", "planning", "data", "marketing", "hr", "workflow", "system", "profile"] as const;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(RoleDataScope) private readonly scopes: Repository<RoleDataScope>,
    @InjectRepository(RoleOrganizationScope) private readonly organizationScopes: Repository<RoleOrganizationScope>,
    @InjectRepository(PermissionGroupSubject) private readonly permissionGroupSubjects: Repository<PermissionGroupSubject>,
    @InjectRepository(OrganizationUnit) private readonly organizationUnits: Repository<OrganizationUnit>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(PasswordResetRequest) private readonly passwordResetRequests: Repository<PasswordResetRequest>,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    private readonly mail: MailService,
    private readonly jwt: JwtService
  ) {}

  private async claimsFor(user: User) {
    const links = await this.userRoles.findBy({ userId: user.id });
    const directRoleIds = links.map((link) => link.roleId);
    const [permissionGroupRoles, permissionGroupSubjects, allOrganizationUnits, allOrganizationScopes] = await Promise.all([
      this.roles.createQueryBuilder("r").where("r.permissionGroupResource IS NOT NULL").andWhere("r.permissionGroupEnabled = true").getMany(),
      this.permissionGroupSubjects.find(), this.organizationUnits.find(), this.organizationScopes.find()
    ]);
    const organizationMembership = createOrganizationMembershipIndex(allOrganizationUnits);
    const belongsToOrganization = (organizationId: string) => (user.departmentPaths ?? [])
      .some((userPath) => organizationMembership.departmentPathBelongsTo(userPath, organizationId));
    const organizationRoleIds = allOrganizationScopes.filter((scope) => belongsToOrganization(scope.organizationUnitId)).map((scope) => scope.roleId);
    const managedOrganizationUnitIds = new Set(allOrganizationUnits.filter((unit) => unit.enabled && (unit.leaderUserIds ?? []).includes(user.id)).map((unit) => unit.id));
    let managedChanged = true;
    while (managedChanged) {
      managedChanged = false;
      for (const unit of allOrganizationUnits) if (unit.enabled && unit.parentId && managedOrganizationUnitIds.has(unit.parentId) && !managedOrganizationUnitIds.has(unit.id)) {
        managedOrganizationUnitIds.add(unit.id); managedChanged = true;
      }
    }
    const roleIds = [...new Set([...directRoleIds, ...organizationRoleIds])];
    const roles = roleIds.length ? await this.roles.createQueryBuilder("r").where("r.id IN (:...ids)", { ids: roleIds }).getMany() : [];
    const matchingPermissionGroupIds = new Set(permissionGroupSubjects.filter((subject) =>
      (subject.subjectType === "USER" && subject.subjectId === user.id)
      || (subject.subjectType === "ROLE" && roleIds.includes(subject.subjectId))
      || (subject.subjectType === "ORGANIZATION" && belongsToOrganization(subject.subjectId))
    ).map((subject) => subject.roleId));
    const effectivePermissionGroups = permissionGroupRoles.filter((role) => matchingPermissionGroupIds.has(role.id));
    const effectiveRoleIds = [...new Set([...roleIds, ...effectivePermissionGroups.map((role) => role.id)])];
    const permissions = effectiveRoleIds.length ? await this.permissions.createQueryBuilder("p").where("p.roleId IN (:...ids)", { ids: effectiveRoleIds }).getMany() : [];
    const scopes = roleIds.length ? await this.scopes.createQueryBuilder("s").where("s.roleId IN (:...ids)", { ids: roleIds }).getMany() : [];
    const organizationScopes = allOrganizationScopes.filter((scope) => roleIds.includes(scope.roleId));
    const organizationUnits = organizationScopes.length ? allOrganizationUnits : [];
    const isSystemAdmin = roles.some((role) => role.name === "系统管理员");
    const isGroupAdmin = roles.some((role) => role.name === "集团管理员");
    const isDivisionPlanningGroup = roles.some((role) => role.name === "事业部计划组");
    const divisions = new Set(scopes.map((scope) => scope.division));
    for (const selected of organizationScopes) {
      const selectedUnit = organizationUnits.find((unit) => unit.id === selected.organizationUnitId);
      if (!selectedUnit) continue;
      const subtree = [] as OrganizationUnit[];
      let frontier = [selectedUnit.id];
      while (frontier.length) {
        const current = frontier;
        frontier = [];
        for (const unit of organizationUnits) if (current.includes(unit.id)) {
          subtree.push(unit);
          frontier.push(...organizationUnits.filter((child) => child.parentId === unit.id).map((child) => child.id));
        }
      }
      for (const unit of subtree) if (unit.division) divisions.add(unit.division);
      if (selectedUnit.division) divisions.add(selectedUnit.division);
    }
    // 事业部计划组不需要逐张订单配置范围：它的范围就是本人所属事业部。
    if (isDivisionPlanningGroup && user.division) divisions.add(user.division);
    const hasFullDataScope = isSystemAdmin || isGroupAdmin;
    const hasLegacyPlanRead = permissions.some((permission) => permission.resource === "monthly-plan" && permission.read);
    const rolePlanningPermissions = isGroupAdmin
      ? [...planningPermissions]
      : isDivisionPlanningGroup
        ? planningPermissions.filter((permission) => !["planning.plan.delete", "planning.plan.unlock", "planning.admin.manage"].includes(permission))
        : hasLegacyPlanRead ? ["planning.plan.read", "planning.process.read", "planning.progress.read"] : [];
    return {
      sub: user.id,
      username: user.username,
      displayName: user.displayName,
      portalModuleOrder: user.portalModuleOrder ?? [],
      roles: roles.map((role) => role.name),
      tableDataScopes: effectivePermissionGroups.map((role) => {
        const operation = permissions.find((permission) => permission.roleId === role.id && permission.fieldKey === "*");
        const actions = operation ? ["read", "create", "copy", "update", "delete", "batch_print", "batch_update", "import", "export"]
          .filter((action) => Boolean(operation[action === "batch_print" ? "batchPrint" : action === "batch_update" ? "batchUpdate" : action as keyof Permission])) : [];
        return { resource: role.permissionGroupResource, groupId: role.id, scope: role.permissionGroupScope, match: role.permissionGroupConditionMatch, rules: role.permissionGroupDataRules, actions };
      }),
      managedOrganizationUnitIds: [...managedOrganizationUnitIds],
      divisions: hasFullDataScope ? "*" : [...divisions],
      permissions: isSystemAdmin ? ["*"] : [...new Set([
        ...permissions.flatMap((permission) =>
          ["read", "create", "copy", "update", "delete", "batch_print", "batch_update", "import", "export"]
            .filter((action) => permission[action === "batch_print" ? "batchPrint" : action === "batch_update" ? "batchUpdate" : action as keyof Permission])
            .map((action) => `${permission.resource}:${permission.fieldKey}:${action}`)
        ),
        ...rolePlanningPermissions
      ])],
      mustChangePassword: user.mustChangePassword
    };
  }

  async claimsForEnabledUser(userId: string) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user?.enabled) throw new UnauthorizedException("账户已停用");
    return this.claimsFor(user);
  }

  private async issueTokens(user: User) {
    const payload = await this.claimsFor(user);
    const accessToken = await this.jwt.signAsync({ ...payload, jti: randomUUID() }, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as any
    });
    const refreshToken = await this.jwt.signAsync({ sub: user.id, type: "refresh", jti: randomUUID() }, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: (process.env.JWT_REFRESH_TTL ?? "7d") as any
    });
    const decoded = this.jwt.decode(refreshToken) as { exp?: number } | null;
    await this.refreshTokens.save({
      userId: user.id,
      tokenHash: createHash("sha256").update(refreshToken).digest("hex"),
      expiresAt: new Date((decoded?.exp ?? Math.floor(Date.now() / 1000 + 7 * 86400)) * 1000),
      revokedAt: null
    });
    return {
      accessToken,
      refreshToken,
      user: payload
    };
  }

  async login(username: string, password: string) {
    const normalizedUsername = username?.trim();
    if (!normalizedUsername) throw new UnauthorizedException("请输入用户名");
    const user = await this.users.findOneBy({ username: normalizedUsername });
    if (!user) throw new UnauthorizedException("用户名不存在");
    if (!user.enabled) throw new UnauthorizedException("账户已停用，请联系管理员");
    if (!(await bcrypt.compare(password ?? "", user.passwordHash))) throw new UnauthorizedException("密码错误");
    await this.users.update(user.id, { lastLoginAt: new Date() });
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type: string }>(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
      if (payload.type !== "refresh") throw new UnauthorizedException("无效刷新令牌");
      const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
      const stored = await this.refreshTokens.findOneBy({ tokenHash });
      if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) throw new UnauthorizedException("刷新令牌已失效");
      const user = await this.users.findOneBy({ id: payload.sub });
      if (!user?.enabled) throw new UnauthorizedException("账户已停用");
      await this.refreshTokens.update(stored.id, { revokedAt: new Date() });
      return this.issueTokens(user);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("刷新令牌已失效");
    }
  }

  async logout(refreshToken: string) {
    const tokenHash = createHash("sha256").update(refreshToken).digest("hex");
    await this.refreshTokens.update({ tokenHash }, { revokedAt: new Date() });
    return { status: "ok" };
  }

  async updatePortalModuleOrder(userId: string, requestedOrder: unknown, requestId: string) {
    if (!Array.isArray(requestedOrder)) throw new BadRequestException("模块顺序必须是数组");
    const invalid = requestedOrder.filter((value) => typeof value !== "string" || !PORTAL_MODULE_IDS.includes(value as typeof PORTAL_MODULE_IDS[number]));
    if (invalid.length) throw new BadRequestException("模块顺序包含未知模块");
    const unique = [...new Set(requestedOrder as string[])];
    const normalized = [...unique, ...PORTAL_MODULE_IDS.filter((id) => !unique.includes(id))];
    const user = await this.users.findOneBy({ id: userId });
    if (!user?.enabled) throw new UnauthorizedException("账户已停用");
    const previousOrder = user.portalModuleOrder ?? [];
    user.portalModuleOrder = normalized;
    user.updatedBy = user.username;
    user.version = (user.version ?? 0) + 1;
    await this.users.save(user);
    await this.auditLogs.save({
      actorId: user.id, actorName: user.displayName, resource: "portal-preferences", recordId: user.id,
      action: "portal.module_order.updated", beforeJson: { order: previousOrder }, afterJson: { order: normalized }, requestId, source: "web"
    });
    return { order: normalized };
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string) {
    this.assertPasswordRule(nextPassword);
    const user = await this.users.findOneBy({ id: userId });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new UnauthorizedException("当前密码错误");
    if (await bcrypt.compare(nextPassword, user.passwordHash)) throw new BadRequestException("新密码不能与当前密码相同");
    user.passwordHash = await bcrypt.hash(nextPassword, 12);
    user.mustChangePassword = false;
    await this.users.save(user);
    await this.refreshTokens.createQueryBuilder().update().set({ revokedAt: new Date() }).where("user_id = :userId AND revoked_at IS NULL", { userId }).execute();
    await this.auditLogs.save({ actorId: user.id, actorName: user.displayName, resource: "auth", recordId: user.id, action: "password.changed", beforeJson: null, afterJson: { passwordStorage: "bcrypt", previousRefreshTokensRevoked: true }, requestId: `password-change:${randomUUID()}`, source: "web" });
    return this.issueTokens(user);
  }

  async requestPasswordReset(mobile: string, email: string, ip: string | undefined, requestId: string) {
    const normalizedMobile = String(mobile ?? "").replace(/[^\d+]/g, "");
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (normalizedMobile.length < 6 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new BadRequestException("请输入有效的手机号码和邮箱");
    const user = await this.users.createQueryBuilder("user")
      .where("user.enabled = true")
      .andWhere("LOWER(COALESCE(user.email, '')) = :email", { email: normalizedEmail })
      .andWhere("regexp_replace(COALESCE(user.mobile, ''), '[^0-9+]', '', 'g') = :mobile", { mobile: normalizedMobile })
      .getOne();
    if (!user) throw new BadRequestException("手机号码或邮箱与最新通讯录不一致");
    const latest = await this.passwordResetRequests.createQueryBuilder("request")
      .where("request.userId = :userId", { userId: user.id }).orderBy("request.createdAt", "DESC").getOne();
    if (latest && latest.createdAt.getTime() > Date.now() - 60_000) throw new HttpException("验证码发送过于频繁，请 60 秒后再试", HttpStatus.TOO_MANY_REQUESTS);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const request = await this.passwordResetRequests.save({
      userId: user.id, codeHash: await bcrypt.hash(code, 12), expiresAt: new Date(Date.now() + 10 * 60_000), consumedAt: null, attempts: 0, requestIp: ip ?? null
    });
    try {
      await this.mail.sendPasswordResetCode(normalizedEmail, user.displayName, code);
    } catch (error) {
      await this.passwordResetRequests.remove(request);
      throw error;
    }
    const maskedEmail = this.maskEmail(normalizedEmail);
    await this.auditLogs.save({ actorId: user.id, actorName: user.displayName, resource: "auth", recordId: user.id, action: "password_reset.requested", beforeJson: null, afterJson: { phoneVerified: true, email: maskedEmail, expiresInMinutes: 10 }, requestId, source: "web" });
    return { phoneVerified: true, email: maskedEmail, expiresInMinutes: 10 };
  }

  async resetPassword(mobile: string, email: string, code: string, nextPassword: string, requestId: string) {
    this.assertPasswordRule(nextPassword);
    const normalizedMobile = String(mobile ?? "").replace(/[^\d+]/g, "");
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    const user = await this.users.createQueryBuilder("user")
      .where("user.enabled = true")
      .andWhere("LOWER(COALESCE(user.email, '')) = :email", { email: normalizedEmail })
      .andWhere("regexp_replace(COALESCE(user.mobile, ''), '[^0-9+]', '', 'g') = :mobile", { mobile: normalizedMobile })
      .getOne();
    if (!user) throw new BadRequestException("手机号码或邮箱与最新通讯录不一致");
    const reset = await this.passwordResetRequests.createQueryBuilder("request")
      .where("request.userId = :userId", { userId: user.id })
      .andWhere("request.consumedAt IS NULL").andWhere("request.expiresAt > now()")
      .orderBy("request.createdAt", "DESC").getOne();
    if (!reset) throw new BadRequestException("验证码已失效，请重新获取");
    if (reset.attempts >= 5) throw new BadRequestException("验证码尝试次数已达上限，请重新获取");
    if (!(await bcrypt.compare(String(code ?? "").trim(), reset.codeHash))) {
      reset.attempts += 1;
      if (reset.attempts >= 5) reset.consumedAt = new Date();
      await this.passwordResetRequests.save(reset);
      throw new BadRequestException(reset.attempts >= 5 ? "验证码尝试次数已达上限，请重新获取" : "验证码错误");
    }
    if (await bcrypt.compare(nextPassword, user.passwordHash)) throw new BadRequestException("新密码不能与当前密码相同");
    user.passwordHash = await bcrypt.hash(nextPassword, 12);
    user.mustChangePassword = false;
    await this.users.save(user);
    await this.passwordResetRequests.createQueryBuilder().update().set({ consumedAt: new Date() }).where("user_id = :userId AND consumed_at IS NULL", { userId: user.id }).execute();
    await this.refreshTokens.createQueryBuilder().update().set({ revokedAt: new Date() }).where("user_id = :userId AND revoked_at IS NULL", { userId: user.id }).execute();
    await this.auditLogs.save({ actorId: user.id, actorName: user.displayName, resource: "auth", recordId: user.id, action: "password.reset", beforeJson: null, afterJson: { passwordStorage: "bcrypt", refreshTokensRevoked: true }, requestId, source: "web" });
    return { status: "ok" };
  }

  private assertPasswordRule(password: string) {
    if (!PASSWORD_PATTERN.test(String(password ?? ""))) throw new BadRequestException(PASSWORD_RULE_TEXT);
  }

  private maskEmail(email: string) {
    const [local, domain] = email.split("@");
    return `${(local ?? "").slice(0, 2)}***@${domain}`;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly moduleRef: ModuleRef
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (token) {
      try {
        const verified = await this.jwt.verifyAsync<{ sub?: string } & Record<string, unknown>>(token, { secret: process.env.JWT_ACCESS_SECRET });
        if (!verified.sub) throw new UnauthorizedException("登录身份无效");
        const auth = this.moduleRef.get(AuthService, { strict: false });
        request.user = { ...verified, ...await auth.claimsForEnabledUser(verified.sub) };
        return true;
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        throw new UnauthorizedException("登录已过期");
      }
    }
    const apiKey = request.headers["x-api-key"];
    if (typeof apiKey !== "string") throw new UnauthorizedException("请先登录");
    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    const record = await this.apiKeys.findOneBy({ keyHash, enabled: true });
    if (!record || (record.expiresAt && record.expiresAt <= new Date())) throw new UnauthorizedException("API Key 无效或已过期");
    const linkedUser = record.userId ? await this.users.findOneBy({ id: record.userId }) : null;
    if (record.userId && !linkedUser) throw new UnauthorizedException("API Key 关联人员不存在，请联系管理员重新配置");
    if (linkedUser && !linkedUser.enabled) throw new UnauthorizedException("API Key 关联人员已停用");
    if (!linkedUser && !["GET", "HEAD", "OPTIONS"].includes(request.method?.toUpperCase() ?? "")) {
      throw new UnauthorizedException("API Key 未关联人员，不能执行上传、新增或修改操作");
    }
    await this.apiKeys.update(record.id, { lastUsedAt: new Date() });
    request.user = {
      sub: linkedUser?.id ?? record.id,
      username: linkedUser?.username ?? `api-key:${record.name}`,
      displayName: linkedUser?.displayName ?? `API Key：${record.name}`,
      actorName: linkedUser?.displayName ?? `API Key：${record.name}`,
      apiKeyId: record.id,
      roles: ["API Key"], divisions: "*", permissions: record.scopes
    };
    return true;
  }
}
