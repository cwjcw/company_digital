import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  isTablePrintFieldPrintable, tablePermissionFieldsFor, tablePrintResourceCapabilityOf, tableResourceRegistry,
  type TablePermissionFieldDefinition, type TableResourceCode
} from "@kdos/contracts";
import { SqlFilterCompiler } from "../filtering/sql-filter.compiler";
import { TableFilterRegistry, recordKeyOf, type TableFilterActor, type TableFilterSource, type TablePrintRowQuery } from "../filtering/table-filter.registry";
import type { TablePrintColumn, TablePrintDto, TablePrintHeaderGroup, TablePrintManifest, TablePrintOrientation } from "./print.contract";

/**
 * 受控批大小：200 与平台分页硬上限一致（不引入新上限、不一次性占满内存，禁止 pageSize=1000000）。
 * 每个批次独立查询，因此总行数不受单次查询限制；超过安全批次数会明确报错而不是静默截断。
 */
export const PRINT_BATCH_SIZE = 200;
/** 前端确认阈值（>300 行需要确认）与超大数据二次警示阈值；都不是硬上限。 */
export const PRINT_CONFIRM_THRESHOLD = 300;
export const PRINT_LARGE_WARNING_THRESHOLD = 3000;
/** 单次渲染的安全批次数上限，用于避免无限循环；超限会明确报错而不是静默截断。 */
const MAX_BATCHES = 400;

export type TablePrintQuery = {
  search?: unknown;
  filterGroup?: unknown;
  sortField?: unknown;
  sortOrder?: unknown;
  /** 页面上下文（部门/状态/角色/视图等），由 resource 的服务端查询解释。 */
  context?: Record<string, unknown>;
  /** 打印模式：显式声明，禁止用 selectedIds 是否为空来猜。 */
  rangeType?: unknown;
  /** 打印已选：稳定记录 ID（后端会重新取数并做权限过滤）。 */
  selectedIds?: unknown;
  /** 客户端只能收窄列集合；后端只做交集。 */
  columnKeys?: unknown;
};

@Injectable()
export class TablePrintService {
  private readonly logger = new Logger(TablePrintService.name);

  constructor(private readonly registry: TableFilterRegistry, private readonly dataSource: DataSource) {}

  /** 打印能力清单：前端据此决定是否显示打印入口（后端仍会二次校验）。 */
  capabilities(actor: TableFilterActor) {
    return tableResourceRegistry.map((resource) => ({
      code: resource.code,
      label: resource.label,
      print: tablePrintResourceCapabilityOf(resource.code),
      allowed: this.hasPrintPermission(actor, resource.code)
    }));
  }

  /** 打印清单：只做 count 与列/方向计算，不加载数据（超大数据先看真实条数再决定）。 */
  async manifest(resourceCode: string, query: TablePrintQuery, actor: TableFilterActor): Promise<TablePrintManifest> {
    const capability = tablePrintResourceCapabilityOf(resourceCode);
    if (capability.status !== "PRINTABLE") {
      throw new ForbiddenException(capability.reason ?? "该表不适用标准表格打印");
    }
    const { source, resource } = this.sourceFor(resourceCode);
    this.assertPrintPermission(actor, resourceCode);
    source.authorize?.(actor);
    if (!this.canReadResource(actor, source)) throw new ForbiddenException("当前权限组没有此表的查看权限");
    const fields = this.printableFields(source, actor, query.columnKeys);
    if (!fields.length) throw new ForbiddenException("当前权限组没有可打印字段");
    const { rangeType, ids: selectedIds } = this.resolveRange(source, query);
    const total = rangeType === "SELECTED"
      ? await this.countSelected(source, actor, query, selectedIds, fields)
      : await this.countFiltered(source, actor, query, fields);
    const columns = this.columnsFor(source, fields);
    return {
      resource: resourceCode,
      title: resource.label,
      printable: true,
      total,
      columns,
      headerGroups: this.headerGroupsFor(source, columns),
      orientation: this.orientationFor(columns),
      batchSize: PRINT_BATCH_SIZE,
      confirmThreshold: PRINT_CONFIRM_THRESHOLD,
      largeWarningThreshold: PRINT_LARGE_WARNING_THRESHOLD
    };
  }

