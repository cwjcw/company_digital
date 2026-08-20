import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import type { PlanItemView } from "./planning.types";

const decimal = (value: unknown) => new Decimal(value == null || value === "" ? 0 : String(value));

@Injectable()
export class PlanningDomainService {
  metrics(item: Pick<PlanItemView, "productionQuantity" | "historicalInboundQuantity" | "currentInboundQuantity" | "unitPrice">) {
    const production = decimal(item.productionQuantity);
    const inbound = decimal(item.historicalInboundQuantity).plus(decimal(item.currentInboundQuantity));
    const balance = production.minus(inbound);
    return {
      inboundQuantity: inbound.toFixed(4),
      balanceQuantity: balance.toFixed(4),
      completionRate: production.isZero() ? null : inbound.dividedBy(production).toDecimalPlaces(8).toNumber(),
      inboundAmount: inbound.times(decimal(item.unitPrice)).toFixed(6),
      balanceAmount: balance.times(decimal(item.unitPrice)).toFixed(6)
    };
  }

  processStatus(progress: { completedQuantity?: unknown; plannedDate?: string | null; status?: string | null }, productionQuantity: unknown, today: string) {
    const completed = decimal(progress.completedQuantity);
    const production = decimal(productionQuantity);
    if (progress.plannedDate && progress.plannedDate < today && completed.lt(production)) return "延期";
    if (!production.isZero() && completed.gte(production)) return "已完成";
    return progress.status || "进行中";
  }

  itemStatus(balanceQuantity: string, processStatuses: string[]) {
    if (processStatuses.includes("延期")) return "延期";
    if (processStatuses.includes("即将延期")) return "即将延期";
    if (decimal(balanceQuantity).lte(0)) return "完成";
    return "进行中";
  }
}
