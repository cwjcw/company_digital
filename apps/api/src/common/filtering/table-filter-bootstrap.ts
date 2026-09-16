import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { tableFilterResourceCapabilities } from "@kdos/contracts";
import { TableFilterRegistry } from "./table-filter.registry";

/**
 * KN-FILTER-001 启动闸门：契约声明的“已注册且可筛选”资源必须与运行时注册表完全一致，
 * 避免未来新增 resource 忘记注册，或注册了却忘记声明导致能力上报说谎。
 */
@Injectable()
export class TableFilterBootstrapCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(TableFilterBootstrapCheck.name);

  constructor(private readonly registry: TableFilterRegistry) {}

  onApplicationBootstrap() {
    const declared = Object.entries(tableFilterResourceCapabilities)
      .filter(([, capability]) => capability.status === "REGISTERED_AND_FILTERABLE")
      .map(([code]) => code);
    this.registry.assertDeclaredCodes(declared);
    this.logger.log(`平台筛选资源注册校验通过：${declared.length} 个资源（KN-FILTER-001）`);
  }
}