  /** 生成打印 DTO：筛选结果=全部匹配记录（受控分批）；打印已选=按稳定 ID 重新取数。 */
  async render(resourceCode: string, query: TablePrintQuery, actor: TableFilterActor): Promise<TablePrintDto> {
    const manifest = await this.manifest(resourceCode, query, actor);
    const { source, resource } = this.sourceFor(resourceCode);
    const fields = this.printableFields(source, actor, query.columnKeys);
    const columns = this.columnsFor(source, fields);
    const { rangeType, ids: selectedIds } = this.resolveRange(source, query);
    const rows: Array<Record<string, unknown>> = [];
    let batches = 0;
    if (rangeType === "SELECTED") {
      /* 打印已选：后端按稳定 ID 重新取数（权限/租户/范围/字段权限重新校验），顺序沿用当前正式排序。 */
      for (let offset = 0; offset < selectedIds.length; offset += PRINT_BATCH_SIZE) {
        const chunk = selectedIds.slice(offset, offset + PRINT_BATCH_SIZE);
        const page = await this.fetchPage(source, actor, query, fields, 1, PRINT_BATCH_SIZE, chunk);
        rows.push(...page.rows);
        batches += 1;
        if (batches > MAX_BATCHES) throw new BadRequestException("打印数据过多，请进一步筛选后再打印");
      }
    } else {
      let page = 1;
      for (;;) {
        const result = await this.fetchPage(source, actor, query, fields, page, PRINT_BATCH_SIZE);
        rows.push(...result.rows);
        batches += 1;
        if (rows.length >= result.total || result.rows.length < PRINT_BATCH_SIZE) break;
        if (batches >= MAX_BATCHES) throw new BadRequestException(`打印数据超过 ${MAX_BATCHES * PRINT_BATCH_SIZE} 行，请进一步筛选后再打印`);
        page += 1;
      }
    }
    const keyField = recordKeyOf(source).field;
    const resolved = await this.resolveLabels(source, rows, fields, keyField);
    const formatted = rows.map((row) => {
      const output: Record<string, string> = {};
      for (const field of fields) {
        output[field.key] = this.formatValue(field, resolved.get(String(row[keyField]))?.[field.key] ?? row[field.key]);
      }
      return output;
    });
    this.logger.log(`打印 ${resourceCode}：rangeType=${rangeType} requestedCount=${selectedIds.length || "-"} printedCount=${formatted.length} 批次=${batches}`);
    return {
      title: resource.label,
      resource: resourceCode,
      columns,
      headerGroups: this.headerGroupsFor(source, columns),
      rows: formatted,
      meta: {
        resource: resourceCode,
        title: resource.label,
        rangeType,
        total: manifest.total,
        requestedCount: rangeType === "SELECTED" ? selectedIds.length : undefined,
        printedCount: formatted.length,
        orientation: manifest.orientation,
        filtered: Boolean(this.hasFilterGroup(query.filterGroup)),
        searched: String(query.search ?? "").trim() !== "",
        printedAt: new Date().toISOString(),
        printedBy: String(actor.userId ?? ""),
        batchSize: PRINT_BATCH_SIZE,
        batches
      }
    };
  }

  private sourceFor(resourceCode: string) {
    const resource = tableResourceRegistry.find((entry) => entry.code === resourceCode);
    if (!resource) throw new BadRequestException("表单资源不存在");
    const source = this.registry.get(resourceCode);
    return { resource, source };
  }

  private hasPrintPermission(actor: TableFilterActor, resource: string) {
    const permissions = actor.permissions ?? [];
    return actor.isSystemAdmin === true || permissions.includes("*")
      || permissions.includes(`${resource}:*:batch_print`) || permissions.includes(`${resource}:*:*`);
  }

  private assertPrintPermission(actor: TableFilterActor, resource: string) {
    if (!this.hasPrintPermission(actor, resource)) throw new ForbiddenException("没有该表打印权限");
  }

  private canReadResource(actor: TableFilterActor, source: TableFilterSource) {
    if (actor.isSystemAdmin === true || (actor.permissions ?? []).includes("*")) return true;
    const permissions = actor.permissions ?? [];
    return source.fields.some((field) => this.canReadField(actor, source.code, field.key))
      || permissions.includes(`${source.code}:*:read`) || permissions.includes(`${source.code}:*:export`);
  }

