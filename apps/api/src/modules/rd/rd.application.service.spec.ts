import { RdApplicationService } from "./rd.application.service";

const actor = {
  tenantId: "KAINAN", userId: "user-1", username: "研发同步", permissions: ["*"], moduleAdminCodes: ["rd"],
  isSystemAdmin: true, tableDataScopes: [], requestId: "request-1", source: "api" as const,
};

const item = {
  source_id: "11111111-1111-4111-8111-111111111111", item_code: "A-001", item_name: "圆管", specification: "T1*20*50",
  remark: "", is_group_item: null, status: "1", approve_status: "1", created_at_source: null,
  last_modified_at_source: "2026-09-30T00:00:00.000Z", modified_at_source: null,
  created_by_source: null, last_modified_by_source: null, modified_by_source: null,
  created_by_name: null, last_modified_by_name: null, modified_by_name: null,
};

function readerOf(rows: unknown[]) {
  return {
    async *read() {
      for (const row of rows) yield row;
    },
  };
}

function itemWithSource(sourceId: string) {
  return { ...item, source_id: sourceId, item_code: sourceId };
}

function dataSourceOf() {
  const transactionManager = {
    query: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "item-1" }]),
  };
  const dataSource = {
    query: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "run-1" }])
      .mockResolvedValueOnce([{ id: "run-1" }])
      .mockResolvedValue([]),
    transaction: jest.fn(async (work: (manager: typeof transactionManager) => unknown) => work(transactionManager)),
  };
  return { dataSource, manager: transactionManager };
}

