import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { MARKETING_REPOSITORY, type MarketingRepository } from "./marketing.repository";
import { MarketingDirectoryQueryService } from "./marketing-directory-query.service";
import type { BusinessCustomerMappingInput, DirectoryOrganizationOption, MappingImportSummary, MarketingActor, OrderScheduleInput, ResolvedBusinessCustomerMappingInput } from "./marketing.types";

type MarketingResource = "business-customer-mapping" | "order-schedule";
type MarketingAction = "read" | "create" | "update" | "delete" | "import" | "export";
type MarketingPageInput = { page?: number; pageSize?: number; search?: string; filters?: Record<string, string>; sortField?: string; sortOrder?: string; completion?: string; dueStart?: string; dueEnd?: string; exactOrderNumber?: string };

@Injectable()
export class MarketingApplicationService {
  constructor(
    @Inject(MARKETING_REPOSITORY) private readonly repository: MarketingRepository,
    private readonly directory: MarketingDirectoryQueryService
  ) {}

  private hasAction(actor: MarketingActor, resource: MarketingResource, action: MarketingAction) {
    return actor.permissions.includes("*") || actor.permissions.includes(`${resource}:*:${action}`);
  }

  private assert(actor: MarketingActor, resource: MarketingResource, action: MarketingAction) {
    if (this.hasAction(actor, resource, action)) return;
    throw new ForbiddenException("当前权限组没有此表的操作权限");
  }

  private text(value: unknown, label: string) {
    const result = String(value ?? "").trim();
    if (!result) throw new BadRequestException(`${label}不能为空`);
    return result;
  }

  private mappingBase(input: BusinessCustomerMappingInput) {
    const salespersonUserIds = [...new Set(Array.isArray(input.salespersonUserIds) ? input.salespersonUserIds.map(String) : [])];
    if (salespersonUserIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      throw new BadRequestException("业务员字段包含无效用户 ID");
    }
    return {
      departmentId: input.departmentId ? String(input.departmentId) : null,
      department: String(input.department ?? "").trim(),
      section: String(input.section ?? "").trim(),
      customerCode: this.text(input.customerCode, "客户"),
      salespersonUserIds
    };
  }

  private resolveMappings(inputs: BusinessCustomerMappingInput[], organizations: DirectoryOrganizationOption[]): ResolvedBusinessCustomerMappingInput[] {
    const byId = new Map(organizations.map((organization) => [organization.id, organization]));
    const byText = (value: string) => organizations.filter((organization) => organization.name === value || organization.pathLabel === value || organization.path.join("/") === value);
    return inputs.map((input) => {
      const base = this.mappingBase(input);
      const departments = base.departmentId ? [byId.get(base.departmentId)].filter((value): value is DirectoryOrganizationOption => Boolean(value)) : byText(base.department);
      if (!departments.length) throw new BadRequestException(`部门“${base.department || base.departmentId}”不在企业微信组织架构中`);
      if (departments.length > 1) throw new BadRequestException({ message: "部门名称存在重名，请在界面选择完整组织路径", candidates: departments.map((department) => department.pathLabel) });
      const selected = departments[0]!;
      return { ...base, departmentId: selected.id, department: selected.name };
    });
  }

  private applyDataScope<T extends Record<string, unknown>>(rows: T[], actor: MarketingActor, resource: MarketingResource, action = "read"): T[] {
    if (actor.permissions.includes("*")) return rows;
    const scopes = (actor.tableDataScopes ?? []).filter((scope) => scope.resource === resource && (!scope.actions || scope.actions.includes(action)));
    if (!scopes.length || scopes.some((scope) => scope.scope === "ALL")) return rows;
    const compare = (row: T, rule: { fieldKey: string; operator: string; value: unknown }) => {
      const actual = row[rule.fieldKey];
      const expected = rule.value === "CURRENT_USER_MANAGED_DEPARTMENTS" ? (actor.managedOrganizationUnitIds ?? [])
        : rule.value === "CURRENT_USER" ? actor.userId : rule.value;
      const values = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
      const actualValues = Array.isArray(actual) ? actual.map(String) : null;
      if (rule.operator === "IS_EMPTY") return actual === null || actual === undefined || actual === "";
      if (rule.operator === "IS_NOT_EMPTY") return actual !== null && actual !== undefined && actual !== "";
      if (rule.operator === "EQ" || rule.operator === "IN") return actualValues ? actualValues.some((value) => values.includes(value)) : values.includes(String(actual ?? ""));
      if (rule.operator === "NE" || rule.operator === "NOT_IN") return actualValues ? actualValues.every((value) => !values.includes(value)) : !values.includes(String(actual ?? ""));
      if (rule.operator === "CONTAINS") return actualValues ? values.some((value) => actualValues.includes(value)) : String(actual ?? "").includes(String(expected ?? ""));
      if (rule.operator === "NOT_CONTAINS") return actualValues ? values.every((value) => !actualValues.includes(value)) : !String(actual ?? "").includes(String(expected ?? ""));
      return false;
    };
    return rows.filter((row) => scopes.some((scope) => scope.scope === "OWN" ? Boolean(actor.userId && row.createdBy === actor.userId) : scope.scope === "CUSTOM" && scope.rules.length > 0 && (scope.match === "ANY" ? scope.rules.some((rule) => compare(row, rule)) : scope.rules.every((rule) => compare(row, rule)))));
  }

