import { Inject, Injectable } from "@nestjs/common";
import { planningFieldRegistry } from "@kdos/contracts";
import { fieldAccess } from "@kdos/permissions";
import { PLANNING_REPOSITORY, type PlanSearchInput, type PlanningRepository } from "./planning.repository";
import { PlanningDomainService } from "./planning-domain.service";
import type { PlanningActor } from "./planning.types";

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

@Injectable()
export class PlanQueryService {
  constructor(
    @Inject(PLANNING_REPOSITORY) private readonly repository: PlanningRepository,
    private readonly domain: PlanningDomainService
  ) {}

  private tenant(actor: PlanningActor) { return this.repository.tenantId(actor.tenantCode); }
  fields(actor: PlanningActor) { return planningFieldRegistry.map((field) => ({ ...field, access: fieldAccess(actor, field) })).filter((field) => field.access !== "HIDDEN"); }
  async listPeriods(actor: PlanningActor) { return this.repository.listPeriods(await this.tenant(actor)); }
  async getPlanPeriod(periodId: string, actor: PlanningActor) { return this.repository.getPeriod(await this.tenant(actor), periodId); }
  async getPeriodByMonth(year: number, month: number, actor: PlanningActor) { return this.repository.periodByMonth(await this.tenant(actor), year, month); }
  async getPublishedPlan(periodId: string, actor: PlanningActor) {
    const result = await this.getPlanPeriod(periodId, actor);
    return result?.versions.find((entry) => entry.id === result.currentVersionId && ["PUBLISHED", "LOCKED"].includes(entry.status)) ?? null;
  }
  async getDraftPlan(periodId: string, actor: PlanningActor) { return (await this.getPlanPeriod(periodId, actor))?.versions.find((entry) => entry.status === "DRAFT") ?? null; }
  async getPlanItem(itemId: string, actor: PlanningActor) { return this.repository.getItem(await this.tenant(actor), itemId); }

  async searchPlanItems(input: PlanSearchInput, actor: PlanningActor) {
    const tenantId = await this.tenant(actor);
    const today = shanghaiDate();
    const rows = await this.repository.searchItems(tenantId, input);
    return rows.map((row) => {
      const metrics = this.domain.metrics(row);
      const processes = Object.fromEntries(Object.entries(row.processes).map(([code, value]) => [code, {
        ...value,
        status: this.domain.processStatus({ completedQuantity: value.quantity, plannedDate: value.dueDate as string | null, status: value.status as string | null }, row.productionQuantity, today)
      }]));
      const processStatuses = Object.values(processes).map((entry) => String(entry.status ?? ""));
      return {
        ...row.legacyData,
        id: row.id, version: row.version, planVersionId: row.planVersionId,
        priority: row.priority, planSequence: row.sequence, sequence: row.sequence, planningStatus: row.status,
        responsibleOrgId: row.responsibleOrgId, ownerUserId: row.ownerUserId,
        orderNumber: row.orderNumber, itemNumber: row.itemNumber, itemName: row.itemName,
        customer: row.customerName, customerDueDate: row.deliveryDate,
        orderQuantity: row.orderQuantity, productionQuantity: row.productionQuantity, historicalInboundQuantity: row.historicalInboundQuantity,
        todayInboundQuantity: row.currentInboundQuantity, unitPrice: row.unitPrice,
        balanceQuantity: metrics.balanceQuantity, inboundAmount: metrics.inboundAmount,
        balanceAmount: metrics.balanceAmount, completionRate: metrics.completionRate,
        itemStatus: this.domain.itemStatus(metrics.balanceQuantity, processStatuses),
        imageRefs: row.imageRefs, remark: row.remark, orderException: row.exception,
        processes, createdAt: row.createdAt, updatedAt: row.updatedAt
      };
    });
  }

  async getOrderProgress(versionId: string, orderNumber: string, actor: PlanningActor) {
    const rows = await this.searchPlanItems({ versionId, orderNumber }, actor);
    return { orderNumber, items: rows, total: rows.length };
  }
  async getProcessProgress(versionId: string, actor: PlanningActor) { return this.repository.listProcessProgress(await this.tenant(actor), versionId); }
  async getPlanRiskSummary(versionId: string, dueWithinDays: number, actor: PlanningActor) {
    const today = shanghaiDate();
    return this.repository.riskSummary(await this.tenant(actor), versionId, dueWithinDays, today);
  }
  async getOverdueItems(versionId: string, actor: PlanningActor) { return (await this.getPlanRiskSummary(versionId, 7, actor)).overdue; }
}
