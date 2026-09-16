import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { MasterPlanFilterCompiler, dynamicDateRange, parseFilterGroup } from "./master-plan.filter";
import { fieldsFor, columnsFor, processReportPendingColumns, processReportPendingFields, MASTER_PLAN_RESOURCE_MAP } from "./master-plan.config";

const expression = (column: string) => column.startsWith("(") ? column : `record.${column}`;

const compilerFor = (code: string, canFilter: (key: string) => boolean = () => true, resolveOptionValues = (_field: string, raw: string) => {
  const options = fieldsFor(MASTER_PLAN_RESOURCE_MAP.get(code as never)!).find((field) => field.key === _field)?.options ?? [];
  const matched = options.filter((option) => option.label === raw || option.value === raw).map((option) => option.value);
  return options.length ? matched : null;
}) => new MasterPlanFilterCompiler(fieldsFor(MASTER_PLAN_RESOURCE_MAP.get(code as never)!), columnsFor(MASTER_PLAN_RESOURCE_MAP.get(code as never)!), canFilter, expression, resolveOptionValues);

describe("KN-FILTER-001 typed filter protocol", () => {
  it("accepts one top-level group with AND/OR and rejects invalid payloads", () => {
    expect(parseFilterGroup('{"logic":"ALL","rules":[]}').logic).toBe("AND");
    expect(parseFilterGroup('{"logic":"OR","rules":[{"field":"itemCode","operator":"contains","value":"1"}]}').logic).toBe("OR");
    expect(parseFilterGroup('{"rules":[{"field":"itemCode","operator":"contains","value":"1"}]}').logic).toBe("AND");
    expect(() => parseFilterGroup("{bad json")).toThrow(BadRequestException);
    expect(() => parseFilterGroup('{"logic":"XOR","rules":[]}')).toThrow("组合方式");
    expect(() => parseFilterGroup(JSON.stringify({ rules: Array.from({ length: 51 }, () => ({ field: "itemCode", operator: "eq", value: "1" })) }))).toThrow("最多 50 条");
    expect(() => parseFilterGroup('{"rules":{}}')).toThrow(BadRequestException);
  });
});

