import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, IsNull, Not, Repository } from "typeorm";
import { tablePermissionFieldsFor, type TablePermissionFieldDefinition } from "@kdos/contracts";
import { OrganizationUnit, Permission, Role, RoleGroup, User, UserRole } from "../../entities";
import { applyTypedFilterToQueryBuilder } from "../../common/filtering/typeorm-filter";
import { USERS_SORT_COLUMNS, usersFilterColumns } from "./users-filter";

export type AdminUserPageQuery = {
  page?: unknown; pageSize?: unknown; search?: unknown; status?: unknown; departmentId?: unknown;
  /** 角色成员视图的上下文约束（服务端强制，不是客户端可删除的 FilterRule）。 */
  roleId?: unknown; filterGroup?: unknown; sortField?: unknown; sortOrder?: unknown;
};

export type AdminUserPage = { rows: Array<Record<string, unknown>>; total: number; page: number; pageSize: number };

@Injectable()
export class AdminQueryService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(RoleGroup) private readonly roleGroups: Repository<RoleGroup>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(OrganizationUnit) private readonly organizationUnits: Repository<OrganizationUnit>
  ) {}

  async listUsers(search?: string) {
    const query = this.users.createQueryBuilder("user").orderBy("user.username", "ASC");
    const value = String(search ?? "").trim();
    if (value) query.andWhere(new Brackets((where) => where
      .where('"user"."username" ILIKE :search', { search: `%${value}%` })
      .orWhere('"user"."employee_no" ILIKE :search', { search: `%${value}%` })
      .orWhere('"user"."display_name" ILIKE :search', { search: `%${value}%` })
      .orWhere('"user"."division" ILIKE :search', { search: `%${value}%` })
      .orWhere('CAST("user"."department_paths" AS text) ILIKE :search', { search: `%${value}%` })));
    const users = await query.getMany();
    const userIds = users.map((user) => user.id);
    const links = userIds.length ? await this.userRoles.createQueryBuilder("link").where("link.userId IN (:...userIds)", { userIds }).getMany() : [];
    const roleIds = [...new Set(links.map((link) => link.roleId))];
    const roles = roleIds.length ? await this.roles.createQueryBuilder("role").where("role.id IN (:...roleIds)", { roleIds }).getMany() : [];
    const roleMap = new Map(roles.map((role) => [role.id, role]));
    return users.map((user) => ({
      id: user.id, username: user.username, displayName: user.displayName, enabled: user.enabled,
      division: user.division, employeeNo: user.employeeNo, wechatUserId: user.wechatUserId, position: user.position,
      alias: user.alias, gender: user.gender, mobile: user.mobile, email: user.email, departmentPaths: user.departmentPaths,
      mustChangePassword: user.mustChangePassword, lastLoginAt: user.lastLoginAt,
      createdBy: user.createdBy, createdAt: user.createdAt, updatedBy: user.updatedBy, updatedAt: user.updatedAt, version: user.version,
      roleIds: links.filter((link) => link.userId === user.id).map((link) => link.roleId),
      roles: links.filter((link) => link.userId === user.id).map((link) => roleMap.get(link.roleId)?.name).filter(Boolean)
    }));
  }

  /** 下拉/成员候选专用：只返回 bounded 展示字段，避免把整表（含敏感字段）暴露给页面。 */
  async listDirectoryOptions() {
    const users = await this.users.find({ order: { displayName: "ASC", username: "ASC" } });
    const links = await this.userRoles.find();
    return users.map((user) => ({
      id: user.id, username: user.username, displayName: user.displayName, enabled: user.enabled,
      employeeNo: user.employeeNo, mobile: user.mobile, departmentPaths: user.departmentPaths,
      roleIds: links.filter((link) => link.userId === user.id).map((link) => link.roleId)
    }));
  }

  async listDirectoryUsers() {
    const users = await this.users.find({ order: { displayName: "ASC", username: "ASC" } });
    return users.map((user) => ({ id: user.id, username: user.username, displayName: user.displayName, enabled: user.enabled }));
  }

  /**
   * KN-FILTER-001：用户管理的服务端列表。
   * 条件顺序固定为 permission（控制器已完成）→ selectedDepartment → status → quick search → FilterGroup，
   * 全部 AND 之后才排序、COUNT、LIMIT/OFFSET；不再整表取回后在前端过滤。
   * 角色成员视图通过服务端强制的 roleId 上下文约束实现，客户端无法移除。
   */
  async listUsersPage(query: AdminUserPageQuery, actor: { isSystemAdmin?: boolean; permissions: string[] }): Promise<AdminUserPage> {
    const requestedPageSize = Number(query.pageSize);
    const pageSize = [20, 50, 100, 200].includes(requestedPageSize) ? requestedPageSize : 50;
    const page = Math.max(Number(query.page) || 1, 1);
    const builder = this.users.createQueryBuilder("row");

    const roleId = String(query.roleId ?? "").trim();
    if (roleId) {
      /* 角色成员 = 直接授予该角色的用户 ∪ 属于该角色授权组织范围的用户（与页面原有语义一致），全部在服务端强制。 */
      const scopeRows: Array<{ organization_unit_id: string }> = await this.users.manager.query(
        "SELECT organization_unit_id FROM role_organization_scopes WHERE role_id = $1", [roleId]
      );
      const units = scopeRows.length ? await this.organizationUnits.find() : [];
      const byId = new Map(units.map((unit) => [unit.id, unit] as const));
      const paths = scopeRows.map((scope) => {
        const path: string[] = [];
        const seen = new Set<string>();
        let current = byId.get(scope.organization_unit_id);
        while (current && !seen.has(current.id)) { seen.add(current.id); path.unshift(current.name); current = current.parentId ? byId.get(current.parentId) : undefined; }
        return path;
      }).filter((path) => path.length);
      const membership = "EXISTS (SELECT 1 FROM user_roles link WHERE link.user_id = row.id AND link.role_id = :contextRoleId)";
      const params: Record<string, unknown> = { contextRoleId: roleId };
      const scopePredicates = paths.map((path, index) => {
        params[`contextRolePath${index}`] = JSON.stringify([path]);
        return `row.department_paths @> :contextRolePath${index}::jsonb`;
      });
      builder.andWhere(scopePredicates.length ? `(${membership} OR ${scopePredicates.join(" OR ")})` : membership, params);
    }
    const departmentId = String(query.departmentId ?? "").trim();
    if (departmentId) {
      const departmentPath = await this.departmentPathOf(departmentId);
      if (!departmentPath.length) return { rows: [], total: 0, page, pageSize };
      builder.andWhere("row.department_paths @> :departmentPath::jsonb", { departmentPath: JSON.stringify([departmentPath]) });
    }
    const status = String(query.status ?? "all");
    if (status === "enabled") builder.andWhere("row.enabled = true");
    if (status === "disabled") builder.andWhere("row.enabled = false");
    const search = String(query.search ?? "").trim();
    if (search) {
      builder.andWhere(new Brackets((where) => where
        .where("row.username ILIKE :search", { search: `%${search}%` })
        .orWhere("row.employee_no ILIKE :search", { search: `%${search}%` })
        .orWhere("row.display_name ILIKE :search", { search: `%${search}%` })
        .orWhere("row.division ILIKE :search", { search: `%${search}%` })
        .orWhere("row.mobile ILIKE :search", { search: `%${search}%` })
        .orWhere("row.email ILIKE :search", { search: `%${search}%` })));
    }
    const fields: TablePermissionFieldDefinition[] = tablePermissionFieldsFor("users");
    applyTypedFilterToQueryBuilder({
      builder, alias: "row", fields, columns: this.usersColumnMap(),
      expressions: { roleIds: `(SELECT COALESCE(jsonb_agg(link.role_id),'[]'::jsonb) FROM user_roles link WHERE link.user_id = row.id)` },
      filterGroup: query.filterGroup,
      canFilterField: (key) => actor.isSystemAdmin === true || actor.permissions.includes("*")
        || actor.permissions.includes(`users:${key}:read`) || actor.permissions.includes(`users:${key}:update`)
        || actor.permissions.includes("users:*:read")
    });
    const sortColumn = USERS_SORT_COLUMNS[String(query.sortField ?? "")];
    builder.orderBy(sortColumn ?? "row.username", String(query.sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC", "NULLS LAST");
    builder.skip((page - 1) * pageSize).take(pageSize);
    const [users, total] = await builder.getManyAndCount();
    return { rows: await this.presentUsers(users), total, page, pageSize };
  }

  /** 字段 key → 真实数据库列（去掉别名，供平台编译器使用）。 */
  private usersColumnMap() {
    return Object.fromEntries(Object.entries(usersFilterColumns("row"))
      .filter(([key]) => key !== "roleIds")
      .map(([key, expression]) => [key, expression.replace(/^row\./, "")])) as Record<string, string>;
  }

  /** 选中部门的完整组织路径（用于 `department_paths @> [...]` 的真实包含匹配）。 */
  private async departmentPathOf(unitId: string) {
    const units = await this.organizationUnits.find();
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const path: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(unitId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id); path.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  }

  /** 只对当前页（≤200 行）补齐角色名称，供列表展示；不参与筛选。 */
  private async presentUsers(users: User[]) {
    const userIds = users.map((user) => user.id);
    const links = userIds.length ? await this.userRoles.createQueryBuilder("link").where("link.userId IN (:...userIds)", { userIds }).getMany() : [];
    const roleIds = [...new Set(links.map((link) => link.roleId))];
    const roles = roleIds.length ? await this.roles.createQueryBuilder("role").where("role.id IN (:...roleIds)", { roleIds }).getMany() : [];
    const roleMap = new Map(roles.map((role) => [role.id, role]));
    return users.map((user) => ({
      id: user.id, username: user.username, displayName: user.displayName, enabled: user.enabled,
      division: user.division, employeeNo: user.employeeNo, wechatUserId: user.wechatUserId, position: user.position,
      alias: user.alias, gender: user.gender, mobile: user.mobile, email: user.email, departmentPaths: user.departmentPaths,
      mustChangePassword: user.mustChangePassword, lastLoginAt: user.lastLoginAt,
      createdBy: user.createdBy, createdAt: user.createdAt, updatedBy: user.updatedBy, updatedAt: user.updatedAt, version: user.version,
      roleIds: links.filter((link) => link.userId === user.id).map((link) => link.roleId),
      roles: links.filter((link) => link.userId === user.id).map((link) => roleMap.get(link.roleId)?.name).filter(Boolean)
    }));
  }

  async listOrganizationUnits() {
    const [units, users] = await Promise.all([
      this.organizationUnits.find({ order: { level: "ASC", sortOrder: "ASC", name: "ASC" } }),
      this.users.find({ order: { displayName: "ASC", username: "ASC" } })
    ]);
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const usersById = new Map(users.map((user) => [user.id, user]));
    const pathOf = (unit: OrganizationUnit) => {
      const path: string[] = [];
      const seen = new Set<string>();
      let current: OrganizationUnit | undefined = unit;
      while (current && !seen.has(current.id)) {
        seen.add(current.id); path.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return path;
    };
    return units.map((unit) => {
      const path = pathOf(unit);
      const leaders = (unit.leaderUserIds ?? []).map((id) => usersById.get(id)).filter((user): user is User => Boolean(user));
      const memberCount = users.filter((user) => user.enabled && (user.departmentPaths ?? []).some((candidate) => candidate.join("\u001f") === path.join("\u001f"))).length;
      return {
        ...unit, path, pathLabel: path.join(" / "), memberCount,
        leaderUsers: leaders.map((user) => ({ id: user.id, displayName: user.displayName, username: user.username, enabled: user.enabled })),
        leaderNames: leaders.map((user) => user.displayName)
      };
    });
  }

  async tablePermissionContext() {
    const [users, roles, roleGroups, organizations] = await Promise.all([
      this.users.find({ order: { displayName: "ASC", username: "ASC" } }),
      this.roles.find({ where: { permissionGroupResource: IsNull(), name: Not("系统管理员") }, order: { name: "ASC" } }),
      this.roleGroups.find({ order: { sortOrder: "ASC", name: "ASC" } }),
      this.listOrganizationUnits()
    ]);
    const roleIds = roles.map((role) => role.id);
    const permissions = roleIds.length ? await this.permissions.createQueryBuilder("permission").where("permission.roleId IN (:...roleIds)", { roleIds }).getMany() : [];
    return {
      users: users.map((user) => ({ id: user.id, username: user.username, displayName: user.displayName, employeeNo: user.employeeNo, enabled: user.enabled, departmentPaths: user.departmentPaths })),
      roles: roles.map((role) => ({ id: role.id, name: role.name, roleGroupId: role.roleGroupId, permissions: permissions.filter((permission) => permission.roleId === role.id) })),
      roleGroups: roleGroups.map((group) => ({ id: group.id, name: group.name })),
      organizations
    };
  }
}
