import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { tableFilterOperatorsFor, type TablePermissionFieldDefinition } from "@kdos/contracts";
import { dynamicDateRange } from "./dynamic-date";
import { isBlankFilterValue, maxFilterRules, parseFilterGroup, type TypedFilterRule } from "./filter.contract";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const datetimePattern = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;

export type FilterOptionResolver = (field: string, raw: string) => string[] | null;

/**
 * KDOS 平台级安全筛选编译器（KN-FILTER-001）：所有正式业务表共用这一份实现。
 * 字段类型、可筛选性与操作符全部取自服务端 metadata；客户端只能提交 field + operator + 操作数。
 * 每个字段都必须通过字段读权限校验（防止隐藏字段侧信道），所有值参数化，列名/表达式由调用方按资源映射提供。
 */
export class SqlFilterCompiler {
  constructor(
    private readonly fields: TablePermissionFieldDefinition[],
    private readonly expressions: Record<string, string>,
    private readonly canFilterField: (fieldKey: string) => boolean,
    private readonly expression: (column: string) => string = (column) => column,
    private readonly resolveOptionValues: FilterOptionResolver = () => null,
    /**
     * 参数占位符工厂：默认 `$n`（原生 SQL / dataSource.query）。
     * TypeORM QueryBuilder 传 `(index) => ":f" + index` 即可复用同一编译器，不得另写一套筛选逻辑。
     */
    private readonly placeholder: (index: number) => string = (index) => `$${index}`
  ) {}

  private ph(index: number) { return this.placeholder(index); }

  compile(input: unknown, params: unknown[]): string {
    const { logic, rules } = parseFilterGroup(input);
    const clauses = rules.map((rule) => this.compileRule(rule, params)).filter(Boolean);
    if (!clauses.length) return "true";
    return `(${clauses.join(logic === "OR" ? " OR " : " AND ")})`;
  }

