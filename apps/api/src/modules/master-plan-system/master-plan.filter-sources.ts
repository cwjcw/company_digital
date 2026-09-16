import { Injectable, type OnModuleInit } from "@nestjs/common";
import { MASTER_PLAN_RESOURCES, columnsFor, fieldsFor } from "./master-plan.config";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import { TableFilterRegistry, type TablePrintRowQuery } from "../../common/filtering/table-filter.registry";
import { MasterPlanQueryService } from "./master-plan.query.service";
import type { MasterPlanActor } from "./master-plan.types";

/**
 * 把主计划资源注册进平台筛选注册表（表、字段列映射、租户+数据范围构造），
 * 之后平台 candidate/筛选接口即可服务主计划，而无需依赖 master-plan 专用 URL。
 */
@Injectable()
export class MasterPlanFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry, private readonly queries: MasterPlanQueryService) {}

  onModuleInit() {
    for (const resource of MASTER_PLAN_RESOURCES) {
      const columns = columnsFor(resource);
      this.registry.register({
        code: resource.code,
        table: resource.table,
        columns,
        fields: fieldsFor(resource),
        buildScope: (actor, params) => buildDataScopeClause({ resource: resource.code, columns, actor, params }),
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
      sortField: query.sortField, sortOrder: query.sortOrder, view: query.context.view ?? "ACTUAL"
    }, actor);
    return { rows: result.rows as Array<Record<string, unknown>>, total: result.total };
  }
}
