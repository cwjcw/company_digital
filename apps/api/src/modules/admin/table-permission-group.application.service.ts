import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager, In, IsNull, Not } from "typeorm";
import {
  presetPermissionGroupTypes, presetTablePermissionDataScope, presetTablePermissionMatrix,
  tablePermissionActions, tablePermissionFieldsFor, tableResourceRegistry,
  type PresetPermissionGroupType, type TablePermissionAction, type TableResourceCode
} from "@kdos/contracts";
import { AuditLog, OrganizationUnit, Permission, PermissionGroupSubject, Role, User } from "../../entities";

export type PermissionSubjectInput = { type: "USER" | "ORGANIZATION" | "ROLE"; id: string };
type FieldInput = { fieldKey: string; visible: boolean; editable: boolean };
type RuleInput = { fieldKey: string; operator: string; value: unknown };
export type TablePermissionGroupInput = {
  resource: string;
  groupType: PresetPermissionGroupType | "CUSTOM";
  displayName?: string;
  description?: string;
  enabled?: boolean;
  actions?: TablePermissionAction[];
  fields?: FieldInput[];
  dataMatch?: "ALL" | "ANY";
  dataRules?: RuleInput[];
  subjects?: PermissionSubjectInput[];
};
type Actor = { userId: string | null; name: string; requestId: string };

