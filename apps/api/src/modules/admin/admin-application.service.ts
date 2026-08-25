import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { AuditLog, Permission, Role, RoleGroup, RoleOrganizationScope, User, UserRole } from "../../entities";

type PermissionInput = Partial<Permission> & { resource?: string };
type RoleInput = {
  name?: string; description?: string; roleGroupId?: string | null;
  permissions?: PermissionInput[]; userIds?: string[]; organizationUnitIds?: string[];
};
type EmployeeActor = { userId: string | null; name: string; requestId: string };

@Injectable()
export class AdminApplicationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RoleGroup) private readonly roleGroups: Repository<RoleGroup>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>
  ) {}

  listRoleGroups() {
    return this.roleGroups.find({ order: { sortOrder: "ASC", name: "ASC" } });
  }

  async createRoleGroup(input: { name?: string; sortOrder?: number; userIds?: unknown }) {
    if (input.userIds !== undefined) throw new BadRequestException("角色组不能关联用户");
    const name = String(input.name ?? "").trim();
    if (!name) throw new BadRequestException("角色组名称不能为空");
    if (await this.roleGroups.findOneBy({ name })) throw new ConflictException("角色组名称已存在");
    return this.roleGroups.save({ name, sortOrder: Number(input.sortOrder ?? 0) });
  }

  async updateRoleGroup(id: string, input: { name?: string; sortOrder?: number; userIds?: unknown }) {
    if (input.userIds !== undefined) throw new BadRequestException("角色组不能关联用户");
    const group = await this.roleGroups.findOneBy({ id });
    if (!group) throw new BadRequestException("角色组不存在");
    if (input.name !== undefined) {
      const name = input.name.trim(); if (!name) throw new BadRequestException("角色组名称不能为空");
      const duplicate = await this.roleGroups.findOneBy({ name });
      if (duplicate && duplicate.id !== id) throw new ConflictException("角色组名称已存在");
      group.name = name;
    }
    if (input.sortOrder !== undefined) group.sortOrder = Number(input.sortOrder);
    return this.roleGroups.save(group);
  }

  async deleteRoleGroup(id: string) {
    const count = await this.roles.countBy({ roleGroupId: id });
    if (count) throw new ConflictException("请先移动或删除组内角色，再删除角色组");
    const result = await this.roleGroups.delete(id);
    if (!result.affected) throw new BadRequestException("角色组不存在");
    return { deleted: true };
  }

  private async validateRoleGroup(manager: DataSource["manager"], roleGroupId: string | null | undefined) {
    if (!roleGroupId) return null;
    const group = await manager.findOneBy(RoleGroup, { id: roleGroupId });
    if (!group) throw new BadRequestException("目标角色组不存在");
    return group.id;
  }

  async createRole(input: RoleInput) {
    const name = String(input.name ?? "").trim();
    if (!name) throw new BadRequestException("角色名称不能为空");
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
      return role;
    });
  }

  async updateRole(id: string, input: RoleInput) {
    return this.dataSource.transaction(async (manager) => {
      const role = await manager.findOneBy(Role, { id });
      if (!role) throw new ForbiddenException("角色不存在");
      if (input.name !== undefined) {
        const name = input.name.trim(); if (!name) throw new BadRequestException("角色名称不能为空");
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
      return role;
    });
  }

  async deleteRole(id: string) {
    const role = await this.roles.findOneBy({ id });
    if (!role) throw new BadRequestException("角色不存在");
    if (["系统管理员", "集团管理员"].includes(role.name)) throw new ForbiddenException("系统内置管理角色不能删除");
    await this.roles.delete(id);
    return { deleted: true };
  }

  async employeeAction(id: string, input: { action?: string; targetUserId?: string; departmentPaths?: string[][] }, actor: EmployeeActor) {
    const action = String(input.action ?? "").toUpperCase();
    if (!["HANDOVER", "DISABLE", "TRANSFER", "DEPARTURE"].includes(action)) throw new BadRequestException("员工操作类型无效");
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
        requestId: actor.requestId, source: "WEB"
      });
      return { id, action, enabled: user.enabled, departmentPaths: user.departmentPaths };
    });
  }
}
