import { BadRequestException } from "@nestjs/common";

/** KN-FILTER-001 正式筛选协议（平台级）：一个顶层 group（AND/OR），规则只含 field + operator + 操作数。 */
export type TypedFilterRule = {
  field?: unknown; operator?: unknown;
  value?: unknown; values?: unknown; min?: unknown; max?: unknown; dynamic?: unknown;
};

export const maxFilterRules = 50;
export const maxFilterDepth = 4;
export type ParsedFilterGroup = { logic: "AND" | "OR"; rules: TypedFilterRule[]; groups?: ParsedFilterGroup[] };

export const isBlankFilterValue = (value: unknown) => value == null || String(value).trim() === "";

export function parseFilterGroup(input: unknown): ParsedFilterGroup {
  if (input == null || input === "") return { logic: "AND", rules: [] };
  let value: unknown = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input); } catch { throw new BadRequestException("高级筛选条件格式无效"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("高级筛选条件格式无效");
  let ruleCount = 0;
  const parse = (candidate: unknown, depth: number): ParsedFilterGroup => {
  if (depth > maxFilterDepth) throw new BadRequestException(`高级筛选最多嵌套 ${maxFilterDepth} 层`);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new BadRequestException("高级筛选条件格式无效");
  const raw = candidate as { logic?: unknown; rules?: unknown; groups?: unknown };
  /* 兼容界面上的“所有/任一”表述：ALL=AND、ANY=OR；其余取值一律拒绝。 */
  const rawLogic = raw.logic == null ? "AND" : String(raw.logic).toUpperCase();
  const logic = rawLogic === "ALL" ? "AND" : rawLogic === "ANY" ? "OR" : rawLogic;
  if (logic !== "AND" && logic !== "OR") throw new BadRequestException("高级筛选组合方式只能是“所有(AND)”或“任一(OR)”");
  if (!Array.isArray(raw.rules)) throw new BadRequestException("高级筛选条件格式无效");
  if (raw.groups !== undefined && !Array.isArray(raw.groups)) throw new BadRequestException("高级筛选条件格式无效");
  ruleCount += raw.rules.length;
  if (ruleCount > maxFilterRules) throw new BadRequestException(`高级筛选单次最多 ${maxFilterRules} 条条件`);
  const rules = raw.rules.map((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new BadRequestException("高级筛选条件格式无效");
    return rule as TypedFilterRule;
  });
  const groups = raw.groups?.map((group) => parse(group, depth + 1));
  return groups === undefined ? { logic, rules } : { logic, rules, groups };
  };
  return parse(value, 1);
}
