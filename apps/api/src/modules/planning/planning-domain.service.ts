import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import type { OnHandSummaryContract } from "@kdos/contracts";
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

  onHandSummary(
    rows: PlanItemView[],
    today: string,
    organizationLabels: ReadonlyMap<string, { name: string; pathLabel: string }> = new Map()
  ): Omit<OnHandSummaryContract, "source" | "visibleFields"> {
    const nextWeek = new Date(`${today}T00:00:00Z`);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const nextWeekText = nextWeek.toISOString().slice(0, 10);
    const dayDifference = (value: string | null) => value
      ? Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
      : null;
    const positive = (value: Decimal) => Decimal.max(value, 0);
    const rate = (inbound: Decimal, production: Decimal) => production.isZero()
      ? 0 : Decimal.min(positive(inbound), production).dividedBy(production).times(100).toDecimalPlaces(2).toNumber();
    const total = {
      production: new Decimal(0), historicalInbound: new Decimal(0), todayInbound: new Decimal(0),
      inbound: new Decimal(0), balance: new Decimal(0)
    };
    const statuses: OnHandSummaryContract["statusCounts"] = { 完成: 0, 进行中: 0, 即将延期: 0, 延期: 0 };
    const customers = new Map<string, {
      customer: string; items: number; orders: Set<string>; production: Decimal; inbound: Decimal; balance: Decimal;
    }>();
    const divisions = new Map<string, {
      divisionId: string | null; divisionName: string; divisionPath: string; items: number; orders: Set<string>;
      production: Decimal; inbound: Decimal; balance: Decimal;
    }>();
    const processes = new Map<string, {
      processCode: string; processName: string; itemCount: number; completedCount: number; overdueCount: number; exceptionCount: number;
    }>();
    const warnings: OnHandSummaryContract["warningRows"] = [];

    for (const row of rows) {
      const production = positive(decimal(row.productionQuantity));
      const historicalInbound = positive(decimal(row.historicalInboundQuantity));
      const todayInbound = positive(decimal(row.currentInboundQuantity));
      const inbound = historicalInbound.plus(todayInbound);
      const balance = positive(production.minus(inbound));
      total.production = total.production.plus(production);
      total.historicalInbound = total.historicalInbound.plus(historicalInbound);
      total.todayInbound = total.todayInbound.plus(todayInbound);
      total.inbound = total.inbound.plus(inbound);
      total.balance = total.balance.plus(balance);

      const processStatuses = Object.entries(row.processes).map(([processCode, value]) => {
        const status = this.processStatus({ completedQuantity: value.quantity, plannedDate: value.dueDate as string | null, status: value.status as string | null }, production, today);
        const processName = String(value.processName ?? processCode);
        const current = processes.get(processCode) ?? { processCode, processName, itemCount: 0, completedCount: 0, overdueCount: 0, exceptionCount: 0 };
        current.itemCount += 1;
        if (["完成", "已完成"].includes(status)) current.completedCount += 1;
        if (status === "延期") current.overdueCount += 1;
        if (String(value.exception ?? "").trim()) current.exceptionCount += 1;
        processes.set(processCode, current);
        return status;
      });
      const itemStatus = this.itemStatus(balance.toFixed(4), processStatuses);
      statuses[itemStatus] = (statuses[itemStatus] ?? 0) + 1;

      const customer = row.customerName?.trim() || "未维护客户";
      const customerValue = customers.get(customer) ?? {
        customer, items: 0, orders: new Set<string>(), production: new Decimal(0), inbound: new Decimal(0), balance: new Decimal(0)
      };
      customerValue.items += 1; customerValue.orders.add(row.orderNumber);
      customerValue.production = customerValue.production.plus(production);
      customerValue.inbound = customerValue.inbound.plus(inbound);
      customerValue.balance = customerValue.balance.plus(balance);
      customers.set(customer, customerValue);

      const organization = row.responsibleOrgId ? organizationLabels.get(row.responsibleOrgId) : undefined;
      const divisionKey = row.responsibleOrgId ?? "__unassigned__";
      const divisionValue = divisions.get(divisionKey) ?? {
        divisionId: row.responsibleOrgId, divisionName: organization?.name ?? "未归属事业部",
        divisionPath: organization?.pathLabel ?? "未归属事业部", items: 0, orders: new Set<string>(),
        production: new Decimal(0), inbound: new Decimal(0), balance: new Decimal(0)
      };
      divisionValue.items += 1; divisionValue.orders.add(row.orderNumber);
      divisionValue.production = divisionValue.production.plus(production);
      divisionValue.inbound = divisionValue.inbound.plus(inbound);
      divisionValue.balance = divisionValue.balance.plus(balance);
      divisions.set(divisionKey, divisionValue);

      const dueDate = row.deliveryDate;
      if (balance.gt(0) && (itemStatus === "延期" || itemStatus === "即将延期" || Boolean(dueDate && dueDate <= nextWeekText))) {
        warnings.push({
          id: row.id, orderNumber: row.orderNumber, itemNumber: row.itemNumber, itemName: row.itemName,
          customer, divisionName: divisionValue.divisionName, customerDueDate: dueDate, itemStatus: dueDate && dueDate < today ? "延期" : itemStatus,
          balanceQuantity: balance.toFixed(4), remainingDays: dayDifference(dueDate)
        });
      }
    }

    return {
      metrics: {
        itemCount: rows.length, orderCount: new Set(rows.map((row) => row.orderNumber)).size,
        customerCount: customers.size, productionQuantity: total.production.toFixed(4),
        historicalInboundQuantity: total.historicalInbound.toFixed(4), todayInboundQuantity: total.todayInbound.toFixed(4),
        inboundQuantity: total.inbound.toFixed(4), balanceQuantity: total.balance.toFixed(4),
        completionRate: rate(total.production.minus(total.balance), total.production)
      },
      statusCounts: statuses,
      divisionRows: [...divisions.values()].map((row) => ({
        divisionId: row.divisionId, divisionName: row.divisionName, divisionPath: row.divisionPath,
        itemCount: row.items, orderCount: row.orders.size, productionQuantity: row.production.toFixed(4),
        inboundQuantity: row.inbound.toFixed(4), balanceQuantity: row.balance.toFixed(4),
        completionRate: rate(row.production.minus(row.balance), row.production)
      })).sort((left, right) => decimal(right.balanceQuantity).comparedTo(decimal(left.balanceQuantity))),
      customerRows: [...customers.values()].map((row) => ({
        customer: row.customer, itemCount: row.items, orderCount: row.orders.size,
        productionQuantity: row.production.toFixed(4), inboundQuantity: row.inbound.toFixed(4),
        balanceQuantity: row.balance.toFixed(4), completionRate: rate(row.production.minus(row.balance), row.production)
      })).sort((left, right) => decimal(right.balanceQuantity).comparedTo(decimal(left.balanceQuantity))).slice(0, 12),
      processRows: [...processes.values()].map((row) => ({
        ...row, completionRate: row.itemCount ? new Decimal(row.completedCount).dividedBy(row.itemCount).times(100).toDecimalPlaces(2).toNumber() : 0
      })).sort((left, right) => right.overdueCount - left.overdueCount || right.exceptionCount - left.exceptionCount || right.itemCount - left.itemCount),
      warningRows: warnings.sort((left, right) => {
        const leftDays = left.remainingDays ?? Number.MAX_SAFE_INTEGER; const rightDays = right.remainingDays ?? Number.MAX_SAFE_INTEGER;
        return leftDays - rightDays || decimal(right.balanceQuantity).comparedTo(decimal(left.balanceQuantity));
      }).slice(0, 12)
    };
  }
}
