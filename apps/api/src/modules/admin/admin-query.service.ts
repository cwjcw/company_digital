import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, Repository } from "typeorm";
import { OrganizationUnit, Role, User, UserRole } from "../../entities";

@Injectable()
export class AdminQueryService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
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

  async listDirectoryUsers() {
    const users = await this.users.find({ order: { displayName: "ASC", username: "ASC" } });
    return users.map((user) => ({ id: user.id, username: user.username, displayName: user.displayName, enabled: user.enabled }));
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
}
