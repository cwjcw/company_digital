import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { MARKETING_REPOSITORY, type MarketingRepository } from "./marketing.repository";
import { MarketingDirectoryQueryService } from "./marketing-directory-query.service";
import type { BusinessCustomerMappingInput, MappingImportSummary, MarketingActor, OrderScheduleInput } from "./marketing.types";

type MarketingResource = "business-customer-mapping" | "order-schedule";
type MarketingAction = "read" | "create" | "update" | "delete" | "import" | "export";

@Injectable()
export class MarketingApplicationService {
  constructor(
    @Inject(MARKETING_REPOSITORY) private readonly repository: MarketingRepository,
    private readonly directory: MarketingDirectoryQueryService
  ) {}

  private assert(actor: MarketingActor, resource: MarketingResource, action: MarketingAction) {
    if (actor.permissions.includes("*") || actor.permissions.includes(`${resource}:*:${action}`)) return;
    throw new ForbiddenException("当前权限组没有此表的操作权限");
  }

  private text(value: unknown, label: string) {
    const result = String(value ?? "").trim();
    if (!result) throw new BadRequestException(`${label}不能为空`);
    return result;
  }

  private mapping(input: BusinessCustomerMappingInput): BusinessCustomerMappingInput {
    const salespersonUserIds = [...new Set(Array.isArray(input.salespersonUserIds) ? input.salespersonUserIds.map(String) : [])];
    if (salespersonUserIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      throw new BadRequestException("业务员字段包含无效用户 ID");
    }
    return {
      department: this.text(input.department, "部门"),
      section: String(input.section ?? "").trim(),
      customerCode: this.text(input.customerCode, "客户"),
      salespersonUserIds
    };
  }

  private async assertEnabledUsers(ids: string[]) {
    const users = await this.directory.findEnabledUsersByIds(ids);
    const found = new Set(users.map((user) => user.id));
    const invalid = ids.filter((id) => !found.has(id));
    if (invalid.length) throw new BadRequestException({ message: "业务员必须选择通讯录内的启用用户", invalidUserIds: invalid });
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
    const numeric = Number(normalized); if (numeric < min || (max !== undefined && numeric > max)) throw new BadRequestException(`${label}必须在 ${min} 至 ${max ?? "正无穷"} 之间`);
    return normalized;
  }
  private schedule(input: OrderScheduleInput): OrderScheduleInput {
    return {
      customerCode: this.text(input.customerCode, "客户代码"), orderNumber: this.text(input.orderNumber, "订单编号"),
      itemNumber: this.text(input.itemNumber, "品项编码"), itemName: this.text(input.itemName, "品项名称"),
      customerDueDate: this.optionalDate(input.customerDueDate, "客户交期"),
      orderTotalQuantity: this.decimal(input.orderTotalQuantity, "订单总数量"), productionUnit: String(input.productionUnit ?? "").trim() || null,
      completionRatio: this.decimal(input.completionRatio, "订单完成比例", 0, 100), sourcePlanItemId: input.sourcePlanItemId ?? null
    };
  }

  private async tenant(actor: MarketingActor) { return this.repository.tenantId(actor.tenantCode); }

  async listMappings(search: string | undefined, actor: MarketingActor, action: "read" | "export" = "read") {
    this.assert(actor, "business-customer-mapping", action);
    type MappingReadRow = Record<string, unknown> & { department: string; section: string; customerCode: string; salespersonUserIds: string[] };
    const rows = await this.repository.listMappings(await this.tenant(actor)) as MappingReadRow[];
    const userIds = [...new Set(rows.flatMap((row) => row.salespersonUserIds ?? []))];
    const users = await this.directory.findUsersByIds(userIds);
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    const result = rows.map((row) => ({
      ...row,
      salespersonNames: (row.salespersonUserIds ?? []).map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
      salespersonUsers: (row.salespersonUserIds ?? []).map((id) => users.find((user) => user.id === id)).filter((user): user is NonNullable<typeof user> => Boolean(user))
    }));
    const value = String(search ?? "").trim().toLocaleLowerCase();
    if (!value) return result;
    return result.filter((row) => [row.department, row.section, row.customerCode, ...(row.salespersonNames as string[])]
      .some((field) => String(field ?? "").toLocaleLowerCase().includes(value)));
  }

  async listDirectoryUsers(actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "read");
    return this.directory.listEnabledUsers();
  }

  async saveMapping(id: string | null, input: BusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", id ? "update" : "create");
    if (id && (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1)) throw new BadRequestException("修改记录必须提供有效版本号");
    const normalized = this.mapping(input);
    await this.assertEnabledUsers(normalized.salespersonUserIds);
    return this.repository.saveMapping(await this.tenant(actor), id, normalized, expectedVersion, actor);
  }

  async replaceMappings(rows: BusinessCustomerMappingInput[], fileName: string, fileHash: string, summary: MappingImportSummary, actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "import");
    const normalized = rows.map((row) => this.mapping(row));
    if (!normalized.length) throw new BadRequestException("文件中没有可导入的业务与客户对应关系");
    const customerCodes = new Set<string>();
    for (const row of normalized) {
      const key = row.customerCode.toLocaleUpperCase();
      if (customerCodes.has(key)) throw new BadRequestException(`客户 ${row.customerCode} 在导入结果中重复`);
      customerCodes.add(key);
    }
    await this.assertEnabledUsers([...new Set(normalized.flatMap((row) => row.salespersonUserIds))]);
    return this.repository.replaceMappings(await this.tenant(actor), normalized, fileName, fileHash, summary, actor);
  }

  async deleteMapping(id: string, expectedVersion: number, actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "delete");
    return this.repository.deleteMapping(await this.tenant(actor), id, Number(expectedVersion), actor);
  }

  async listSchedules(search: string | undefined, actor: MarketingActor, action: "read" | "export" = "read") {
    this.assert(actor, "order-schedule", action);
    return this.repository.listSchedules(await this.tenant(actor), search);
  }

  async saveSchedule(id: string | null, input: OrderScheduleInput, expectedVersion: number | null, actor: MarketingActor) {
    this.assert(actor, "order-schedule", id ? "update" : "create");
    if (id && (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1)) throw new BadRequestException("修改记录必须提供有效版本号");
    return this.repository.saveSchedule(await this.tenant(actor), id, this.schedule(input), expectedVersion, actor);
  }

  async deleteSchedule(id: string, expectedVersion: number, actor: MarketingActor) {
    this.assert(actor, "order-schedule", "delete");
    return this.repository.deleteSchedule(await this.tenant(actor), id, Number(expectedVersion), actor);
  }

  async batchUpdateDueDate(rows: Array<{ id: string; expectedVersion: number }>, customerDueDate: string | null, actor: MarketingActor) {
    this.assert(actor, "order-schedule", "update");
    if (!rows.length || rows.length > 1000) throw new BadRequestException("请选择 1 至 1000 条订单排期");
    if (rows.some((row) => !row.id || !Number.isInteger(Number(row.expectedVersion)))) throw new BadRequestException("所选排期版本无效");
    return this.repository.batchUpdateDueDate(await this.tenant(actor), rows, this.optionalDate(customerDueDate, "客户交期"), actor);
  }

  async syncSchedulesFromPlanning(actor: MarketingActor) {
    this.assert(actor, "order-schedule", "import");
    return this.repository.syncSchedulesFromPlanning(await this.tenant(actor), actor);
  }
}
