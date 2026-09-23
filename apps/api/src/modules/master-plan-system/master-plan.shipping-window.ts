import { ForbiddenException } from "@nestjs/common";

/**
 * KN-MPS-LIVE-002：出货计划「开放星期」的**唯一解析入口**。
 *
 * 语义：
 * - 星期编码 1=周一 … 7=周日（与 `Intl.DateTimeFormat` 的 weekday 归一化结果一致）。
 * - 支持英文逗号分隔的多个星期，例如 `2,4,5`；`2, 4, 5`、`2,2,4,5` 同样合法（trim + 去重）。
 * - 单值 `5` 继续兼容，不破坏既有配置。
 *
 * 非法配置（`0`、`8`、`abc`、`2,a,5`、`,`、空字符串）**不静默放宽权限**：
 * 由调用方转入 fail-closed（禁止编辑并给出明确系统配置错误），绝不因为配置错误而绕过管控。
 */
export function parseWeekdays(value: unknown): number[] {
  if (value == null) return [];
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value.join(",") : String(value);
  const text = raw.trim();
  /* 空字符串属于「参数存在但格式非法」，必须 fail closed，不能被当成未配置。 */
  if (text === "") throw new Error("非法的开放星期配置：空值");
  const parsed = new Set<number>();
  for (const part of text.split(",")) {
    const token = part.trim();
    if (token === "") throw new Error(`非法的开放星期配置：${raw.slice(0, 64)}`);
    if (!/^\d+$/.test(token)) throw new Error(`非法的开放星期配置：${raw.slice(0, 64)}`);
    const weekday = Number(token);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error(`非法的开放星期配置：${raw.slice(0, 64)}`);
    parsed.add(weekday);
  }
  return [...parsed].sort((left, right) => left - right);
}

/** 保存入口使用的规范化形式：拒绝 JSON 数组，始终返回稳定的英文逗号字符串。 */
export function normalizeShippingEditWeekday(value: unknown): string {
  try {
    if (Array.isArray(value)) throw new Error("数组不是受支持的简单配置格式");
    return parseWeekdays(value).join(",");
  } catch {
    throw new Error("请输入 1~7 的星期数字，多个星期使用英文逗号分隔，例如：2,4,5");
  }
}

/** 默认开放星期（配置不存在时保持既有兼容行为：周五）。 */
export const DEFAULT_SHIPPING_EDIT_WEEKDAYS = [5] as const;

/** 参数不存在（NULL/未配置）→ 默认 5；参数存在但非法（含空字符串）→ 抛错（fail closed）。 */
export function resolveShippingEditWeekdays(value: unknown): number[] {
  if (value == null) return [...DEFAULT_SHIPPING_EDIT_WEEKDAYS];
  return parseWeekdays(value);
}

export type ShippingWindowInput = {
  /** `shipping_edit_weekday` 参数的原始值（jsonb）。 */
  editWeekday: unknown;
  /** `shipping_temporary_unlock_until` 参数的原始值（jsonb）。 */
  temporaryUnlockUntil: unknown;
  /** 当前时刻（默认 now），测试可注入。 */
  now?: Date;
};

/**
 * 判断当前是否允许维护出货计划。
 * 优先级：有效临时解锁 > 开放星期；非法开放星期配置 → fail closed（禁止编辑 + 明确报错）。
 */
export function assertShippingEditAllowed(input: ShippingWindowInput) {
  const unlockUntil = input.temporaryUnlockUntil;
  if (unlockUntil != null && String(unlockUntil).trim() !== "" && String(unlockUntil) !== "null") {
    const until = Date.parse(String(unlockUntil));
    if (Number.isNaN(until)) throw new ForbiddenException("系统参数 shipping_temporary_unlock_until 配置非法，出货计划已按安全策略关闭编辑，请联系系统管理员。");
    if (until > (input.now ?? new Date()).getTime()) return { allowed: true, reason: "TEMPORARY_UNLOCK" as const };
  }
  let weekdays: number[];
  try {
    weekdays = resolveShippingEditWeekdays(input.editWeekday);
  } catch {
    throw new ForbiddenException("系统参数 shipping_edit_weekday 配置非法（应为 1~7，多个用英文逗号分隔，例如 2,4,5），出货计划已按安全策略关闭编辑，请联系系统管理员。");
  }
  const today = shanghaiWeekday(input.now ?? new Date());
  if (!weekdays.includes(today)) {
    throw new ForbiddenException(`出货计划仅在配置的开放星期可编辑（当前开放：${weekdays.join(",")}；今天为 ${today}）；如需临时调整，请由系统管理员设置临时解锁时间`);
  }
  return { allowed: true, reason: "EDIT_WEEKDAY" as const };
}

/** 上海时区的 ISO 星期（1=周一 … 7=周日）。 */
export function shanghaiWeekday(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", weekday: "short" }).formatToParts(now);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
  return index + 1;
}
