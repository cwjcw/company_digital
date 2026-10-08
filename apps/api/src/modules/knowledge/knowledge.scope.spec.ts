import {
  KnowledgeAuthorizationService,
  canKnowledge,
  canKnowledgeField,
  effectiveKnowledgeRank,
  knowledgeDataScope,
} from "./knowledge.scope";
import type { KnowledgeActor } from "./knowledge.types";
import type { KnowledgeAccessEntry as Entry } from "@kdos/contracts";
const ordinary: KnowledgeActor = {
  tenantId: "A",
  userId: "u",
  username: "member",
  requestId: "test",
  permissions: ["knowledge-pages:*:read", "knowledge-spaces:*:read"],
  tableDataScopes: ["knowledge-pages", "knowledge-spaces"].map((resource) => ({
    resource,
    scope: "ALL",
    actions: ["read"],
  })),
};
const membership = { userId: "u", organizationIds: ["o"], roleIds: ["r"] };
const all = (level: Entry["accessLevel"]): Entry => ({
  subjectType: "ALL",
  subjectId: null,
  accessLevel: level,
});
describe("Knowledge 2 unified authorization", () => {
  it("requires independent action and field grants", () => {
    expect(canKnowledge(ordinary, "knowledge-pages", "read")).toBe(true);
    expect(
      canKnowledgeField(ordinary, "knowledge-pages", "content", "read"),
    ).toBe(false);
    expect(canKnowledge(ordinary, "knowledge-pages", "update")).toBe(false);
  });
  it.each([
    { isSystemAdmin: true },
    { moduleAdminCodes: ["knowledge"] },
    { permissions: ["*"] },
  ])("uses existing admin authority %j", (claims) => {
    expect(
      canKnowledge({ ...ordinary, ...claims }, "knowledge-spaces", "create"),
    ).toBe(true);
  });
  it("does not inherit Planning administrator authority", () => {
    expect(
      canKnowledge(
        { ...ordinary, moduleAdminCodes: ["planning"] },
        "knowledge-spaces",
        "create",
      ),
    ).toBe(false);
    expect(
      knowledgeDataScope(
        { ...ordinary, moduleAdminCodes: ["planning"] },
        "knowledge-pages",
        "update",
        [],
      ),
    ).toBe("1=0");
  });
  it.each(["USER", "ORGANIZATION", "ROLE", "ALL"] as const)(
    "resolves stable %s membership",
    (subjectType) => {
      const subjectId =
        subjectType === "USER"
          ? "u"
          : subjectType === "ROLE"
            ? "r"
            : subjectType === "ORGANIZATION"
              ? "o"
              : null;
      expect(
        effectiveKnowledgeRank(
          [{ subjectType, subjectId, accessLevel: "EDITOR" }],
          [],
          membership,
        ),
      ).toBe(2);
    },
  );
  it("a child cannot broaden Space or parent authority", () => {
    expect(
      effectiveKnowledgeRank(
        [all("VIEWER")],
        [[all("FULL_ACCESS")]],
        membership,
      ),
    ).toBe(1);
    expect(
      effectiveKnowledgeRank(
        [all("FULL_ACCESS")],
        [[all("EDITOR")], [all("FULL_ACCESS")]],
        membership,
      ),
    ).toBe(2);
    expect(
      effectiveKnowledgeRank(
        [all("FULL_ACCESS")],
        [[], [all("FULL_ACCESS")]],
        membership,
      ),
    ).toBe(0);
  });
  it("checks tenant, ancestors, inherited levels and published state in SQL", async () => {
    const service = new KnowledgeAuthorizationService({} as never);
    jest.spyOn(service, "membership").mockResolvedValue(membership);
    const params: unknown[] = ["A"];
    const sql = await service.clause(ordinary, params);
    expect(sql).toContain("record.tenant_id=$1");
    expect(sql).toContain("WITH RECURSIVE chain");
    expect(sql).toContain("knowledge_page_access");
    expect(sql).toContain("space.status='ACTIVE'");
    expect(sql).toContain("chain.published_version_id IS NULL");
    expect(params).toContain("u");
    expect(sql).not.toContain("'u'");
    await expect(service.clause(ordinary, ["A"], "working")).rejects.toThrow(
      "权限",
    );
  });
  it("retains tenant context in repository transactions", async () => {
    const m = { query: jest.fn().mockResolvedValue([]) };
    const service = new KnowledgeAuthorizationService({
      transaction: (fn: (manager: unknown) => unknown) => fn(m),
    } as never);
    await service.transaction(ordinary, async () => 123);
    expect(m.query).toHaveBeenCalledWith(
      "SELECT set_config('app.tenant_id',$1,true)",
      ["A"],
    );
  });
  it("resolves live organization hierarchy and ordinary role membership", async () => {
    const m = {
      query: jest.fn().mockImplementation((sql: string) =>
        sql.includes("department_paths")
          ? [{ paths: [["公司", "人力资源", "招聘"]] }]
          : sql.includes("FROM organization_units")
            ? [
                { id: "root", name: "公司" },
                { id: "hr", name: "人力资源", parentId: "root" },
                { id: "child", name: "招聘", parentId: "hr" },
              ]
            : sql.includes("user_roles")
              ? [{ id: "direct" }]
              : [{ id: "org-role", organizationId: "hr" }],
      ),
    };
    expect(
      await new KnowledgeAuthorizationService({
        manager: m,
      } as never).membership(ordinary),
    ).toEqual({
      userId: "u",
      organizationIds: ["root", "hr", "child"],
      roleIds: ["direct", "org-role"],
    });
  });
});
