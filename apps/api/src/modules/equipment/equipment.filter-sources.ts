import { Injectable, type OnModuleInit } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { TableFilterRegistry, type TableFilterActor } from "../../common/filtering/table-filter.registry";
import { equipmentScopeClause, type EquipmentActor } from "./equipment.types";

/**
 * KN-FILTER-001 设备模块筛选数据源。数据范围复用 `equipmentScopeClause`（列表/总数/导出/候选同一实现），
 * 不是平台默认的 `created_by` 语义；平台 actor 只做字段适配，不改变权限判断。
 */
@Injectable()
export class EquipmentFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry) {}

  onModuleInit() {
    const scope = (actor: TableFilterActor, resource: string, params: unknown[]) =>
      `record.active=true AND ${equipmentScopeClause(actor as unknown as EquipmentActor, resource, "read", "record", params)}`;
    this.registry.register({
      code: "equipment-register",
      table: "equipment_assets",
      columns: {
        divisionId: "division_organization_unit_id", usageDepartmentId: "usage_department_organization_unit_id",
        equipmentCode: "equipment_code", equipmentName: "equipment_name", purchaseDate: "purchase_date",
        plannedStartupMinutes: "planned_startup_minutes", monitored: "monitored",
        createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
      },
      fields: tablePermissionFieldsFor("equipment-register"),
      buildScope: (actor, params) => scope(actor, "equipment-register", params)
    });
    this.registry.register({
      code: "equipment-status-report",
      table: "equipment_status_reports",
      columns: {
        equipmentId: "equipment_id", equipmentCode: "equipment_code_snapshot", equipmentName: "equipment_name_snapshot",
        divisionId: "division_organization_unit_id", usageDepartmentId: "usage_department_organization_unit_id",
        reportDate: "report_date", runtimeMinutes: "runtime_minutes", faultMinutes: "fault_minutes", faultReason: "fault_reason",
        createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
      },
      fields: tablePermissionFieldsFor("equipment-status-report"),
      buildScope: (actor, params) => scope(actor, "equipment-status-report", params)
    });
  }
}
