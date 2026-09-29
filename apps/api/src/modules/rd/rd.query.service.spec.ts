import { RdQueryService } from "./rd.query.service";

describe("RdQueryService 实时一物多码检索", () => {
  const actor = {
    tenantId: "KAINAN", userId: "user-1", username: "研发管理员", permissions: ["*"], moduleAdminCodes: ["rd"],
    isSystemAdmin: true, tableDataScopes: [], requestId: "request-1", source: "web" as const,
  };

  it("扫描租户物料全库，limit 只控制 Top N 返回数量", async () => {
    const rows = [
      { row: 0, code: "LATE-304", name: "304内六角螺钉", spec: "M6*20" },
      { row: 0, code: "OTHER", name: "纸箱", spec: "500*400" },
    ];
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ count: 2, maxUpdatedAt: "2026-09-29T00:00:00.000Z" }]).mockResolvedValueOnce(rows) };
    const service = new RdQueryService(dataSource as never);

    const result = await service.check({ itemName: "304内六角螺钉", specification: "M6*20", limit: 10 }, actor);
    const sql = dataSource.query.mock.calls[1]?.[0] as string;

    expect(sql).toContain("FROM rd_items WHERE tenant_id=$1");
    expect(sql).not.toMatch(/LIMIT|last_modified_at_source|modified_at_source|5000|20000/);
    expect(dataSource.query.mock.calls[1]?.[1]).toEqual(["KAINAN"]);
    expect(result).toMatchObject({ rowsScanned: 2, limit: 10 });
    expect(result.results[0]).toMatchObject({ code: "LATE-304", score: 100 });
  });
});