  /** 供 metadata/测试读取：字段与操作符（不接受客户端 type）。 */
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
    }
    if (field.type === "structured") throw new BadRequestException(`字段“${field.label}”不支持筛选`);

    if (field.multiple) return this.compileMultiple(field, operator, rule, target, params);

    /* 日期与时间共用一套操作符（eq/neq/gt/lt/gte/lte/between/dynamic），粒度由字段类型决定。 */
    if (field.type === "date" || field.type === "datetime") {
      const asDate = field.type === "datetime" ? `${target}` : `${target}::date`;
      const range = (from: string, to: string) => {
        params.push(from, to);
        return `(${asDate} >= ${this.ph(params.length - 1)}::date AND ${asDate} < (${this.ph(params.length)}::date + interval '1 day'))`;
      };
      if (operator === "dynamic") { const { from, to } = dynamicDateRange(String(rule.dynamic ?? "")); return range(from, to); }
      if (operator === "between") return range(this.dateOperand(rule.min, field.label), this.dateOperand(rule.max, field.label));
      const value = this.dateOperand(rule.value, field.label);
      if (operator === "eq") return range(value, value);
      if (operator === "neq") return `NOT (${range(value, value)})`;
      params.push(value);
      const bound = `${this.ph(params.length)}::date`;
      if (operator === "gt") return `${asDate} >= (${bound} + interval '1 day')`;
      if (operator === "gte") return `${asDate} >= ${bound}`;
      if (operator === "lt") return `${asDate} < ${bound}`;
      if (operator === "lte") return `${asDate} < (${bound} + interval '1 day')`;
    }

    if (field.type === "number") {
      const asNumber = `NULLIF(${text},'')::numeric`;
      if (operator === "between") {
        const min = this.numberOperand(rule.min, field.label); const max = this.numberOperand(rule.max, field.label);
        params.push(min, max);
        return `${asNumber} BETWEEN ${this.ph(params.length - 1)}::numeric AND ${this.ph(params.length)}::numeric`;
      }
      if (operator === "in" || operator === "not_in") {
        const values = this.listOperands(rule, field.label).map((entry) => this.numberOperand(entry, field.label));
        params.push(values);
        const index = `${this.ph(params.length)}::numeric[]`;
        return operator === "in" ? `${asNumber} =ANY(${index})` : `(${asNumber} IS NULL OR ${asNumber} <>ALL(${index}))`;
      }
      params.push(this.numberOperand(rule.value, field.label));
      const single = `${this.ph(params.length)}::numeric`;
      const compare = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[operator];
      if (!compare) throw new BadRequestException(`字段“${field.label}”不支持该筛选方式`);
      return `${asNumber} ${compare} ${single}`;
    }

    if (operator === "contains" || operator === "not_contains" || operator === "starts_with") {
      const raw = this.textOperand(rule.value, field.label);
      params.push(operator === "starts_with" ? `${raw}%` : `%${raw}%`);
      return `COALESCE(${text},'') ${operator === "not_contains" ? "NOT ILIKE" : "ILIKE"} ${this.ph(params.length)}`;
    }

    if (operator === "in" || operator === "not_in") {
      const values = this.resolveValues(field, this.listOperands(rule, field.label));
      if (!values.length) return "1=0";
      params.push(values);
      const index = `${this.ph(params.length)}::text[]`;
      return operator === "in" ? `${text} =ANY(${index})` : `COALESCE(${text},'') <>ALL(${index})`;
    }

    /* eq / neq：字典类字段先按 label/value 解析成稳定 value（全项目唯一字典定义）。 */
    const raw = this.textOperand(rule.value, field.label);
    const resolved = this.resolveValues(field, [raw]);
    if (!resolved.length) return "1=0";
    params.push(resolved);
    const index = `${this.ph(params.length)}::text[]`;
    return operator === "neq" ? `COALESCE(${text},'') <>ALL(${index})` : `${text} =ANY(${index})`;
  }

  private compileMultiple(field: TablePermissionFieldDefinition, operator: string, rule: TypedFilterRule, target: string, params: unknown[]): string {
    const array = `(CASE WHEN jsonb_typeof(to_jsonb(${target}))='array' THEN to_jsonb(${target}) ELSE '[]'::jsonb END)`;
    const length = `COALESCE(jsonb_array_length(${array}),0)`;
    if (operator === "is_empty") return `${length}=0`;
    if (operator === "is_not_empty") return `${length}>0`;
    if (operator === "count_eq" || operator === "count_gte" || operator === "count_lte") {
      params.push(this.numberOperand(rule.value, field.label));
      const compare = operator === "count_eq" ? "=" : operator === "count_gte" ? ">=" : "<=";
      return `${length} ${compare} ${this.ph(params.length)}::numeric`;
    }
    const values = this.resolveValues(field, this.listOperands(rule, field.label));
    if (!values.length) return operator === "not_contains_any" ? "true" : "1=0";
    params.push(values);
    const index = `${this.ph(params.length)}::text[]`;
    /*
     * 集合函数必须显式声明别名与列名（`AS elements(element)`）：若只写 `jsonb_array_elements_text(...) element`，
     * 表别名会遮住同名输出列，`element` 会解析成整行 record，PostgreSQL 报 “operator does not exist: record = text”。
     */
    const elements = `jsonb_array_elements_text(${array}) AS elements(element)`;
    if (operator === "contains_any") return `EXISTS (SELECT 1 FROM ${elements} WHERE element =ANY(${index}))`;
    if (operator === "contains_all") return `(SELECT count(DISTINCT element) FROM ${elements} WHERE element =ANY(${index})) = ${values.length}`;
    if (operator === "not_contains_any") return `NOT EXISTS (SELECT 1 FROM ${elements} WHERE element =ANY(${index}))`;
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
    if (!(datePattern.test(text) || datetimePattern.test(text))) throw new BadRequestException(`“${label}”的筛选日期格式应为 YYYY-MM-DD`);
    return text.slice(0, 10);
  }

  private listOperands(rule: TypedFilterRule, label: string) {
    const raw = Array.isArray(rule.values) ? rule.values : isBlankFilterValue(rule.value) ? [] : [rule.value];
    const values = raw.map((value) => this.textOperand(value, label));
    if (!values.length) throw new BadRequestException(`“${label}”至少需要一个筛选值`);
    if (values.length > maxFilterRules) throw new BadRequestException(`“${label}”的筛选值过多`);
    return values;
  }
}
