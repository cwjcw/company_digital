import { AdminQueryService } from "./admin-query.service";

/**
 * KN-FILTER-002：用户管理页面上下文（部门 / 状态 / 角色成员）必须与服务端 FilterGroup 之间是 AND，
 * 并且 rows 与 total 共用同一个 WHERE（客户端无法移除上下文条件）。
 */
function fakeUsersRepository() {
  const calls: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const state: { skip?: number; take?: number } = {};
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    andWhere(clause: unknown, params?: Record<string, unknown>) { calls.push({ clause: typeof clause === "string" ? clause : "BRACKETS", params }); return builder; },
    orderBy() { return builder; },
    skip(value: number) { state.skip = value; return builder; },
    take(value: number) { state.take = value; return builder; },
    getManyAndCount: async () => [[], 0]
  });
  return {
    calls, state,
    repository: {
      createQueryBuilder: () => builder,
      manager: { query: async () => [] },
      find: async () => []
    }
  };
}

function service(users: ReturnType<typeof fakeUsersRepository>, units: Array<Record<string, unknown>> = []) {
  return new AdminQueryService(
    users.repository as never,
    { createQueryBuilder: () => ({ where: () => ({ getMany: async () => [] }) }), find: async () => [] } as never,
    { createQueryBuilder: () => ({ where: () => ({ getMany: async () => [] }) }) } as never,
    {} as never, {} as never,
    { find: async () => units } as never
  );
}

describe("用户管理服务端查询上下文 + FilterGroup（KN-FILTER-002）", () => {
  const actor = { isSystemAdmin: true, permissions: ["*"] };

  it("J: 部门 + 状态 + 快速搜索 + FilterGroup 全部 AND，并且行与总数共用同一 WHERE", async () => {
    const users = fakeUsersRepository();
    await service(users, [{ id: "org-2", name: "计划中心", parentId: "org-1" }, { id: "org-1", name: "凯南", parentId: null }]).listUsersPage({
      page: 2, pageSize: 20, search: "admin", status: "disabled", departmentId: "org-2",
      filterGroup: { logic: "AND", rules: [{ field: "position", operator: "is_not_empty" }] }
    }, actor);
    const where = users.calls.map((call) => call.clause).join(" AND ");
    expect(where).toContain("department_paths @>");          /* 部门上下文 */
    expect(where).toContain("row.enabled = false");           /* 状态上下文 */
    /* 快速搜索以 Brackets 形式加入（内部是 username/display_name/... 的 OR 组）。 */
    expect(where).toContain("BRACKETS");
    expect(where).toContain("position");                      /* FilterGroup */
    /* 分页在条件之后：page=2/pageSize=20 → skip 20, take 20 */
    expect(users.state.skip).toBe(20);
    expect(users.state.take).toBe(20);
  });

  it("没有搜索词时不会加入搜索条件（快速搜索只在有输入时生效）", async () => {
    const users = fakeUsersRepository();
    await service(users).listUsersPage({ pageSize: 50, status: "enabled" }, actor);
    expect(users.calls.map((call) => call.clause)).not.toContain("BRACKETS");
  });

  it("K: 角色成员视图由服务端强制 roleId（关系 ∪ 授权组织范围）", async () => {
    const users = fakeUsersRepository();
    await service(users).listUsersPage({ pageSize: 50, roleId: "role-1" }, actor);
    const where = users.calls.map((call) => call.clause).join(" AND ");
    expect(where).toContain("user_roles");
    expect(where).toContain("link.role_id = :contextRoleId");
  });

  it("非管理员不能按未授权字段筛选（权限与列表查询一致）", async () => {
    const users = fakeUsersRepository();
    await expect(service(users).listUsersPage({
      pageSize: 50, filterGroup: { logic: "AND", rules: [{ field: "email", operator: "contains", value: "a" }] }
    }, { isSystemAdmin: false, permissions: ["users:username:read"] })).rejects.toThrow(/不能按该字段筛选/);
  });
});
