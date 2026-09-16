import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { KdosDatabaseClient } from "@kdos/database";
import { tablePermissionFieldsFor, type TableResourceCode } from "@kdos/contracts";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import { KDOS_DATABASE } from "../organization-directory/kdos-database.provider";
import { MarketingDirectoryQueryService } from "./marketing-directory-query.service";

/**
 * KN-FILTER-001 营销资源筛选数据源。营销表位于 KDOS 库（`marketing.*`），
 * 因此提供自己的 `runQuery`（KDOS 连接池）与成员/部门候选来源（KDOS 目录），
 * 但字段类型、操作符、编译器与候选协议仍然复用平台实现。
 * READ 语义：拥有 read 权限即可见全部租户内数据（不追加本人/部门范围）。
 */
const TENANT = "record.tenant_id=(SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true)";

const SOURCES: Array<{ code: TableResourceCode; table: string; columns: Record<string, string> }> = [
  {
    code: "business-customer-mapping",
    table: "marketing.business_customer_mappings",
    columns: {
      departmentId: "department_id", department: "department", section: "section",
      customerCode: "customer_code", salespersonUserIds: "salesperson_user_ids",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    }
  },
  {
    code: "order-schedule",
    table: "marketing.order_schedules",
    columns: {
      customerCode: "customer_code", orderNumber: "order_number", departmentId: "department_id",
      department: "department", section: "section", salespersonUserIds: "salesperson_user_ids",
      itemNumber: "item_number", itemName: "item_name", customerDueDate: "customer_due_date",
      orderTotalQuantity: "order_total_quantity", productionUnit: "production_unit",
      completionRatio: "completion_ratio", status: "status",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    }
  }
];

@Injectable()
export class MarketingFilterSourceProvider implements OnModuleInit {
  constructor(
    private readonly registry: TableFilterRegistry,
    @Inject(KDOS_DATABASE) private readonly database: KdosDatabaseClient,
    private readonly directory: MarketingDirectoryQueryService
  ) {}

  onModuleInit() {
    /* 平台编译器默认就是 `$n` 占位符，KDOS 连接池（pg）直接可用，无需改写 SQL。 */
    const run = async (sql: string, params: unknown[]) => (await this.database.pool.query(sql, params)).rows;
    for (const source of SOURCES) {
      this.registry.register({
        code: source.code,
        table: source.table,
        columns: source.columns,
        /* 营销表 tenant_id 是 iam.tenants 主键：用编码解析，避免把租户编码当 uuid 使用。 */
        tenantColumn: null,
        fields: tablePermissionFieldsFor(source.code),
        runQuery: run,
        buildScope: () => TENANT,
        memberCandidates: async (search, limit) => (await this.directory.listEnabledUsers())
          .filter((user) => !search || user.displayName.includes(search) || (user.departmentPaths ?? []).some((path) => path.join("/").includes(search)))
          .slice(0, limit)
          .map((user) => ({ value: user.id, label: user.displayName })),
        departmentCandidates: async (search, limit) => (await this.directory.listEnabledOrganizations())
          .filter((organization) => !search || organization.name.includes(search) || organization.pathLabel.includes(search))
          .slice(0, limit)
          .map((organization) => ({ value: organization.id, label: organization.pathLabel }))
      });
    }
  }
}
