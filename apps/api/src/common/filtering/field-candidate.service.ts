import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { tableFilterOperatorsFor, type TablePermissionFieldDefinition } from "@kdos/contracts";

export type FieldCandidate = { value: string; label: string };
export type CandidateContext = {
  /** 正式字段定义（只能来自服务端 metadata）。 */
  fields: TablePermissionFieldDefinition[];
  /** 字段 key → 安全列表达式（调用方按资源提供）。 */
  expressions: Record<string, string>;
  /** 字段是否可读（调用方已完成权限/数据范围判定）。 */
  canReadField: (fieldKey: string) => boolean;
  /** 资源表来源（含别名，例如 `mps_base_plans record`）。 */
  scopedSource: string;
  /** 租户 + 数据范围条件（调用方必须已包含 tenant 与 scope）。 */
  scopedWhere: string;
  scopedParams: unknown[];
  /** 关联字段候选解析器：reference 字段的候选来源资源。 */
  referenceCandidates?: (referenceResource: string, search: string, limit: number, binding?: TablePermissionFieldDefinition["filterBinding"]) => Promise<FieldCandidate[]>;
  /** 字典/关系型字段候选解析器（优先于类型默认行为）。 */
  dictionaryCandidates?: (fieldKey: string, search: string, limit: number) => Promise<FieldCandidate[]>;
  /** 资源所在库的查询执行器；缺省使用平台默认 DataSource（KDOS 库资源必须提供）。 */
  executor?: (sql: string, params: unknown[]) => Promise<any[]>;
  /** 部门与成员候选解析器（平台通用目录）。 */
  departmentCandidates?: (search: string, limit: number) => Promise<FieldCandidate[]>;
  memberCandidates?: (search: string, limit: number) => Promise<FieldCandidate[]>;
};

const maxCandidates = 200;
export type CandidateResult = { options: FieldCandidate[]; hasMore: boolean };

/**
 * KN-FILTER-001 字段候选值服务（平台级）：为高级筛选提供受权限约束的候选值。
 * 服务器必须先完成资源读权限、字段读权限、租户与数据范围裁剪，任何候选都不能泄露用户本来看不到的数据。
 */
@Injectable()
export class FieldCandidateService {
  constructor(private readonly dataSource: DataSource) {}

  async resolve(fieldKey: string, searchInput: unknown, limitInput: unknown, context: CandidateContext): Promise<FieldCandidate[]> {
    return (await this.resolveWithMeta(fieldKey, searchInput, limitInput, context)).options;
  }

  async resolveWithMeta(fieldKey: string, searchInput: unknown, limitInput: unknown, context: CandidateContext): Promise<CandidateResult> {
    const field = context.fields.find((candidate) => candidate.key === fieldKey);
    if (!field) throw new BadRequestException(`字段 ${fieldKey} 不存在`);
    if (!context.canReadField(field.key)) throw new ForbiddenException(`当前权限组不能按该字段筛选：${field.label}`);
    const operators = tableFilterOperatorsFor(field);
    if (!operators.length || field.filterable === false) throw new BadRequestException(`字段“${field.label}”不支持筛选`);
    const search = String(searchInput ?? "").trim();
    const limit = Math.min(maxCandidates, Math.max(1, Math.floor(Number(limitInput) || 50)));
    if (search.length > 200) throw new BadRequestException("候选搜索词过长");
    if (["date", "datetime", "number", "boolean", "structured", "attachment"].includes(field.type)) return { options: [], hasMore: false };

    /* 候选必须先在当前资源的完整授权数据范围内 DISTINCT；不能把目录/静态选项本身当作可见行。 */
    const expression = context.expressions[field.key];
    if (!expression) throw new BadRequestException(`字段“${field.label}”暂不支持候选值`);
    const params = [...context.scopedParams];
    const labels = new Map<string, string>();
    let matchingValues: string[] | undefined;
    let providerHasMore = false;
    if (field.options?.length) {
      for (const option of field.options) labels.set(String(option.value), String(option.label));
      if (search) matchingValues = field.options.filter((option) => option.label.includes(search) || option.value.includes(search)).map((option) => String(option.value));
    } else {
      const provider = field.type === "dictionary" ? context.dictionaryCandidates && ((term: string, size: number) => context.dictionaryCandidates!(field.key, term, size))
        : field.type === "department" ? context.departmentCandidates
        : field.type === "member" ? context.memberCandidates
        : field.type === "reference" ? (async (term: string, size: number) => {
          const referenceResource = field.filterBinding?.referenceResource;
          if (!referenceResource || !context.referenceCandidates) throw new BadRequestException(`字段“${field.label}”缺少候选来源`);
          return context.referenceCandidates(referenceResource, term, size, field.filterBinding);
        }) : undefined;
      if (provider) {
        const choices = await provider(search, maxCandidates + 1);
        providerHasMore = choices.length > maxCandidates;
        for (const choice of choices) labels.set(String(choice.value), String(choice.label));
        if (search) matchingValues = choices.map((choice) => String(choice.value));
      }
    }
    if (matchingValues && !matchingValues.length) return { options: [], hasMore: false };
    const candidateExpression = field.multiple
      ? "candidate_element.value"
      : `${expression}::text`;
    const from = field.multiple
      ? `${context.scopedSource} CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(to_jsonb(${expression}))='array' THEN to_jsonb(${expression}) ELSE '[]'::jsonb END) AS candidate_element(value)`
      : context.scopedSource;
    let clause = `${context.scopedWhere} AND COALESCE(${candidateExpression},'') <> ''`;
    if (matchingValues) { params.push(matchingValues); clause += ` AND ${candidateExpression} = ANY($${params.length}::text[])`; }
    else if (search) { params.push(`%${search}%`); clause += ` AND ${candidateExpression} ILIKE $${params.length}`; }
    params.push(limit + 1);
    const run = context.executor ?? ((sql: string, values: unknown[]) => this.dataSource.query(sql, values));
    const rows = await run(`SELECT DISTINCT ${candidateExpression} value FROM ${from} WHERE ${clause} ORDER BY value LIMIT $${params.length}`, params);
    const needsOfficialLabel = ["member", "department", "reference"].includes(field.type);
    const visibleRows = rows.slice(0, limit).filter((row: { value: string }) => !needsOfficialLabel || labels.has(String(row.value)));
    const hasMore = rows.length > limit || providerHasMore || visibleRows.length < Math.min(rows.length, limit);
    return { options: visibleRows.map((row: { value: string }) => ({ value: String(row.value), label: labels.get(String(row.value)) ?? String(row.value) })), hasMore };
  }
}
