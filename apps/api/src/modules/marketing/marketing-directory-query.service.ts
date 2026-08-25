import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { User } from "../../entities";
import type { DirectoryUserOption } from "./marketing.types";

@Injectable()
export class MarketingDirectoryQueryService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

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
}
