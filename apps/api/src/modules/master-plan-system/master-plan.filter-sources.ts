import { Injectable, type OnModuleInit } from "@nestjs/common";
import { formatProductionProgress } from "@tracker/shared";
import { MASTER_PLAN_RESOURCES, columnsFor, fieldsFor, processReportPendingColumns, processReportPendingFields, processReportPendingInputKeys, processReportPendingSourceSql } from "./master-plan.config";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import { TableFilterRegistry, type TablePrintRowQuery } from "../../common/filtering/table-filter.registry";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

/**
 * 把主计划资源注册进平台筛选注册表（表、字段列映射、租户+数据范围构造），
 * 之后平台 candidate/筛选接口即可服务主计划，而无需依赖 master-plan 专用 URL。
 */
@Injectable()
export class MasterPlanFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry, private readonly queries: MasterPlanQueryService) {}

  onModuleInit() {
    for (const resource of MASTER_PLAN_RESOURCES) {
      if (resource.code === 'mps-review-due-dates') continue; // Dedicated strict scope and canonical read/export provider.
      const columns = columnsFor(resource);
      this.registry.register({
        code: resource.code,
        table: resource.table,
        columns,
        fields: fieldsFor(resource),
        exportVariant: context => {
          if (resource.code === "mps-process-reports" && String(context.view ?? "").toUpperCase() === "PENDING") {
            return {
              columns: { ...processReportPendingColumns(), createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at" },
              fields: [...processReportPendingFields(), ...fieldsFor(resource).filter(field => ["createdBy", "createdAt", "updatedBy", "updatedAt"].includes(field.key))]
            };
          }
          if (resource.code === "mps-three-day-work-orders") return {
            columns: { ...columns, productionDateRange: "production_date_range" },
            fields: [...fieldsFor(resource), { key: "productionDateRange", label: "生产日期", type: "text", editable: false }]
          };
          return undefined;
        },
        fieldReadPermission: (actor, key) => {
          const principal = { ...actor, username: actor.username ?? "", tableDataScopes: actor.tableDataScopes ?? [], requestId: "", source: "system" as const };
          if (resource.code === "mps-process-reports" && ["remainingQuantity", "cumulativeReportedQuantity"].includes(key)) return hasMasterPlanPermission(principal, resource.code, "read");
          if (key === "productionDateRange") return ["productionStartDate", "productionEndDate"].every(k => hasMasterPlanFieldPermission(principal, resource.code, k, "read"));
          return hasMasterPlanFieldPermission(principal, resource.code, key, "read");
        },
        exportDisplayValue: (field, value, row) => {
          if (row.pendingTask && processReportPendingInputKeys().includes(field.key)) return "";
          if (field.key.endsWith("ProductionProgress")) return formatProductionProgress(value);
          if (field.type === "attachment") {
            const items = Array.isArray(value) ? value : [];
            if (!items.length) return "—";
            const first = items[0];
            const label = typeof first === "string" ? first : String(first?.name ?? first?.url ?? "附件");
            return items.length > 1 ? `${label} 等 ${items.length} 个` : label;
          }
          if (field.key === "completionRate") return `${Math.round(Number(value || 0) * 100)}%`;
          if (field.type === "number" && value != null && value !== "") return String(value);
          return undefined;
        },
        buildScope: (actor, params) => `(${buildDataScopeClause({ resource: resource.code, columns, actor, params })})${resource.code === "mps-order-allocations" ? " AND record.archived_at IS NULL" : ""}`,
        candidateVariant: resource.code === "mps-process-reports" ? (context) => String(context.view ?? "").toUpperCase() === "PENDING" ? {
          table: `(${processReportPendingSourceSql})`, columns: processReportPendingColumns(),
          fields: processReportPendingFields().filter((field) => !field.input),
          buildScope: (actor, params) => buildDataScopeClause({ resource: resource.code, columns: processReportPendingColumns(), actor, params })
        } : undefined : undefined,
        /* KN-PRINT-001：打印取数复用模块正式查询（正确处理 ACTUAL/PENDING 视图与工序派生列），不自建打印 SQL。 */
        printRows: (query) => this.printRows(resource.code, query)
      });
    }
  }

  /** 打印与列表共用同一业务 Query：同一 where、同一排序语义，只是用打印批大小分页。 */
  private async printRows(code: string, query: TablePrintRowQuery) {
    const actor = {
      tenantId: query.actor.tenantId, userId: query.actor.userId, username: "", isSystemAdmin: query.actor.isSystemAdmin,
      moduleAdminCodes: query.actor.moduleAdminCodes, permissions: query.actor.permissions,
      tableDataScopes: query.actor.tableDataScopes ?? [], requestId: "", source: "system" as const
    } satisfies MasterPlanActor;
    const result = await this.queries.list(code, {
      page: query.page, pageSize: 200, search: query.search, filterGroup: query.filterGroup,
      sortField: query.sortField, sortOrder: query.sortOrder, view: query.context.view ?? "ACTUAL",
      ids: query.ids, basePlanId: query.context.basePlanId
    }, actor, query.action === "export" ? params => buildDataScopeClause({
      resource: code, actor, params, action: "export",
      columns: code === "mps-process-reports" && String(query.context.view ?? "").toUpperCase() === "PENDING" ? processReportPendingColumns() : columnsFor(MASTER_PLAN_RESOURCES.find(r => r.code === code)!)
    }) : undefined);
    const rows = result.rows as Array<Record<string, unknown>>;
    if (code === "mps-three-day-work-orders") for (const row of rows) {
      const start = row.productionStartDate ? String(row.productionStartDate).slice(0, 10) : "";
      const end = row.productionEndDate ? String(row.productionEndDate).slice(0, 10) : "";
      row.productionDateRange = start && end ? `${start} → ${end}` : start || end;
    }
    return { rows, total: result.total };
  }
}
