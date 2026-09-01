import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { administrableModuleRegistry, type AdministrableModuleCode } from "@kdos/contracts";
import { DataSource } from "typeorm";
import { AdministratorGrant, AuditLog, User } from "../../entities";
import { isPrimaryAdminUsername } from "../../user-defaults";

type Actor = { userId: string | null; username: string; name: string; requestId: string; isSystemAdmin: boolean };
type GrantInput = { systemAdmin?: boolean; moduleCodes?: string[]; expectedVersion?: number | null; targetUserId?: string };

@Injectable()
export class AdministratorGrantApplicationService {
  constructor(private readonly dataSource: DataSource) {}

  async list(tenantId: string) {
    const [users, grants] = await Promise.all([
      this.dataSource.getRepository(User).find({ order: { displayName: "ASC", username: "ASC" } }),
      this.dataSource.getRepository(AdministratorGrant).find({ where: { tenantId }, order: { createdAt: "ASC" } })
    ]);
    const byUser = new Map(grants.map((grant) => [grant.userId, grant]));
    return {
      modules: administrableModuleRegistry,
      users: users.map((user) => {
        const grant = byUser.get(user.id);
        return {
          id: user.id, username: user.username, displayName: user.displayName, employeeNo: user.employeeNo,
          departmentPaths: user.departmentPaths, enabled: user.enabled,
          grant: grant ? { id: grant.id, systemAdmin: grant.systemAdmin, moduleCodes: grant.moduleCodes, version: grant.version } : null
        };
      })
    };
  }

  async replace(tenantId: string, userId: string, input: GrantInput, actor: Actor) {
    const allowed = new Set<string>(administrableModuleRegistry.map((module) => module.code));
    const moduleCodes = [...new Set((input.moduleCodes ?? []).map(String))];
    const invalid = moduleCodes.filter((code) => !allowed.has(code));
    if (invalid.length) throw new BadRequestException(`包含不可管理的模块：${invalid.join("、")}`);
    const systemAdmin = Boolean(input.systemAdmin);
    if (systemAdmin && moduleCodes.length) throw new BadRequestException("系统管理员无需重复配置模块管理员");

    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext('administrator-grants'))", [tenantId]);
      const user = await manager.findOneBy(User, { id: userId });
      if (!user) throw new BadRequestException("用户不存在");
      const current = await manager.createQueryBuilder(AdministratorGrant, "grant")
        .setLock("pessimistic_write").where("grant.tenantId = :tenantId", { tenantId })
        .andWhere("grant.userId = :userId", { userId }).getOne();
      if (current && input.expectedVersion !== current.version) throw new ConflictException("管理员配置已被其他人修改，请刷新后重试");
      if (!current && input.expectedVersion != null) throw new ConflictException("管理员配置已发生变化，请刷新后重试");
      const touchesSystemAdministrators = systemAdmin || current?.systemAdmin === true;
      if (touchesSystemAdministrators && (!actor.isSystemAdmin || !isPrimaryAdminUsername(actor.username))) {
        throw new ForbiddenException("只有 admin 账号可以调整系统管理员");
      }
      if (!touchesSystemAdministrators && !actor.isSystemAdmin) throw new ForbiddenException("只有系统管理员可以调整模块管理员");
      if (isPrimaryAdminUsername(user.username) && !systemAdmin) throw new BadRequestException("admin 是默认系统管理员，不能删除或改为模块管理员");

      const targetUserId = String(input.targetUserId ?? userId);
      const targetUser = targetUserId === userId ? user : await manager.findOneBy(User, { id: targetUserId });
      if (!targetUser) throw new BadRequestException("目标用户不存在");
      if (!targetUser.enabled) throw new BadRequestException("停用或离职用户不能设为管理员");
      if (targetUserId !== userId) {
        if (!current) throw new BadRequestException("原管理员配置不存在");
        if (isPrimaryAdminUsername(user.username)) throw new BadRequestException("admin 是默认系统管理员，不能更换账号");
        const targetGrant = await manager.createQueryBuilder(AdministratorGrant, "grant")
          .setLock("pessimistic_write").where("grant.tenantId = :tenantId", { tenantId })
          .andWhere("grant.userId = :userId", { userId: targetUserId }).getOne();
        if (targetGrant) throw new ConflictException("目标用户已经是管理员");
      }

      const before = current ? { systemAdmin: current.systemAdmin, moduleCodes: current.moduleCodes, version: current.version } : null;
      if (current?.systemAdmin && !systemAdmin) {
        const count = await manager.count(AdministratorGrant, { where: { tenantId, systemAdmin: true } });
        if (count <= 1) throw new ConflictException("系统必须至少保留一名系统管理员");
      }

      let saved: AdministratorGrant | null = null;
      if (!systemAdmin && !moduleCodes.length) {
        if (current) await manager.delete(AdministratorGrant, { id: current.id });
      } else if (current && targetUserId === userId) {
        current.systemAdmin = systemAdmin;
        current.moduleCodes = moduleCodes as AdministrableModuleCode[];
        current.updatedBy = actor.userId ?? "system";
        current.version += 1;
        saved = await manager.save(AdministratorGrant, current);
      } else {
        saved = await manager.save(AdministratorGrant, {
          tenantId, userId: targetUserId, systemAdmin, moduleCodes, createdBy: actor.userId,
          updatedBy: actor.userId ?? "system", version: 1
        });
        if (current) await manager.delete(AdministratorGrant, { id: current.id });
      }

      const after = saved ? { systemAdmin: saved.systemAdmin, moduleCodes: saved.moduleCodes, version: saved.version } : null;
      await manager.save(AuditLog, {
        actorId: actor.userId, actorName: actor.name, resource: "administrators", recordId: targetUserId,
        action: targetUserId === userId ? "administrator_grant.replaced" : "administrator_grant.transferred",
        beforeJson: targetUserId === userId ? before : { userId, grant: before },
        afterJson: targetUserId === userId ? after : { userId: targetUserId, grant: after },
        requestId: actor.requestId, source: "web"
      });
      return { userId: targetUserId, grant: saved ? { id: saved.id, ...after } : null };
    });
  }
}
