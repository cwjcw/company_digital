import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";

export type QuantityInput = {
  productionQuantity?: string | number | null;
  historicalInboundQuantity?: string | number | null;
  todayInboundQuantity?: string | number | null;
  unitPrice?: string | number | null;
};

export type MilestoneInput = {
  quantity?: string | number | null;
  dueDate?: string | null;
};

const decimal = (value: string | number | null | undefined) =>
  new Decimal(value === null || value === undefined || value === "" ? 0 : value);

@Injectable()
export class DomainService {
  private localDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  milestoneStatus(progress: MilestoneInput | undefined, productionQuantity: string | number | null, today = this.localDate()) {
    if (progress?.quantity !== null && progress?.quantity !== undefined
      && Number(progress.quantity) >= Number(productionQuantity ?? 0)) return "已完成";
    if (!progress?.dueDate || today < progress.dueDate) return "进行中";
    if (today === progress.dueDate) return "即将延期";
    return "延期";
  }

  itemStatus(item: QuantityInput, milestoneStatuses: string[]) {
    if (milestoneStatuses.includes("延期")) return "延期";
    if (milestoneStatuses.includes("即将延期")) return "即将延期";
    const inbound = decimal(item.historicalInboundQuantity).plus(decimal(item.todayInboundQuantity));
    if (inbound.greaterThanOrEqualTo(decimal(item.productionQuantity))) return "完成";
    return "进行中";
  }

  itemMetrics(item: QuantityInput) {
    const production = decimal(item.productionQuantity);
    const inbound = decimal(item.historicalInboundQuantity).plus(decimal(item.todayInboundQuantity));
    const balance = production.minus(inbound);
    const price = decimal(item.unitPrice);
    return {
      productionQuantity: production.toFixed(),
      completedQuantity: inbound.toFixed(),
      balanceQuantity: balance.toFixed(),
      inboundAmount: inbound.times(price).toFixed(4),
      balanceAmount: balance.times(price).toFixed(4),
      warnings: balance.isNegative() ? ["订单欠数为负，请核对入库数量"] : []
    };
  }

  orderMetrics(items: QuantityInput[]) {
    const metrics = items.map((item) => this.itemMetrics(item));
    const total = metrics.reduce((sum, item) => sum.plus(item.productionQuantity), new Decimal(0));
    const balance = metrics.reduce((sum, item) => sum.plus(item.balanceQuantity), new Decimal(0));
    const completed = total.minus(balance);
    return {
      totalQuantity: total.toFixed(),
      completedQuantity: completed.toFixed(),
      pendingQuantity: balance.toFixed(),
      completionRate: total.isZero() ? null : completed.div(total).toDecimalPlaces(6).toNumber()
    };
  }

  orderAmount(items: QuantityInput[]) {
    return items.reduce((sum, item) =>
      sum.plus(decimal(item.productionQuantity).times(decimal(item.unitPrice))), new Decimal(0)
    ).toDecimalPlaces(4).toFixed();
  }
}
