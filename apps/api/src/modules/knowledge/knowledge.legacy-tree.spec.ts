import { tablePermissionFieldsFor } from "@kdos/contracts";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { KnowledgeAuthorizationService } from "./knowledge.scope";
import type { KnowledgeActor } from "./knowledge.types";

const id = "0199e000-0000-7000-8000-000000000011";
const member: KnowledgeActor = {
  tenantId: "LEGACY_TEST", userId: id, username: "fixture", requestId: "legacy-query",
  permissions: ["knowledge-pages:*:read", "knowledge-pages:*:update", "knowledge-spaces:*:read",
    ...(["knowledge-pages", "knowledge-spaces"] as const).flatMap(resource => tablePermissionFieldsFor(resource).map(field => `${resource}:${field.key}:read`))],
  tableDataScopes: [
    { resource: "knowledge-spaces", scope: "ALL", actions: ["read"] },
    { resource: "knowledge-pages", scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "title", operator: "CONTAINS", value: "历史" }] }
  ]
};
const admin: KnowledgeActor = { ...member, permissions: ["*"], isSystemAdmin: true };
function fixture() {
  const manager = { query: jest.fn(async (sql: string) => sql.startsWith("SELECT count(*)") ? [{ total: 0 }] : []) };
  const access = new KnowledgeAuthorizationService({ transaction: async (work: (m: unknown) => unknown) => work(manager) } as never);
  jest.spyOn(access, "membership").mockResolvedValue({ userId: id, roleIds: [], organizationIds: [] });
  return { service: new KnowledgeQueryService(access), manager };
}

describe("Knowledge legacyOnly complete SQL alias safety", () => {
  it.each(["published", "working"] as const)("preserves ancestor aliases in complete %s SQL for admin and scoped members", async mode => {
    for (const actor of [admin, member]) {
      for (const legacyOnly of [true, "true"]) {
        const { service, manager } = fixture();
        await service.list({ mode, legacyOnly, tree: true, spaceId: id }, actor);
        const queries = manager.query.mock.calls.filter(([sql]) => sql.includes("FROM knowledge_pages record"));
        expect(queries).toHaveLength(2);
        for (const [sql, params] of queries as unknown as Array<[string, unknown[]]>) {
          expect(sql).toContain("knowledge_page_versions legacy_published ON legacy_published.tenant_id=legacy_child.tenant_id");
          expect(sql).toContain("ancestor_published.tenant_id=ancestor.tenant_id");
          expect(sql).not.toContain("ancestor_legacy_published");
          expect(sql).toContain("legacy_child.tenant_id=$1");
          expect(sql).toContain("WITH RECURSIVE chain");
          expect(params[0]).toBe(actor.tenantId);
          expect(sql).toContain(mode === "published" ? "legacy_published.parent_id=record.id" : "legacy_child.parent_id=record.id");
          if (!actor.isSystemAdmin) {
            expect(sql).toContain("knowledge_page_access acl");
            expect(sql).toContain(mode === "published" ? "ancestor_published.title" : "ancestor.title");
            expect(params).toContain(actor.userId);
          }
        }
      }
    }
  });
  it.each(["published", "working"] as const)("does not add legacy root filtering to a %s child branch or a normal list", async mode => {
    for (const input of [{ parentId: id, legacyOnly: true, tree: true }, { legacyOnly: false }]) {
      const { service, manager } = fixture();
      await service.list({ ...input, mode }, admin);
      for (const [sql] of manager.query.mock.calls) expect(sql).not.toContain("legacy_child");
    }
  });
  it("retains the working-mode update permission requirement", async () => {
    const { service } = fixture();
    await expect(service.list({ mode: "working", legacyOnly: true }, {
      ...member, permissions: member.permissions.filter(p => p !== "knowledge-pages:*:update")
    })).rejects.toThrow("权限");
  });
});