  private canReadField(actor: TableFilterActor, resource: string, key: string) {
    const permissions = actor.permissions ?? [];
    return actor.isSystemAdmin === true || permissions.includes("*")
      || permissions.includes(`${resource}:${key}:read`) || permissions.includes(`${resource}:${key}:update`)
      || permissions.includes(`${resource}:*:read`);
  }

  /** 打印列 = 正式 metadata ∩ 字段读权限 ∩ 客户端可收窄集合；客户端无法扩大字段。 */
  private printableFields(source: TableFilterSource, actor: TableFilterActor, columnKeys: unknown) {
    const requested = this.normalizeKeys(columnKeys);
    return tablePermissionFieldsFor(source.code as TableResourceCode)
      .filter((field) => isTablePrintFieldPrintable(field))
      .filter((field) => requested.size === 0 || requested.has(field.key))
      .filter((field) => this.canReadField(actor, source.code, field.key))
      .filter((field) => this.supportsValue(field, source));
  }

  /** 没有列/表达式绑定、也没有批解析器的字段不进入打印（例如纯前端派生的展示字段）。 */
  private supportsValue(field: TablePermissionFieldDefinition, source: TableFilterSource) {
    if (source.columns[field.key] || source.expressions?.[field.key]) return true;
    if (source.printResolvers?.[field.key]) return true;
    return false;
  }

  private normalizeKeys(value: unknown) {
    if (value == null || value === "") return new Set<string>();
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return new Set(list.map((entry) => String(entry).trim()).filter(Boolean));
  }

  /**
   * 解析打印模式（显式 rangeType）：SELECTED 必须带合法稳定 ID，否则 400，绝不退化为 FILTERED；
   * FILTERED 即使误传 selectedIds 也一律忽略。
   */
  private resolveRange(source: TableFilterSource, query: TablePrintQuery) {
    const raw = query.rangeType == null || String(query.rangeType).trim() === "" ? "FILTERED" : String(query.rangeType).toUpperCase();
    if (raw !== "FILTERED" && raw !== "SELECTED") throw new BadRequestException("打印模式只能是 FILTERED 或 SELECTED");
    if (raw === "FILTERED") return { rangeType: "FILTERED" as const, ids: [] as string[] };
    const ids = this.normalizeIds(source, query.selectedIds);
    if (!ids.length) throw new BadRequestException("打印已选必须提供有效的记录 ID");
    return { rangeType: "SELECTED" as const, ids };
  }

  /** 按资源正式主键类型校验稳定 ID（不假设所有 resource 都是 UUID）。 */
  private normalizeIds(source: TableFilterSource, value: unknown): string[] {
    const key = recordKeyOf(source);
    const list = value == null || value === "" ? [] : Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    const ids = list.flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter((entry) => this.isValidKey(key.type, entry));
    return [...new Set(ids)];
  }

