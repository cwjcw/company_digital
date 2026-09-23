import { ForbiddenException } from "@nestjs/common";
import { assertShippingEditAllowed, normalizeShippingEditWeekday, parseWeekdays, resolveShippingEditWeekdays, shanghaiWeekday } from "./master-plan.shipping-window";

/**
 * KN-MPS-LIVE-002：出货计划开放星期支持多个星期（英文逗号分隔），并保持原有兼容行为。
 * 非法配置绝不静默放宽：必须 fail closed（禁止编辑 + 明确系统配置错误）。
 */
describe("shipping edit weekday window", () => {
  it.each([
    ["5", [5]],
    ["2,5", [2, 5]],
    ["2,4,5", [2, 4, 5]],
    ["2, 4, 5", [2, 4, 5]],
    ["2,2,5", [2, 5]],
    [" 4 , 4 ", [4]],
    ["1,2,3,4,5,6,7", [1, 2, 3, 4, 5, 6, 7]]
  ])("parses %s into %j", (value, expected) => {
    expect(parseWeekdays(value)).toEqual(expected);
  });

  it.each([["0"], ["8"], ["abc"], ["2,a,5"], ["2，4，5"], [","], [""], ["2,,5"], ["2.5"], ["-1"]])(
    "rejects the illegal configuration %s instead of opening the window", (value) => {
      expect(() => parseWeekdays(value)).toThrow(/非法的开放星期配置/);
    });

  it("keeps the legacy single-value configuration working", () => {
    expect(resolveShippingEditWeekdays("5")).toEqual([5]);
    expect(resolveShippingEditWeekdays(5)).toEqual([5]);
    /* 参数不存在 → 默认周五（既有兼容行为）；存在但为空字符串属于非法配置，必须 fail closed。 */
    expect(resolveShippingEditWeekdays(null)).toEqual([5]);
    expect(resolveShippingEditWeekdays(undefined)).toEqual([5]);
    expect(() => resolveShippingEditWeekdays("")).toThrow(/非法的开放星期配置/);
  });

  it.each([
    ["5", "5"], ["2,5", "2,5"], ["2,4,5", "2,4,5"], ["2, 4, 5", "2,4,5"], ["2,2,4,5", "2,4,5"]
  ])("normalizes the saved value %s to %s", (value, expected) => {
    expect(normalizeShippingEditWeekday(value)).toBe(expected);
  });

  it("uses the exact save-time validation message for invalid weekday input", () => {
    for (const value of ["0", "8", "2,8", "A,5", "2，4，5"]) {
      expect(() => normalizeShippingEditWeekday(value)).toThrow("请输入 1~7 的星期数字，多个星期使用英文逗号分隔，例如：2,4,5");
    }
  });

  it("uses the Shanghai calendar for the weekday", () => {
    /* 2026-09-18 是星期五（Asia/Shanghai）。 */
    expect(shanghaiWeekday(new Date("2026-09-18T04:00:00Z"))).toBe(5);
    /* UTC 周五 20:00 已经是上海周六 04:00 → 必须按上海时区判定。 */
    expect(shanghaiWeekday(new Date("2026-09-18T20:00:00Z"))).toBe(6);
  });

  it("allows editing on any configured weekday and forbids the others", () => {
    const friday = new Date("2026-09-18T04:00:00Z");
    const monday = new Date("2026-09-21T04:00:00Z");
    expect(assertShippingEditAllowed({ editWeekday: "2,4,5", temporaryUnlockUntil: null, now: friday })).toEqual({ allowed: true, reason: "EDIT_WEEKDAY" });
    expect(() => assertShippingEditAllowed({ editWeekday: 2, temporaryUnlockUntil: null, now: friday })).toThrow(ForbiddenException);
    expect(assertShippingEditAllowed({ editWeekday: "1,2,3", temporaryUnlockUntil: null, now: monday })).toEqual({ allowed: true, reason: "EDIT_WEEKDAY" });
  });

  it("keeps the temporary unlock ahead of the weekday window", () => {
    const friday = new Date("2026-09-18T04:00:00Z");
    expect(assertShippingEditAllowed({ editWeekday: 1, temporaryUnlockUntil: "2026-09-19T00:00:00+08:00", now: friday }))
      .toEqual({ allowed: true, reason: "TEMPORARY_UNLOCK" });
    /* 过期解锁不再生效，仍然受开放星期约束。 */
    expect(() => assertShippingEditAllowed({ editWeekday: 1, temporaryUnlockUntil: "2026-09-17T00:00:00+08:00", now: friday })).toThrow(ForbiddenException);
  });

  it("fails closed when the configured weekdays are illegal", () => {
    const friday = new Date("2026-09-18T04:00:00Z");
    for (const value of ["0", "8", "abc", "2,a,5", ","]) {
      let error: unknown;
      try { assertShippingEditAllowed({ editWeekday: value, temporaryUnlockUntil: null, now: friday }); } catch (thrown) { error = thrown; }
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toContain("shipping_edit_weekday");
      expect((error as Error).message).toContain("关闭编辑");
    }
  });

  it("fails closed when the temporary unlock value is unparsable", () => {
    expect(() => assertShippingEditAllowed({ editWeekday: 5, temporaryUnlockUntil: "not-a-date", now: new Date("2026-09-18T04:00:00Z") }))
      .toThrow(/shipping_temporary_unlock_until/);
  });
});
