import { BadRequestException } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { SqlFilterCompiler } from "./sql-filter.compiler";

/**
 * KN-FILTER-003：datetime 高级筛选必须按真实时间点比较（保留时分秒、按 Asia/Shanghai 解释用户输入），
 * date 保持自然日语义不回归，dynamic 仍按 Asia/Shanghai 自然日边界。
 */
const datetimeField = tablePermissionFieldsFor("audit-logs").find((field) => field.key === "createdAt")!;
const dateField = tablePermissionFieldsFor("mps-process-reports").find((field) => field.key === "productionDate")!;
const compiler = () => new SqlFilterCompiler(
  [datetimeField, dateField],
  { createdAt: "created_at", productionDate: "production_date" },
  () => true,
  (column) => column
);
const compile = (rule: Record<string, unknown>) => {
  const params: unknown[] = [];
  const clause = compiler().compile({ logic: "AND", rules: [rule] }, params);
  return { clause, params };
};

describe("KN-FILTER-003 datetime 时间点比较", () => {
  it("gte/lte/gt/lt 使用 timestamptz 真实时间点，且参数保留完整时分秒 + 上海偏移", () => {
    const gte = compile({ field: "createdAt", operator: "gte", value: "2026-09-17 15:30:00" });
    expect(gte.clause).toBe("(created_at >= $1::timestamptz)");
    expect(gte.params).toEqual(["2026-09-17 15:30:00+08:00"]);
    expect(gte.clause).not.toContain("::date");
    expect(gte.clause).not.toContain("interval '1 day'");

    expect(compile({ field: "createdAt", operator: "lte", value: "2026-09-17 15:30:00" }).clause).toBe("(created_at <= $1::timestamptz)");
    expect(compile({ field: "createdAt", operator: "gt", value: "2026-09-17 15:30:00" }).clause).toBe("(created_at > $1::timestamptz)");
    expect(compile({ field: "createdAt", operator: "lt", value: "2026-09-17 15:30:00" }).clause).toBe("(created_at < $1::timestamptz)");
  });

  it("接受 HH:mm 与 ISO 的 T 分隔形式，统一规范化为秒精度上海墙上时间（绝不 slice(0,10)）", () => {
    expect(compile({ field: "createdAt", operator: "gte", value: "2026-09-17 15:30" }).params).toEqual(["2026-09-17 15:30:00+08:00"]);
    expect(compile({ field: "createdAt", operator: "gte", value: "2026-09-17T15:30:25" }).params).toEqual(["2026-09-17 15:30:25+08:00"]);
    /* 关键回归：带时间的操作数绝不能被截断成日期。 */
    for (const value of ["2026-09-17 15:36:25", "2026-09-17T15:36:25"]) {
      expect(compile({ field: "createdAt", operator: "gte", value }).params[0]).toBe("2026-09-17 15:36:25+08:00");
    }
    expect(() => compile({ field: "createdAt", operator: "gte", value: "2026/09/17 15:30" })).toThrow(BadRequestException);
  });

  it("eq 按 UI 精度定义“同一秒”窗口（毫秒值也能命中），neq 为其反逻辑", () => {
    const eq = compile({ field: "createdAt", operator: "eq", value: "2026-09-17 15:36:25" });
    expect(eq.clause).toBe("((created_at >= $1::timestamptz AND created_at < $1::timestamptz + interval '1 second'))");
    expect(eq.params).toEqual(["2026-09-17 15:36:25+08:00"]);
    const neq = compile({ field: "createdAt", operator: "neq", value: "2026-09-17 15:36:25" });
    expect(neq.clause).toContain("NOT (");
    expect(neq.clause).toContain("interval '1 second'");
  });

  it("带毫秒的 datetime 操作数按“同一毫秒”窗口比较", () => {
    const eq = compile({ field: "createdAt", operator: "eq", value: "2026-09-17 15:36:25.427" });
    expect(eq.clause).toContain("interval '1 millisecond'");
    expect(eq.params).toEqual(["2026-09-17 15:36:25.427+08:00"]);
  });

  it("between 保留两个完整时间点（跨零点也不会扩大成整天）", () => {
    const between = compile({ field: "createdAt", operator: "between", min: "2026-09-17 08:30:15", max: "2026-09-17 17:45:50" });
    expect(between.clause).toBe("((created_at >= $1::timestamptz AND created_at <= $2::timestamptz))");
    expect(between.params).toEqual(["2026-09-17 08:30:15+08:00", "2026-09-17 17:45:50+08:00"]);

    const crossMidnight = compile({ field: "createdAt", operator: "between", min: "2026-09-17 23:30:00", max: "2026-09-18 00:30:00" });
    expect(crossMidnight.params).toEqual(["2026-09-17 23:30:00+08:00", "2026-09-18 00:30:00+08:00"]);
    expect(crossMidnight.clause).not.toContain("interval '1 day'");
  });

  it("datetime 的 dynamic 仍按 Asia/Shanghai 自然日边界（今天 = 今日 00:00 ~ 明日 00:00）", () => {
    const today = compile({ field: "createdAt", operator: "dynamic", dynamic: "TODAY" });
    expect(today.clause).toBe("((created_at >= $1::timestamptz AND created_at < $2::timestamptz))");
    const [from, to] = today.params as string[];
    expect(from.endsWith("00:00:00+08:00")).toBe(true);
    expect(to.endsWith("00:00:00+08:00")).toBe(true);
    /* 右边界是下一天的 00:00:00（独占），不是“当前时间 + 24 小时”。 */
    expect(Date.parse(to.replace(" ", "T")) - Date.parse(from.replace(" ", "T"))).toBe(86_400_000);
  });
});

describe("KN-FILTER-003 date 自然日语义不回归", () => {
  it("date eq/gte/lte/gt/lt 仍按自然日边界实现", () => {
    const eq = compile({ field: "productionDate", operator: "eq", value: "2026-09-17" });
    expect(eq.clause).toBe("((production_date::date >= $1::date AND production_date::date < ($2::date + interval '1 day')))");
    expect(eq.params).toEqual(["2026-09-17", "2026-09-17"]);
    expect(compile({ field: "productionDate", operator: "gte", value: "2026-09-17" }).clause).toBe("(production_date::date >= $1::date)");
    expect(compile({ field: "productionDate", operator: "lt", value: "2026-09-17" }).clause).toBe("(production_date::date < $1::date)");
    expect(compile({ field: "productionDate", operator: "gt", value: "2026-09-17" }).clause).toBe("(production_date::date >= ($1::date + interval '1 day'))");
    expect(compile({ field: "productionDate", operator: "lte", value: "2026-09-17" }).clause).toBe("(production_date::date < ($1::date + interval '1 day'))");
    /* date 即使收到 datetime 形式的操作数也只取自然日。 */
    expect(compile({ field: "productionDate", operator: "eq", value: "2026-09-17 15:30:00" }).params).toEqual(["2026-09-17", "2026-09-17"]);
  });

  it("date between 与 dynamic 保持既有自然日区间", () => {
    const between = compile({ field: "productionDate", operator: "between", min: "2026-09-01", max: "2026-09-30" });
    expect(between.clause).toContain("interval '1 day'");
    expect(between.params).toEqual(["2026-09-01", "2026-09-30"]);
    expect(compile({ field: "productionDate", operator: "dynamic", dynamic: "THIS_MONTH" }).clause).toContain("interval '1 day'");
  });
});