  private isValidKey(type: "uuid" | "text" | "integer" | "bigint", value: string) {
    if (!value) return false;
    if (type === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (type === "integer" || type === "bigint") return /^-?\d{1,19}$/.test(value);
    return value.length <= 200;
  }

  private hasFilterGroup(filterGroup: unknown) {
    return filterGroup != null && String(filterGroup).trim() !== "";
  }

  private columnsFor(source: TableFilterSource, fields: TablePermissionFieldDefinition[]): TablePrintColumn[] {
    return fields.map((field) => ({
      key: field.key,
      label: field.printLabel ?? field.label,
      align: field.type === "number" || field.type === "boolean" ? "right" : "left",
      width: this.widthFor(field)
    }));
  }

  private widthFor(field: TablePermissionFieldDefinition) {
    if (field.type === "date" || field.type === "datetime") return 10;
    if (field.type === "boolean" || field.format === "integer") return 6;
    if (field.type === "number") return 9;
    if (field.key === "itemName" || field.key === "remark" || field.key === "description" || field.key === "title") return 22;
    if (field.type === "member" || field.type === "department" || field.type === "reference") return 14;
    return 12;
  }

  /** A4 自动方向：宽表优先横向，列少优先纵向（平台统一判断，各页面不自行猜）。 */
  private orientationFor(columns: TablePrintColumn[]): TablePrintOrientation {
    const total = columns.reduce((sum, column) => sum + column.width, 0);
    return total > 130 ? "landscape" : "portrait";
  }

  private headerGroupsFor(source: TableFilterSource, columns: TablePrintColumn[]): TablePrintHeaderGroup[] {
    const groups = source.printHeaderGroups;
    if (!groups?.length) return [];
    const known = new Set(columns.map((column) => column.key));
    return groups
      .map((group) => ({ label: group.label, columns: group.columns.filter((key) => known.has(key)) }))
      .filter((group) => group.columns.length > 0);
  }

  private async countFiltered(source: TableFilterSource, actor: TableFilterActor, query: TablePrintQuery, fields: TablePermissionFieldDefinition[]) {
    const result = await this.queryRows(source, actor, query, fields, 1, 1);
    return result.total;
  }

  /** 打印已选的计数同样必须带上页面上下文/搜索/FilterGroup（例如 users 的部门/状态、主计划视图）。 */
  private async countSelected(source: TableFilterSource, actor: TableFilterActor, query: TablePrintQuery, ids: string[], fields: TablePermissionFieldDefinition[]) {
    const result = await this.queryRows(source, actor, query, fields, 1, 1, ids);
    return result.total;
  }

  private async fetchPage(source: TableFilterSource, actor: TableFilterActor, query: TablePrintQuery, fields: TablePermissionFieldDefinition[], page: number, pageSize: number, ids?: string[]) {
    return this.queryRows(source, actor, query, fields, page, pageSize, ids);
  }

  /** 统一数据入口：模块 provider 优先（能正确处理 ACTUAL/PENDING、users 上下文等），否则用注册表的通用 SQL。 */
  private async queryRows(
    source: TableFilterSource, actor: TableFilterActor, query: TablePrintQuery,
    fields: TablePermissionFieldDefinition[], page: number, pageSize: number, ids?: string[]
  ) {
    const rowQuery: TablePrintRowQuery = {
      search: String(query.search ?? "").trim(),
      filterGroup: query.filterGroup,
      sortField: query.sortField,
      sortOrder: query.sortOrder,
      context: query.context ?? {},
      ids,
      fieldKeys: fields.map((field) => field.key),
      page,
      pageSize,
      actor
    };
    if (source.printRows) return source.printRows(rowQuery);
    return this.genericRows(source, rowQuery);
  }

  /** 通用 SQL 打印查询：复用注册表列绑定 + 平台编译器（无第二套 FilterCompiler）。 */
  private async genericRows(source: TableFilterSource, query: TablePrintRowQuery) {
    const params: unknown[] = [query.actor.tenantId];
    const clauses = [this.scopedWhere(source, source.buildScope(query.actor, params))];
    if (query.search) {
      const searchKeys = source.searchColumns?.length
        ? source.searchColumns
        : tablePermissionFieldsFor(source.code as TableResourceCode)
          .filter((field) => ["text", "number", "dictionary", "reference", "member", "department"].includes(field.type))
          .map((field) => field.key);
      const searchable = searchKeys.map((key) => source.columns[key]).filter(Boolean) as string[];
      if (searchable.length) {
        params.push(`%${query.search}%`);
        clauses.push(`(${searchable.map((column) => `COALESCE(record.${column}::text,'') ILIKE $${params.length}`).join(" OR ")})`);
      }
    }
    const fields = tablePermissionFieldsFor(source.code as TableResourceCode);
    if (this.hasFilterGroup(query.filterGroup)) {
      const compiler = new SqlFilterCompiler(
        fields, this.expressions(source),
        (key: string) => query.fieldKeys.includes(key) || this.canReadField(query.actor, source.code, key),
        (column: string) => column
      );
      clauses.push(compiler.compile(query.filterGroup, params));
    }
    const key = recordKeyOf(source);
    if (query.ids?.length) {
      params.push(query.ids);
      const keyColumn = source.columns[key.field] ?? key.field;
      const cast = key.type === "uuid" ? "uuid" : key.type === "bigint" ? "bigint" : key.type === "integer" ? "integer" : "text";
      clauses.push(`record.${keyColumn} = ANY($${params.length}::${cast}[])`);
    }
    const where = clauses.filter((clause) => clause && clause !== "1=1").join(" AND ") || "1=1";
    const selected = [
      `record.${source.columns[recordKeyOf(source).field] ?? recordKeyOf(source).field} AS "${recordKeyOf(source).field}"`,
      ...Object.entries(source.columns).filter(([key]) => query.fieldKeys.includes(key)).map(([key, column]) => `record.${column} AS "${key}"`),
      ...Object.entries(source.expressions ?? {}).filter(([key]) => query.fieldKeys.includes(key) && !source.columns[key]).map(([key, expression]) => `${expression} AS "${key}"`)
    ];
    const sortColumn = query.sortField ? (source.columns[String(query.sortField)] ?? source.expressions?.[String(query.sortField)]) : undefined;
    const keyColumn = source.columns[recordKeyOf(source).field];
    const orderBy = sortColumn
      ? `record.${sortColumn} ${String(query.sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC"} NULLS LAST`
      : keyColumn ? `record.${keyColumn}` : "record.ctid";
    const run = source.runQuery ?? ((sql: string, values: unknown[]) => this.dataSource.query(sql, values));
    const [{ count }] = await run(`SELECT count(*)::integer count FROM ${source.table} record WHERE ${where}`, params) as Array<{ count: number }>;
    const paged = [...params, query.pageSize, (query.page - 1) * query.pageSize];
    const rows = await run(
      `SELECT ${selected.join(",")} FROM ${source.table} record WHERE ${where} ORDER BY ${orderBy} LIMIT $${paged.length - 1} OFFSET $${paged.length}`,
      paged
    );
    return { rows, total: Number(count) };
  }

  private scopedWhere(source: TableFilterSource, scope: string) {
    const tenant = source.tenantColumn === undefined ? "tenant_id" : source.tenantColumn;
    const clauses = tenant ? [`record.${tenant}=$1`, scope] : [scope];
    const where = clauses.filter((clause) => clause && clause !== "1=1").join(" AND ") || "1=1";
    if (where.includes("$1")) return where;
    return `$1::text IS NOT NULL AND (${where === "1=1" ? "1=1" : where})`;
  }

  private expressions(source: TableFilterSource) {
    return {
      ...Object.fromEntries(Object.entries(source.columns).map(([key, column]) => [key, `record.${column}`])),
      ...(source.expressions ?? {})
    };
  }

  /** 批量 label 解析（dictionary/member/department/reference），禁止 N+1。 */
  private async resolveLabels(source: TableFilterSource, rows: Array<Record<string, unknown>>, fields: TablePermissionFieldDefinition[], keyField = "id") {
    const resolved = new Map<string, Record<string, unknown>>();
    const labelFields = fields.filter((field) => ["dictionary", "member", "department", "reference"].includes(field.type));
    const resolvers: Array<Promise<void>> = [];
    for (const field of labelFields) {
      const resolver = source.printResolvers?.[field.key] ?? this.defaultResolver(field, source);
      if (!resolver) continue;
      resolvers.push(resolver(rows).then((values) => {
        for (const row of rows) {
          const id = String(row[keyField] ?? "");
          const value = values.get(id);
          if (value === undefined) continue;
          resolved.set(id, { ...(resolved.get(id) ?? {}), [field.key]: value });
        }
      }));
    }
    await Promise.all(resolvers);
    return resolved;
  }

  private defaultResolver(field: TablePermissionFieldDefinition, source: TableFilterSource) {
    const expression = source.columns[field.key] ?? source.expressions?.[field.key];
    if (!expression) return null;
    /* 单次批量查询：收集本批所有行的原始值后一次性解析（不是每行一次）。 */
    return async (rows: Array<Record<string, unknown>>) => {
      const values = new Map<string, unknown[]>();
      for (const row of rows) {
        const raw = row[field.key];
        const list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
        if (list.length) values.set(String(row.id ?? ""), list);
      }
      const output = new Map<string, unknown>();
      if (!values.size) return output;
      if (field.options?.length) {
        const labels = new Map(field.options.map((option) => [String(option.value), option.label]));
        for (const [id, list] of values) output.set(id, list.map((value) => labels.get(String(value)) ?? String(value)));
        return output;
      }
      const keys = [...new Set([...values.values()].flat().map((value) => String(value)).filter(Boolean))];
      const lookup = await this.lookupLabels(field, keys);
      for (const [id, list] of values) output.set(id, list.map((value) => lookup.get(String(value)) ?? "").filter(Boolean));
      return output;
    };
  }

  /** 一次查询解析一批 ID → 正式 label（成员/部门/引用）。 */
  private async lookupLabels(field: TablePermissionFieldDefinition, keys: string[]) {
    const lookup = new Map<string, string>();
    if (!keys.length) return lookup;
    if (field.type === "member") {
      const rows = await this.dataSource.query(`SELECT id, COALESCE(NULLIF(display_name,''),username) label FROM users WHERE id = ANY($1::uuid[])`, [keys]);
      for (const row of rows) lookup.set(String(row.id), String(row.label));
      return lookup;
    }
    if (field.type === "department") {
      const rows = await this.dataSource.query(`SELECT id, name label FROM organization_units WHERE id = ANY($1::uuid[])`, [keys]);
      for (const row of rows) lookup.set(String(row.id), String(row.label));
      return lookup;
    }
    if (field.type === "reference" && field.filterBinding?.referenceResource) {
      const target = this.registry.get(field.filterBinding.referenceResource);
      const labelColumns = (field.filterBinding.labelField ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
      const labelExpression = labelColumns.length
        ? (labelColumns.length > 1 ? `concat_ws(' ',${labelColumns.map((column) => `target.${column}`).join(",")})` : `target.${labelColumns[0]}`)
        : "target.id::text";
      const targetRun = target.runQuery ?? ((sql: string, values: unknown[]) => this.dataSource.query(sql, values));
      const rows = await targetRun(`SELECT target.id, COALESCE(${labelExpression},target.id::text) AS label FROM ${target.table} target WHERE target.id = ANY($1::uuid[])`, [keys]);
      for (const row of rows) lookup.set(String(row.id), String(row.label));
      return lookup;
    }
    /* 动态字典（如设备故障原因）：按值本身输出，字典 label 由 resolver 提供。 */
    for (const key of keys) lookup.set(key, key);
    return lookup;
  }

  /** 统一字段格式化：不允许把数据库原始值直接上纸。 */
  formatValue(field: TablePermissionFieldDefinition, value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (Array.isArray(value)) {
      const parts = value.map((entry) => this.formatScalar(field, entry)).filter((entry) => entry && entry !== "—");
      return parts.length ? parts.join("、") : "—";
    }
    return this.formatScalar(field, value);
  }

  private formatScalar(field: TablePermissionFieldDefinition, value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    if (field.type === "boolean") return value === true || value === "true" || value === "t" ? "是" : "否";
    if (field.type === "date") return this.formatDate(value);
    if (field.type === "datetime") return this.formatDateTime(value);
    if (field.type === "number") return this.formatNumber(field, value);
    return String(value);
  }

  private formatDate(value: unknown) {
    if (value instanceof Date) return this.toShanghaiDate(value);
    const text = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : String(value);
  }

  /** 时间戳按系统正式时区（Asia/Shanghai）输出，不打印原始 UTC 字符串。 */
  private formatDateTime(value: unknown) {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
  }

  private toShanghaiDate(date: Date) {
    const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "01";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  private formatNumber(field: TablePermissionFieldDefinition, value: unknown) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    if (field.format === "durationMinutes") {
      const minutes = Math.round(numeric);
      const hours = Math.floor(minutes / 60);
      return hours ? `${hours}小时${minutes % 60}分钟` : `${minutes}分钟`;
    }
    if (field.format === "percentage") {
      /* 按 metadata 的真实尺度：ratio（0..1）显示为百分比；percent（0..100）原样显示。 */
      const percent = field.percentageScale === "percent" ? numeric : numeric * 100;
      return `${this.trimNumber(percent)}%`;
    }
    if (field.format === "integer") return String(Math.round(numeric));
    if (field.format === "currency") return numeric.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return this.trimNumber(numeric);
  }

  private trimNumber(value: number) {
    return String(Math.round(value * 10000) / 10000);
  }

  /** 前端可得：能力 + 允许的打印动作。 */
  entryPoints(actor: TableFilterActor) {
    return tableResourceRegistry
      .filter((resource) => tablePrintResourceCapabilityOf(resource.code).status === "PRINTABLE")
      .map((resource) => ({ code: resource.code, label: resource.label, allowed: this.hasPrintPermission(actor, resource.code) }));
  }
}