  private assertDataScope(row: Record<string, unknown>, actor: MarketingActor, resource: MarketingResource, action: string) {
    if (!this.applyDataScope([row], actor, resource, action).length) throw new ForbiddenException("该记录不在当前用户的数据权限范围内");
  }

  private visibleFields(actor: MarketingActor, resource: MarketingResource, fields: string[]) {
    const all = actor.permissions.includes("*") || actor.tableDataScopes?.some((scope) => scope.resource === resource && scope.groupId.startsWith("module-admin:"));
    return new Set(all ? fields : fields.filter((field) => actor.permissions.includes(`${resource}:${field}:read`) || actor.permissions.includes(`${resource}:${field}:update`)));
  }

  private async assertEnabledUsers(ids: string[]) {
    const users = await this.directory.findEnabledUsersByIds(ids);
    const found = new Set(users.map((user) => user.id));
    const invalid = ids.filter((id) => !found.has(id));
    if (invalid.length) throw new BadRequestException({ message: "业务员必须选择通讯录内的启用用户", invalidUserIds: invalid });
  }

  private async assertUsersBelongToDepartment(ids: string[], departmentId: string, grandfatheredIds: string[] = []) {
    const users = await this.directory.findEnabledUsersInOrganization(departmentId);
    const valid = new Set([...users.map((user) => user.id), ...grandfatheredIds]);
    const invalid = ids.filter((id) => !valid.has(id));
    if (invalid.length) throw new BadRequestException({ message: "业务员必须是在所选部门或其子部门内的在职用户", invalidUserIds: invalid });
  }

