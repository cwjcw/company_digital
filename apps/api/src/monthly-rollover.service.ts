import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PlanningApplicationService } from "./modules/planning/planning.application.service";
import { PlanQueryService } from "./modules/planning/planning.query.service";
import type { PlanningActor } from "./modules/planning/planning.types";

const systemActor = (): PlanningActor => ({
  tenantCode: process.env.KDOS_DEFAULT_TENANT_CODE || "KAINAN",
  userId: null, permissions: ["*"], roles: ["SYSTEM"], requestId: `monthly-rollover:${new Date().toISOString()}`,
  source: "SYSTEM"
});

@Injectable()
export class MonthlyRolloverService {
  constructor(private readonly commands: PlanningApplicationService, private readonly queries: PlanQueryService) {}

  @Cron("0 0 1 1 * *", { timeZone: "Asia/Shanghai" })
  async createCurrentMonth(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric" }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return this.rollover(Number(values.year), Number(values.month), systemActor());
  }

  async rollover(year: number, month: number, actor: PlanningActor) {
    const existing = await this.queries.getPeriodByMonth(year, month, actor);
    if (existing?.versions.length) return { period: existing, version: existing.versions[0], created: false, carried: 0 };
    const period = existing ?? await this.commands.createPeriod(year, month, actor);
    const version = await this.commands.createVersion(period.id, null, actor);
    const previousDate = new Date(Date.UTC(year, month - 2, 1));
    const previous = await this.queries.getPeriodByMonth(previousDate.getUTCFullYear(), previousDate.getUTCMonth() + 1, actor);
    const sourceVersionId = previous?.currentVersionId ?? previous?.versions.find((entry) => entry.status === "DRAFT")?.id;
    let carried = 0;
    if (sourceVersionId) {
      const rows = await this.queries.searchPlanItems({ versionId: sourceVersionId }, actor);
      for (const row of rows.filter((entry: any) => Number(entry.balanceQuantity ?? 0) > 0)) {
        await this.commands.createItem(version.id, {
          orderNumber: row.orderNumber, itemNumber: row.itemNumber, itemName: row.itemName ?? undefined,
          customerName: row.customer ?? undefined, orderQuantity: row.orderQuantity ?? row.productionQuantity,
          productionQuantity: row.balanceQuantity, deliveryDate: row.customerDueDate ?? undefined,
          priority: row.priority, responsibleOrgId: row.responsibleOrgId ?? undefined,
          ownerUserId: row.ownerUserId ?? undefined, remark: row.remark ?? undefined,
          legacyData: { rolloverSourceItemId: row.id, rolloverSourceVersionId: sourceVersionId }
        }, actor);
        carried += 1;
      }
    }
    return { period, version, created: true, carried };
  }
}
