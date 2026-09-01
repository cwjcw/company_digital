import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { AdministratorGrant, AuditLog, Permission, Role, RoleGroup, RoleOrganizationScope, User, UserRole } from "../../entities";
import { isPrimaryAdminUsername } from "../../user-defaults";

type PermissionInput = Partial<Permission> & { resource?: string };
type RoleInput = {
  name?: string; description?: string; roleGroupId?: string | null;
  permissions?: PermissionInput[]; userIds?: string[]; organizationUnitIds?: string[];
};
type EmployeeActor = { userId: string | null; name: string; requestId: string };
type AdminActor = EmployeeActor;
const systemActor: AdminActor = { userId: null, name: "system", requestId: "system" };

@Injectable()
export class AdminApplicationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RoleGroup) private readonly roleGroups: Repository<RoleGroup>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>
  ) {}

  async assertCanDisableUser(userId: string, tenantId: string) {
    const user = await this.users.findOneBy({ id: userId });
    if (isPrimaryAdminUsername(user?.username)) throw new ConflictException("admin 是默认系统管理员，不能停用");
    const target = await this.dataSource.getRepository(AdministratorGrant).findOneBy({ tenantId, userId, systemAdmin: true });
    if (!target) return;
    const enabledSystemAdministrators = await this.dataSource.getRepository(AdministratorGrant).createQueryBuilder("grant")
      .innerJoin(User, "user", "user.id = grant.userId AND user.enabled = true")
      .where("grant.tenantId = :tenantId", { tenantId }).andWhere("grant.systemAdmin = true").getCount();
    if (enabledSystemAdministrators <= 1) throw new ConflictException("不能停用最后一名在职系统管理员");
  }

  async assertCanDisableUsers(userIds: string[], tenantId: string) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    const selectedUsers = await this.users.find({ where: ids.map((id) => ({ id })) });
    if (selectedUsers.some((user) => isPrimaryAdminUsername(user.username))) throw new ConflictException("admin 是默认系统管理员，不能停用");
    const repository = this.dataSource.getRepository(AdministratorGrant);
    const [enabledSystemAdministrators, selectedSystemAdministrators] = await Promise.all([
      repository.createQueryBuilder("grant").innerJoin(User, "user", "user.id = grant.userId AND user.enabled = true")
        .where("grant.tenantId = :tenantId", { tenantId }).andWhere("grant.systemAdmin = true").getCount(),
      repository.createQueryBuilder("grant").innerJoin(User, "user", "user.id = grant.userId AND user.enabled = true")
        .where("grant.tenantId = :tenantId", { tenantId }).andWhere("grant.systemAdmin = true")
        .andWhere("grant.userId IN (:...ids)", { ids }).getCount()
    ]);
    if (enabledSystemAdministrators - selectedSystemAdministrators < 1) throw new ConflictException("不能停用最后一名在职系统管理员");
  }

  listRoleGroups() {
    return this.roleGroups.find({ order: { sortOrder: "ASC", name: "ASC" } });
  }

  async createRoleGroup(input: { name?: string; sortOrder?: number; userIds?: unknown }, actor: AdminActor = systemActor) {
    if (input.userIds !== undefined) throw new BadRequestException("角色组不能关联用户");
    const name = String(input.name ?? "").trim();
    if (!name) throw new BadRequestException("角色组名称不能为空");
    if (await this.roleGroups.findOneBy({ name })) throw new ConflictException("角色组名称已存在");
    return this.dataSource.transaction(async (manager) => {
      const group = await manager.save(RoleGroup, { name, sortOrder: Number(input.sortOrder ?? 0) });
      await manager.save(AuditLog, {
        actorId: actor.userId, actorName: actor.name, resource: "role-groups", recordId: group.id,
        action: "role_group.created", beforeJson: null, afterJson: { name: group.name, sortOrder: group.sortOrder },
        requestId: actor.requestId, source: "web"
      });
      return group;
    });
  }

  async updateRoleGroup(id: string, input: { name?: string; sortOrder?: number; userIds?: unknown }, actor: AdminActor = systemActor) {
    if (input.userIds !== undefined) throw new BadRequestException("角色组不能关联用户");
    const group = await this.roleGroups.findOneBy({ id });
    if (!group) throw new BadRequestException("角色组不存在");
    const before = { name: group.name, sortOrder: group.sortOrder };
    if (input.name !== undefined) {
      const name = input.name.trim(); if (!name) throw new BadRequestException("角色组名称不能为空");
      const duplicate = await this.roleGroups.findOneBy({ name });
      if (duplicate && duplicate.id !== id) throw new ConflictException("角色组名称已存在");
      group.name = name;
    }
    if (input.sortOrder !== undefined) group.sortOrder = Number(input.sortOrder);
    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(RoleGroup, group);
      await manager.save(AuditLog, {
        actorId: actor.userId, actorName: actor.name, resource: "role-groups", recordId: saved.id,
        action: "role_group.updated", beforeJson: before, afterJson: { name: saved.name, sortOrder: saved.sortOrder },
        requestId: actor.requestId, source: "web"
      });
      return saved;
    });
  }

  async deleteRoleGroup(id: string, actor: AdminActor = systemActor) {
    const group = await this.roleGroups.findOneBy({ id });
    if (!group) throw new BadRequestException("角色组不存在");
    const count = await this.roles.countBy({ roleGroupId: id });
    if (count) throw new ConflictException("请先移动或删除组内角色，再删除角色组");
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(RoleGroup, { id });
      await manager.save(AuditLog, {
        actorId: actor.userId, actorName: actor.name, resource: "role-groups", recordId: id,
        action: "role_group.deleted", beforeJson: { name: group.name, sortOrder: group.sortOrder }, afterJson: null,
        requestId: actor.requestId, source: "web"
      });
      return { deleted: true };
    });
  }

  private async validateRoleGroup(manager: DataSource["manager"], roleGroupId: string | null | undefined) {
    if (!roleGroupId) return null;
    const group = await manager.findOneBy(RoleGroup, { id: roleGroupId });
    if (!group) throw new BadRequestException("目标角色组不存在");
    return group.id;
  }

  async createRole(input: RoleInput, actor: AdminActor = systemActor) {
    const name = String(input.name ?? "").trim();
    if (!name) throw new BadRequestException("角色名称不能为空");
    if (name === "系统管理员") throw new ForbiddenException("系统管理员只能在“管理员”页面调整");
    if (await this.roles.findOneBy({ name })) throw new ConflictException("角色名称已存在");
    return this.dataSource.transaction(async (manager) => {
      const roleGroupId = await this.validateRoleGroup(manager, input.roleGroupId);
      const role = await manager.save(Role, { name, description: input.description?.trim() || null, roleGroupId });
      for (const permission of input.permissions ?? []) {
        if (!permission.resource) continue;
        await manager.save(Permission, { ...permission, roleId: role.id, resource: permission.resource, fieldKey: permission.fieldKey ?? "*" });
      }
      for (const userId of [...new Set(input.userIds ?? [])]) await manager.save(UserRole, { userId, roleId: role.id });
      for (const organizationUnitId of [...new Set(input.organizationUnitIds ?? [])]) await manager.save(RoleOrganizationScope, { roleId: role.id, organizationUnitId });
      await manager.save(AuditLog, {
        actorId: actor.userId, actorName: actor.name, resource: "permission-groups", recordId: role.id,
        action: "permission_group.created", beforeJson: null,
        afterJson: { name: role.name, permissions: input.permissions ?? [], userIds: input.userIds ?? [], organizationUnitIds: input.organizationUnitIds ?? [] },
        requestId: actor.requestId, source: "web"
      });
      return role;
    });
  }

  async updateRole(id: string, input: RoleInput, actor: AdminActor = systemActor) {
    return this.dataSource.transaction(async (manager) => {
      const role = await manager.findOneBy(Role, { id });
      if (!role) throw new ForbiddenException("角色不存在");
      const [beforePermissions, beforeUsers, beforeOrganizations] = await Promise.all([
        manager.find(Permission, { where: { roleId: id } }), manager.find(UserRole, { where: { roleId: id } }),
        manager.find(RoleOrganizationScope, { where: { roleId: id } })
      ]);
      const before = {
        name: role.name, description: role.description, roleGroupId: role.roleGroupId,
        permissions: beforePermissions, userIds: beforeUsers.map((link) => link.userId),
        organizationUnitIds: beforeOrganizations.map((scope) => scope.organizationUnitId)
      };
      if (input.name !== undefined) {
        const name = input.name.trim(); if (!name) throw new BadRequestException("角色名称不能为空");
        if (role.name === "系统管理员" || name === "系统管理员") throw new ForbiddenException("系统管理员只能在“管理员”页面调整");
        const duplicate = await manager.findOneBy(Role, { name });
        if (duplicate && duplicate.id !== id) throw new ConflictException("角色名称已存在");
        role.name = name;
      }
      if (input.description !== undefined) role.description = input.description.trim() || null;
      if (input.roleGroupId !== undefined) role.roleGroupId = await this.validateRoleGroup(manager, input.roleGroupId);
      await manager.save(role);
      if (input.permissions) {
        await manager.delete(Permission, { roleId: id });
        for (const permission of input.permissions) {
          if (!permission.resource) continue;
          await manager.save(Permission, { ...permission, roleId: id, resource: permission.resource, fieldKey: permission.fieldKey ?? "*" });
        }
      }
      if (input.userIds) {
        await manager.delete(UserRole, { roleId: id });
        for (const userId of [...new Set(input.userIds)]) await manager.save(UserRole, { userId, roleId: id });
      }
      if (input.organizationUnitIds) {
        await manager.delete(RoleOrganizationScope, { roleId: id });
        for (const organizationUnitId of [...new Set(input.organizationUnitIds)]) await manager.save(RoleOrganizationScope, { roleId: id, organizationUnitId });
      }
      const [afterPermissions, afterUsers, afterOrganizations] = await Promise.all([
        manager.find(Permission, { where: { roleId: id } }), manager.find(UserRole, { where: { roleId: id } }),
        manager.find(RoleOrganizationScope, { where: { roleId: id } })
      ]);
      await manager.save(AuditLog, {
        actorId: actor.userId, actorName: actor.name, resource: "permission-groups", recordId: role.id,
        action: "permission_group.updated", beforeJson: before,
        afterJson: {
          name: role.name, description: role.description, roleGroupId: role.roleGroupId,
          permissions: afterPermissions, userIds: afterUsers.map((link) => link.userId),
          organizationUnitIds: afterOrganizations.map((scope) => scope.organizationUnitId)
        }, requestId: actor.requestId, source: "web"
      });
      return role;
    });
  }

  async deleteRole(id: string, actor: AdminActor = systemActor) {
    const role = await this.roles.findOneBy({ id });
    if (!role) throw new BadRequestException("角色不存在");
    if (["系统管理员", "集团管理员"].includes(role.name)) throw new ForbiddenException("系统内置管理角色不能删除");
    return this.dataSource.transaction(async (manager) => {
      const [permissions, users, organizations] = await Promise.all([
        manager.find(Permission, { where: { roleId: id } }), manager.find(UserRole, { where: { roleId: id } }),
        manager.find(RoleOrganizationScope, { where: { roleId: id } })
      ]);
      await manager.delete(Role, { id });
      await manager.save(AuditLog, {
        actorId: actor.userId, actorName: actor.name, resource: "permission-groups", recordId: id,
        action: "permission_group.deleted",
        beforeJson: { name: role.name, description: role.description, roleGroupId: role.roleGroupId, permissions, userIds: users.map((link) => link.userId), organizationUnitIds: organizations.map((scope) => scope.organizationUnitId) },
        afterJson: null, requestId: actor.requestId, source: "web"
      });
      return { deleted: true };
    });
  }

  async employeeAction(id: string, input: { action?: string; targetUserId?: string; departmentPaths?: string[][] }, actor: EmployeeActor) {
    const action = String(input.action ?? "").toUpperCase();
    if (!["HANDOVER", "DISABLE", "TRANSFER", "DEPARTURE"].includes(action)) throw new BadRequestException("员工操作类型无效");
    if (["DISABLE", "DEPARTURE"].includes(action)) await this.assertCanDisableUser(id, process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN");
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOneBy(User, { id });
      if (!user) throw new BadRequestException("员工不存在");
      const before = { enabled: user.enabled, departmentPaths: user.departmentPaths };
      if (action === "HANDOVER") {
        if (!input.targetUserId || input.targetUserId === id) throw new BadRequestException("请选择其他在职员工接收工作");
        const target = await manager.findOneBy(User, { id: input.targetUserId, enabled: true });
        if (!target) throw new BadRequestException("接收人不存在或已停用");
      }
      if (action === "TRANSFER") {
        if (!Array.isArray(input.departmentPaths) || !input.departmentPaths.length) throw new BadRequestException("请选择转入部门");
        user.departmentPaths = input.departmentPaths; await manager.save(user);
      }
      if (action === "DISABLE" || action === "DEPARTURE") { user.enabled = false; await manager.save(user); }
      await manager.save(AuditLog, {
        actorId: actor.userId, actorName: actor.name, resource: "users", recordId: id,
        action: `employee.${action.toLowerCase()}`, beforeJson: before,
        afterJson: { enabled: user.enabled, departmentPaths: user.departmentPaths, targetUserId: input.targetUserId ?? null },
        requestId: actor.requestId, source: "web"
      });
      return { id, action, enabled: user.enabled, departmentPaths: user.departmentPaths };
    });
  }
}
