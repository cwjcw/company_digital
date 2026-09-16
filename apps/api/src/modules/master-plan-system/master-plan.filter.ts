import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { tableFilterDynamicDateKeys, tableFilterOperatorsFor, type TablePermissionFieldDefinition } from "@kdos/contracts";
import { shanghaiToday } from "./master-plan.domain";

/** KN-FILTER-001 正式筛选协议：一个顶层 group（AND/OR），规则只含 field + operator + 操作数。 */
export type TypedFilterRule = {
  field?: unknown; operator?: unknown;
  value?: unknown; values?: unknown; min?: unknown; max?: unknown; dynamic?: unknown;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const datetimePattern = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
const maxRules = 50;

export const isBlankFilterValue = (value: unknown) => value == null || String(value).trim() === "";

/** 动态日期区间：服务端按 Asia/Shanghai 计算，客户端不得下发日期范围。 */
export function dynamicDateRange(key: string, today = shanghaiToday()) {
  const base = new Date(`${today}T00:00:00.000Z`);
  const shift = (days: number) => new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const weekday = (base.getUTCDay() + 6) % 7;
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: shift(-1), to: shift(-1) };
    case "this_week": return { from: shift(-weekday), to: shift(6 - weekday) };
    case "last_week": return { from: shift(-weekday - 7), to: shift(-weekday - 1) };
    case "this_month": return { from: `${today.slice(0, 7)}-01`, to: new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) };
    case "last_month": {
      const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 0));
      return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
    }
    case "last_7_days": return { from: shift(-6), to: today };
    case "last_30_days": return { from: shift(-29), to: today };
    case "this_year": return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default: throw new BadRequestException(`动态日期关键字无效：${String(key)}`);
  }
}

