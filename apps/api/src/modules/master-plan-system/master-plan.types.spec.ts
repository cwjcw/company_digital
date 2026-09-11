import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

const actor = (overrides: Partial<MasterPlanActor> = {}): MasterPlanActor => ({
  tenantId: "TEST_TENANT", userId: "00000000-0000-7000-8000-000000000001", username: "tester",
  permissions: [], tableDataScopes: [], requestId: "TEST_20260911_PERMISSION", source: "web", ...overrides
});

describe("主计划权限矩阵", () => {
  it("系统管理员和计划模块管理员拥有表级与字段级权限", () => {
    for (const current of [actor({ isSystemAdmin: true }), actor({ moduleAdminCodes: ["planning"] })]) {
      expect(hasMasterPlanPermission(current, "mps-shipping-plans", "delete")).toBe(true);
      expect(hasMasterPlanFieldPermission(current, "mps-shipping-plans", "plannedQuantity", "update")).toBe(true);
    }
  });

  it("普通用户必须同时获得准确的资源、字段和动作授权", () => {
    const current = actor({ permissions: ["mps-shipping-plans:*:create", "mps-shipping-plans:plannedQuantity:update"] });
    expect(hasMasterPlanPermission(current, "mps-shipping-plans", "create")).toBe(true);
    expect(hasMasterPlanPermission(current, "mps-shipping-plans", "delete")).toBe(false);
    expect(hasMasterPlanFieldPermission(current, "mps-shipping-plans", "plannedQuantity", "update")).toBe(true);
    expect(hasMasterPlanFieldPermission(current, "mps-shipping-plans", "divisionId", "update")).toBe(false);
  });

  it("无授权用户默认拒绝所有主计划写入", () => {
    const current = actor();
    expect(hasMasterPlanPermission(current, "mps-process-reports", "create")).toBe(false);
    expect(hasMasterPlanFieldPermission(current, "mps-process-reports", "productionQuantity", "update")).toBe(false);
  });
});
