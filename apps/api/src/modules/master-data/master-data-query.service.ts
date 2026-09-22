import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ObjectLiteral, Repository, SelectQueryBuilder } from "typeorm";
import { tablePermissionFieldsFor, type TableResourceCode } from "@kdos/contracts";
import { FinishedGoodsInbound, FinishedGoodsOutbound, SalesOrder } from "../../entities";
import { applyTypedFilterToQueryBuilder } from "../../common/filtering/typeorm-filter";

export type MasterDataPageQuery = {
  page?: unknown;
  pageSize?: unknown;
  search?: unknown;
  filters?: unknown;
  filterGroup?: unknown;
  sortField?: unknown;
  sortOrder?: unknown;
};

/** 数据中心表的数据范围：当前这三张 ERP 镜像表只有资源级权限，没有行级范围，平台与列表保持一致。 */
export type MasterDataActor = { permissions: string[]; isSystemAdmin?: boolean; moduleAdminCodes?: string[] };

export type MasterDataPage<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

@Injectable()
export class MasterDataQueryService {
  constructor(
    @InjectRepository(SalesOrder) private readonly salesOrders: Repository<SalesOrder>,
    @InjectRepository(FinishedGoodsInbound) private readonly finishedGoodsInbound: Repository<FinishedGoodsInbound>,
    @InjectRepository(FinishedGoodsOutbound) private readonly finishedGoodsOutbound: Repository<FinishedGoodsOutbound>
  ) {}

  salesOrderPage(query: MasterDataPageQuery) {
    return this.salesOrderPageFor(query, { permissions: ["*"] });
  }

  salesOrderPageFor(query: MasterDataPageQuery, actor: MasterDataActor) {
    return this.page(
      this.salesOrders,
      query,
      ["orderNumber", "customerCode", "itemNumber", "itemName", "specification", "sourceSystem", "sourceDatabase"],
      (builder) => builder.orderBy("row.orderDate", "DESC", "NULLS LAST").addOrderBy("row.orderNumber", "ASC").addOrderBy("row.itemNumber", "ASC"),
      "sales-orders",
      actor
    );
  }

  finishedGoodsInboundPage(query: MasterDataPageQuery) {
    return this.finishedGoodsInboundPageFor(query, { permissions: ["*"] });
  }

  finishedGoodsInboundPageFor(query: MasterDataPageQuery, actor: MasterDataActor) {
    return this.page(
      this.finishedGoodsInbound,
      query,
      ["documentNumber", "salesOrderNumber", "workOrderNumber", "inventoryCode", "inventoryName", "warehouse", "sourceSystem", "sourceDatabase"],
      (builder) => builder.orderBy("row.inboundDate", "DESC", "NULLS LAST").addOrderBy("row.documentNumber", "ASC").addOrderBy("row.lineNumber", "ASC"),
      "finished-goods-inbound",
      actor
    );
  }

  finishedGoodsOutboundPage(query: MasterDataPageQuery) {
    return this.finishedGoodsOutboundPageFor(query, { permissions: ["*"] });
  }

  finishedGoodsOutboundPageFor(query: MasterDataPageQuery, actor: MasterDataActor) {
    return this.page(
      this.finishedGoodsOutbound,
      query,
      ["documentNumber", "salesOrderNumber", "customerCode", "customerName", "itemNumber", "itemName", "warehouse", "sourceSystem", "sourceDatabase"],
      (builder) => builder.orderBy("row.documentDate", "DESC", "NULLS LAST").addOrderBy("row.documentNumber", "ASC").addOrderBy("row.itemNumber", "ASC"),
      "finished-goods-outbound",
      actor
    );
  }

  private async page<T extends ObjectLiteral>(
    repository: Repository<T>,
    query: MasterDataPageQuery,
    searchFields: string[],
    order: (builder: SelectQueryBuilder<T>) => SelectQueryBuilder<T>,
    resource: TableResourceCode,
    actor: MasterDataActor
  ): Promise<MasterDataPage<T>> {
    const page = Math.max(1, Math.trunc(Number(query.page) || 1));
    const pageSize = Math.min(200, Math.max(10, Math.trunc(Number(query.pageSize) || 50)));
    const search = String(query.search ?? "").trim();
    const filters = this.parseFilters(query.filters);
    const builder = repository.createQueryBuilder("row");

    if (search) {
      const clauses = searchFields
        .map((field) => this.textColumn(repository, field))
        .filter((field): field is string => Boolean(field))
        .map((field) => `CAST(${field} AS text) ILIKE :search`);
      if (clauses.length) builder.andWhere(`(${clauses.join(" OR ")})`, { search: `%${search}%` });
    }
    let filterIndex = 0;
    for (const [field, rawValue] of Object.entries(filters)) {
      const value = String(rawValue ?? "").trim();
      const column = this.textColumn(repository, field);
      if (!value || !column) continue;
      const parameter = `filter${filterIndex++}`;
      builder.andWhere(`CAST(${column} AS text) ILIKE :${parameter}`, { [parameter]: `%${value}%` });
    }

    /* KN-FILTER-001：类型化高级筛选复用平台编译器（`:filter_n` 命名参数），与快速搜索/分页/总数同一 where。 */
    applyTypedFilterToQueryBuilder({
      builder, alias: "row", fields: tablePermissionFieldsFor(resource), columns: this.columnMap(repository),
      filterGroup: query.filterGroup,
      canFilterField: (key) => actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("data") === true
        || actor.permissions.includes(`${resource}:${key}:read`)
    });

    const sortField = String(query.sortField ?? "");
    if (sortField) {
      const readable = tablePermissionFieldsFor(resource).some((field) => field.key === sortField)
        && (actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("data") === true || actor.permissions.includes(`${resource}:${sortField}:read`));
      if (!readable) throw new ForbiddenException("当前权限组不能按该字段排序");
      const sortColumn = this.textColumn(repository, sortField);
      if (!sortColumn) throw new ForbiddenException("当前权限组不能按该字段排序");
      builder.orderBy(sortColumn, String(query.sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC", "NULLS LAST");
    } else order(builder);
    builder.skip((page - 1) * pageSize).take(pageSize);
    const [rows, total] = await builder.getManyAndCount();
    return { rows, total, page, pageSize };
  }

  /** 字段 key → 真实数据库列：以实体 metadata 为准，不按字段名猜测。 */
  private columnMap<T extends ObjectLiteral>(repository: Repository<T>) {
    const columns: Record<string, string> = {};
    for (const column of repository.metadata.columns) {
      if (column.relationMetadata) continue;
      columns[column.propertyName] = column.databaseName;
    }
    return columns;
  }

  private textColumn<T extends ObjectLiteral>(repository: Repository<T>, property: string) {
    const column = repository.metadata.findColumnWithPropertyName(property);
    if (!column || column.relationMetadata) return null;
    const escape = repository.manager.connection.driver.escape.bind(repository.manager.connection.driver);
    return `${escape("row")}.${escape(column.databaseName)}`;
  }

  private parseFilters(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}
