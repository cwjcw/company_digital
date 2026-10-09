import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import type { KnowledgeActor } from "./knowledge.types";
const actor: KnowledgeActor = { tenantId: "UX", userId: null, username: "fixture", permissions: ["*"], requestId: "ux-test" };
describe("Knowledge Space UX contract", () => {
  function fixture(collisions = 0) {
    const inserted: unknown[][] = [];
    const manager = { query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('AS "nextOrder"')) return [{ nextOrder: 40 }];
      if (sql.startsWith("INSERT INTO knowledge_spaces")) {
        inserted.push(params);
        if (collisions-- > 0) throw Object.assign(new Error("unique conflict"), { code: "23505" });
      }
      return [{ exists: 1 }];
    }) };
    const transaction = jest.fn(async (_actor, work) => work(manager));
    const service = new KnowledgeApplicationService({ transaction } as never, {} as never);
    jest.spyOn(service as any, "audit").mockResolvedValue(undefined);
    return { service, transaction, inserted };
  }
  it("generates the stable code from the server page identity and defaults order/icon", async () => {
    const { service, inserted } = fixture();
    const created = await service.createSpace({ name: "新空间" }, actor);
    expect(inserted[0]![2]).toBe(`SPACE_${created.id.replace(/-/g, "")}`);
    expect(inserted[0]![5]).toBe("book"); expect(inserted[0]![6]).toBe(40);
  });
  it("retries a unique collision in a new transaction with a new code and id", async () => {
    const { service, transaction, inserted } = fixture(1);
    const created = await service.createSpace({ name: "新空间", sortOrder: 0, icon: "research" }, actor);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(inserted[0]![0]).not.toBe(inserted[1]![0]);
    expect(inserted[0]![2]).not.toBe(inserted[1]![2]);
    expect(inserted[1]![0]).toBe(created.id); expect(inserted[1]![6]).toBe(0);
  });
  it("bounds collision retries and rejects manually supplied creation code", async () => {
    const { service, transaction } = fixture(4);
    await expect(service.createSpace({ name: "新空间" }, actor)).rejects.toThrow(/重复/);
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(() => service.createSpace({ code: "ERP", name: "空间" }, actor)).toThrow();
  });
  it("retains action and submitted field authorization", () => {
    const { service } = fixture();
    expect(() => service.createSpace({ name: "空间" }, { ...actor, permissions: [] })).toThrow(/权限/);
    expect(() => service.createSpace({ name: "空间", icon: "book" }, { ...actor, permissions: ["knowledge-spaces:*:create", "knowledge-spaces:name:update"] })).toThrow(/icon/);
  });
});
describe("Knowledge location query UX contract", () => {
  const id = "0199e000-0000-7000-8000-000000000001";
  it("delegates target searches to working/create query with typed title filter and exclusion", async () => {
    const service = new KnowledgeQueryService({} as never);
    const list = jest.spyOn(service, "list").mockResolvedValue({ rows: [{ id, title: "公司制度", parentId: null, breadcrumb: [], content: "must not leak" }], total: 1, page: 2, pageSize: 100 });
    const result = await service.locations(id, { search: "公司制度", page: 2, excludeId: id }, actor);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ mode: "working", tree: false, page: 2, filterGroup: { logic: "AND", rules: [{ field: "title", operator: "contains", value: "公司制度" }] } }), actor, "create", id);
    expect(result.rows[0]).not.toHaveProperty("content");
  });
  it("delegates a child branch to a paged tree query", async () => {
    const service = new KnowledgeQueryService({} as never);
    const list = jest.spyOn(service, "list").mockResolvedValue({ rows: [], total: 105, page: 2, pageSize: 100 });
    const result = await service.locations(id, { parentId: id, page: 2 }, actor);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ tree: true, parentId: id, page: 2 }), actor, "create", undefined);
    expect(result.total).toBe(105);
  });
});
