import { KnowledgeAccessService, canKnowledge, canKnowledgeField, knowledgeAclClause, knowledgeDataScope } from "./knowledge.scope";
import type { KnowledgeActor } from "./knowledge.types";
const ordinary: KnowledgeActor = { tenantId: "A", userId: "u", username: "member", requestId: "test", permissions: ["knowledge-articles:*:read"], tableDataScopes: [{ resource: "knowledge-articles", scope: "ALL", actions: ["read"] }] };
describe("Knowledge authorization boundary", () => {
  it("requires resource and field grants independently", () => { expect(canKnowledge(ordinary, "knowledge-articles", "read")).toBe(true); expect(canKnowledgeField(ordinary, "knowledge-articles", "content", "read")).toBe(false); for (const action of ["create", "update", "delete"]) expect(canKnowledge(ordinary, "knowledge-articles", action)).toBe(false); });
  it.each([{ isSystemAdmin: true }, { moduleAdminCodes: ["knowledge"] }, { permissions: ["*"] }])("uses existing administrator authority %j", (claims) => { const actor = { ...ordinary, ...claims }; expect(canKnowledge(actor, "knowledge-categories", "create")).toBe(true); expect(canKnowledgeField(actor, "knowledge-articles", "status", "update")).toBe(true); });
  it("does not inherit Planning administrator authority", () => { const actor = { ...ordinary, moduleAdminCodes: ["planning"] }; expect(canKnowledge(actor, "knowledge-categories", "create")).toBe(false); expect(knowledgeDataScope(actor, "knowledge-articles", "update", [])).toBe("1=0"); });
  it("never expands update with read ALL scope", () => { expect(knowledgeDataScope(ordinary, "knowledge-articles", "update", [])).toBe("1=0"); });
  it("parameterizes all four visibility types", () => { const params: unknown[] = ["A"]; const sql = knowledgeAclClause("published.visibility", { userId: "u", organizationIds: ["o"], roleIds: ["r"] }, params); expect(sql).toContain("'ALL'"); expect(sql).toContain("'USER'"); expect(sql).toContain("'ORGANIZATION'"); expect(sql).toContain("'ROLE'"); expect(params).toEqual(["A", "u", ["o"], ["r"]]); expect(sql).not.toContain("'u'"); });
  it("uses canonical organization path and live ordinary-role membership", async () => {
    const manager = { query: jest.fn().mockImplementation((sql: string) => sql.includes("department_paths") ? [{ paths: [["公司", "人力资源", "招聘"]] }] : sql.includes("FROM organization_units") ? [{ id: "root", name: "公司" }, { id: "hr", name: "人力资源", parentId: "root" }, { id: "child", name: "招聘", parentId: "hr" }, { id: "other", name: "其他", parentId: "root" }] : sql.includes("user_roles") ? [{ id: "direct" }] : [{ id: "org-role", organizationId: "hr" }, { id: "other-role", organizationId: "other" }]) };
    expect(await new KnowledgeAccessService({ manager } as never).membership(ordinary)).toEqual({ userId: "u", organizationIds: ["root", "hr", "child"], roleIds: ["direct", "org-role"] });
  });
  it("browse includes tenant, published state and ACL in SQL; read-only cannot manage", async () => {
    const service = new KnowledgeAccessService({} as never); jest.spyOn(service, "membership").mockResolvedValue({ userId: "u", organizationIds: [], roleIds: [] });
    const sql = await service.clause(ordinary, ["A"], "browse"); expect(sql).toContain("record.tenant_id=$1"); expect(sql).toContain("record.status='PUBLISHED'"); expect(sql).toContain("published.visibility"); await expect(service.clause(ordinary, ["A"], "manage")).rejects.toThrow("管理权限");
  });
});
