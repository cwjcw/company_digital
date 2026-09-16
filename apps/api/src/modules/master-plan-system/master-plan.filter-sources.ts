import { Injectable, type OnModuleInit } from "@nestjs/common";
import { MASTER_PLAN_RESOURCES, columnsFor, fieldsFor } from "./master-plan.config";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";

/**
 * 把主计划资源注册进平台筛选注册表（表、字段列映射、租户+数据范围构造），
 * 之后平台 candidate/筛选接口即可服务主计划，而无需依赖 master-plan 专用 URL。
 */
@Injectable()
export class MasterPlanFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry) {}

  onModuleInit() {
    for (const resource of MASTER_PLAN_RESOURCES) {
      const columns = columnsFor(resource);
      this.registry.register({
        code: resource.code,
        table: resource.table,
        columns,
        fields: fieldsFor(resource),
        buildScope: (actor, params) => buildDataScopeClause({ resource: resource.code, columns, actor, params })
      });
    }
  }
}