export function parseFilterGroup(input: unknown): { logic: "AND" | "OR"; rules: TypedFilterRule[] } {
  if (input == null || input === "") return { logic: "AND", rules: [] };
  let value: unknown = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input); } catch { throw new BadRequestException("高级筛选条件格式无效"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("高级筛选条件格式无效");
  const raw = value as { logic?: unknown; rules?: unknown };
  /* 兼容界面上的“所有/任一”表述：ALL=AND、ANY=OR；其余取值一律拒绝。 */
  const rawLogic = raw.logic == null ? "AND" : String(raw.logic).toUpperCase();
  const logic = rawLogic === "ALL" ? "AND" : rawLogic === "ANY" ? "OR" : rawLogic;
  if (logic !== "AND" && logic !== "OR") throw new BadRequestException("高级筛选组合方式只能是“所有(AND)”或“任一(OR)”");
  if (!Array.isArray(raw.rules)) throw new BadRequestException("高级筛选条件格式无效");
  if (raw.rules.length > maxRules) throw new BadRequestException(`高级筛选单次最多 ${maxRules} 条条件`);
  return { logic, rules: raw.rules as TypedFilterRule[] };
}

/**
 * 统一安全筛选编译器：字段类型、可筛选性与操作符全部取自服务端 metadata；
 * 客户端只能提交 field + operator + 操作数，列名/表达式/CAST/SQL 结构一律由服务端决定。
 * 每个字段都必须通过当前用户的字段读权限校验，避免用隐藏字段做侧信道推断。
 */
export class MasterPlanFilterCompiler {
  constructor(
    private readonly fields: TablePermissionFieldDefinition[],
    private readonly expressions: Record<string, string>,
    private readonly canFilterField: (fieldKey: string) => boolean,
    private readonly expression: (column: string) => string,
    /** 字典类字段的 label → value 解析（沿用全项目唯一字典定义）。 */
    private readonly resolveOptionValues: (field: string, raw: string) => string[] | null = () => null
  ) {}

  compile(input: unknown, params: unknown[]): string {
    const { logic, rules } = parseFilterGroup(input);
    const clauses = rules.map((rule) => this.compileRule(rule, params)).filter(Boolean);
    if (!clauses.length) return "true";
    return `(${clauses.join(logic === "OR" ? " OR " : " AND ")})`;
  }

  /** 供 metadata/测试读取：字段可用的操作符与组合方式（不接受客户端 type）。 */
  describe(input: unknown) {
    const { logic, rules } = parseFilterGroup(input);
    return { logic, rules: rules.map((rule) => ({ field: String(rule.field ?? ""), operator: String(rule.operator ?? "") })) };
  }

  private compileRule(rule: TypedFilterRule, params: unknown[]): string {
    const key = String(rule.field ?? "");
    const field = this.fields.find((candidate) => candidate.key === key);
    if (!field) throw new BadRequestException(`字段 ${key} 不允许筛选`);
    if (!this.canFilterField(key)) throw new ForbiddenException(`当前权限组不能按该字段筛选：${field.label}`);
    const column = this.expressions[key];
    if (!column) throw new BadRequestException(`字段 ${field.label} 暂不支持筛选`);
    const operator = String(rule.operator ?? "");
    const allowed = tableFilterOperatorsFor(field).map((definition) => definition.operator as string);
    if (!allowed.includes(operator)) throw new BadRequestException(`字段“${field.label}”不支持该筛选方式`);
    const target = this.expression(column);
    const text = `${target}::text`;

    if (operator === "is_empty") return `COALESCE(${text},'')=''`;
    if (operator === "is_not_empty") return `COALESCE(${text},'')<>''`;
    if (operator === "is_true") return `${target} IS TRUE`;
    if (operator === "is_false") return `${target} IS NOT TRUE`;

    if (field.type === "attachment") {
      const length = `COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(to_jsonb(${target}))='array' THEN to_jsonb(${target}) ELSE '[]'::jsonb END),0)`;
      if (operator === "has_attachment") return `${length}>0`;
      if (operator === "has_no_attachment") return `${length}=0`;
      throw new BadRequestException(`字段“${field.label}”不支持该筛选方式`);
    }

    if (field.multiple) return this.compileMultiple(field, operator, rule, target, params);

    if (["date_eq", "date_before", "date_after", "date_between", "date_dynamic"].includes(operator)) {
      const asDate = field.type === "datetime" ? `${target}` : `${target}::date`;
      if (operator === "date_dynamic") {
        const keyword = String(rule.dynamic ?? "");
        if (!(tableFilterDynamicDateKeys as readonly string[]).includes(keyword)) throw new BadRequestException(`动态日期关键字无效：${keyword}`);
        const { from, to } = dynamicDateRange(keyword);
        params.push(from, to);
        return `(${asDate} >= $${params.length - 1}::date AND ${asDate} < ($${params.length}::date + interval '1 day'))`;
      }
      if (operator === "date_between") {
        const from = this.dateOperand(rule.min, field.label); const to = this.dateOperand(rule.max, field.label);
        params.push(from, to);
        return `(${asDate} >= $${params.length - 1}::date AND ${asDate} < ($${params.length}::date + interval '1 day'))`;
      }
      const value = this.dateOperand(rule.value, field.label);
      params.push(value);
      if (operator === "date_eq") return `(${asDate} >= $${params.length}::date AND ${asDate} < ($${params.length}::date + interval '1 day'))`;
      if (operator === "date_before") return `${asDate} < $${params.length}::date`;
      return `${asDate} >= ($${params.length}::date + interval '1 day')`;
    }

    if (["gt", "gte", "lt", "lte", "between"].includes(operator) || (field.type === "number" && ["eq", "neq", "in", "not_in"].includes(operator))) {
      const asNumber = `NULLIF(${text},'')::numeric`;
      if (operator === "between") {
        const min = this.numberOperand(rule.min, field.label); const max = this.numberOperand(rule.max, field.label);
        params.push(min, max);
        return `${asNumber} BETWEEN $${params.length - 1}::numeric AND $${params.length}::numeric`;
      }
      const values = operator === "in" || operator === "not_in"
        ? this.listOperands(rule, field.label).map((entry) => this.numberOperand(entry, field.label))
        : [this.numberOperand(rule.value, field.label)];
      params.push(values);
      const index = `$${params.length}::numeric[]`;
      if (operator === "in") return `${asNumber} =ANY(${index})`;
      if (operator === "not_in") return `(${asNumber} IS NULL OR ${asNumber} <>ALL(${index}))`;
      const compare = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[operator]!;
      return `${asNumber} ${compare} ${index}[1]`;
    }

    if (operator === "contains" || operator === "not_contains" || operator === "starts_with") {
      const raw = this.textOperand(rule.value, field.label);
      params.push(operator === "starts_with" ? `${raw}%` : `%${raw}%`);
      return `COALESCE(${text},'') ${operator === "not_contains" ? "NOT ILIKE" : "ILIKE"} $${params.length}`;
    }

    if (operator === "in" || operator === "not_in") {
      const values = this.resolveValues(field, this.listOperands(rule, field.label));
      params.push(values);
      const index = `$${params.length}::text[]`;
      return operator === "in" ? `${text} =ANY(${index})` : `COALESCE(${text},'') <>ALL(${index})`;
    }

    /* eq / neq：字典类字段先按 label/value 解析成稳定 value（全项目唯一字典定义）。 */
    const raw = this.textOperand(rule.value, field.label);
    const resolved = this.resolveValues(field, [raw]);
    if (!resolved.length) return "1=0";
    params.push(resolved);
    const index = `$${params.length}::text[]`;
    return operator === "neq" ? `COALESCE(${text},'') <>ALL(${index})` : `${text} =ANY(${index})`;
  }

  private compileMultiple(field: TablePermissionFieldDefinition, operator: string, rule: TypedFilterRule, target: string, params: unknown[]): string {
    const array = `(CASE WHEN jsonb_typeof(to_jsonb(${target}))='array' THEN to_jsonb(${target}) ELSE '[]'::jsonb END)`;
    const length = `COALESCE(jsonb_array_length(${array}),0)`;
    if (operator === "is_empty") return `${length}=0`;
    if (operator === "is_not_empty") return `${length}>0`;
    if (operator === "count_eq" || operator === "count_gte" || operator === "count_lte") {
      const value = this.numberOperand(rule.value, field.label);
      params.push(value);
      const compare = operator === "count_eq" ? "=" : operator === "count_gte" ? ">=" : "<=";
      return `${length} ${compare} $${params.length}::numeric`;
    }
    const values = this.resolveValues(field, this.listOperands(rule, field.label));
    params.push(values);
    const index = `$${params.length}::text[]`;
    const elements = `(SELECT element FROM jsonb_array_elements_text(${array}) element)`;
    if (operator === "contains_any") return `EXISTS (SELECT 1 FROM ${elements} value WHERE value =ANY(${index}))`;
    if (operator === "contains_all") return `(SELECT count(DISTINCT value) FROM ${elements} value WHERE value =ANY(${index})) = ${values.length}`;
    if (operator === "not_contains_any") return `NOT EXISTS (SELECT 1 FROM ${elements} value WHERE value =ANY(${index}))`;
    throw new BadRequestException(`字段“${field.label}”不支持该筛选方式`);
  }

  private resolveValues(field: TablePermissionFieldDefinition, raw: string[]) {
    if (!field.options?.length) return raw;
    const resolved = raw.map((value) => {
      const matched = this.resolveOptionValues(field.key, value);
      return matched?.length ? matched : [value];
    });
    return [...new Set(resolved.flat())];
  }

  private textOperand(value: unknown, label: string) {
    if (isBlankFilterValue(value)) throw new BadRequestException(`请填写“${label}”的筛选值`);
    const text = String(value).trim();
    if (text.length > 500) throw new BadRequestException(`“${label}”筛选值过长`);
    return text;
  }

  private numberOperand(value: unknown, label: string) {
    if (isBlankFilterValue(value)) throw new BadRequestException(`请填写“${label}”的筛选数值`);
    const text = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new BadRequestException(`“${label}”的筛选值必须是数字`);
    return text;
  }

  private dateOperand(value: unknown, label: string) {
    const text = this.textOperand(value, label);
    if (label && !(datePattern.test(text) || datetimePattern.test(text))) throw new BadRequestException(`“${label}”的筛选日期格式应为 YYYY-MM-DD`);
    return text.slice(0, 10);
  }

  private listOperands(rule: TypedFilterRule, label: string) {
    const raw = Array.isArray(rule.values) ? rule.values : isBlankFilterValue(rule.value) ? [] : [rule.value];
    const values = raw.map((value) => this.textOperand(value, label));
    if (!values.length) throw new BadRequestException(`“${label}”至少需要一个筛选值`);
    if (values.length > maxRules) throw new BadRequestException(`“${label}”的筛选值过多`);
    return values;
  }
}

export { uuidPattern as filterUuidPattern, maxRules as maxFilterRules };
