import { MasterPlanApplicationService } from "./master-plan.application.service";

const actor = { tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester", permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-import", source: "web" as const };

describe("MasterPlanApplicationService imports", () => {
  it("rejects direct POST and Excel creation of a division weekly plan", async () => {
    const query = jest.fn().mockResolvedValue([]); const manager = { query };
    const service = new MasterPlanApplicationService({ query, manager, transaction: (work: (value: typeof manager) => unknown) => work(manager) } as never, { processOutbox: jest.fn() } as never);
    const values = {
      orderNumber: "SO-1", itemCode: "ITEM-1", deliveryNumber: 1,
      latestCustomerDueDate: "2026-10-01", latestReviewDueDate: "2026-09-20", plannedQuantity: 1
    };

    await expect(service.create("mps-weekly-plans", values, actor)).rejects.toThrow("事业部周计划只能由事业部基础计划生成。");
    await expect(service.validateImportUpdates("mps-weekly-plans", [
      { row: 2, id: null, expectedVersion: null, values }
    ], actor)).resolves.toEqual([
      { row: 2, reason: "事业部周计划只能由事业部基础计划生成。" }
    ]);
    await expect(service.importUpdates("mps-weekly-plans", [
      { id: null, expectedVersion: null, values }
    ], "weekly-create-file", actor)).rejects.toThrow("事业部周计划只能由事业部基础计划生成。");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO mps_weekly_plans"))).toBe(false);
  });

  it("accepts zero business quantities but still rejects negative values and version zero", async () => {
    const weekly = { division_id: "22222222-2222-4222-8222-222222222222", order_number: "SO-1", item_code: "ITEM-1", item_name: "品项", delivery_number: 0, planned_quantity: 0, manufacturing_method: "自制" };
    const query = jest.fn(async (sql: string) => sql.includes("FROM mps_weekly_plans") ? [weekly] : []);
    const service = new MasterPlanApplicationService({ query, manager: { query } } as never, { processOutbox: jest.fn() } as never);
    await expect(service.validateImportUpdates("mps-shipping-plans", [{ row: 1, id: null, expectedVersion: null, values: { customerCode: "C1", orderNumber: "SO-1", itemCode: "ITEM-1", itemName: "品项", deliveryNumber: 0, latestCustomerDueDate: "2026-10-01", plannedQuantity: 0, divisionId: "22222222-2222-4222-8222-222222222222" } }], actor)).resolves.toEqual([]);
    await expect(service.validateImportUpdates("mps-process-reports", [{ row: 2, id: null, expectedVersion: null, values: { weeklyPlanId: "22222222-2222-4222-8222-222222222222", processCode: "cutting", productionDate: "2026-09-15", productionQuantity: 0 } }], actor)).resolves.toEqual([]);
    await expect(service.validateImportUpdates("mps-process-reports", [{ row: 3, id: null, expectedVersion: null, values: { weeklyPlanId: "22222222-2222-4222-8222-222222222222", processCode: "cutting", productionDate: "2026-09-15", productionQuantity: -1 } }], actor)).resolves.toEqual([{ row: 3, reason: "报工数量必须为非负数字" }]);
    await expect(service.validateImportUpdates("mps-process-reports", [{ row: 4, id: "22222222-2222-4222-8222-222222222222", expectedVersion: 0, values: { productionQuantity: 0 } }], actor)).resolves.toEqual([{ row: 4, reason: "版本必须为正整数" }]);
    await expect(service.update("mps-process-cycles", "22222222-2222-4222-8222-222222222222", { itemCode: "ITEM", expectedVersion: 0 }, actor)).rejects.toThrow("expectedVersion 必须是正整数");
  });

  it.each([
    ["customerCode", "客户编码"], ["orderNumber", "订单编号"], ["itemCode", "品项编码"], ["itemName", "品项名称"],
    ["deliveryNumber", "交期编码"], ["latestCustomerDueDate", "最迟客户交期"], ["plannedQuantity", "计划数量"], ["divisionId", "承接事业部"]
  ])("rejects clearing required shipping field %s during import update", async (field, label) => {
    const current = { id: "22222222-2222-4222-8222-222222222222", version: 2, customer_code: "C1", order_number: "SO-1", item_code: "I1", item_name: "品项", delivery_number: 0, latest_customer_due_date: "2026-10-01", planned_quantity: 0, division_id: "33333333-3333-4333-8333-333333333333" };
    const query = jest.fn(async (sql: string) => sql.startsWith("SELECT * FROM mps_shipping_plans") ? [current] : []);
    const service = new MasterPlanApplicationService({ query, manager: { query } } as never, { processOutbox: jest.fn() } as never);
    await expect(service.validateImportUpdates("mps-shipping-plans", [{ row: 38, id: current.id, expectedVersion: 2, values: { [field]: "" } }], actor)).resolves.toEqual([{ row: 38, reason: `${label}不能为空` }]);
  });

  it("detects a unique-key conflict from the complete updated record during preview", async () => {
    const current = { id: "22222222-2222-4222-8222-222222222222", version: 2, customer_code: "C1", order_number: "SO-1", item_code: "I1", item_name: "品项", delivery_number: 0, latest_customer_due_date: "2026-10-01", planned_quantity: 0, division_id: "33333333-3333-4333-8333-333333333333" };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith("SELECT * FROM mps_shipping_plans")) return [current];
      if (sql.startsWith("SELECT id FROM mps_shipping_plans")) return [{ id: "44444444-4444-4444-8444-444444444444" }];
      return [];
    });
    const service = new MasterPlanApplicationService({ query, manager: { query } } as never, { processOutbox: jest.fn() } as never);
    await expect(service.validateImportUpdates("mps-shipping-plans", [{ row: 51, id: current.id, expectedVersion: 2, values: { orderNumber: "SO-2" } }], actor)).resolves.toEqual([{ row: 51, reason: "修改后的业务唯一键与现有记录重复" }]);
  });

  it("applies the outsourcing received-date rule during preview", async () => {
    const current = { id: "22222222-2222-4222-8222-222222222222", version: 2, received: false, actual_inbound_date: null };
    const query = jest.fn(async (sql: string) => sql.startsWith("SELECT * FROM mps_outsourcing_reports") ? [current] : []);
    const service = new MasterPlanApplicationService({ query, manager: { query } } as never, { processOutbox: jest.fn() } as never);
    await expect(service.validateImportUpdates("mps-outsourcing-reports", [{ row: 5, id: current.id, expectedVersion: 2, values: { received: true } }], actor)).resolves.toEqual([{ row: 5, reason: "标记外协已入库时必须填写实际入库日期" }]);
  });

  it("allows a non-system administrator with explicit permissions to update system settings", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const current = { id, version: 3, value_json: "old", created_by: actor.userId };
    const updated = { ...current, version: 4, value_json: "new" };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith("SELECT * FROM mps_system_settings")) return [current];
      if (sql.startsWith("UPDATE mps_system_settings")) return [[updated], 1];
      return [];
    });
    const manager = { query }; const dataSource = { transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query };
    const service = new MasterPlanApplicationService(dataSource as never, { processOutbox: jest.fn().mockResolvedValue(undefined) } as never);
    const permitted = { ...actor, isSystemAdmin: false, permissions: ["mps-system-settings:*:update", "mps-system-settings:valueJson:update"], tableDataScopes: [{ resource: "mps-system-settings", scope: "ALL" as const, actions: ["update"] }] };
    await expect(service.update("mps-system-settings", id, { valueJson: "new", expectedVersion: 3 }, permitted)).resolves.toEqual({ id, version: 4, values: { valueJson: "new" } });
    await expect(service.update("mps-system-settings", id, { valueJson: "new", expectedVersion: 3 }, { ...permitted, permissions: [] })).rejects.toThrow("当前权限组没有该表修改权限");
  });

  it.each([
    ["23505", "相同业务唯一键"], ["23503", "关联的上游记录"], ["23514", "业务约束"], ["23502", "不能为空"],
    ["22003", "数值超出"], ["22001", "文本内容超过"], ["22P02", "字段类型或日期格式"], ["22007", "字段类型或日期格式"]
  ])("translates PostgreSQL error %s into a business message", async (code, expected) => {
    const service = new MasterPlanApplicationService({} as never, {} as never) as any;
    await expect(service.translateDatabaseError(async () => { throw { code, column: "planned_quantity" }; })).rejects.toThrow(expected);
  });
  it("enforces base-plan required fields and dictionary values on the backend", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new MasterPlanApplicationService({ query, manager: { query } } as never, { processOutbox: jest.fn() } as never);
    const common = { orderNumber: "SO-1", itemCode: "ITEM-1", deliveryNumber: 1, latestCustomerDueDate: "2026-10-01", plannedQuantity: 1 };

    await expect(service.create("mps-base-plans", common, actor)).rejects.toThrow("最迟评审交期不能为空");
    await expect(service.create("mps-base-plans", {
      ...common, latestReviewDueDate: "2026-09-20", productAttribute: "塑料", modelAge: "新", surfaceNature: "烤漆", manufacturingMethod: "自制"
    }, actor)).rejects.toThrow("产品属性只能选择：五金、木作、亚克力、五金+木作");
  });

  it("allows a base plan to save one weekly-admission field while the other three are blank", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const current = { id, version: 3, order_number: "SO-1", item_code: "ITEM-1", delivery_number: 1, latest_customer_due_date: "2026-10-01", planned_quantity: "10", latest_review_due_date: null, product_attribute: null, surface_nature: null, manufacturing_method: null };
    const updated = { ...current, version: 4, latest_review_due_date: "2026-09-20" };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith("SELECT * FROM mps_base_plans")) return [current];
      if (sql.startsWith("UPDATE mps_base_plans")) return [[updated], 1];
      return [];
    });
    const manager = { query }; const sync = { processOutbox: jest.fn().mockResolvedValue(undefined) };
    const service = new MasterPlanApplicationService({ transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query } as never, sync as never);
    await expect(service.update("mps-base-plans", id, { latestReviewDueDate: "2026-09-20", expectedVersion: 3 }, actor)).resolves.toEqual({ id, version: 4, values: { latestReviewDueDate: "2026-09-20" } });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("mps_reconciliation_outbox"))).toBe(true);
  });

  it.each([
    ["FAILED", "基础计划已保存，但周计划生成失败：未维护工序周期"],
    ["PENDING", "基础计划已保存，周计划正在生成，请稍后刷新查看。"],
    ["RUNNING", "基础计划已保存，周计划正在生成，请稍后刷新查看。"]
  ])("reports reconciliation state %s without rolling back the committed base-plan write", async (status, expected) => {
    const id = "22222222-2222-4222-8222-222222222222";
    const current = { id, version: 3, order_number: "SO-1", item_code: "ITEM-1", delivery_number: 1, latest_customer_due_date: "2026-10-01", planned_quantity: "10", latest_review_due_date: null };
    const updated = { ...current, version: 4, latest_review_due_date: "2026-09-20" };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith("SELECT * FROM mps_base_plans")) return [current];
      if (sql.startsWith("UPDATE mps_base_plans")) return [[updated], 1];
      if (sql.startsWith("SELECT status,last_error FROM mps_reconciliation_outbox")) return [{ status, last_error: status === "FAILED" ? "未维护工序周期" : null }];
      return [];
    });
    const manager = { query };
    const sync = { processOutbox: jest.fn().mockResolvedValue(1) };
    const service = new MasterPlanApplicationService({ transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query } as never, sync as never);

    await expect(service.update("mps-base-plans", id, { latestReviewDueDate: "2026-09-20", expectedVersion: 3 }, actor)).resolves.toEqual({
      id, version: 4, values: { latestReviewDueDate: "2026-09-20" },
      reconciliation: { status, message: expected }
    });
    expect(sync.processOutbox).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE mps_base_plans"))).toBe(true);
  });

  it("reports a completed reconciliation as success without inventing a warning", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const current = { id, version: 3, order_number: "SO-1", item_code: "ITEM-1", delivery_number: 1, latest_customer_due_date: "2026-10-01", planned_quantity: "10", latest_review_due_date: null };
    const updated = { ...current, version: 4, latest_review_due_date: "2026-09-20" };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith("SELECT * FROM mps_base_plans")) return [current];
      if (sql.startsWith("UPDATE mps_base_plans")) return [[updated], 1];
      if (sql.startsWith("SELECT status,last_error FROM mps_reconciliation_outbox")) return [{ status: "SUCCESS", last_error: null }];
      return [];
    });
    const manager = { query };
    const service = new MasterPlanApplicationService({ transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query } as never, { processOutbox: jest.fn().mockResolvedValue(1) } as never);

    await expect(service.update("mps-base-plans", id, { latestReviewDueDate: "2026-09-20", expectedVersion: 3 }, actor)).resolves.toEqual({
      id, version: 4, values: { latestReviewDueDate: "2026-09-20" }, reconciliation: { status: "SUCCESS", message: null }
    });
  });

  it("keeps a committed base-plan write successful when the reconciliation pass itself throws", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const current = { id, version: 3, order_number: "SO-1", item_code: "ITEM-1", delivery_number: 1, latest_customer_due_date: "2026-10-01", planned_quantity: "10", latest_review_due_date: null };
    const updated = { ...current, version: 4, latest_review_due_date: "2026-09-20" };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith("SELECT * FROM mps_base_plans")) return [current];
      if (sql.startsWith("UPDATE mps_base_plans")) return [[updated], 1];
      return [];
    });
    const manager = { query };
    const sync = { processOutbox: jest.fn().mockRejectedValue(new Error("连接中断")) };
    const service = new MasterPlanApplicationService({ transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query } as never, sync as never);

    await expect(service.update("mps-base-plans", id, { latestReviewDueDate: "2026-09-20", expectedVersion: 3 }, actor)).resolves.toEqual({
      id, version: 4, values: { latestReviewDueDate: "2026-09-20" }
    });
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
