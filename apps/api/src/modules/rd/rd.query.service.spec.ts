import { ForbiddenException } from "@nestjs/common";
import { RdQueryService } from "./rd.query.service";

describe("RdQueryService 实时一物多码检索", () => {
  const actor = {
    tenantId: "KAINAN", userId: "user-1", username: "研发管理员", permissions: ["*"], moduleAdminCodes: ["rd"],
    isSystemAdmin: true, tableDataScopes: [], requestId: "request-1", source: "web" as const,
  };
  const readOnlyActor = {
    ...actor, isSystemAdmin: false, moduleAdminCodes: [], permissions: ["rd-material-duplicates:*:read"],
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

  it("没有一物多码查询权限时，查询接口在数据库访问前返回 403", async () => {
    const dataSource = { query: jest.fn() };
    const service = new RdQueryService(dataSource as never);
    const noReadActor = { ...readOnlyActor, permissions: ["rd-items:*:read"] };

    await expect(service.latestScan(noReadActor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.check({ itemName: "304内六角螺钉" }, noReadActor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it("只有一物多码查询权限时，可以查询已保存结果", async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    const service = new RdQueryService(dataSource as never);

    await expect(service.latestScan(readOnlyActor)).resolves.toBeNull();
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  it("可以按扫描 ID 查询增量维护状态而不加载结果明细", async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ id: "scan-1", status: "RUNNING", scanMode: "INCREMENTAL" }]) };
    const service = new RdQueryService(dataSource as never);

    await expect(service.scanStatus("scan-1", readOnlyActor)).resolves.toMatchObject({ id: "scan-1", status: "RUNNING", scanMode: "INCREMENTAL" });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id=$1 AND id=$2"), ["KAINAN", "scan-1"]);
  });
});
