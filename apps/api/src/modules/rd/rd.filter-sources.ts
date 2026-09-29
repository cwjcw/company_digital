import { ForbiddenException, Injectable, type OnModuleInit } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { TableFilterRegistry, type TableFilterActor } from "../../common/filtering/table-filter.registry";

function authorize(actor: TableFilterActor, resource: string) {
  if (actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("rd") || actor.permissions.includes(`${resource}:*:read`)) return;
  throw new ForbiddenException("当前权限组没有此表的查看权限");
}

@Injectable()
export class RdFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry) {}

  onModuleInit() {
    this.registry.register({
      code: "rd-items",
      table: "rd_items",
      columns: {
        id: "id", version: "version", itemCode: "item_code", itemName: "item_name", specification: "specification", remark: "remark",
        isGroupItem: "is_group_item", sourceCreatedAt: "created_at_source", sourceLastModifiedAt: "last_modified_at_source", sourceModifiedAt: "modified_at_source",
        createdByName: "created_by_name", lastModifiedByName: "last_modified_by_name", modifiedByName: "modified_by_name", status: "status",
        createdBy: "created_by_name", createdAt: "created_at", updatedBy: "modified_by_name", updatedAt: "updated_at"
      },
      fields: tablePermissionFieldsFor("rd-items"),
      searchColumns: ["itemCode", "itemName", "specification", "remark", "createdByName", "lastModifiedByName", "modifiedByName"],
      authorize: (actor) => authorize(actor, "rd-items"),
      buildScope: () => "1=1"
    });
    this.registry.register({
      code: "rd-material-duplicates",
      table: "rd_duplicate_groups",
      columns: { id: "id", groupNo: "group_no", kind: "kind", score: "score", reason: "reason", memberCount: "member_count", distinctCodes: "distinct_codes", membersTruncated: "members_truncated" },
      expressions: { warnings: "record.warnings::text" },
      fields: tablePermissionFieldsFor("rd-material-duplicates"),
      searchColumns: ["kind", "reason"],
      authorize: (actor) => authorize(actor, "rd-material-duplicates"),
      buildScope: () => "1=1"
    });
  }
}
