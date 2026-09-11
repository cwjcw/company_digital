import Decimal from "decimal.js";

export const STANDARD_PROCESSES = [
  ["cutting", "下料", "cuttingDays"], ["machining", "机加", "machiningDays"],
  ["bending", "折弯", "bendingDays"], ["spotWelding", "点焊", "spotWeldingDays"],
  ["welding", "焊接", "weldingDays"], ["woodworking", "木作", "woodworkingDays"],
  ["grinding", "研磨", "grindingDays"], ["surfaceTreatment", "表面处理", "surfaceTreatmentDays"],
  ["packaging", "包装", "packagingDays"]
] as const;

export type ProcessCode = typeof STANDARD_PROCESSES[number][0];
export type ProcessCycleInput = Partial<Record<typeof STANDARD_PROCESSES[number][2], number | null>>;

const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/** Natural-day reverse scheduling: the last applicable process shares the review anchor date. */
export function reverseSchedule(anchorDate: string, cycles: ProcessCycleInput) {
  let cursor = dateOnly(anchorDate);
  const result: Array<{ code: ProcessCode; name: string; sequence: number; cycleDays: number | null; dueDate: string | null }> = [];
  for (let index = STANDARD_PROCESSES.length - 1; index >= 0; index -= 1) {
    const [code, name, field] = STANDARD_PROCESSES[index]!;
    const cycle = cycles[field];
    if (cycle == null) {
      result.push({ code, name, sequence: index + 1, cycleDays: null, dueDate: null });
      continue;
    }
    result.push({ code, name, sequence: index + 1, cycleDays: cycle, dueDate: isoDate(cursor) });
    cursor = new Date(cursor.getTime() - Math.max(0, cycle) * 86_400_000);
  }
  return result.reverse();
}

export type FifoDelivery = { id: string; dueDate: string; deliveryNumber: number; plannedQuantity: string | number };

export function allocateInboundFifo(deliveries: FifoDelivery[], inboundQuantity: string | number) {
  let remaining = Decimal.max(new Decimal(inboundQuantity || 0), 0);
  return [...deliveries]
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.deliveryNumber - right.deliveryNumber || left.id.localeCompare(right.id))
    .map((delivery) => {
      const planned = Decimal.max(new Decimal(delivery.plannedQuantity || 0), 0);
      const allocated = Decimal.min(remaining, planned);
      remaining = Decimal.max(remaining.minus(allocated), 0);
      return { ...delivery, allocatedQuantity: allocated.toFixed(4), pendingQuantity: planned.minus(allocated).toFixed(4) };
    });
}

export function processStatus(plannedQuantity: string | number, reportedQuantity: string | number, dueDate: string | null, today: string) {
  const planned = new Decimal(plannedQuantity || 0); const reported = new Decimal(reportedQuantity || 0);
  if (planned.gt(0) && reported.gte(planned)) return "已完成" as const;
  if (dueDate && today > dueDate) return "延期" as const;
  if (reported.gt(0)) return "进行中" as const;
  return "未开始" as const;
}

export function outsourcingStatus(input: { purchaseOrderNumber?: string | null; actualInboundDate?: string | null; dueDate?: string | null; today: string }) {
  if (input.actualInboundDate) return "已入库" as const;
  if (!input.purchaseOrderNumber?.trim()) return "未开始" as const;
  if (input.dueDate && input.today > input.dueDate) return "延期" as const;
  return "进行中" as const;
}

export function aggregateGroup(items: Array<{ requiredQuantity: string | number; inboundQuantity: string | number }>) {
  const rates = items.map(({ requiredQuantity, inboundQuantity }) => {
    const required = new Decimal(requiredQuantity || 0); const inbound = Decimal.max(new Decimal(inboundQuantity || 0), 0);
    return required.lte(0) ? new Decimal(0) : Decimal.min(inbound.div(required), 1);
  });
  const required = Decimal.sum(0, ...items.map((item) => new Decimal(item.requiredQuantity || 0)));
  const completed = Decimal.sum(0, ...items.map((item) => Decimal.min(Decimal.max(new Decimal(item.inboundQuantity || 0), 0), Decimal.max(new Decimal(item.requiredQuantity || 0), 0))));
  return {
    requiredQuantity: required.toFixed(4), completedQuantity: completed.toFixed(4),
    pendingQuantity: Decimal.max(required.minus(completed), 0).toFixed(4),
    completionRate: rates.length ? Decimal.sum(0, ...rates).div(rates.length).toDecimalPlaces(4).toString() : "0"
  };
}

export function shanghaiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

