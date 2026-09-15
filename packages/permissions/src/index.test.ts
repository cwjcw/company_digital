import { describe, expect, it } from "vitest";
import { createOrganizationMembershipIndex } from "./index";

describe("organization membership", () => {
  it("resolves stable IDs and descendant membership without relying on display names", () => {
    const index = createOrganizationMembershipIndex([
      { id: "root", name: "集团" },
      { id: "division", name: "事业一部", parentId: "root" },
      { id: "team", name: "生产组", parentId: "division" }
    ]);
    expect(index.unitIdForDepartmentPath(["集团", "事业一部", "生产组"])).toBe("team");
    expect(index.departmentPathBelongsTo(["集团", "事业一部", "生产组"], "division")).toBe(true);
  });
});
