import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { OrganizationUnit, User } from "../../entities";
import type { DirectoryOrganizationOption, DirectoryUserOption } from "./marketing.types";
import { createOrganizationMembershipIndex } from "@kdos/permissions";

@Injectable()
export class MarketingDirectoryQueryService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OrganizationUnit) private readonly organizations: Repository<OrganizationUnit>
  ) {}

  async listEnabledUsers(): Promise<DirectoryUserOption[]> {
    const users = await this.users.find({ where: { enabled: true }, order: { displayName: "ASC", username: "ASC" } });
    return users.map((user) => ({ id: user.id, displayName: user.displayName, departmentPaths: user.departmentPaths ?? [], enabled: user.enabled }));
  }

  async findEnabledUsersByIds(ids: string[]): Promise<DirectoryUserOption[]> {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return [];
    const users = await this.users.find({ where: { id: In(uniqueIds), enabled: true } });
    return users.map((user) => ({ id: user.id, displayName: user.displayName, departmentPaths: user.departmentPaths ?? [], enabled: user.enabled }));
  }

  async findUsersByIds(ids: string[]): Promise<DirectoryUserOption[]> {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return [];
    const users = await this.users.find({ where: { id: In(uniqueIds) } });
    return users.map((user) => ({ id: user.id, displayName: user.displayName, departmentPaths: user.departmentPaths ?? [], enabled: user.enabled }));
  }

  async findEnabledUsersInOrganization(organizationId: string): Promise<DirectoryUserOption[]> {
    const [users, units] = await Promise.all([
      this.users.find({ where: { enabled: true }, order: { displayName: "ASC", username: "ASC" } }),
      this.organizations.find({ where: { enabled: true } })
    ]);
    if (!units.some((unit) => unit.id === organizationId)) return [];
    const membership = createOrganizationMembershipIndex(units);
    return users.filter((user) => user.enabled && (user.departmentPaths ?? []).some((path) => membership.departmentPathBelongsTo(path, organizationId)))
      .map((user) => ({ id: user.id, displayName: user.displayName, departmentPaths: user.departmentPaths ?? [], enabled: user.enabled }));
  }

  async resolveEnabledUsersByNames(names: string[]) {
    const normalized = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    if (!normalized.length) return new Map<string, DirectoryUserOption[]>();
    const users = await this.users.createQueryBuilder("user")
      .where("user.enabled = true")
      .andWhere("user.displayName IN (:...names)", { names: normalized })
      .orderBy("user.displayName", "ASC")
      .addOrderBy("user.username", "ASC")
      .getMany();
    const result = new Map<string, DirectoryUserOption[]>();
    for (const user of users) {
      const current = result.get(user.displayName) ?? [];
      current.push({ id: user.id, displayName: user.displayName, departmentPaths: user.departmentPaths ?? [], enabled: user.enabled });
      result.set(user.displayName, current);
    }
    return result;
  }

  async listEnabledOrganizations(): Promise<DirectoryOrganizationOption[]> {
    const units = await this.organizations.find({ where: { enabled: true }, order: { level: "ASC", sortOrder: "ASC", name: "ASC" } });
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const pathOf = (unit: OrganizationUnit) => {
      const path: string[] = []; const seen = new Set<string>(); let current: OrganizationUnit | undefined = unit;
      while (current && !seen.has(current.id)) { seen.add(current.id); path.unshift(current.name); current = current.parentId ? byId.get(current.parentId) : undefined; }
      return path;
    };
    return units.map((unit) => { const path = pathOf(unit); return { id: unit.id, name: unit.name, parentId: unit.parentId, path, pathLabel: path.join(" / "), enabled: unit.enabled }; });
  }
}