describe("KN-FILTER-001 server filter compiler", () => {
  it("compiles dictionary filters through the shared option resolver (毛坯 → blank)", () => {
    const params: unknown[] = [];
    const clause = compilerFor("mps-process-reports").compile({ logic: "AND", rules: [{ field: "processCode", operator: "eq", value: "毛坯" }] }, params);
    expect(clause).toContain("record.process_code::text =ANY(");
    expect(params).toEqual([["blank"]]);
  });

  it("compiles text, number, date and boolean operators into parameterized SQL", () => {
    const params: unknown[] = [];
    const clause = compilerFor("mps-process-reports").compile({ logic: "AND", rules: [
      { field: "orderNumber", operator: "contains", value: "2026A0" },
      { field: "productionQuantity", operator: "between", min: "1", max: "10" },
      { field: "productionDate", operator: "date_dynamic", dynamic: "this_month" }
    ] }, params);
    expect(clause).toContain("ILIKE $");
    expect(clause).toContain("BETWEEN $");
    expect(clause).toContain("interval '1 day'");
    expect(params).toContain("%2026A0%");
    expect(params).toContain("1");
    expect(params).toContain("10");
  });

  it("computes dynamic date ranges on the server from Asia/Shanghai today", () => {
    const range = dynamicDateRange("this_month", "2026-09-16");
    expect(range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(dynamicDateRange("yesterday", "2026-09-16")).toEqual({ from: "2026-09-15", to: "2026-09-15" });
    expect(dynamicDateRange("last_month", "2026-09-16")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(() => dynamicDateRange("next_century", "2026-09-16")).toThrow(BadRequestException);
  });

  it("supports ALL and ANY combination", () => {
    const all = compilerFor("mps-process-reports").compile({ logic: "AND", rules: [
      { field: "orderNumber", operator: "eq", value: "SO-1" }, { field: "itemCode", operator: "eq", value: "ITEM-1" }
    ] }, []);
    const any = compilerFor("mps-process-reports").compile({ logic: "OR", rules: [
      { field: "orderNumber", operator: "eq", value: "SO-1" }, { field: "itemCode", operator: "eq", value: "ITEM-1" }
    ] }, []);
    expect(all).toContain(" AND ");
    expect(any).toContain(" OR ");
  });

  it("filters multi-value member fields with any/all/count semantics", () => {
    /* 多值字段（数组）用合成定义验证，避免依赖具体资源是否存在该字段。 */
    const multipleFields = [{ key: "responsibleUserIds", label: "责任人", type: "member" as const, editable: true, multiple: true }];
    const multipleColumns = { responsibleUserIds: "responsible_user_ids" };
    const multipleCompiler = () => new MasterPlanFilterCompiler(multipleFields, multipleColumns, () => true, expression);
    const params: unknown[] = [];
    const any = multipleCompiler().compile({ logic: "AND", rules: [{ field: "responsibleUserIds", operator: "contains_any", values: ["user-1"] }] }, params);
    expect(any).toContain("jsonb_array_elements_text");
    expect(any).toContain("EXISTS");
    const all = multipleCompiler().compile({ logic: "AND", rules: [{ field: "responsibleUserIds", operator: "contains_all", values: ["user-1", "user-2"] }] }, []);
    expect(all).toContain("count(DISTINCT value)");
    const count = multipleCompiler().compile({ logic: "AND", rules: [{ field: "responsibleUserIds", operator: "count_gte", value: 1 }] }, []);
    expect(count).toContain("jsonb_array_length");
  });

  it("supports empty / not-empty semantics", () => {
    const empty = compilerFor("mps-process-reports").compile({ rules: [{ field: "itemName", operator: "is_empty" }] }, []);
    const notEmpty = compilerFor("mps-process-reports").compile({ rules: [{ field: "itemName", operator: "is_not_empty" }] }, []);
    expect(empty).toContain("COALESCE(record.item_name::text,'')=''");
    expect(notEmpty).toContain("<>''");
  });

  it("rejects unknown fields, operators for the wrong type, unreadable fields and malformed operands", () => {
    const compiler = compilerFor("mps-process-reports");
    expect(() => compiler.compile({ rules: [{ field: "rawPayload", operator: "eq", value: "1" }] }, [])).toThrow("不允许筛选");
    expect(() => compiler.compile({ rules: [{ field: "productionDate", operator: "contains", value: "1" }] }, [])).toThrow("不支持该筛选方式");
    expect(() => compiler.compile({ rules: [{ field: "productionQuantity", operator: "gt", value: "abc" }] }, [])).toThrow("必须是数字");
    expect(() => compiler.compile({ rules: [{ field: "productionDate", operator: "date_eq", value: "2026-9-1" }] }, [])).toThrow("格式应为 YYYY-MM-DD");
    expect(() => compiler.compile({ rules: [{ field: "itemName", operator: "contains", value: "" }] }, [])).toThrow("请填写");
  });

  it("blocks filter side channels for fields the actor cannot read", () => {
    const compiler = compilerFor("mps-process-reports", (key) => key !== "itemName");
    expect(() => compiler.compile({ rules: [{ field: "itemName", operator: "eq", value: "x" }] }, [])).toThrow(ForbiddenException);
  });

  it("never inlines user input into SQL (injection stays a bound parameter)", () => {
    const params: unknown[] = [];
    const hostile = "' OR 1=1; DROP TABLE mps_process_reports; --";
    const clause = compilerFor("mps-process-reports").compile({ rules: [{ field: "orderNumber", operator: "contains", value: hostile }] }, params);
    expect(clause).not.toContain("DROP TABLE");
    expect(clause).not.toContain("OR 1=1");
    expect(clause).toContain("ILIKE $");
    expect(params).toEqual([`%${hostile}%`]);
  });

  it("compiles the pending view from its own authoritative field definition only", () => {
    const columns = processReportPendingColumns();
    const compiler = new MasterPlanFilterCompiler(processReportPendingFields().filter((field) => !field.input), columns, () => true, expression);
    const clause = compiler.compile({ rules: [
      { field: "processCode", operator: "eq", value: "blank" },
      { field: "remainingQuantity", operator: "gt", value: 0 }
    ] }, []);
    expect(clause).toContain("record.process_code::text =ANY(");
    expect(clause).toContain("record.remaining_quantity");
    expect(() => compiler.compile({ rules: [{ field: "productionQuantity", operator: "gt", value: 1 }] }, [])).toThrow("不允许筛选");
  });
});
