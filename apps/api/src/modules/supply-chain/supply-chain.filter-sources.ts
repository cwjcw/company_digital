import { Injectable, type OnModuleInit } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";

/**
 * KN-FILTER-001 供应商清单筛选数据源：`supply_chain_suppliers` 是 T+ 同步投影，
 * 列绑定与 SupplyChainQueryService 的查询列保持同一份口径。
 */
@Injectable()
export class SupplyChainFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry) {}

  onModuleInit() {
    this.registry.register({
      code: "supplier-list",
      table: "supply_chain_suppliers",
      columns: {
        sourceSystem: "source_system", sourceDatabase: "source_database", sourceAccountName: "source_account_name",
        sourceId: "source_id", code: "code", name: "name", abbreviation: "abbreviation", shorthand: "shorthand",
        categoryCode: "category_code", categoryName: "category_name", partnerTypeLabel: "partner_type_label",
        representative: "representative", contact: "contact", mobilePhone: "mobile_phone", telephone: "telephone",
        fax: "fax", email: "email", address: "address", enabled: "enabled", sourceUpdatedAt: "source_updated_at",
        createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
      },
      fields: tablePermissionFieldsFor("supplier-list"),
      buildScope: (actor, params) => {
        if (actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("data")) return "1=1";
        const scopes = (actor.tableDataScopes ?? []).filter((scope) => scope.resource === "supplier-list" && (!scope.actions || scope.actions.includes("read")));
        if (scopes.some((scope) => scope.scope === "ALL" || scope.scope === "NONE")) return "1=1";
        if (actor.userId && scopes.some((scope) => scope.scope === "OWN")) {
          params.push(actor.userId);
          return `record.created_by=$${params.length}::uuid`;
        }
        return "1=0";
      }
    });
  }
}
