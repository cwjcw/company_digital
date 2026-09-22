import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { FieldCandidateService } from "./field-candidate.service";
import { SqlFilterCompiler } from "./sql-filter.compiler";
import { parseFilterGroup, type ParsedFilterGroup } from "./filter.contract";
import { TableFilterRegistry, type TableFilterActor } from "./table-filter.registry";
import { OrganizationDirectoryService } from "../../modules/organization-directory/organization-directory.service";
import { DataSource } from "typeorm";
import { isTableFieldFilterable, referenceLabelFieldsFor, tableFilterResourceCapabilityOf, tableResourceRegistry, type TablePermissionFieldDefinition } from "@kdos/contracts";

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
  async candidateOptions(@Query() query: Record<string, string | undefined>, @Req() request: FilterRequest) {
    const actor = this.actor(request);
    const registeredSource = this.registry.get(String(query.resource ?? ""));
    const context = { ...this.context(query.context), ...(query.view === "PENDING" ? { view: "PENDING" } : {}) };
    const source = { ...registeredSource, ...registeredSource.candidateVariant?.(context) };
    source.authorize?.(actor);
    this.assertReadResource(actor, source.code);
    const params: unknown[] = [actor.tenantId];
    const scope = source.buildScope(actor, params);
    const clauses = [this.scopedWhere(source, scope), await source.buildContext?.(context, params) ?? "1=1"];
    const tableSearch = String(query.tableSearch ?? "").trim();
    if (tableSearch) {
      const columns = this.searchExpressions(source, actor);
      params.push(`%${tableSearch}%`);
      clauses.push(columns.length ? `(${columns.map((column) => `COALESCE(${column}::text,'') ILIKE $${params.length}`).join(" OR ")})` : "1=0");
    }
    const advanced = parseFilterGroup(query.advancedFilterGroup);
    const header = parseFilterGroup(query.headerFilterGroup);
    const currentField = String(query.currentHeaderField ?? query.field ?? "");
    const withoutSelf = this.withoutHeaderField(header, currentField);
    const group: ParsedFilterGroup = { logic: "AND", rules: [], groups: [advanced, withoutSelf] };
    const compiler = new SqlFilterCompiler(source.fields, this.expressions(source), (key) => this.canReadField(actor, source.code, key));
    clauses.push(compiler.compile(group, params));
    const result = await this.candidates.resolveWithMeta(String(query.field ?? ""), query.search, query.limit, {
      fields: source.fields,
      expressions: this.expressions(source),
      canReadField: (key) => this.canReadField(actor, source.code, key),
      scopedSource: `${source.table} record`,
      scopedWhere: clauses.filter((clause) => clause !== "true").join(" AND "),
      scopedParams: params,
      executor: source.runQuery,
      referenceCandidates: (referenceResource, term, size, binding) => this.referenceCandidates(referenceResource, binding, term, size, actor),
      dictionaryCandidates: source.dictionaryCandidates,
      departmentCandidates: source.departmentCandidates ?? (async (term, size) => (await this.directory.listEnabled())
        .filter((option) => !term || option.name.includes(term) || option.pathLabel.includes(term))
        .slice(0, size).map((option) => ({ value: option.id, label: option.pathLabel }))),
      memberCandidates: source.memberCandidates ?? (async (term, size) => (await this.dataSource.query(
        `SELECT id, COALESCE(NULLIF(display_name,''),username) label FROM users WHERE enabled=true${term ? " AND (COALESCE(display_name,'') ILIKE $1 OR username ILIKE $1)" : ""} ORDER BY label LIMIT $${term ? 2 : 1}`,
        term ? [`%${term}%`, size] : [size]
      )).map((row: { id: string; label: string }) => ({ value: row.id, label: row.label })))
    });
    return query.withMeta === "1" ? result : result.options;
  }

  private withoutHeaderField(group: ParsedFilterGroup, field: string): ParsedFilterGroup {
    return { logic: group.logic, rules: group.rules.filter((rule) => rule.field !== field),
      ...(group.groups ? { groups: group.groups.map((child) => this.withoutHeaderField(child, field)) } : {}) };
  }

  /**
   * KN-FILTER-001 平台统一读取入口：任意已注册资源都可以用同一套
   * 权限 → 租户 → 数据范围 → 快速搜索 → FilterGroup → 排序 → 分页 的语义读取当前页与总数。
   * 只返回调用者拥有字段读权限的列，绝不返回整表列（例如用户口令哈希）。
   */
  @Get("rows")
  async rows(@Query() query: Record<string, string | undefined>, @Req() request: FilterRequest) {
    const actor = this.actor(request);
    const source = this.registry.get(String(query.resource ?? ""));
    source.authorize?.(actor);
    this.assertReadResource(actor, source.code);
    const params: unknown[] = [actor.tenantId];
    const clauses = [this.scopedWhere(source, source.buildScope(actor, params)), await source.buildContext?.(this.context(query.context), params) ?? "1=1"];
    const search = String(query.search ?? "").trim();
    if (search) {
      params.push(`%${search}%`);
      const columns = this.searchExpressions(source, actor);
      clauses.push(columns.length
        ? `(${columns.map((column) => `COALESCE(${column}::text,'') ILIKE $${params.length}`).join(" OR ")})`
        : "1=0");
    }
    if (query.filterGroup != null && String(query.filterGroup).trim() !== "") {
      const compiler = new SqlFilterCompiler(
        source.fields,
        this.expressions(source),
        (key: string) => this.canReadField(actor, source.code, key),
        (column: string) => column
      );
      clauses.push(compiler.compile(query.filterGroup, params));
    }
    const where = clauses.filter((clause) => clause && clause !== "1=1").join(" AND ") || "1=1";
    const sortKey = String(query.sortField ?? "");
    const sortColumn = source.columns[sortKey] ?? source.expressions?.[sortKey];
    const sortAlias = source.sortAliases?.[sortKey];
    if (sortKey && (!sortColumn && !sortAlias || !source.fields.some((field) => field.key === (sortAlias?.permissionField ?? sortKey)))) throw new BadRequestException("排序字段无效");
    if (sortKey && !this.canReadField(actor, source.code, sortAlias?.permissionField ?? sortKey)) throw new ForbiddenException("当前权限组不能按该字段排序");
    const sortExpression = sortKey ? sortAlias?.expression ?? this.expressions(source)[sortKey] : undefined;
    const requestedPageSize = Number(query.pageSize);
    const pageSize = [20, 50, 100, 200].includes(requestedPageSize) ? requestedPageSize : 50;
    const page = Math.max(Number(query.page) || 1, 1);
    const selected = [
      ...Object.entries(source.columns).filter(([key]) => this.canReadField(actor, source.code, key)).map(([key, column]) => `record.${column} AS "${key}"`),
      ...Object.entries(source.expressions ?? {}).filter(([key]) => !source.columns[key] && this.canReadField(actor, source.code, key)).map(([key, expression]) => `${expression} AS "${key}"`)
    ];
    if (!selected.length) throw new ForbiddenException("当前权限组没有可读字段");
    const run = source.runQuery ?? ((sql: string, values: unknown[]) => this.dataSource.query(sql, values));
    const [{ count }] = await run(`SELECT count(*)::integer count FROM ${source.table} record WHERE ${where}`, params) as Array<{ count: number }>;
    const paged = [...params, pageSize, (page - 1) * pageSize];
    const rows = await run(
      `SELECT ${selected.join(",")} FROM ${source.table} record WHERE ${where} ORDER BY ${sortExpression ?? (source.columns.id ? "record.id" : "record.ctid")} ${String(query.sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC"} NULLS LAST LIMIT $${paged.length - 1} OFFSET $${paged.length}`,
      paged
    );
    return { rows, total: Number(count), page, pageSize };
  }

  private defaultSearchColumns(source: { fields: TablePermissionFieldDefinition[]; columns: Record<string, string> }) {
    const searchable = new Set(["text", "number", "dictionary", "reference", "member", "department"]);
    return source.fields.filter((field) => searchable.has(field.type)).map((field) => field.key).filter((key) => Boolean(source.columns[key]));
  }

  private searchExpressions(source: ReturnType<TableFilterRegistry["get"]>, actor: TableFilterActor): string[] {
    return [
      ...(source.searchColumns ?? this.defaultSearchColumns(source))
        .filter((key) => this.canReadField(actor, source.code, key))
        .map((key) => this.expressions(source)[key]),
      ...(source.searchAliases ?? []).filter((alias) => this.canReadField(actor, source.code, alias.permissionField)).map((alias) => alias.expression)
    ].filter((expression): expression is string => Boolean(expression));
  }

  private context(raw: unknown): Record<string, unknown> {
    if (raw == null || raw === "") return {};
    if (typeof raw !== "string" || raw.length > 4000) throw new BadRequestException("表格上下文格式无效");
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
      return value as Record<string, unknown>;
    } catch { throw new BadRequestException("表格上下文格式无效"); }
  }

  private canReadField(actor: TableFilterActor, resource: string, key: string) {
    const definition = tableResourceRegistry.find((item) => item.code === resource);
    return actor.isSystemAdmin === true || actor.permissions.includes("*")
      || Boolean(definition && actor.moduleAdminCodes?.includes(definition.moduleCode))
      || actor.permissions.includes(`${resource}:${key}:read`);
  }

  private assertReadResource(actor: TableFilterActor, resource: string) {
    if (actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.permissions.includes(`${resource}:*:read`)) return;
    throw new ForbiddenException("当前权限组没有此表的查看权限");
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
        capability: tableFilterResourceCapabilityOf(code),
        filterableFields: source.fields.filter((field) => isTableFieldFilterable(field)).map((field) => field.key)
      };
    });
  }

  /**
   * 租户条件由资源自己声明：确有 `tenant_id` 的表必须恒定加租户谓词；
   * ERP 镜像/审计等无租户列的资源显式声明 `tenantColumn: null`，不得伪造条件掩盖真实隔离边界。
   */
  private scopedWhere(source: { tenantColumn?: string | null }, scope: string) {
    const tenant = source.tenantColumn === undefined ? "tenant_id" : source.tenantColumn;
    const clauses = tenant ? [`record.${tenant}=$1`, scope] : [scope];
    const where = clauses.filter((clause) => clause && clause !== "1=1").join(" AND ") || "1=1";
    /* 无租户列的全局配置表（隔离由资源权限承担）不会引用 $1；此时显式给 $1 一个类型，
       否则 PostgreSQL 会报 “could not determine data type of parameter $1”。 */
    if (where.includes("$1")) return where;
    return `$1::text IS NOT NULL AND (${where === "1=1" ? "1=1" : where})`;
  }

  /** 字段 key → 带别名的安全表达式：`columns` 是裸列名，`expressions` 已经是完整表达式。 */
  private expressions(source: { columns: Record<string, string>; expressions?: Record<string, string> }) {
    return {
      ...Object.fromEntries(Object.entries(source.columns).map(([key, column]) => [key, `record.${column}`])),
      ...(source.expressions ?? {})
    };
  }

  private actor(request: FilterRequest): TableFilterActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: request.user?.sub ?? null,
      displayName: request.user?.displayName ?? undefined,
      username: request.user?.username ?? undefined,
      permissions: request.user?.permissions ?? [],
      roles: request.user?.roles ?? [],
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
    target.authorize?.(actor);
    const params: unknown[] = [actor.tenantId];
    let clause = this.scopedWhere(target, target.buildScope(actor, params));
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
    const run = target.runQuery ?? ((sql: string, values: unknown[]) => this.dataSource.query(sql, values));
    const rows = await run(`SELECT ${valueExpression} value, COALESCE(${labelExpression},${valueExpression}::text) label FROM ${target.table} record WHERE ${clause} ORDER BY label LIMIT $${params.length}`, params);
    return rows.map((row: { value: string; label: string }) => ({ value: row.value, label: row.label }));
  }
}
