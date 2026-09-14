import { MasterPlanApplicationService } from "./master-plan.application.service";

const actor = { tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester", permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-import", source: "web" as const };

describe("MasterPlanApplicationService imports", () => {
  it("enforces base-plan required fields and dictionary values on the backend", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new MasterPlanApplicationService({ query, manager: { query } } as never, { processOutbox: jest.fn() } as never);
    const common = { orderNumber: "SO-1", itemCode: "ITEM-1", deliveryNumber: 1, latestCustomerDueDate: "2026-10-01", plannedQuantity: 1 };

    await expect(service.create("mps-base-plans", common, actor)).rejects.toThrow("最迟评审交期不能为空");
    await expect(service.create("mps-base-plans", {
      ...common, latestReviewDueDate: "2026-09-20", productAttribute: "塑料", modelAge: "新", surfaceNature: "烤漆", manufacturingMethod: "自制"
    }, actor)).rejects.toThrow("产品属性只能选择：五金、木作、亚克力、五金+木作");
  });

  it("validates a blank-identity row as a create and rejects duplicate business keys", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const dataSource = { query, manager: { query } };
    const service = new MasterPlanApplicationService(dataSource as never, { processOutbox: jest.fn().mockResolvedValue(undefined) } as never);
    const rows = [
      { row: 2, id: null, expectedVersion: null, values: { itemCode: "ITEM-001", technicalDays: "1" } },
      { row: 3, id: null, expectedVersion: null, values: { itemCode: "ITEM-001", technicalDays: "2" } }
    ];

    await expect(service.validateImportUpdates("mps-process-cycles", rows, actor)).resolves.toEqual([
      { row: 3, reason: "文件中存在重复业务记录" }
    ]);
  });

  it("does not let import permission bypass create permission for blank-identity rows", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new MasterPlanApplicationService({ query, manager: { query } } as never, { processOutbox: jest.fn() } as never);
    const importOnlyActor = { ...actor, isSystemAdmin: false, permissions: ["mps-process-cycles:*:import"] };

    await expect(service.validateImportUpdates("mps-process-cycles", [
      { row: 2, id: null, expectedVersion: null, values: { itemCode: "ITEM-001" } }
    ], importOnlyActor)).resolves.toEqual([
      { row: 2, reason: "当前权限组没有该表新增权限，不能导入新增记录" }
    ]);
  });

  it("creates an imported row transactionally and records create and batch audits", async () => {
    const inserted = { id: "22222222-2222-4222-8222-222222222222", version: 1, item_code: "ITEM-NEW" };
    const query = jest.fn(async (...args: [string, unknown[]?]) => {
      const [sql] = args;
      if (sql.includes("SELECT response_json")) return [];
      if (sql.includes("INSERT INTO mps_process_cycles")) return [inserted];
      return [];
    });
    const manager = { query };
    const dataSource = { transaction: (operation: (value: typeof manager) => unknown) => operation(manager), manager, query };
    const sync = { processOutbox: jest.fn().mockResolvedValue(undefined) };
    const service = new MasterPlanApplicationService(dataSource as never, sync as never);

    const result = await service.importUpdates("mps-process-cycles", [
      { id: null, expectedVersion: null, values: { itemCode: "ITEM-NEW", technicalDays: "1.5" } }
    ], "file-hash", actor);

    expect(result).toEqual({ total: 1, created: 1, updated: 0, repeated: false });
    expect(query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("mps-process-cycles.import_created"))).toBe(true);
    expect(query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("mps-process-cycles.import_confirmed"))).toBe(true);
  });

  it("returns server-confirmed normalized field values and latest version from update", async () => {
    const current = { id: "22222222-2222-4222-8222-222222222222", version: 4, item_code: "旧编码" };
    const updated = { ...current, version: 5, item_code: "服务端确认编码" };
    const query = jest.fn(async (...args: [string, unknown[]?]) => {
      const [sql] = args;
      if (sql.startsWith("SELECT * FROM mps_process_cycles")) return [current];
      if (sql.startsWith("UPDATE mps_process_cycles")) return [[updated], 1];
      return [];
    });
    const manager = { query }; const dataSource = { transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query };
    const service = new MasterPlanApplicationService(dataSource as never, { processOutbox: jest.fn().mockResolvedValue(undefined) } as never);

    await expect(service.update("mps-process-cycles", current.id, { itemCode: "  客户端编码  ", expectedVersion: 4 }, actor)).resolves.toEqual({
      id: current.id, version: 5, values: { itemCode: "服务端确认编码" }
    });
  });

  it("keeps batch update operational with expected versions, idempotency and audit", async () => {
    const id = "22222222-2222-4222-8222-222222222222"; const current = { id, version: 2, item_code: "旧编码", created_by: actor.userId };
    const query = jest.fn(async (...args: [string, unknown[]?]) => {
      const [sql] = args;
      if (sql.includes("SELECT request_hash,response_json")) return [];
      if (sql.startsWith("SELECT * FROM mps_process_cycles")) return [current];
      if (sql.startsWith("UPDATE mps_process_cycles")) return [[{ ...current, version: 3, item_code: "批量新编码" }], 1];
      return [];
    });
    const manager = { query }; const dataSource = { transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query };
    const service = new MasterPlanApplicationService(dataSource as never, { processOutbox: jest.fn().mockResolvedValue(undefined) } as never);
    const result = await service.batchUpdate("mps-process-cycles", {
      records: [{ id, expectedVersion: 2 }], fieldKey: "itemCode", value: "批量新编码", idempotencyKey: "33333333-3333-4333-8333-333333333333"
    }, actor);

    expect(result).toEqual(expect.objectContaining({ submitted: 1, succeeded: 1, failed: 0 }));
    expect(query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("mps-process-cycles.batch_item_updated"))).toBe(true);
    expect(query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("mps-process-cycles.batch_updated"))).toBe(true);
  });
});
