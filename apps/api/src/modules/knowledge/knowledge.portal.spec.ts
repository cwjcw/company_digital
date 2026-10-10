import { tablePermissionFieldsFor } from "@kdos/contracts";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { knowledgeExpressions, type KnowledgeActor } from "./knowledge.types";
const viewer: KnowledgeActor = { tenantId: "PORTAL", userId: "0199e000-0000-7000-8000-000000000001", username: "fixture", requestId: "test", permissions: ["knowledge-pages:*:read", "knowledge-spaces:*:read",
  ...["knowledge-pages", "knowledge-spaces"].flatMap(r => tablePermissionFieldsFor(r as never).map(f => `${r}:${f.key}:read`))] };
function fixture(targets = true) {
  const manager = { query: jest.fn(async (sql: string) => sql.includes("count(*)") ? [{ total: 0 }] : sql.startsWith("SELECT 1") ? targets ? [{ exists: 1 }] : [] : []) };
  const access = { chain: jest.fn(() => "WITH chain AS (SELECT 1)"), transaction: jest.fn(async (_actor, work) => work(manager)), clause: jest.fn(async () => "existing_page_acl"), spaceClause: jest.fn(async () => "existing_space_acl") };
  return { service: new KnowledgeQueryService(access as never), manager, access };
}
describe("Knowledge employee portal query boundaries", () => {
  it("readers have no management capability even with readable fields", async () => {
    const { service, access, manager } = fixture();
    expect(await service.capabilities(viewer)).toEqual(Object.fromEntries(["canManage", "canCreatePages", "canEditPages", "canManagePages", "canCreateSpaces", "canManageSpaces", "canArchive", "canTrash"].map(k => [k, false])));
    expect(access.clause).not.toHaveBeenCalled(); expect(manager.query).not.toHaveBeenCalled();
  });
  it("denies callers lacking module read", () => {
    expect(() => fixture().service.capabilities({ ...viewer, permissions: [] })).toThrow(/权限/);
  });
  it("edit action without writable/readable fields does not show edit management", async () => {
    const { service } = fixture();
    expect((await service.capabilities({ ...viewer, permissions: [...viewer.permissions, "knowledge-pages:*:update"] })).canEditPages).toBe(false);
  });
  it("a real editor target is checked with the existing EDITOR ACL and data scope", async () => {
    const { service, access } = fixture();
    const actor = { ...viewer, permissions: [...viewer.permissions, "knowledge-pages:*:update", "knowledge-pages:title:update"] };
    const caps = await service.capabilities(actor);
    expect(caps.canEditPages).toBe(true); expect(caps.canManage).toBe(true); expect(caps.canManageSpaces).toBe(false);
    expect(access.clause).toHaveBeenCalledWith(actor, expect.any(Array), "working", "update", 2, expect.anything());
    expect((await fixture(false).service.capabilities(actor)).canManage).toBe(false);
  });
  it("space/page creation and administrator navigation retain field checks", async () => {
    const { service } = fixture();
    const caps = await service.capabilities({ ...viewer, permissions: ["*"] });
    expect(Object.values(caps).every(Boolean)).toBe(true);
    const limited = await service.capabilities({ ...viewer, permissions: [...viewer.permissions, "knowledge-pages:*:create", "knowledge-pages:title:update"] });
    expect(limited.canCreatePages).toBe(false);
  });
  it("published lists project immutable primary files and sort by publication timestamp", async () => {
    const { service, manager } = fixture();
    await service.list({ mode: "published", pageSize: 10, sortField: "publishedAt", sortOrder: "desc" }, viewer);
    const sql = manager.query.mock.calls.map(c => c[0]).find(s => s.includes('AS "primaryFile"'))!;
    expect(sql).toContain("knowledge_page_version_files"); expect(sql).toContain("link.version_id=record.published_version_id"); expect(sql).toContain("ORDER BY published.published_at desc,record.id");
    expect(sql).not.toContain("storage_key"); expect(sql).not.toContain("record.updated_at");
    expect(knowledgeExpressions("knowledge-pages", "published").updatedAt).toBe("published.published_at");
  });
  it("hides file metadata when attachment fields are unreadable", async () => {
    const { service, manager } = fixture();
    await service.list({ mode: "published" }, { ...viewer, permissions: viewer.permissions.filter(p => p !== "knowledge-pages:attachmentIds:read") });
    expect(manager.query.mock.calls.map(c => c[0]).join("\n")).not.toContain('AS "primaryFile"');
  });
});
