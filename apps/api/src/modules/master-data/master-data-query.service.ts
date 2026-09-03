import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ObjectLiteral, Repository, SelectQueryBuilder } from "typeorm";
import { FinishedGoodsInbound, FinishedGoodsOutbound, SalesOrder } from "../../entities";

export type MasterDataPageQuery = {
  page?: unknown;
  pageSize?: unknown;
  search?: unknown;
  filters?: unknown;
};

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
    return this.page(
      this.salesOrders,
      query,
      ["orderNumber", "customerCode", "itemNumber", "itemName", "specification", "sourceSystem", "sourceDatabase"],
      (builder) => builder.orderBy("row.orderDate", "DESC", "NULLS LAST").addOrderBy("row.orderNumber", "ASC").addOrderBy("row.itemNumber", "ASC")
    );
  }

  finishedGoodsInboundPage(query: MasterDataPageQuery) {
    return this.page(
      this.finishedGoodsInbound,
      query,
      ["documentNumber", "salesOrderNumber", "workOrderNumber", "inventoryCode", "inventoryName", "warehouse", "sourceSystem", "sourceDatabase"],
      (builder) => builder.orderBy("row.inboundDate", "DESC", "NULLS LAST").addOrderBy("row.documentNumber", "ASC").addOrderBy("row.lineNumber", "ASC")
    );
  }

  finishedGoodsOutboundPage(query: MasterDataPageQuery) {
    return this.page(
      this.finishedGoodsOutbound,
      query,
      ["documentNumber", "salesOrderNumber", "customerCode", "customerName", "itemNumber", "itemName", "warehouse", "sourceSystem", "sourceDatabase"],
      (builder) => builder.orderBy("row.documentDate", "DESC", "NULLS LAST").addOrderBy("row.documentNumber", "ASC").addOrderBy("row.itemNumber", "ASC")
    );
  }

  private async page<T extends ObjectLiteral>(
    repository: Repository<T>,
    query: MasterDataPageQuery,
    searchFields: string[],
    order: (builder: SelectQueryBuilder<T>) => SelectQueryBuilder<T>
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

    order(builder);
    builder.skip((page - 1) * pageSize).take(pageSize);
    const [rows, total] = await builder.getManyAndCount();
    return { rows, total, page, pageSize };
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