  private optionalDate(value: unknown, label: string) {
    if (value === null || value === undefined || value === "") return null;
    const date = String(value).slice(0, 10); const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new BadRequestException(`${label}格式无效，应为 YYYY-MM-DD`);
    return date;
  }
  private decimal(value: unknown, label: string, min = 0, max?: number) {
    const normalized = String(value ?? "").replaceAll(",", "").trim();
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) throw new BadRequestException(`${label}必须为数字`);
    const numeric = Number(normalized); if (!Number.isFinite(numeric)) throw new BadRequestException(`${label}超出数值范围`); if (numeric < min || (max !== undefined && numeric > max)) throw new BadRequestException(`${label}必须在 ${min} 至 ${max ?? "正无穷"} 之间`);
    return normalized;
  }
  private schedule(input: OrderScheduleInput): OrderScheduleInput {
    const status = String(input.status ?? "NORMAL").trim().toUpperCase();
    if (status !== "NORMAL" && status !== "VOID") throw new BadRequestException("状态只能选择正常或作废");
    return {
      customerCode: this.text(input.customerCode, "客户代码"), orderNumber: this.text(input.orderNumber, "订单编号"),
      itemNumber: this.text(input.itemNumber, "品项编码"), itemName: this.text(input.itemName, "品项名称"),
      customerDueDate: this.optionalDate(input.customerDueDate, "客户交期"),
      orderTotalQuantity: this.decimal(input.orderTotalQuantity, "订单总数量"), productionUnit: String(input.productionUnit ?? "").trim() || null,
      completionRatio: this.decimal(input.completionRatio, "订单完成比例", 0, 100), status, sourcePlanItemId: input.sourcePlanItemId ?? null
    };
  }

  private async tenant(actor: MarketingActor) { return this.repository.tenantId(actor.tenantCode); }

  async listMappings(search: string | undefined, actor: MarketingActor, action: "read" | "export" = "read") {
    this.assert(actor, "business-customer-mapping", action);
    type MappingReadRow = Record<string, unknown> & { department: string; section: string; customerCode: string; salespersonUserIds: string[] };
    const rows = this.applyDataScope(await this.repository.listMappings(await this.tenant(actor)) as MappingReadRow[], actor, "business-customer-mapping", action);
    const userIds = [...new Set(rows.flatMap((row) => row.salespersonUserIds ?? []))];
    const [users, organizations] = await Promise.all([this.directory.findUsersByIds(userIds), this.directory.listEnabledOrganizations()]);
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    const organizationMap = new Map(organizations.map((organization) => [organization.id, organization]));
    const result = rows.map((row) => ({
      ...row,
      departmentPath: organizationMap.get(String(row.departmentId ?? ""))?.pathLabel ?? row.department,
      salespersonNames: (row.salespersonUserIds ?? []).map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
      salespersonUsers: (row.salespersonUserIds ?? []).map((id) => users.find((user) => user.id === id)).filter((user): user is NonNullable<typeof user> => Boolean(user))
    }));
    const value = String(search ?? "").trim().toLocaleLowerCase();
    if (!value) return result;
    return result.filter((row) => [row.department, row.section, row.customerCode, ...(row.salespersonNames as string[])]
      .some((field) => String(field ?? "").toLocaleLowerCase().includes(value)));
  }

  private pageRows<T extends Record<string, unknown>>(rows: T[], input: MarketingPageInput, allowedFields: string[]) {
    const page = Math.max(Number(input.page) || 1, 1);
    const pageSize = [20, 50, 100, 200].includes(Number(input.pageSize)) ? Number(input.pageSize) : 50;
    const allowed = new Set(allowedFields);
    const filtered = rows.filter((row) => Object.entries(input.filters ?? {}).every(([key, raw]) => {
      const value = raw.trim().toLocaleLowerCase();
      if (!value || !allowed.has(key)) return true;
      const actual = key === "salespersonUserIds" || key === "salespersonNames" ? row.salespersonNames : row[key];
      return (Array.isArray(actual) ? actual.join(" ") : String(actual ?? "")).toLocaleLowerCase().includes(value);
    }));
    const sortField = allowed.has(String(input.sortField ?? "")) ? String(input.sortField) : "";
    if (sortField) filtered.sort((left, right) => {
      const leftValue = sortField === "salespersonUserIds" || sortField === "salespersonNames" ? left.salespersonNames : left[sortField];
      const rightValue = sortField === "salespersonUserIds" || sortField === "salespersonNames" ? right.salespersonNames : right[sortField];
      const compared = String(Array.isArray(leftValue) ? leftValue.join(" ") : leftValue ?? "").localeCompare(String(Array.isArray(rightValue) ? rightValue.join(" ") : rightValue ?? ""), "zh-CN", { numeric: true });
      return input.sortOrder === "desc" ? -compared : compared;
    });
    return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  }

  async listMappingsPage(input: MarketingPageInput, actor: MarketingActor) {
    const rows = await this.listMappings(input.search, actor) as Array<Record<string, unknown>>;
    return this.pageRows(rows, input, ["department", "section", "customerCode", "salespersonUserIds", "createdBy", "createdAt", "updatedBy", "updatedAt"]);
  }

  async listDirectoryUsers(actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "read");
    return this.directory.listEnabledUsers();
  }

  async listDirectoryOrganizations(actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "read");
    return this.directory.listEnabledOrganizations();
  }

  async syncMappingDepartmentsFromDirectory(actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "import");
    const tenantId = await this.tenant(actor);
    type MappingRow = { id: string; customerCode: string; salespersonUserIds: string[] };
    const rows = await this.repository.listMappings(tenantId) as MappingRow[];
    const userIds = [...new Set(rows.flatMap((row) => row.salespersonUserIds ?? []))];
    const [users, organizations] = await Promise.all([this.directory.findUsersByIds(userIds), this.directory.listEnabledOrganizations()]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const organizationsByPath = new Map(organizations.map((organization) => [organization.path.join("/"), organization]));
    const collapseConsecutiveNames = (path: string[]) => path.filter((name, index) => index === 0 || name !== path[index - 1]);
    const organizationForPath = (path: string[]) => {
      const exact = organizationsByPath.get(path.join("/"));
      if (exact) return exact;
      const normalized = collapseConsecutiveNames(path).join("/");
      const candidates = organizations
        .filter((organization) => collapseConsecutiveNames(organization.path).join("/") === normalized)
        .sort((left, right) => right.path.length - left.path.length);
      if (!candidates.length || (candidates[1] && candidates[1].path.length === candidates[0].path.length)) return undefined;
      return candidates[0];
    };
    const targets = [];
    const skipped: Array<{ customerCode: string; reason: string }> = [];
    for (const row of rows) {
      let selected: DirectoryOrganizationOption | undefined;
      for (const userId of row.salespersonUserIds ?? []) {
        const user = usersById.get(userId);
        if (!user?.enabled) continue;
        selected = (user.departmentPaths ?? []).map(organizationForPath).find(Boolean);
        if (selected) break;
      }
      if (!selected) {
        skipped.push({ customerCode: row.customerCode, reason: "没有可匹配最新组织架构的在职业务员" });
        continue;
      }
      targets.push({ id: row.id, departmentId: selected.id, department: selected.name });
    }
    return this.repository.syncMappingDepartmentsFromDirectory(tenantId, targets, skipped, actor);
  }

  async saveMapping(id: string | null, input: BusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", id ? "update" : "create");
    if (id && (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1)) throw new BadRequestException("修改记录必须提供有效版本号");
    const normalized = this.resolveMappings([input], await this.directory.listEnabledOrganizations())[0]!;
    const tenantId = await this.tenant(actor);
    let current: Record<string, unknown> | undefined;
    if (id) {
      current = (await this.repository.listMappings(tenantId) as Array<Record<string, unknown>>).find((row) => row.id === id);
      if (!current) throw new BadRequestException("业务与客户对应关系不存在");
      this.assertDataScope(current, actor, "business-customer-mapping", "update");
    }
    this.assertDataScope(normalized as unknown as Record<string, unknown>, actor, "business-customer-mapping", id ? "update" : "create");
    await this.assertEnabledUsers(normalized.salespersonUserIds);
    const grandfatheredIds = current?.departmentId === normalized.departmentId && Array.isArray(current.salespersonUserIds) ? current.salespersonUserIds.map(String) : [];
    await this.assertUsersBelongToDepartment(normalized.salespersonUserIds, normalized.departmentId, grandfatheredIds);
    return this.repository.saveMapping(tenantId, id, normalized, expectedVersion, actor);
  }

  async replaceMappings(rows: BusinessCustomerMappingInput[], fileName: string, fileHash: string, summary: MappingImportSummary, actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "import");
    const normalized = this.resolveMappings(rows, await this.directory.listEnabledOrganizations());
    if (!normalized.length) throw new BadRequestException("文件中没有可导入的业务与客户对应关系");
    const customerCodes = new Set<string>();
    for (const row of normalized) {
      const key = row.customerCode.toLocaleUpperCase();
      if (customerCodes.has(key)) throw new BadRequestException(`客户 ${row.customerCode} 在导入结果中重复`);
      customerCodes.add(key);
    }
    await this.assertEnabledUsers([...new Set(normalized.flatMap((row) => row.salespersonUserIds))]);
    for (const row of normalized) await this.assertUsersBelongToDepartment(row.salespersonUserIds, row.departmentId);
    return this.repository.replaceMappings(await this.tenant(actor), normalized, fileName, fileHash, summary, actor);
  }

  async deleteMapping(id: string, expectedVersion: number, actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "delete");
    const tenantId = await this.tenant(actor);
    const current = (await this.repository.listMappings(tenantId) as Array<Record<string, unknown>>).find((row) => row.id === id);
    if (!current) throw new BadRequestException("业务与客户对应关系不存在");
    this.assertDataScope(current, actor, "business-customer-mapping", "delete");
    return this.repository.deleteMapping(tenantId, id, Number(expectedVersion), actor);
  }

  async listSchedules(search: string | undefined, actor: MarketingActor, action: "read" | "export" = "read") {
    this.assert(actor, "order-schedule", action);
    type ScheduleReadRow = {
      department: string | null;
      section: string | null;
      salespersonUserIds: string[];
      customerCode: string;
      orderNumber: string;
      itemNumber: string;
      itemName: string;
      productionUnit: string | null;
      [key: string]: unknown;
    };
    const rows = this.applyDataScope(await this.repository.listSchedules(await this.tenant(actor)) as ScheduleReadRow[], actor, "order-schedule", action);
    const userIds = [...new Set(rows.flatMap((row) => row.salespersonUserIds ?? []))];
    const [users, organizations] = await Promise.all([this.directory.findUsersByIds(userIds), this.directory.listEnabledOrganizations()]);
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    const organizationMap = new Map(organizations.map((organization) => [organization.id, organization]));
    const result = rows.map((row) => ({
      ...row,
      departmentPath: organizationMap.get(String(row.departmentId ?? ""))?.pathLabel ?? row.department,
      salespersonNames: (row.salespersonUserIds ?? []).map((id) => names.get(id)).filter((name): name is string => Boolean(name))
    }));
    const value = String(search ?? "").trim().toLocaleLowerCase();
    if (!value) return result;
    return result.filter((row) => [row.department, row.section, row.customerCode, row.orderNumber, row.itemNumber, row.itemName, row.productionUnit, ...(row.salespersonNames as string[])]
      .some((field) => String(field ?? "").toLocaleLowerCase().includes(value)));
  }

  async listSchedulesPage(input: MarketingPageInput, actor: MarketingActor) {
    let rows = await this.listSchedules(input.search, actor) as Array<Record<string, unknown>>;
    if (input.exactOrderNumber) rows = rows.filter((row) => row.orderNumber === input.exactOrderNumber);
    if (input.completion === "unfinished") rows = rows.filter((row) => Number(row.completionRatio ?? 0) < 100);
    if (input.completion === "completed") rows = rows.filter((row) => Number(row.completionRatio ?? 0) >= 100);
    if (input.dueStart) rows = rows.filter((row) => Boolean(row.customerDueDate) && String(row.customerDueDate) >= input.dueStart!);
    if (input.dueEnd) rows = rows.filter((row) => Boolean(row.customerDueDate) && String(row.customerDueDate) <= input.dueEnd!);
    return this.pageRows(rows, input, ["customerCode", "department", "section", "salespersonNames", "orderNumber", "itemNumber", "itemName", "customerDueDate", "orderTotalQuantity", "productionUnit", "completionRatio", "status", "createdBy", "createdAt", "updatedBy", "updatedAt"]);
  }

  assertScheduleImport(actor: MarketingActor) { this.assert(actor, "order-schedule", "import"); }

  async validateScheduleImport(inputs: Array<{ row: number; input: OrderScheduleInput }>, actor: MarketingActor) {
    this.assertScheduleImport(actor);
    const existing = await this.repository.listSchedules(await this.tenant(actor)) as Array<Record<string, unknown>>;
    const byKey = new Map(existing.map((row) => [JSON.stringify([row.orderNumber, row.itemNumber]), row]));
    const keys = new Set<string>();
    const rows: import("./marketing.types").ScheduleImportRow[] = [];
    const errors: Array<{ row: number; reason: string }> = [];
    for (const entry of inputs) {
      try {
        const input = this.schedule(entry.input);
        for (const [key, max] of Object.entries({ customerCode: 120, orderNumber: 120, itemNumber: 160, itemName: 320, productionUnit: 200 })) {
          if (String(input[key as keyof OrderScheduleInput] ?? "").length > max) throw new BadRequestException(`${key}长度不能超过${max}`);
        }
        if (!/^\d{1,14}(\.\d{1,4})?$/.test(String(input.orderTotalQuantity))) throw new BadRequestException("订单总数量最多14位整数、4位小数");
        if (!/^\d{1,3}(\.\d{1,4})?$/.test(String(input.completionRatio))) throw new BadRequestException("订单完成比例最多4位小数");
        const key = JSON.stringify([input.orderNumber, input.itemNumber]);
        if (keys.has(key)) throw new BadRequestException("订单编号 + 品项编码在文件内重复");
        keys.add(key);
        const current = byKey.get(key);
        this.assertDataScope(current ?? { ...input, createdBy: actor.userId }, actor, "order-schedule", "import");
        this.assertDataScope({ ...current, ...input, createdBy: current?.createdBy ?? actor.userId }, actor, "order-schedule", "import");
        const administrator = actor.permissions.includes("*") || actor.tableDataScopes?.some((scope) => scope.resource === "order-schedule" && scope.groupId.startsWith("module-admin:"));
        if (!administrator) for (const field of Object.keys(input).filter((field) => field !== "sourcePlanItemId")) {
          if (!actor.permissions.includes(`order-schedule:${field}:update`)) throw new ForbiddenException(`字段 ${field} 没有编辑权限`);
        }
        rows.push({ row: entry.row, input, id: current ? String(current.id) : null, expectedVersion: current ? Number(current.version) : null });
      } catch (error) { errors.push({ row: entry.row, reason: (error as Error).message }); }
    }
    return { rows, errors };
  }

  async importSchedules(rows: import("./marketing.types").ScheduleImportRow[], hash: string, actor: MarketingActor) {
    const validated = await this.validateScheduleImport(rows, actor);
    if (validated.errors.length) throw new BadRequestException({ message: "导入失败，请修正后重新预览", errors: validated.errors });
    const result = await this.repository.importSchedules(await this.tenant(actor), rows, hash, actor);
    return result;
  }

  async clearSchedules(actor: MarketingActor) {
    if (!actor.permissions.includes("*") || actor.username !== "order-schedule-reset") throw new ForbiddenException("仅限已授权的一次性维护命令");
    const result = await this.repository.clearSchedules(await this.tenant(actor), actor);
    return result;
  }

  async saveSchedule(id: string | null, input: OrderScheduleInput, expectedVersion: number | null, actor: MarketingActor) {
    this.assert(actor, "order-schedule", id ? "update" : "create");
    if (id && (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1)) throw new BadRequestException("修改记录必须提供有效版本号");
    const tenantId = await this.tenant(actor);
    if (id) {
      const current = (await this.repository.listSchedules(tenantId) as Array<Record<string, unknown>>).find((row) => row.id === id);
      if (!current) throw new BadRequestException("订单排期不存在");
      this.assertDataScope(current, actor, "order-schedule", "update");
    }
    const result = await this.repository.saveSchedule(tenantId, id, this.schedule(input), expectedVersion, actor);
    return result;
  }

  async deleteSchedule(id: string, expectedVersion: number, actor: MarketingActor) {
    this.assert(actor, "order-schedule", "delete");
    const tenantId = await this.tenant(actor);
    const current = (await this.repository.listSchedules(tenantId) as Array<Record<string, unknown>>).find((row) => row.id === id);
    if (!current) throw new BadRequestException("订单排期不存在");
    this.assertDataScope(current, actor, "order-schedule", "delete");
    const result = await this.repository.deleteSchedule(tenantId, id, Number(expectedVersion), actor);
    return result;
  }

  async batchUpdateDueDate(rows: Array<{ id: string; expectedVersion: number }>, customerDueDate: string | null, actor: MarketingActor) {
    this.assert(actor, "order-schedule", "update");
    if (!rows.length || rows.length > 1000) throw new BadRequestException("请选择 1 至 1000 条订单排期");
    if (rows.some((row) => !row.id || !Number.isInteger(Number(row.expectedVersion)))) throw new BadRequestException("所选排期版本无效");
    const tenantId = await this.tenant(actor);
    const allRows = await this.repository.listSchedules(tenantId) as Array<Record<string, unknown>>;
    for (const selected of rows) {
      const current = allRows.find((row) => row.id === selected.id);
      if (!current) throw new BadRequestException("所选排期不存在");
      this.assertDataScope(current, actor, "order-schedule", "update");
    }
    const result = await this.repository.batchUpdateDueDate(tenantId, rows, this.optionalDate(customerDueDate, "客户交期"), actor);
    return result;
  }

  async batchDeleteSchedules(rows: Array<{ id: string; expectedVersion: number }>, actor: MarketingActor) {
    this.assert(actor, "order-schedule", "delete");
    if (!rows.length || rows.length > 1000) throw new BadRequestException("请选择 1 至 1000 条订单排期");
    if (rows.some((row) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id) || !Number.isInteger(Number(row.expectedVersion)) || Number(row.expectedVersion) < 1)) throw new BadRequestException("所选排期标识或版本无效");
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new BadRequestException("所选排期包含重复记录");
    const tenantId = await this.tenant(actor);
    const selectedRows = await this.repository.findSchedulesByIds(tenantId, rows.map((row) => row.id)) as Array<Record<string, unknown>>;
    for (const selected of rows) {
      const current = selectedRows.find((row) => row.id === selected.id);
      if (!current) throw new BadRequestException("所选排期不存在");
      this.assertDataScope(current, actor, "order-schedule", "delete");
    }
    const result = await this.repository.batchDeleteSchedules(tenantId, rows, actor);
    return result;
  }

}
