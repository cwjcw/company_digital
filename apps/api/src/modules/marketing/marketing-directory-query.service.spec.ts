import { MarketingDirectoryQueryService } from "./marketing-directory-query.service";

describe("MarketingDirectoryQueryService department users", () => {
  it("returns only enabled users in the selected department subtree with omitted duplicate names", async () => {
    const users = { find: jest.fn().mockResolvedValue([
      { id: "user-eu", displayName: "欧美业务员", username: "1", enabled: true, departmentPaths: [["公司", "营销中心", "业务部", "业务一部（欧美）"]] },
      { id: "user-jp", displayName: "日本业务员", username: "2", enabled: true, departmentPaths: [["公司", "营销中心", "业务部", "业务二部（日本）"]] },
      { id: "user-left", displayName: "离职业务员", username: "3", enabled: false, departmentPaths: [["公司", "营销中心", "业务部", "业务一部（欧美）"]] }
    ]) };
    const organizations = { find: jest.fn().mockResolvedValue([
      { id: "company", name: "公司", parentId: null, enabled: true },
      { id: "marketing-1", name: "营销中心", parentId: "company", enabled: true },
      { id: "marketing-2", name: "营销中心", parentId: "marketing-1", enabled: true },
      { id: "sales", name: "业务部", parentId: "marketing-2", enabled: true },
      { id: "eu", name: "业务一部（欧美）", parentId: "sales", enabled: true },
      { id: "jp", name: "业务二部（日本）", parentId: "sales", enabled: true }
    ]) };
    const service = new MarketingDirectoryQueryService(users as never, organizations as never);
    await expect(service.findEnabledUsersInOrganization("eu")).resolves.toEqual([{ id: "user-eu", displayName: "欧美业务员", enabled: true, departmentPaths: [["公司", "营销中心", "业务部", "业务一部（欧美）"]] }]);
  });
});
