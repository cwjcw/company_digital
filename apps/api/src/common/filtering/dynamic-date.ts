import { BadRequestException } from "@nestjs/common";
import { tableFilterDynamicDateKeys } from "@kdos/contracts";
import { shanghaiToday } from "../../modules/master-plan-system/master-plan.domain";

/**
 * 动态日期区间（用户确认的 11 个关键字）：服务端按 Asia/Shanghai 计算，
 * 客户端只提交关键字，不得下发具体日期范围。NEXT_1_WEEK / NEXT_2_WEEKS 为闭区间。
 */
export function dynamicDateRange(key: string, today = shanghaiToday()) {
  const normalized = String(key ?? "").toUpperCase();
  if (!(tableFilterDynamicDateKeys as readonly string[]).includes(normalized)) throw new BadRequestException(`动态日期关键字无效：${String(key ?? "")}`);
  const base = new Date(`${today}T00:00:00.000Z`);
  const shift = (days: number) => new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const monthStart = (offset: number) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
  const monthEnd = (offset: number) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset + 1, 0)).toISOString().slice(0, 10);
  switch (normalized) {
    case "YESTERDAY": return { from: shift(-1), to: shift(-1) };
    case "TODAY": return { from: today, to: today };
    case "TOMORROW": return { from: shift(1), to: shift(1) };
    case "NEXT_1_WEEK": return { from: today, to: shift(7) };
    case "NEXT_2_WEEKS": return { from: today, to: shift(14) };
    case "LAST_MONTH": return { from: monthStart(-1), to: monthEnd(-1) };
    case "THIS_MONTH": return { from: monthStart(0), to: monthEnd(0) };
    case "NEXT_MONTH": return { from: monthStart(1), to: monthEnd(1) };
    case "LAST_YEAR": return { from: `${base.getUTCFullYear() - 1}-01-01`, to: `${base.getUTCFullYear() - 1}-12-31` };
    case "THIS_YEAR": return { from: `${base.getUTCFullYear()}-01-01`, to: `${base.getUTCFullYear()}-12-31` };
    default: return { from: `${base.getUTCFullYear() + 1}-01-01`, to: `${base.getUTCFullYear() + 1}-12-31` };
  }
}
