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
