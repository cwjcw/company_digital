import { Injectable, type OnModuleInit } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";

/**
 * KN-FILTER-001 审计日志筛选数据源。`audit_logs` 没有 `tenant_id` 列，
 * 可见性由“仅系统管理员可访问”的资源权限承担，因此显式声明 `tenantColumn: null`，不伪造租户条件。
 */
@Injectable()
export class AuditFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry) {}

  onModuleInit() {
    this.registry.register({
      code: "audit-logs",
      table: "audit_logs",
      columns: {
        actorName: "actor_name", resource: "resource", action: "action", recordId: "record_id",
        source: "source", requestId: "request_id",
        createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
      },
      tenantColumn: null,
      fields: tablePermissionFieldsFor("audit-logs"),
      buildScope: () => "1=1"
    });
  }
}
