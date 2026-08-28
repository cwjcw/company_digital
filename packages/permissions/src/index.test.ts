import { describe, expect, it } from "vitest";
import { planningFieldRegistry } from "@kdos/contracts";
import { createOrganizationMembershipIndex, fieldAccess, hasPermission } from "./index";

describe("Planning permission engine", () => {
  it("maps legacy permissions during the migration", () => {
    expect(hasPermission({ permissions: ["monthly-plan:*:update"] }, "planning.plan.update")).toBe(true);
  });
  it("never makes calculated fields editable", () => {
    const balance = planningFieldRegistry.find((field) => field.code === "balanceQuantity")!;
    expect(fieldAccess({ permissions: ["*"] }, balance)).toBe("READONLY");
  });
  it("supports read, update, publish, lock and unlock as separate grants", () => {
    const subject = { permissions: ["planning.plan.read", "planning.plan.update", "planning.plan.publish"] };
    expect(hasPermission(subject, "planning.plan.read")).toBe(true);
    expect(hasPermission(subject, "planning.plan.update")).toBe(true);
    expect(hasPermission(subject, "planning.plan.publish")).toBe(true);
    expect(hasPermission(subject, "planning.plan.lock")).toBe(false);
    expect(hasPermission(subject, "planning.plan.unlock")).toBe(false);
  });
  it("hides every field without plan read permission", () => {
    expect(fieldAccess({ permissions: [] }, planningFieldRegistry[0]!)).toBe("HIDDEN");
  });
});

describe("organization membership", () => {
  const index = createOrganizationMembershipIndex([
    { id: "company", name: "厦门凯南展示制品有限公司", parentId: null },
    { id: "marketing-level-1", name: "营销中心", parentId: "company" },
    { id: "quotation", name: "报价部", parentId: "marketing-level-1" },
    { id: "marketing-level-2", name: "营销中心", parentId: "marketing-level-1" },
    { id: "sales", name: "业务部", parentId: "marketing-level-2" }
  ]);

  it("resolves a collapsed duplicate-name path to the deepest unique department", () => {
    expect(index.unitIdForDepartmentPath(["厦门凯南展示制品有限公司", "营销中心"])).toBe("marketing-level-2");
    expect(index.departmentPathBelongsTo(["厦门凯南展示制品有限公司", "营销中心", "业务部"], "marketing-level-2")).toBe(true);
    expect(index.departmentPathBelongsTo(["厦门凯南展示制品有限公司", "营销中心", "报价部"], "marketing-level-2")).toBe(false);
  });
});
