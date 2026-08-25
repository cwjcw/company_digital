import { createHash, randomUUID } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import bcrypt from "bcryptjs";
import { Request } from "express";
import { Repository } from "typeorm";
import { ApiKey, OrganizationUnit, Permission, RefreshToken, Role, RoleDataScope, RoleOrganizationScope, User, UserRole } from "./entities";
import { planningPermissions } from "@kdos/contracts";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(RoleDataScope) private readonly scopes: Repository<RoleDataScope>,
    @InjectRepository(RoleOrganizationScope) private readonly organizationScopes: Repository<RoleOrganizationScope>,
    @InjectRepository(OrganizationUnit) private readonly organizationUnits: Repository<OrganizationUnit>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService
  ) {}

  private async claimsFor(user: User) {
    const links = await this.userRoles.findBy({ userId: user.id });
    const roleIds = links.map((link) => link.roleId);
    const roles = roleIds.length ? await this.roles.createQueryBuilder("r").where("r.id IN (:...ids)", { ids: roleIds }).getMany() : [];
    const permissions = roleIds.length ? await this.permissions.createQueryBuilder("p").where("p.roleId IN (:...ids)", { ids: roleIds }).getMany() : [];
    const scopes = roleIds.length ? await this.scopes.createQueryBuilder("s").where("s.roleId IN (:...ids)", { ids: roleIds }).getMany() : [];
    const organizationScopes = roleIds.length ? await this.organizationScopes.createQueryBuilder("s").where("s.roleId IN (:...ids)", { ids: roleIds }).getMany() : [];
    const organizationUnits = organizationScopes.length ? await this.organizationUnits.find() : [];
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
      roles: roles.map((role) => role.name),
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

  async changePassword(userId: string, currentPassword: string, nextPassword: string) {
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(nextPassword)) throw new UnauthorizedException("密码至少 8 位，且必须同时包含字母和数字");
    const user = await this.users.findOneBy({ id: userId });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new UnauthorizedException("当前密码错误");
    user.passwordHash = await bcrypt.hash(nextPassword, 12);
    user.mustChangePassword = false;
    await this.users.save(user);
    return this.issueTokens(user);
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    @InjectRepository(User) private readonly users: Repository<User>
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (token) {
      try {
        request.user = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
        return true;
      } catch {
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
