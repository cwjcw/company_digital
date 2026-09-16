import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import type { SelectQueryBuilder } from "typeorm";
import { SqlFilterCompiler, type FilterOptionResolver } from "./sql-filter.compiler";

/**
 * KN-FILTER-001 平台 QueryBuilder 适配：TypeORM 模块复用同一个 `SqlFilterCompiler`，
 * 只把参数占位符从 `$n` 换成 `:f<n>`，不得另写第二套筛选/字典解析逻辑。
 */
export function applyTypedFilterToQueryBuilder(options: {
  builder: SelectQueryBuilder<any>;
  alias: string;
  fields: TablePermissionFieldDefinition[];
  columns: Record<string, string>;
  /** field key → 完整 SQL 表达式（虚拟列/关联列），优先于 columns。 */
  expressions?: Record<string, string>;
  filterGroup: unknown;
  canFilterField: (fieldKey: string) => boolean;
  resolveOptionValues?: FilterOptionResolver;
}): void {
  const { builder, alias, fields, columns, filterGroup } = options;
  if (filterGroup == null || String(filterGroup).trim() === "") return;
  const params: unknown[] = [];
  const compiler = new SqlFilterCompiler(
    fields,
    {
      ...Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, `${alias}.${column}`])),
      ...(options.expressions ?? {})
    },
    options.canFilterField,
    (column) => column,
    options.resolveOptionValues ?? (() => null),
    (index) => `:filter_${index}`
  );
  const clause = compiler.compile(filterGroup, params);
  if (clause === "true") return;
  builder.andWhere(clause, Object.fromEntries(params.map((value, index) => [`filter_${index + 1}`, value])));
}