const presetNames: Record<PresetPermissionGroupType, string> = {
  ADD_ONLY: "仅添加数据", ADD_MANAGE_OWN: "添加并管理本人数据", ADD_VIEW_ALL: "添加并查看全部数据",
  MANAGE_ALL: "管理全部数据", VIEW_ALL: "查看全部数据"
};
const dependentActions: TablePermissionAction[] = ["copy", "update", "delete", "batch_update", "export"];
const operators = new Set(["EQ", "NE", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN", "IS_EMPTY", "IS_NOT_EMPTY"]);

@Injectable()
export class TablePermissionGroupApplicationService {
  constructor(private readonly dataSource: DataSource) {}

  private resource(code: string): TableResourceCode {
    if (!tableResourceRegistry.some((item) => item.code === code)) throw new BadRequestException("表单资源不存在");
    return code as TableResourceCode;
  }

  async list(resourceInput: string) {
    const resource = this.resource(resourceInput);
    const roles = await this.dataSource.getRepository(Role).find({ where: { permissionGroupResource: resource }, order: { createdAt: "ASC" } });
    if (!roles.length) return [];
    const ids = roles.map((role) => role.id);
    const [permissions, subjects] = await Promise.all([
      this.dataSource.getRepository(Permission).findBy({ roleId: In(ids) }),
      this.dataSource.getRepository(PermissionGroupSubject).findBy({ roleId: In(ids) })
    ]);
    return roles.map((role) => ({
      id: role.id, resource, groupType: role.permissionGroupType, displayName: role.permissionGroupDisplayName,
      description: role.description, enabled: role.permissionGroupEnabled, dataScope: role.permissionGroupScope,
      dataMatch: role.permissionGroupConditionMatch, dataRules: role.permissionGroupDataRules,
      permissions: permissions.filter((permission) => permission.roleId === role.id),
      subjects: subjects.filter((subject) => subject.roleId === role.id).map((subject) => ({ type: subject.subjectType, id: subject.subjectId })),
      createdAt: role.createdAt, createdBy: role.createdBy, updatedAt: role.updatedAt, updatedBy: role.updatedBy, version: role.version
    }));
  }

  async resourceForGroup(id: string) {
    const role = await this.dataSource.getRepository(Role).findOneBy({ id });
    if (!role?.permissionGroupResource) throw new NotFoundException("权限组不存在");
    return this.resource(role.permissionGroupResource);
  }

  private actions(input: TablePermissionGroupInput): TablePermissionAction[] {
    if (input.groupType !== "CUSTOM") {
      const presetType: PresetPermissionGroupType = input.groupType;
      return tablePermissionActions.filter((action) => presetTablePermissionMatrix[presetType][action]);
    }
    const values = [...new Set(input.actions ?? [])].filter((action): action is TablePermissionAction => tablePermissionActions.includes(action));
    if (!values.length) throw new BadRequestException("至少选择一个操作权限");
    if (!values.includes("read") && values.some((action) => dependentActions.includes(action))) throw new BadRequestException("复制、编辑、删除、批量修改和导出依赖查看权限");
    return values;
  }

  private fields(resource: TableResourceCode, input: TablePermissionGroupInput, actions: TablePermissionAction[]) {
    if (input.groupType !== "CUSTOM") return tablePermissionFieldsFor(resource).map((field) => ({ fieldKey: field.key, visible: actions.includes("read"), editable: actions.includes("update") && field.editable }));
    const definitions = new Map(tablePermissionFieldsFor(resource).map((field) => [field.key, field]));
    const values = [...new Map((input.fields ?? []).map((field) => [field.fieldKey, field])).values()].map((field) => {
      const definition = definitions.get(field.fieldKey);
      if (!definition) throw new BadRequestException(`未知字段：${field.fieldKey}`);
      if (field.editable && (!field.visible || !definition.editable)) throw new BadRequestException(`${definition.label}不能设置为可编辑`);
      return { fieldKey: field.fieldKey, visible: Boolean(field.visible), editable: Boolean(field.editable) };
    });
    if (actions.includes("read") && !values.some((field) => field.visible)) throw new BadRequestException("拥有查看权限时至少选择一个可见字段");
    if (actions.includes("update") && !values.some((field) => field.editable)) throw new BadRequestException("拥有编辑权限时至少选择一个可编辑字段");
    return values;
  }

  private rules(resource: TableResourceCode, input: TablePermissionGroupInput) {
    if (input.groupType !== "CUSTOM") return [];
    const definitions = new Map(tablePermissionFieldsFor(resource).map((field) => [field.key, field]));
    return (input.dataRules ?? []).map((rule) => {
      const definition = definitions.get(rule.fieldKey);
      if (!definition) throw new BadRequestException(`数据权限包含未知字段：${rule.fieldKey}`);
      if (!operators.has(rule.operator)) throw new BadRequestException(`${definition.label}的数据权限运算符无效`);
      if (!["IS_EMPTY", "IS_NOT_EMPTY"].includes(rule.operator) && (rule.value === undefined || rule.value === null || rule.value === "")) throw new BadRequestException(`${definition.label}的数据权限条件值不能为空`);
      if (rule.value === "CURRENT_USER_MANAGED_DEPARTMENTS" && definition.type !== "department") throw new BadRequestException("当前用户负责部门只能用于部门字段");
      if (rule.value === "CURRENT_USER" && definition.type !== "member") throw new BadRequestException("当前用户只能用于成员字段");
      return { fieldKey: rule.fieldKey, operator: rule.operator, value: rule.value, fieldType: definition.type };
    });
  }

  private async subjects(manager: EntityManager, input: PermissionSubjectInput[]) {
    const values = [...new Map(input.map((subject) => [`${subject.type}:${subject.id}`, subject])).values()];
    if (!values.length) throw new BadRequestException("请至少选择一个部门、角色或成员");
    for (const type of ["USER", "ORGANIZATION", "ROLE"] as const) {
      const ids = values.filter((value) => value.type === type).map((value) => value.id);
      if (!ids.length) continue;
      const entity = type === "USER" ? User : type === "ORGANIZATION" ? OrganizationUnit : Role;
      const found = await manager.count(entity, { where: { id: In(ids), ...(type === "ROLE" ? { permissionGroupResource: IsNull() } : {}) } as never });
      if (found !== ids.length) throw new BadRequestException(`${type === "USER" ? "成员" : type === "ORGANIZATION" ? "部门" : "角色"}选择中包含无效数据`);
    }
    return values;
  }

  private permission(resource: string, fieldKey: string, actions: TablePermissionAction[] = [], visible = false, editable = false) {
    const enabled = new Set(actions);
    return {
      resource, fieldKey, read: fieldKey === "*" ? enabled.has("read") : visible,
      create: fieldKey === "*" && enabled.has("create"), copy: fieldKey === "*" && enabled.has("copy"),
      update: fieldKey === "*" ? enabled.has("update") : editable, delete: fieldKey === "*" && enabled.has("delete"),
      batchPrint: fieldKey === "*" && enabled.has("batch_print"), batchUpdate: fieldKey === "*" && enabled.has("batch_update"),
      import: fieldKey === "*" && enabled.has("import"), export: fieldKey === "*" && enabled.has("export")
    };
  }

  private async replaceConfiguration(manager: EntityManager, role: Role, input: TablePermissionGroupInput, actor: Actor) {
    const resource = this.resource(role.permissionGroupResource!);
    const actions = this.actions(input);
    const fields = this.fields(resource, input, actions);
    const rules = this.rules(resource, input);
    role.permissionGroupConditionMatch = input.dataMatch === "ANY" ? "ANY" : "ALL";
    role.permissionGroupDataRules = rules;
    role.permissionGroupScope = input.groupType === "CUSTOM" ? (rules.length ? "CUSTOM" : "ALL") : presetTablePermissionDataScope[input.groupType];
    role.updatedBy = actor.userId ?? "system";
    role.version += 1;
    // `manager.save(entity)` relies on the value being a class instance. Newly
    // created roles are returned as plain objects by TypeORM, so always provide
    // the entity target explicitly inside this transaction.
    await manager.save(Role, role);
    await manager.delete(Permission, { roleId: role.id });
    await manager.save(Permission, { roleId: role.id, ...this.permission(resource, "*", actions) });
    for (const field of fields) if (field.visible || field.editable) await manager.save(Permission, { roleId: role.id, ...this.permission(resource, field.fieldKey, [], field.visible, field.editable) });
  }

  async create(input: TablePermissionGroupInput, actor: Actor) {
    const resource = this.resource(input.resource);
    if (![...presetPermissionGroupTypes, "CUSTOM"].includes(input.groupType)) throw new BadRequestException("权限类型无效");
    return this.dataSource.transaction(async (manager) => {
      const selected = await this.subjects(manager, input.subjects ?? []);
      let role = input.groupType === "CUSTOM" ? null : await manager.findOneBy(Role, { permissionGroupResource: resource, permissionGroupType: input.groupType });
      if (!role) {
        const displayName = input.groupType === "CUSTOM" ? String(input.displayName ?? "").trim() : presetNames[input.groupType];
        if (!displayName) throw new BadRequestException("权限组名称不能为空");
        if (input.groupType === "CUSTOM" && await manager.findOneBy(Role, { permissionGroupResource: resource, permissionGroupDisplayName: displayName })) throw new ConflictException("当前表单已存在同名权限组");
        role = await manager.save(Role, {
          name: `__table_permission__:${randomUUID()}`, description: input.groupType === "CUSTOM" ? String(input.description ?? "").trim() || null : null,
          roleGroupId: null, permissionGroupResource: resource, permissionGroupType: input.groupType,
          permissionGroupDisplayName: displayName, permissionGroupEnabled: true,
          permissionGroupScope: input.groupType === "CUSTOM" ? "ALL" : presetTablePermissionDataScope[input.groupType],
          permissionGroupConditionMatch: "ALL", permissionGroupDataRules: [], createdBy: actor.userId, updatedBy: actor.userId ?? "system"
        });
        await this.replaceConfiguration(manager, role, input, actor);
      }
      for (const subject of selected) await manager.createQueryBuilder().insert().into(PermissionGroupSubject).values({ roleId: role.id, subjectType: subject.type, subjectId: subject.id, createdBy: actor.userId, updatedBy: actor.userId ?? "system" }).orIgnore().execute();
      await manager.save(AuditLog, { actorId: actor.userId, actorName: actor.name, resource: `permissions:${resource}`, recordId: role.id, action: "table_permission_group.created_or_members_added", beforeJson: null, afterJson: { groupType: role.permissionGroupType, displayName: role.permissionGroupDisplayName, subjects: selected }, requestId: actor.requestId, source: "web" });
      return role;
    });
  }

  async update(id: string, input: Partial<TablePermissionGroupInput> & { version?: number }, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const role = await manager.findOneBy(Role, { id, permissionGroupResource: Not(IsNull()) });
      if (!role) throw new NotFoundException("权限组不存在");
      if (input.version !== undefined && role.version !== input.version) throw new ConflictException({ message: "权限组已被其他管理员修改，请刷新后重试", currentVersion: role.version });
      const before = { ...role };
      if (input.subjects) {
        const selected = await this.subjects(manager, input.subjects);
        await manager.delete(PermissionGroupSubject, { roleId: id });
        for (const subject of selected) await manager.save(PermissionGroupSubject, { roleId: id, subjectType: subject.type, subjectId: subject.id, createdBy: actor.userId, updatedBy: actor.userId ?? "system" });
      }
      role.permissionGroupEnabled = input.enabled ?? role.permissionGroupEnabled;
      if (input.displayName !== undefined) {
        const displayName = input.displayName.trim();
        if (!displayName) throw new BadRequestException("权限组名称不能为空");
        role.permissionGroupDisplayName = displayName;
      }
      if (role.permissionGroupType === "CUSTOM") {
        const changesConfiguration = input.actions !== undefined || input.fields !== undefined || input.dataRules !== undefined || input.dataMatch !== undefined || input.description !== undefined;
        if (changesConfiguration) {
          const currentPermissions = await manager.find(Permission, { where: { roleId: id } });
          const currentOperation = currentPermissions.find((permission) => permission.fieldKey === "*");
          const currentActions = currentOperation ? tablePermissionActions.filter((action) => Boolean(currentOperation[action === "batch_print" ? "batchPrint" : action === "batch_update" ? "batchUpdate" : action as keyof Permission])) : [];
          const currentFields = currentPermissions.filter((permission) => permission.fieldKey !== "*").map((permission) => ({ fieldKey: permission.fieldKey, visible: permission.read, editable: permission.update }));
          role.description = input.description === undefined ? role.description : input.description.trim() || null;
          await this.replaceConfiguration(manager, role, { ...input, resource: role.permissionGroupResource!, groupType: "CUSTOM", actions: input.actions ?? currentActions, fields: input.fields ?? currentFields, dataRules: input.dataRules ?? role.permissionGroupDataRules as RuleInput[], dataMatch: input.dataMatch ?? role.permissionGroupConditionMatch as "ALL" | "ANY", subjects: input.subjects ?? [] } as TablePermissionGroupInput, actor);
        } else { role.updatedBy = actor.userId ?? "system"; role.version += 1; await manager.save(Role, role); }
      } else {
        role.updatedBy = actor.userId ?? "system"; role.version += 1; await manager.save(Role, role);
      }
      await manager.save(AuditLog, { actorId: actor.userId, actorName: actor.name, resource: `permissions:${role.permissionGroupResource}`, recordId: id, action: "table_permission_group.updated", beforeJson: before, afterJson: role, requestId: actor.requestId, source: "web" });
      return role;
    });
  }

  async delete(id: string, actor: Actor) {
    return this.dataSource.transaction(async (manager) => {
      const role = await manager.findOneBy(Role, { id, permissionGroupResource: Not(IsNull()) });
      if (!role) throw new NotFoundException("权限组不存在");
      await manager.delete(Role, { id });
      await manager.save(AuditLog, { actorId: actor.userId, actorName: actor.name, resource: `permissions:${role.permissionGroupResource}`, recordId: id, action: "table_permission_group.deleted", beforeJson: role, afterJson: null, requestId: actor.requestId, source: "web" });
      return { deleted: true };
    });
  }
}
