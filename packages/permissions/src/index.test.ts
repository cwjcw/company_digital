import { describe, expect, it } from "vitest";
import { planningFieldRegistry } from "@kdos/contracts";
import { fieldAccess, hasPermission } from "./index";

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
