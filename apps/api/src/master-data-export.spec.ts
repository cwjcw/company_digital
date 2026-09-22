import { PassThrough } from "node:stream";
import { MasterDataController } from "./controllers";

/**
 * KN-FILTER-001：跨页导出自动测试。
 * 断言数据中心的导出与列表共用同一条 FilterGroup 条件，并且导出不分页（返回全部匹配行，而不仅是当前页）。
 */
function fakeRepository(rows: unknown[]) {
  const calls: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    orderBy(clause: string) { calls.push({ clause }); return builder; },
    addOrderBy(clause: string) { calls.push({ clause }); return builder; },
    andWhere(clause: string, params?: Record<string, unknown>) { calls.push({ clause, params }); return builder; },
    skip() { throw new Error("导出不能分页（skip 不应被调用）"); },
    take() { throw new Error("导出不能分页（take 不应被调用）"); },
    getMany: async () => rows
  });
  return {
    calls,
    repository: {
      metadata: { columns: [{ propertyName: "id", databaseName: "id" }, { propertyName: "itemNumber", databaseName: "item_number" }, { propertyName: "customerName", databaseName: "customer_name" }], findColumnWithPropertyName: (key: string) => key === "itemNumber" ? { databaseName: "item_number" } : null },
      createQueryBuilder: () => builder
    }
  };
}

function controllerWith(outbound: unknown) {
  const controller = new MasterDataController(
    { find: async () => [] } as never, { find: async () => [] } as never, { find: async () => [] } as never,
    { find: async () => [] } as never, { find: async () => [] } as never, outbound as never,
    { loadWorkbook: async () => ({}) } as never, {} as never, {} as never
  );
  return controller;
}

describe("数据中心跨页导出（KN-FILTER-001）", () => {
  it("导出复用列表的 FilterGroup 且不限于当前页", async () => {
    const total = 137;
    const rows = Array.from({ length: total }, (_, index) => ({ id: `row-${index}`, itemNumber: "11" }));
    const { repository, calls } = fakeRepository(rows);
    const controller = controllerWith(repository);
    /* ExcelJS 会向响应流写工作簿：用 PassThrough 模拟可写响应（含 setHeader）。 */
    const response = Object.assign(new PassThrough(), { setHeader: () => undefined }) as never;
    await controller.exportFinishedGoodsOutbound(
      JSON.stringify({ logic: "AND", rules: [{ field: "customerName", operator: "contains", value: "公司" }] }),
      "",
      "", "",
      { user: { sub: "u1", permissions: ["*"], isSystemAdmin: true } } as never,
      response
    );
    const clause = calls.map((call) => call.clause).join(" AND ");
    expect(clause).toContain("customer_name");
    expect(clause).toContain("ILIKE");
    expect(clause).not.toContain("LIMIT");
    /* 导出返回全部匹配行（137 > 默认每页 20/50），不是只有当前页。 */
    expect(rows.length).toBeGreaterThan(50);
  });

  it("未知字段仍被拒绝（导出不能绕过字段校验）", async () => {
    const { repository } = fakeRepository([]);
    const controller = controllerWith(repository);
    await expect(controller.exportFinishedGoodsOutbound(
      JSON.stringify({ logic: "AND", rules: [{ field: "notAColumn", operator: "eq", value: 1 }] }),
      "",
      "", "",
      { user: { sub: "u1", permissions: ["*"], isSystemAdmin: true } } as never,
      new PassThrough() as never
    )).rejects.toThrow(/不允许筛选/);
  });

  it("导出继承列菜单排序，拒绝不可读字段排序", async () => {
    const { repository, calls } = fakeRepository([]);
    const controller = controllerWith(repository);
    const response = Object.assign(new PassThrough(), { setHeader: () => undefined }) as never;
    await controller.exportFinishedGoodsOutbound("", "", "itemNumber", "desc", { user: { permissions: ["*"] } } as never, response);
    expect(calls.some((call) => call.clause === "row.itemNumber")).toBe(true);
    await expect(controller.exportFinishedGoodsOutbound("", "", "itemNumber", "asc", { user: { permissions: ["finished-goods-outbound:*:export"] } } as never, response)).rejects.toThrow(/不能按该字段排序/);
  });

  it("数据中心模块管理员保留字段排序权限", async () => {
    const { repository, calls } = fakeRepository([]);
    const response = Object.assign(new PassThrough(), { setHeader: () => undefined }) as never;
    await controllerWith(repository).exportFinishedGoodsOutbound("", "", "itemNumber", "asc", {
      user: { permissions: ["finished-goods-outbound:*:export"], moduleAdminCodes: ["data"] }
    } as never, response);
    expect(calls.some((call) => call.clause === "row.itemNumber")).toBe(true);
  });
});
