import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { FieldCandidateService } from "./field-candidate.service";
import { TableFilterRegistry, type TableFilterActor } from "./table-filter.registry";
import { OrganizationDirectoryService } from "../../modules/organization-directory/organization-directory.service";
import { DataSource } from "typeorm";
import { isTableFieldFilterable, referenceLabelFieldsFor } from "@kdos/contracts";

type FilterRequest = Request & { user: any; requestId: string };

/**
 * KN-FILTER-001 平台级筛选接口：所有正式业务表统一使用这一入口，
 * 模块不得依赖其它模块（例如 master-plan-system）的筛选 URL。
 */
@ApiTags("表格筛选平台")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("table-filters")
export class TableFilterController {
  constructor(
    private readonly candidates: FieldCandidateService,
    private readonly registry: TableFilterRegistry,
    private readonly directory: OrganizationDirectoryService,
    private readonly dataSource: DataSource
  ) {}

  @Get("candidates")
  async candidateOptions(@Query("resource") resource: string, @Query("field") field: string, @Query("search") search: string, @Query("limit") limit: string, @Req() request: FilterRequest) {
    const actor = this.actor(request);
    const source = this.registry.get(String(resource ?? ""));
    const params: unknown[] = [actor.tenantId];
    const scope = source.buildScope(actor, params);
    return this.candidates.resolve(String(field ?? ""), search, limit, {
      fields: source.fields,
      expressions: Object.fromEntries(Object.entries(source.columns).map(([key, column]) => [key, `record.${column}`])),
      canReadField: (key) => actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.permissions.includes(`${source.code}:${key}:read`) || actor.permissions.includes(`${source.code}:${key}:update`) || actor.permissions.includes(`${source.code}:*:read`),
      scopedSource: `${source.table} record`,
      scopedWhere: `record.tenant_id=$1 AND ${scope}`,
      scopedParams: params,
      referenceCandidates: (referenceResource, term, size, binding) => this.referenceCandidates(referenceResource, binding, term, size, actor),
      departmentCandidates: async (term, size) => (await this.directory.listEnabled())
        .filter((option) => !term || option.name.includes(term) || option.pathLabel.includes(term))
        .slice(0, size).map((option) => ({ value: option.id, label: option.pathLabel })),
      memberCandidates: async (term, size) => (await this.dataSource.query(
        `SELECT id, COALESCE(NULLIF(display_name,''),username) label FROM users WHERE enabled=true${term ? " AND (COALESCE(display_name,'') ILIKE $1 OR username ILIKE $1)" : ""} ORDER BY label LIMIT $${term ? 2 : 1}`,
        term ? [`%${term}%`, size] : [size]
      )).map((row: { id: string; label: string }) => ({ value: row.id, label: row.label }))
    });
  }

  /**
   * 平台已接入筛选的资源清单（含可筛选字段）：前端据此判断是否展示正式高级筛选，
   * 未接入资源不得出现“条件可填写但服务端忽略”的假筛选。
   */
  @Get("resources")
  registeredResources() {
    return this.registry.codes().sort().map((code) => {
      const source = this.registry.get(code);
      return {
        code,
        filterableFields: source.fields.filter((field) => isTableFieldFilterable(field)).map((field) => field.key)
      };
    });
  }

  private actor(request: FilterRequest): TableFilterActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: request.user?.sub ?? null,
      permissions: request.user?.permissions ?? [],
      isSystemAdmin: request.user?.isSystemAdmin === true,
      moduleAdminCodes: request.user?.moduleAdminCodes ?? [],
      tableDataScopes: request.user?.tableDataScopes ?? []
    };
  }

  /**
   * 关联字段候选：优先使用已注册的资源来源（platform registry），
   * 标签列取自字段 metadata 的 filterBinding.labelField（逗号分隔可多列），
   * 因此不会暴露未接入或无权限的业务对象。
   */
  private async referenceCandidates(referenceResource: string, binding: { valueField?: string; labelField?: string } | undefined, term: string, size: number, actor: TableFilterActor) {
    const target = this.registry.get(referenceResource);
    const params: unknown[] = [actor.tenantId];
    let clause = `record.tenant_id=$1 AND ${target.buildScope(actor, params)}`;
    /* 标签列来自字段显式 labelField 或目标资源的标签定义；缺失时直接拒绝，不允许猜测。 */
    const labelColumns = referenceLabelFieldsFor(referenceResource, binding?.labelField);
    if (!labelColumns.length) throw new BadRequestException(`关联字段缺少标签定义：${referenceResource}`);
    const labelExpression = labelColumns.length > 1
      ? `concat_ws(' / ',${labelColumns.map((column) => `record.${column}`).join(",")})`
      : `record.${labelColumns[0] ?? "id"}::text`;
    const valueExpression = `record.${binding?.valueField ?? "id"}`;
    if (term) {
      params.push(`%${term}%`);
      clause += ` AND COALESCE(${labelExpression},'') ILIKE $${params.length}`;
    }
    params.push(size);
    const rows = await this.dataSource.query(`SELECT ${valueExpression} value, COALESCE(${labelExpression},${valueExpression}::text) label FROM ${target.table} record WHERE ${clause} ORDER BY label LIMIT $${params.length}`, params);
    return rows.map((row: { value: string; label: string }) => ({ value: row.value, label: row.label }));
  }
}