describe("E10 增量同步与一物多码维护串联", () => {
  it("只把本批新增/修改物料传入 INCREMENTAL，不触发 FULL", async () => {
    const { dataSource } = dataSourceOf();
    const historyScan = {
      hasFailedMaintenance: jest.fn().mockResolvedValue(false),
      start: jest.fn().mockResolvedValue({ status: "RUNNING", scanMode: "INCREMENTAL" }),
      recordFailure: jest.fn(),
    };
    const service = new RdApplicationService(dataSource as never, readerOf([item]) as never, historyScan as never);

    const result = await service.sync("INCREMENTAL", actor);

    expect(historyScan.start).toHaveBeenCalledWith(actor, "INCREMENTAL", ["item-1"]);
    expect(historyScan.start).not.toHaveBeenCalledWith(actor, "FULL", expect.anything());
    expect(result).toMatchObject({ status: "SUCCESS", changedItems: 1, duplicateScan: { scanMode: "INCREMENTAL" } });
  });

  it("214 条新增加 13 条修改时，增量查重接收全部 227 个真实变化物料", async () => {
    const createdSources = Array.from({ length: 214 }, (_, index) => `00000000-0000-7000-8000-${(index + 1).toString(16).padStart(12, "0")}`);
    const updatedSources = Array.from({ length: 13 }, (_, index) => `00000000-0000-7001-8000-${(index + 1).toString(16).padStart(12, "0")}`);
    const updatedSourceSet = new Set(updatedSources);
    const rows = [...createdSources, ...updatedSources].map(itemWithSource);
    const transactionManager = {
      query: jest.fn().mockImplementation((sql: string, params: unknown[]) => {
        const sourceId = String(params?.[2] ?? "");
        if (sql.includes("SELECT id,content_hash")) return updatedSourceSet.has(sourceId) ? [{ id: `existing-${sourceId}`, content_hash: "old-hash" }] : [];
        if (sql.includes("INSERT INTO rd_items")) return [{ id: `created-id-${sourceId}` }];
        if (sql.includes("UPDATE rd_items SET")) return [[{ id: `updated-id-${sourceId}` }], 1];
        throw new Error(`未预期的事务 SQL：${sql.slice(0, 80)}`);
      }),
    };
    const dataSource = {
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "run-227" }])
        .mockResolvedValueOnce([[{ id: "run-227" }], 1])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      transaction: jest.fn(async (work: (manager: typeof transactionManager) => unknown) => work(transactionManager)),
    };
    const historyScan = {
      hasFailedMaintenance: jest.fn().mockResolvedValue(false),
      start: jest.fn().mockImplementation(async (_actor: unknown, _mode: string, changedItemIds: string[]) => ({ status: "RUNNING", scanMode: "INCREMENTAL", changedItems: changedItemIds.length })),
      recordFailure: jest.fn(),
    };
    const service = new RdApplicationService(dataSource as never, readerOf(rows) as never, historyScan as never);

    const result = await service.sync("INCREMENTAL", actor);

    expect(result).toMatchObject({ rowsCreated: 214, rowsUpdated: 13, changedItems: 227, duplicateScan: { changedItems: 227 } });
    const changedItemIds = historyScan.start.mock.calls[0][2] as string[];
    expect(changedItemIds).toHaveLength(227);
    expect(changedItemIds).not.toContain(undefined);
    expect(changedItemIds).toEqual([
      ...createdSources.map((sourceId) => `created-id-${sourceId}`),
      ...updatedSources.map((sourceId) => `updated-id-${sourceId}`),
    ]);
  });

  it("成功后 watermark_after 等于本批最大时间和 ITEM_BUSINESS_ID cursor", async () => {
    const rows = [
      { ...item, source_id: "00000001-0000-0000-0000-000000000000", last_modified_at_source: "2026-09-30 14:45:14.000978" },
      { ...item, source_id: "01000000-0000-0000-0000-000000000000", last_modified_at_source: "2026-09-30 14:45:14.000978" },
    ];
    const transactionManager = {
      query: jest.fn().mockImplementation((sql: string) => sql.includes("SELECT id,content_hash") ? [] : [{ id: "target-id" }]),
    };
    const dataSource = {
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "run-max" }])
        .mockResolvedValueOnce([[{ id: "run-max" }], 1])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      transaction: jest.fn(async (work: (manager: typeof transactionManager) => unknown) => work(transactionManager)),
    };
    const historyScan = {
      hasFailedMaintenance: jest.fn().mockResolvedValue(false),
      start: jest.fn().mockResolvedValue({ status: "RUNNING", scanMode: "INCREMENTAL" }),
      recordFailure: jest.fn(),
    };
    const service = new RdApplicationService(dataSource as never, readerOf(rows) as never, historyScan as never);

    const result = await service.sync("INCREMENTAL", actor);
    const successUpdate = dataSource.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE rd_sync_runs SET status='SUCCESS'"));

    expect(successUpdate?.[1]).toEqual(["run-max", 2, 2, 0, 0, "2026-09-30 14:45:14.000978+00:00", "00000001-0000-0000-0000-000000000000", "KAINAN"]);
    expect(result).toMatchObject({ watermark: { at: "2026-09-30T14:45:14.000978Z", id: "00000001-0000-0000-0000-000000000000" } });
  });

  it("reader 或目标写入失败时不提交 watermark_after", async () => {
    const failingReader = {
      async *read() {
        if (process.env.NODE_ENV === "__never__") yield item;
        throw new Error("E10 mock read failed");
      },
    };
    const dataSource = {
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "run-failed" }])
        .mockResolvedValue([]),
      transaction: jest.fn(),
    };
    const historyScan = { hasFailedMaintenance: jest.fn(), start: jest.fn(), recordFailure: jest.fn() };
    const service = new RdApplicationService(dataSource as never, failingReader as never, historyScan as never);

    await expect(service.sync("INCREMENTAL", actor)).rejects.toThrow("E10 mock read failed");
    expect(dataSource.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE rd_sync_runs SET status='SUCCESS'"))).toBe(false);
    expect(dataSource.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE rd_sync_runs SET status='FAILED'"))).toBe(true);
  });

  it("查重维护失败不回滚已成功同步的物料，并记录失败以便后续重试", async () => {
    const { dataSource } = dataSourceOf();
    const historyScan = {
      hasFailedMaintenance: jest.fn().mockResolvedValue(false),
      start: jest.fn().mockRejectedValue(new Error("查重后台异常")),
      recordFailure: jest.fn().mockResolvedValue({ status: "FAILED", scanMode: "INCREMENTAL" }),
    };
    const service = new RdApplicationService(dataSource as never, readerOf([item]) as never, historyScan as never);

    const result = await service.sync("INCREMENTAL", actor);

    expect(result).toMatchObject({ status: "SUCCESS", duplicateScan: { status: "FAILED" } });
    expect(historyScan.recordFailure).toHaveBeenCalledWith(actor, "查重后台异常");
    expect(dataSource.query.mock.calls.some(([sql]) => String(sql).includes("status='FAILED'"))).toBe(false);
  });

  it("没有新物料但存在失败维护时，下一次同步会自动重试历史增量维护", async () => {
    const { dataSource } = dataSourceOf();
    const historyScan = {
      hasFailedMaintenance: jest.fn().mockResolvedValue(true),
      start: jest.fn().mockResolvedValue({ status: "RUNNING", scanMode: "INCREMENTAL" }),
      recordFailure: jest.fn(),
    };
    const service = new RdApplicationService(dataSource as never, readerOf([]) as never, historyScan as never);

    await service.sync("INCREMENTAL", actor);

    expect(historyScan.start).toHaveBeenCalledWith(actor, "INCREMENTAL", undefined);
  });

  it("失败状态写入异常时也不把 E10 成功同步改报为失败", async () => {
    const { dataSource } = dataSourceOf();
    const historyScan = {
      hasFailedMaintenance: jest.fn().mockResolvedValue(false),
      start: jest.fn().mockRejectedValue(new Error("查重后台异常")),
      recordFailure: jest.fn().mockRejectedValue(new Error("查重失败状态写入异常")),
    };
    const service = new RdApplicationService(dataSource as never, readerOf([item]) as never, historyScan as never);

    const result = await service.sync("INCREMENTAL", actor);

    expect(result).toMatchObject({
      status: "SUCCESS",
      duplicateScan: { status: "FAILED", errorMessage: "增量查重维护失败，且失败状态记录未成功写入" },
    });
  });
});
