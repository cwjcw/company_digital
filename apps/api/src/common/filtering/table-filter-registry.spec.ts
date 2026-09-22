import { tableFilterResourceCapabilities, isTableFieldFilterable } from "@kdos/contracts";
import { TableFilterRegistry } from "./table-filter.registry";
import { MasterPlanFilterSourceProvider } from "../../modules/master-plan-system/master-plan.filter-sources";
import { MasterDataFilterSourceProvider } from "../../modules/master-data/master-data.filter-sources";
import { EquipmentFilterSourceProvider } from "../../modules/equipment/equipment.filter-sources";
import { SupplyChainFilterSourceProvider } from "../../modules/supply-chain/supply-chain.filter-sources";
import { AuditFilterSourceProvider } from "../../modules/audit/audit.filter-sources";
import { MarketingFilterSourceProvider } from "../../modules/marketing/marketing.filter-sources";
import { SystemFilterSourceProvider } from "./system-filter-sources";

/**
 * KN-FILTER-001 第四轮跨模块测试：契约声明的“已注册且可筛选”资源必须由各模块 provider 真正注册，
 * 任何“声明了但服务端没接”的资源都会让本测试失败（防止 UI 出现假筛选）。
 */
function buildRegistry() {
  const registry = new TableFilterRegistry();
  new MasterPlanFilterSourceProvider(registry, { list: async () => ({ rows: [], total: 0 }) } as never).onModuleInit();
  new MasterDataFilterSourceProvider(registry).onModuleInit();
  new EquipmentFilterSourceProvider(registry).onModuleInit();
  new SupplyChainFilterSourceProvider(registry).onModuleInit();
  new AuditFilterSourceProvider(registry).onModuleInit();
  new SystemFilterSourceProvider(registry, { query: async () => [] } as never, {} as never).onModuleInit();
  /* 营销资源位于 KDOS 库：这里只验证注册（连接池在使用时才需要）。 */
  new MarketingFilterSourceProvider(registry, { pool: { query: async () => ({ rows: [] }) } } as never, {
    listEnabledUsers: async () => [], listEnabledOrganizations: async () => []
  } as never).onModuleInit();
  return registry;
}

describe("平台筛选资源注册表（KN-FILTER-001）", () => {
  const registry = buildRegistry();
  const declared = Object.entries(tableFilterResourceCapabilities)
    .filter(([, capability]) => capability.status === "REGISTERED_AND_FILTERABLE")
    .map(([code]) => code)
    .sort();

  it("声明的可筛选资源与运行时注册表完全一致", () => {
    expect(registry.codes().sort()).toEqual(declared);
    expect(() => registry.assertDeclaredCodes(declared)).not.toThrow();
  });

  it("每个已注册资源都有真实表、列绑定与至少一个可筛选字段", () => {
    for (const code of registry.codes()) {
      const source = registry.get(code);
      /* 允许真实表名或受控子查询来源（组合键资源用 relation/custom binding）。 */
      expect(source.table.length).toBeGreaterThan(0);
      const filterable = source.fields.filter((field) => isTableFieldFilterable(field));
      expect(filterable.length).toBeGreaterThan(0);
      for (const field of filterable) {
        /* reference/成员/部门候选按类型解析，其余可筛选字段必须能在注册表中找到列绑定。 */
        if (["member", "department", "reference", "dictionary", "boolean", "date", "datetime"].includes(field.type)) continue;
        /* structured 字段按定义不参与筛选（filterable=false），无需列绑定。 */
        if (field.type === "structured") continue;
        expect(source.columns[field.key] ?? source.expressions?.[field.key]).toBeTruthy();
      }
    }
  });

  it("未注册资源返回明确 404 语义而不是静默忽略", () => {
    expect(registry.has("sales-summary-dashboard")).toBe(false);
    expect(() => registry.get("sales-summary-dashboard")).toThrow(/暂未接入/);
  });

  it("数据范围构造必须返回确定的谓词（true 或带租户/范围的条件）", () => {
    const actor = { tenantId: "KAINAN", userId: null, permissions: ["*"], isSystemAdmin: true };
    for (const code of registry.codes()) {
      const params: unknown[] = [actor.tenantId];
      const clause = registry.get(code).buildScope(actor, params);
      expect(typeof clause).toBe("string");
      expect(clause.length).toBeGreaterThan(0);
    }
  });

  it("非系统管理员的数据中心/审计资源保持真实隔离边界（无租户列时不伪造）", () => {
    for (const code of ["sales-orders", "finished-goods-inbound", "finished-goods-outbound", "audit-logs"]) {
      const source = registry.get(code);
      expect(source.tenantColumn).toBeNull();
      expect(source.buildScope({ tenantId: "KAINAN", userId: null, permissions: [] }, [])).toBe("1=1");
    }
  });

  it("设备资源的数据范围沿用设备模块语义，而不是平台默认的 created_by", () => {
    const source = registry.get("equipment-register");
    const params: unknown[] = ["KAINAN"];
    const clause = source.buildScope(
      { tenantId: "KAINAN", userId: "u1", permissions: [], tableDataScopes: [{ resource: "equipment-register", scope: "CUSTOM", rules: [{ fieldKey: "divisionId", operator: "EQ", value: "division-1" }] }] },
      params
    );
    expect(clause).toContain("division_organization_unit_id");
    expect(clause).not.toContain("created_by");
    expect(params).toContainEqual(["division-1"]);
    expect(source.expressions?.responsibleUserIds).toContain("equipment_responsibles");
    expect(registry.get("equipment-status-report").expressions?.responsibleUserIds).toContain("equipment_responsibles");
  });

  it("待报工候选来自任务来源而非实际报工表", () => {
    const source = registry.get("mps-process-reports");
    const pending = source.candidateVariant?.({ view: "PENDING" });
    expect(pending?.table).toContain("mps_weekly_process_plans task");
    expect(pending?.table).toContain("task.execution_enabled=true");
    expect(pending?.columns?.remainingQuantity).toBe("remaining_quantity");
    expect(source.candidateVariant?.({ view: "ACTUAL" })).toBeUndefined();
  });

});
