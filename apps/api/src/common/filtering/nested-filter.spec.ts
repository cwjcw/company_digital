import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { parseFilterGroup } from "./filter.contract";
import { SqlFilterCompiler } from "./sql-filter.compiler";

const fields: TablePermissionFieldDefinition[] = [
  { key: "customer", label: "客户", type: "text", editable: false },
  { key: "division", label: "事业部", type: "dictionary", editable: false },
  { key: "department", label: "部门", type: "text", editable: false }
];
const expressions = { customer: "record.customer", division: "record.division", department: "record.department" };
const compiler = (readable = (key: string) => key !== "department") => new SqlFilterCompiler(fields, expressions, readable);

describe("KN-TABLE-COLUMN-MENU-001 recursive FilterGroup", () => {
  it("保持旧 flat AND/OR 协议", () => {
    expect(parseFilterGroup({ logic: "OR", rules: [{ field: "customer", operator: "eq", value: "A" }] }))
      .toEqual({ logic: "OR", rules: [{ field: "customer", operator: "eq", value: "A" }] });
    const params: unknown[] = [];
    expect(compiler().compile({ logic: "OR", rules: [{ field: "customer", operator: "eq", value: "A" }] }, params)).toContain("record.customer");
    expect(params).toEqual([["A"]]);
  });

  it("高级 OR 与列头 AND，保留同字段值/未填写的 OR", () => {
    const group = { logic: "AND", rules: [], groups: [
      { logic: "OR", rules: [{ field: "customer", operator: "eq", value: "A" }, { field: "customer", operator: "eq", value: "B" }] },
      { logic: "AND", rules: [], groups: [{ logic: "OR", rules: [
        { field: "division", operator: "in", values: ["二部", "三部"] }, { field: "division", operator: "is_empty" }
      ] }] }
    ] };
    const params: unknown[] = [];
    const sql = compiler().compile(group, params);
    expect(sql).toMatch(/record\.customer.* OR .*record\.customer/);
    expect(sql).toMatch(/ AND /);
    expect(sql).toMatch(/record\.division.* OR .*record\.division/);
    expect(params).toEqual([["A"], ["B"], ["二部", "三部"]]);
  });

  it("递归校验字段权限、未知字段与操作符", () => {
    const nested = (rule: object) => ({ logic: "AND", rules: [], groups: [{ logic: "OR", rules: [rule] }] });
    expect(() => compiler().compile(nested({ field: "department", operator: "eq", value: "秘密" }), [])).toThrow(ForbiddenException);
    expect(() => compiler().compile(nested({ field: "ghost", operator: "eq", value: "X" }), [])).toThrow(BadRequestException);
    expect(() => compiler().compile(nested({ field: "customer", operator: "between", min: 1, max: 2 }), [])).toThrow(BadRequestException);
  });

  it("拒绝超过四层和累计超过50条规则", () => {
    const deep = { logic: "AND", rules: [], groups: [{ logic: "AND", rules: [], groups: [{ logic: "AND", rules: [], groups: [{ logic: "AND", rules: [], groups: [{ logic: "AND", rules: [] }] }] }] }] };
    expect(() => parseFilterGroup(deep)).toThrow(BadRequestException);
    const excessive = { logic: "AND", rules: Array.from({ length: 26 }, () => ({ field: "customer", operator: "eq", value: "A" })), groups: [
      { logic: "AND", rules: Array.from({ length: 25 }, () => ({ field: "customer", operator: "eq", value: "B" })) }
    ] };
    expect(() => parseFilterGroup(excessive)).toThrow(BadRequestException);
  });
});
