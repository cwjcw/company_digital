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
  referenceCandidates?: (referenceResource: string, search: string, limit: number) => Promise<FieldCandidate[]>;
  /** 部门与成员候选解析器（平台通用目录）。 */
  departmentCandidates?: (search: string, limit: number) => Promise<FieldCandidate[]>;
  memberCandidates?: (search: string, limit: number) => Promise<FieldCandidate[]>;
};

const maxCandidates = 50;

/**
 * KN-FILTER-001 字段候选值服务（平台级）：为高级筛选提供受权限约束的候选值。
 * 服务器必须先完成资源读权限、字段读权限、租户与数据范围裁剪，任何候选都不能泄露用户本来看不到的数据。
 */
@Injectable()
export class FieldCandidateService {
  constructor(private readonly dataSource: DataSource) {}

  async resolve(fieldKey: string, searchInput: unknown, limitInput: unknown, context: CandidateContext): Promise<FieldCandidate[]> {
    const field = context.fields.find((candidate) => candidate.key === fieldKey);
    if (!field) throw new BadRequestException(`字段 ${fieldKey} 不存在`);
    if (!context.canReadField(field.key)) throw new ForbiddenException(`当前权限组不能按该字段筛选：${field.label}`);
    const operators = tableFilterOperatorsFor(field);
    if (!operators.length || field.filterable === false) throw new BadRequestException(`字段“${field.label}”不支持筛选`);
    const search = String(searchInput ?? "").trim();
    const limit = Math.min(maxCandidates, Math.max(1, Math.floor(Number(limitInput) || 20)));

    /* 字典类字段直接复用正式 options（不查历史数据库值）。 */
    if (field.options?.length) {
      return field.options
        .filter((option) => !search || option.label.includes(search) || option.value.includes(search))
        .slice(0, limit)
        .map((option) => ({ value: String(option.value), label: String(option.label) }));
    }
    if (field.type === "department") {
      if (!context.departmentCandidates) throw new BadRequestException("部门候选暂不可用");
      return context.departmentCandidates(search, limit);
    }
    if (field.type === "member") {
      if (!context.memberCandidates) throw new BadRequestException("成员候选暂不可用");
      return context.memberCandidates(search, limit);
    }
    if (field.type === "reference") {
      const referenceResource = field.filterBinding?.referenceResource;
      if (!referenceResource || !context.referenceCandidates) throw new BadRequestException(`字段“${field.label}”缺少候选来源`);
      return context.referenceCandidates(referenceResource, search, limit);
    }
    if (field.type === "boolean") return [{ value: "true", label: "是" }, { value: "false", label: "否" }];
    if (field.type === "date" || field.type === "datetime" || field.type === "structured" || field.type === "attachment") return [];

    /* text：服务端受限去重查询，禁止一次性返回全部 DISTINCT 结果。 */
    const expression = context.expressions[field.key];
    if (!expression) throw new BadRequestException(`字段“${field.label}”暂不支持候选值`);
    const params = [...context.scopedParams];
    let clause = `${context.scopedWhere} AND COALESCE(${expression}::text,'') <> ''`;
    if (search) { params.push(`%${search}%`); clause += ` AND ${expression}::text ILIKE $${params.length}`; }
    params.push(limit);
    const rows = await this.dataSource.query(`SELECT DISTINCT ${expression}::text value FROM ${context.scopedSource} WHERE ${clause} ORDER BY value LIMIT $${params.length}`, params);
    return rows.map((row: { value: string }) => ({ value: String(row.value), label: String(row.value) }));
  }
}
