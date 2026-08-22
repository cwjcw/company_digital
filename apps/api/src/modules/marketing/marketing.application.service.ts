import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { MARKETING_REPOSITORY, type MarketingRepository } from "./marketing.repository";
import type { BusinessCustomerMappingInput, MarketingActor, OrderScheduleInput } from "./marketing.types";

type MarketingResource = "business-customer-mapping" | "order-schedule";
type MarketingAction = "read" | "create" | "update" | "delete" | "import" | "export";

@Injectable()
export class MarketingApplicationService {
  constructor(@Inject(MARKETING_REPOSITORY) private readonly repository: MarketingRepository) {}

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
    const customerCodes = [...new Set(String(input.customerCodes ?? "").split(/[|、,，;；\s]+/).map((value) => value.trim()).filter(Boolean))];
    if (!customerCodes.length) throw new BadRequestException("客户代码不能为空");
    return {
      department: this.text(input.department, "部门"),
      section: String(input.section ?? "").trim(),
      salesperson: this.text(input.salesperson, "业务"),
      customerCodes: customerCodes.join("|")
    };
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
    return this.repository.listMappings(await this.tenant(actor), search);
  }

  async saveMapping(id: string | null, input: BusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", id ? "update" : "create");
    if (id && (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1)) throw new BadRequestException("修改记录必须提供有效版本号");
    return this.repository.saveMapping(await this.tenant(actor), id, this.mapping(input), expectedVersion, actor);
  }

  async replaceMappings(rows: BusinessCustomerMappingInput[], fileName: string, fileHash: string, actor: MarketingActor) {
    this.assert(actor, "business-customer-mapping", "import");
    const normalized = rows.map((row) => this.mapping(row));
    if (!normalized.length) throw new BadRequestException("文件中没有可导入的业务与客户对应关系");
    return this.repository.replaceMappings(await this.tenant(actor), normalized, fileName, fileHash, actor);
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
