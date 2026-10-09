import { KnowledgeQueryService } from "./knowledge.query.service";
import type { KnowledgeActor } from "./knowledge.types";
const id = "0199e000-0000-7000-8000-000000000001";
const reads = ["status", "title", "content", "contentText", "tags", "attachmentIds"].map(f => `knowledge-pages:${f}:read`);
const publisher: KnowledgeActor = { tenantId: "PUBLISH_TEST", userId: id, username: "fixture", permissions: ["knowledge-pages:*:read", "knowledge-pages:*:update", "knowledge-pages:status:update", ...reads], requestId: "publish-test" };
describe("Knowledge publication status authorization", () => {
  function fixture(canEdit = true) {
    const manager = { query: jest.fn(async (sql: string) => [{ id, version: 7, internalPublishedVersionId: id, ...(sql.includes('AS "hasUnpublishedChanges"') ? { hasUnpublishedChanges: true } : {}) }]) };
    const access = { transaction: jest.fn(async (_actor, work) => work(manager)), clause: jest.fn(async () => "authorized_tenant_and_page"), historicalClause: jest.fn(() => "authorized_history"), membership: jest.fn(async () => ({})) };
    const service = new KnowledgeQueryService(access as never);
    jest.spyOn(service as any, "allowed").mockImplementation(async (...args: any[]) => args[4] === 2 && canEdit);
    jest.spyOn(service as any, "files").mockResolvedValue([]);
    jest.spyOn(service as any, "tagNames").mockResolvedValue([]);
    return service;
  }
  it("exposes current working-change metadata to a page editor with status write authority", async () => {
    const row = await fixture().detail(id, {}, publisher);
    expect(row.canEdit).toBe(true);
    expect(row.hasUnpublishedChanges).toBe(true);
    expect(row.version).toBe(7);
  });
  it.each(["knowledge-pages:*:update", "knowledge-pages:status:update", "knowledge-pages:status:read", "knowledge-pages:content:read"])("omits the flag without %s", async (missing) => {
    const row = await fixture().detail(id, {}, { ...publisher, permissions: publisher.permissions.filter(p => p !== missing) });
    expect(row).not.toHaveProperty("hasUnpublishedChanges");
  });
  it("page ACL still strips the flag despite table and field permissions", async () => {
    const row = await fixture(false).detail(id, {}, publisher);
    expect(row.canEdit).toBe(false);
    expect(row).not.toHaveProperty("hasUnpublishedChanges");
  });
  it("historical reading never receives mutable working-change metadata", async () => {
    const row = await fixture().detail(id, { versionId: id }, { ...publisher, permissions: [...publisher.permissions, "knowledge-pages:publishedVersion:read"] });
    expect(row).not.toHaveProperty("hasUnpublishedChanges");
  });
});
