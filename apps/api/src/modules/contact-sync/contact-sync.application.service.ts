import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { DataSource, In, Repository } from "typeorm";
import { ApiKey, AuditLog, Contact, OrganizationUnit, RefreshToken, Role, RoleOrganizationScope, User, UserRole } from "../../entities";
import { currentModificationActor, currentModificationActorId } from "../../modification-audit";
import { DEFAULT_USER_PASSWORD, isPrimaryAdminUsername } from "../../user-defaults";
import type { WecomContactSnapshot, WecomDepartmentSnapshot, WecomSyncPayload } from "./contact-sync.types";

type SyncActor = { userId: string; name: string; requestId: string; source: string };

const pathKey = (path: string[]) => path.map((part) => part.trim()).filter(Boolean).join("\u001f");
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const ignoredPath = (path: string[]) => path[0] === "其他" || path[1] === "其他";

@Injectable()
export class ContactSyncApplicationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(OrganizationUnit) private readonly organizations: Repository<OrganizationUnit>,
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>
  ) {}

  async snapshot() {
    const [users, contacts, organizations] = await Promise.all([
      this.users.find({ order: { username: "ASC" } }),
      this.contacts.find({ order: { wechatUserId: "ASC" } }),
      this.organizations.find({ order: { level: "ASC", sortOrder: "ASC", name: "ASC" } })
    ]);
    return {
      capturedAt: new Date().toISOString(),
      users: users.map((user) => { const safe: Partial<User> = { ...user }; delete safe.passwordHash; return safe; }),
      contacts,
      organizations
    };
  }

  private normalize(payload: WecomSyncPayload) {
    if (!payload || !Array.isArray(payload.departments) || !Array.isArray(payload.contacts)) throw new BadRequestException("企业微信同步快照格式无效");
    const departments = payload.departments
      .map((entry, index) => ({
        externalId: String(entry.externalId ?? "").trim(), name: String(entry.name ?? "").trim(),
        parentExternalId: entry.parentExternalId == null ? null : String(entry.parentExternalId).trim() || null,
        path: (entry.path ?? []).map(String).map((part) => part.trim()).filter(Boolean), sortOrder: Number(entry.sortOrder ?? index)
      }))
      .filter((entry) => entry.externalId && entry.name && entry.path.length && !ignoredPath(entry.path));
    const departmentIds = new Set(departments.map((entry) => entry.externalId));
    for (const department of departments) if (department.parentExternalId && !departmentIds.has(department.parentExternalId)) department.parentExternalId = null;
    const contacts = payload.contacts.map((entry) => ({
      ...entry,
      wechatUserId: String(entry.wechatUserId ?? "").trim(), employeeNo: String(entry.employeeNo ?? "").trim() || null,
      name: String(entry.name ?? "").trim(), position: String(entry.position ?? "").trim() || null,
      telephone: String(entry.telephone ?? "").trim() || null, mobile: String(entry.mobile ?? "").trim() || null,
      email: String(entry.email ?? "").trim() || null, alias: String(entry.alias ?? "").trim() || null,
      gender: String(entry.gender ?? "").trim() || null,
      directLeaders: [...new Set((entry.directLeaders ?? []).map(String).filter(Boolean))],
      departmentLeaderExternalIds: [...new Set((entry.departmentLeaderExternalIds ?? []).map(String).filter((id) => departmentIds.has(String(id))))],
      departmentPaths: [...new Map((entry.departmentPaths ?? []).map((path) => {
        const normalized = path.map(String).map((part) => part.trim()).filter(Boolean);
        return [pathKey(normalized), normalized] as const;
      })).values()].filter((path) => path.length && !ignoredPath(path)),
      enabled: Boolean(entry.enabled)
    })).filter((entry) => entry.wechatUserId && entry.name && entry.departmentPaths.length);
    const duplicate = contacts.find((entry, index) => contacts.findIndex((candidate) => candidate.wechatUserId === entry.wechatUserId) !== index);
    if (duplicate) throw new BadRequestException(`企业微信快照包含重复成员：${duplicate.wechatUserId}`);
    return { departments, contacts };
  }

  private async preview(departments: WecomDepartmentSnapshot[], contacts: WecomContactSnapshot[]) {
    const [localUsers, localContacts, localOrganizations] = await Promise.all([this.users.find(), this.contacts.find(), this.organizations.find()]);
    const incomingIds = new Set(contacts.map((entry) => entry.wechatUserId));
    const incomingEmployeeNos = new Set(contacts.map((entry) => entry.employeeNo).filter(Boolean));
    const matchedUsers = localUsers.filter((user) => incomingIds.has(user.wechatUserId ?? "") || incomingEmployeeNos.has(user.employeeNo) || incomingEmployeeNos.has(user.username));
    const managedUsers = localUsers.filter((user) => user.enabled && !isPrimaryAdminUsername(user.username) && (user.wechatUserId || user.employeeNo));
    const organizationById = new Map(localOrganizations.map((entry) => [entry.id, entry]));
    const organizationPath = (unit: OrganizationUnit) => {
      const path: string[] = []; let cursor: OrganizationUnit | undefined = unit; const seen = new Set<string>();
      while (cursor && !seen.has(cursor.id)) { seen.add(cursor.id); path.unshift(cursor.name); cursor = cursor.parentId ? organizationById.get(cursor.parentId) : undefined; }
      return pathKey(path);
    };
    const desiredDepartmentIds = new Set(departments.map((entry) => entry.externalId));
    const desiredPaths = new Set(departments.map((entry) => pathKey(entry.path)));
    if (localContacts.filter((entry) => entry.enabled).length >= 50 && contacts.length < localContacts.filter((entry) => entry.enabled).length * 0.5) {
      throw new BadRequestException("企业微信返回人数不足本地在职通讯录的 50%，为防止错误批量离职，本次同步已终止");
    }
    return {
      incomingDepartments: departments.length,
      incomingContacts: contacts.length,
      organizationAdds: departments.filter((entry) => !localOrganizations.some((local) => local.wechatDepartmentId === entry.externalId || organizationPath(local) === pathKey(entry.path))).length,
      organizationDeletes: localOrganizations.filter((entry) => !(entry.wechatDepartmentId && desiredDepartmentIds.has(entry.wechatDepartmentId)) && !desiredPaths.has(organizationPath(entry))).length,
      contactAdds: contacts.filter((entry) => !localContacts.some((local) => local.wechatUserId === entry.wechatUserId)).length,
      contactDepartures: localContacts.filter((entry) => entry.enabled && !incomingIds.has(entry.wechatUserId)).length,
      userAdds: contacts.length - matchedUsers.length,
      userDepartures: managedUsers.filter((user) => !incomingIds.has(user.wechatUserId ?? "") && !incomingEmployeeNos.has(user.employeeNo)).length
    };
  }

  async sync(payload: WecomSyncPayload, actor: SyncActor, dryRun = false) {
    const normalized = this.normalize(payload);
    const preview = await this.preview(normalized.departments, normalized.contacts);
    if (dryRun) return { dryRun: true, ...preview };
    return this.dataSource.transaction(async (manager) => {
      const existingOrganizations = await manager.find(OrganizationUnit, { order: { level: "ASC", sortOrder: "ASC" } });
      const existingByExternalId = new Map(existingOrganizations.filter((entry) => entry.wechatDepartmentId).map((entry) => [entry.wechatDepartmentId!, entry]));
      const existingByPath = new Map<string, OrganizationUnit>();
      const existingById = new Map(existingOrganizations.map((entry) => [entry.id, entry]));
      const currentPath = (unit: OrganizationUnit) => {
        const result: string[] = []; let cursor: OrganizationUnit | undefined = unit; const seen = new Set<string>();
        while (cursor && !seen.has(cursor.id)) { seen.add(cursor.id); result.unshift(cursor.name); cursor = cursor.parentId ? existingById.get(cursor.parentId) : undefined; }
        return result;
      };
      for (const unit of existingOrganizations) existingByPath.set(pathKey(currentPath(unit)), unit);
      const desiredByExternalId = new Map<string, OrganizationUnit>();
      let organizationAdds = 0; let organizationUpdates = 0;
      for (const department of [...normalized.departments].sort((left, right) => left.path.length - right.path.length || left.sortOrder - right.sortOrder)) {
        const parent = department.parentExternalId ? desiredByExternalId.get(department.parentExternalId) : undefined;
        let unit = existingByExternalId.get(department.externalId) ?? existingByPath.get(pathKey(department.path));
        if (!unit) {
          unit = manager.create(OrganizationUnit, { wechatDepartmentId: department.externalId, name: department.name, level: department.path.length, parentId: parent?.id ?? null, division: department.path.find((part) => part.includes("事业部")) ?? null, sortOrder: department.sortOrder, enabled: true });
          organizationAdds++;
        } else {
          const changed = unit.wechatDepartmentId !== department.externalId || unit.name !== department.name || unit.parentId !== (parent?.id ?? null) || unit.level !== department.path.length || unit.sortOrder !== department.sortOrder || !unit.enabled;
          unit.wechatDepartmentId = department.externalId; unit.name = department.name; unit.parentId = parent?.id ?? null;
          unit.level = department.path.length; unit.division = department.path.find((part) => part.includes("事业部")) ?? null; unit.sortOrder = department.sortOrder; unit.enabled = true;
          if (changed) organizationUpdates++;
        }
        unit = await manager.save(unit);
        desiredByExternalId.set(department.externalId, unit);
      }
      const desiredOrganizationIds = new Set([...desiredByExternalId.values()].map((entry) => entry.id));
      const obsoleteOrganizations = existingOrganizations.filter((entry) => !desiredOrganizationIds.has(entry.id)).sort((left, right) => right.level - left.level);
      if (obsoleteOrganizations.length) {
        const ids = obsoleteOrganizations.map((entry) => entry.id);
        await manager.delete(RoleOrganizationScope, { organizationUnitId: In(ids) });
        for (const organization of obsoleteOrganizations) await manager.delete(OrganizationUnit, organization.id);
      }

      const [localContacts, localUsers, whiteboard] = await Promise.all([
        manager.find(Contact), manager.find(User), manager.findOneBy(Role, { name: "白板" })
      ]);
      const contactByWechatId = new Map(localContacts.map((entry) => [entry.wechatUserId, entry]));
      const userByWechatId = new Map(localUsers.filter((entry) => entry.wechatUserId).map((entry) => [entry.wechatUserId!, entry]));
      const userByEmployeeNo = new Map(localUsers.filter((entry) => entry.employeeNo).map((entry) => [entry.employeeNo!, entry]));
      const userByUsername = new Map(localUsers.map((entry) => [entry.username, entry]));
      const incomingIds = new Set(normalized.contacts.map((entry) => entry.wechatUserId));
      const incomingEmployeeNos = new Set(normalized.contacts.map((entry) => entry.employeeNo).filter(Boolean));
      let contactAdds = 0; let contactUpdates = 0; let userAdds = 0; let userUpdates = 0;
      for (const incoming of normalized.contacts) {
        let contact = contactByWechatId.get(incoming.wechatUserId);
        if (!contact) { contact = manager.create(Contact, { wechatUserId: incoming.wechatUserId }); contactAdds++; }
        else if (!sameJson([contact.employeeNo, contact.name, contact.position, contact.telephone, contact.directLeaders, contact.departmentPaths, contact.enabled], [incoming.employeeNo, incoming.name, incoming.position, incoming.telephone, incoming.directLeaders, incoming.departmentPaths, incoming.enabled])) contactUpdates++;
        Object.assign(contact, { employeeNo: incoming.employeeNo, name: incoming.name, position: incoming.position, telephone: incoming.telephone, directLeaders: incoming.directLeaders, departmentPaths: incoming.departmentPaths, enabled: incoming.enabled });
        await manager.save(contact);

        let user = userByWechatId.get(incoming.wechatUserId) ?? (incoming.employeeNo ? userByEmployeeNo.get(incoming.employeeNo) ?? userByUsername.get(incoming.employeeNo) : undefined) ?? userByUsername.get(incoming.wechatUserId);
        if (!user) {
          const username = incoming.employeeNo ?? incoming.wechatUserId;
          if (isPrimaryAdminUsername(username)) continue;
          user = manager.create(User, { username, displayName: incoming.name, passwordHash: await bcrypt.hash(DEFAULT_USER_PASSWORD, 12), mustChangePassword: true, lastLoginAt: null });
          userAdds++;
        } else if (!sameJson([user.displayName, user.enabled, user.employeeNo, user.wechatUserId, user.position, user.departmentPaths, user.mobile, user.email, user.alias, user.gender], [incoming.name, incoming.enabled, incoming.employeeNo, incoming.wechatUserId, incoming.position, incoming.departmentPaths, incoming.mobile, incoming.email, incoming.alias, incoming.gender])) userUpdates++;
        Object.assign(user, { displayName: incoming.name, enabled: incoming.enabled, employeeNo: incoming.employeeNo, wechatUserId: incoming.wechatUserId, position: incoming.position, departmentPaths: incoming.departmentPaths, division: incoming.departmentPaths.flat().find((part) => part.includes("事业部")) ?? null, mobile: incoming.mobile ?? incoming.telephone, email: incoming.email, alias: incoming.alias, gender: incoming.gender });
        const wasNew = !user.id;
        user = await manager.save(user);
        if (wasNew && whiteboard) await manager.createQueryBuilder().insert().into(UserRole).values({ userId: user.id, roleId: whiteboard.id }).orIgnore().execute();
      }

      const synchronizedUsers = await manager.find(User);
      const synchronizedUserByWechatId = new Map(synchronizedUsers.filter((user) => user.wechatUserId).map((user) => [user.wechatUserId!, user]));
      let organizationLeaderUpdates = 0;
      for (const [externalId, organization] of desiredByExternalId) {
        const leaderUserIds = normalized.contacts
          .filter((contact) => contact.enabled && contact.departmentLeaderExternalIds.includes(externalId))
          .map((contact) => synchronizedUserByWechatId.get(contact.wechatUserId)?.id)
          .filter((id): id is string => Boolean(id))
          .filter((id, index, ids) => ids.indexOf(id) === index)
          .sort();
        const currentLeaderUserIds = [...(organization.leaderUserIds ?? [])].sort();
        if (!sameJson(currentLeaderUserIds, leaderUserIds)) {
          organization.leaderUserIds = leaderUserIds;
          await manager.save(organization);
          organizationLeaderUpdates += 1;
        }
      }

      const departedContacts = localContacts.filter((entry) => entry.enabled && !incomingIds.has(entry.wechatUserId));
      for (const contact of departedContacts) { contact.enabled = false; await manager.save(contact); }
      const departedUsers = localUsers.filter((user) => user.enabled && !isPrimaryAdminUsername(user.username) && (user.wechatUserId || user.employeeNo) && !incomingIds.has(user.wechatUserId ?? "") && !incomingEmployeeNos.has(user.employeeNo));
      for (const user of departedUsers) { user.enabled = false; await manager.save(user); }
      if (departedUsers.length) await manager.update(RefreshToken, { userId: In(departedUsers.map((entry) => entry.id)), revokedAt: null }, { revokedAt: new Date() });

      const result = { dryRun: false, ...preview, organizationAdds, organizationUpdates, organizationLeaderUpdates, organizationDeletes: obsoleteOrganizations.length, contactAdds, contactUpdates, contactDepartures: departedContacts.length, userAdds, userUpdates, userDepartures: departedUsers.length };
      await manager.save(AuditLog, { actorId: actor.userId, actorName: actor.name, resource: "contacts", recordId: null, action: "wecom.full_sync", beforeJson: { localContacts: localContacts.length, localUsers: localUsers.length, localOrganizations: existingOrganizations.length }, afterJson: { ...result, capturedAt: payload.capturedAt, sourceHash: payload.sourceHash }, requestId: actor.requestId, source: actor.source });
      return result;
    });
  }

  async provisionApiKey() {
    const adminRole = await this.roles.findOneBy({ name: "系统管理员" });
    if (!adminRole) throw new Error("系统管理员角色不存在");
    const links = await this.userRoles.findBy({ roleId: adminRole.id });
    const candidates = links.length ? await this.users.findBy({ id: In(links.map((entry) => entry.userId)), enabled: true }) : [];
    const user = candidates.find((entry) => isPrimaryAdminUsername(entry.username)) ?? candidates[0];
    if (!user) throw new Error("没有可用于通讯录同步的在职系统管理员账号");
    const secret = `fdt_${randomBytes(32).toString("base64url")}`;
    const existing = await this.apiKeys.findOneBy({ name: "企业微信通讯录同步" });
    const record = existing ?? this.apiKeys.create({ name: "企业微信通讯录同步", expiresAt: null, lastUsedAt: null, enabled: true });
    Object.assign(record, { keyHash: createHash("sha256").update(secret).digest("hex"), scopes: ["contacts:*:read", "contacts:*:import", "contacts:*:export"], userId: user.id, roleId: adminRole.id, enabled: true, lastUsedAt: null });
    await this.apiKeys.save(record);
    await this.dataSource.getRepository(AuditLog).save({ actorId: currentModificationActorId() ?? user.id, actorName: currentModificationActor(), resource: "api-keys", recordId: record.id, action: "wecom.sync_key.provisioned", beforeJson: null, afterJson: { name: record.name, userId: user.id, scopes: record.scopes }, requestId: "contact-sync-provision", source: "api" });
    return { apiKey: secret, id: record.id };
  }
}
