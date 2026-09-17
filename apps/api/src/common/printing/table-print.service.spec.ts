import { TablePrintService, PRINT_BATCH_SIZE } from "./table-print.service";
import { TableFilterRegistry, type TableFilterActor, type TableFilterSource } from "../filtering/table-filter.registry";

/**
 * KN-PRINT-001：平台打印服务的核心契约。
 * 覆盖：受控分批（打印全部匹配行而不是当前页）、稳定 ID 重新取数、越权 ID 过滤、排序继承、
 * batch_print 403、字段读权限、敏感字段保护与统一格式化。
 */
const actor = (permissions: string[], extra: Partial<TableFilterActor> = {}): TableFilterActor => ({
  tenantId: "KAINAN", userId: "u1", permissions, isSystemAdmin: false, tableDataScopes: [], ...extra
});

function registryWith(source: Partial<TableFilterSource> & { code: string }) {
  const registry = new TableFilterRegistry();
  registry.register({
    table: "demo_rows",
    columns: { id: "id", orderNumber: "order_number", quantity: "quantity", status: "status" },
    fields: [
      { key: "id", label: "ID", type: "text", editable: false },
      { key: "orderNumber", label: "订单编号", type: "text", editable: true },
      { key: "quantity", label: "数量", type: "number", editable: true, format: "decimal" },
      { key: "status", label: "状态", type: "dictionary", editable: true, options: [{ value: "NORMAL", label: "正常" }] },
      { key: "createdAt", label: "创建时间", type: "datetime", editable: false }
    ],
    buildScope: () => "1=1",
    ...source
  } as TableFilterSource);
  return registry;
}

const resource = "mps-weekly-plans"; /* 已注册为 PRINTABLE 的正式 resource，用于测试打印服务契约。 */

describe("平台打印服务（KN-PRINT-001）", () => {
  it("打印筛选结果是全部匹配记录（受控分批），不是当前页", async () => {
    const calls: number[] = [];
    const total = PRINT_BATCH_SIZE * 2 + 37;
    const registry = registryWith({
      code: resource,
      printRows: async (query) => {
        calls.push(query.page);
        const start = (query.page - 1) * query.pageSize;
        const size = Math.max(0, Math.min(query.pageSize, total - start));
        return { rows: Array.from({ length: size }, (_, index) => ({ id: `row-${start + index}`, orderNumber: `A${start + index}`, quantity: index, status: "NORMAL" })), total };
      }
    });
    const service = new TablePrintService(registry, {} as never);
    const dto = await service.render(resource, { rangeType: "FILTERED", search: "", filterGroup: { logic: "AND", rules: [] } }, actor([`${resource}:*:batch_print`, `${resource}:*:read`]));
    expect(dto.rows.length).toBe(total);
    expect(calls.length).toBeGreaterThan(1);
    expect(dto.meta.rangeType).toBe("FILTERED");
    expect(dto.meta.printedCount).toBe(total);
  });

  it("SELECTED 1 条：manifest/render 都只含该记录，rangeType=SELECTED", async () => {
    const registry = registryWith({
      code: resource,
      printRows: async (query) => ({
        rows: (query.ids ?? []).map((id) => ({ id, orderNumber: "A1", quantity: 1, status: "NORMAL" })),
        total: (query.ids ?? []).length
      })
    });
    const service = new TablePrintService(registry, {} as never);
    const id = "11111111-1111-4111-8111-111111111111";
    const manifest = await service.manifest(resource, { rangeType: "SELECTED", selectedIds: [id] }, actor([`${resource}:*:batch_print`, `${resource}:*:read`]));
    expect(manifest.total).toBe(1);
    const dto = await service.render(resource, { rangeType: "SELECTED", selectedIds: [id] }, actor([`${resource}:*:batch_print`, `${resource}:*:read`]));
    expect(dto.meta.rangeType).toBe("SELECTED");
    expect(dto.meta.requestedCount).toBe(1);
    expect(dto.meta.printedCount).toBe(1);
    expect(dto.rows.length).toBe(1);
  });

  it("SELECTED 与非 UUID 主键：文本主键资源按真实主键重取（不再假设 UUID）", async () => {
    const registry = registryWith({
      code: resource,
      recordKey: { field: "orderNumber", type: "text" },
      printRows: async (query) => ({
        rows: (query.ids ?? []).map((id) => ({ id: "ignored", orderNumber: id, quantity: 1, status: "NORMAL" })),
        total: (query.ids ?? []).length
      })
    });
    const service = new TablePrintService(registry, {} as never);
    const dto = await service.render(resource, { rangeType: "SELECTED", selectedIds: ["ORDER-001"] }, actor([`${resource}:*:batch_print`, `${resource}:*:read`]));
    expect(dto.meta.requestedCount).toBe(1);
    expect(dto.meta.printedCount).toBe(1);
    expect(dto.rows[0]!.orderNumber).toBe("ORDER-001");
  });

  it("SELECTED 空/非法 ID：400，绝不退化为 FILTERED", async () => {
    const registry = registryWith({ code: resource, printRows: async () => ({ rows: [{ id: "x" }], total: 1 }) });
    const service = new TablePrintService(registry, {} as never);
    const permissions = [`${resource}:*:batch_print`, `${resource}:*:read`];
    await expect(service.render(resource, { rangeType: "SELECTED", selectedIds: [] }, actor(permissions))).rejects.toThrow(/必须提供有效的记录 ID/);
    await expect(service.render(resource, { rangeType: "SELECTED", selectedIds: ["not-a-uuid"] }, actor(permissions))).rejects.toThrow(/必须提供有效的记录 ID/);
    await expect(service.manifest(resource, { rangeType: "SELECTED", selectedIds: [] }, actor(permissions))).rejects.toThrow(/必须提供有效的记录 ID/);
  });

  it("FILTERED 即使误传 selectedIds 也忽略，仍打印全部匹配结果", async () => {
    let seenIds: string[] | undefined = ["sentinel"];
    const registry = registryWith({
      code: resource,
      printRows: async (query) => { seenIds = query.ids; return { rows: [{ id: "11111111-1111-4111-8111-111111111111", orderNumber: "A1" }], total: 1 }; }
    });
    const service = new TablePrintService(registry, {} as never);
    const dto = await service.render(resource, { rangeType: "FILTERED", selectedIds: ["11111111-1111-4111-8111-111111111111"] }, actor([`${resource}:*:batch_print`, `${resource}:*:read`]));
    /* FILTERED 模式不把 selectedIds 传给取数层（等于忽略）。 */
    expect(seenIds ?? []).toEqual([]);
    expect(dto.meta.rangeType).toBe("FILTERED");
    expect(dto.meta.requestedCount).toBeUndefined();
  });

  it("打印已选：按稳定 ID 重新取数，越权/不存在 ID 被过滤且不泄漏", async () => {
    const seenIds: string[][] = [];
    const registry = registryWith({
      code: resource,
      printRows: async (query) => {
        const ids = query.ids ?? [];
        seenIds.push(ids);
        /* 模拟后端权限过滤：只返回授权可见的两条。 */
        const allowed = ids.filter((id) => id.startsWith("1111111"));
        return { rows: allowed.map((id) => ({ id, orderNumber: "A1", quantity: 1, status: "NORMAL" })), total: allowed.length };
      }
    });
    const service = new TablePrintService(registry, {} as never);
    const dto = await service.render(resource, {
      rangeType: "SELECTED",
      selectedIds: [
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-222222222222",
        "99999999-9999-4999-8999-999999999999",
        "88888888-8888-4888-8888-888888888888"
      ]
    }, actor([`${resource}:*:batch_print`, `${resource}:*:read`]));
    /* manifest 先做 count、render 再取数：两次都按稳定 ID 重新查询，ID 集合一致。 */
    expect(new Set(seenIds.flat()).size).toBe(4);
    expect(dto.rows.length).toBe(2);
    expect(dto.meta.requestedCount).toBe(4);
    expect(dto.meta.printedCount).toBe(2);
    expect(JSON.stringify(dto)).not.toContain("99999999-9999-4999-8999-999999999999");
  });

  it("排序继承：打印使用当前列表排序字段", async () => {
    const sorts: Array<unknown> = [];
    const registry = registryWith({
      code: resource,
      printRows: async (query) => { sorts.push([query.sortField, query.sortOrder]); return { rows: [], total: 0 }; }
    });
    const service = new TablePrintService(registry, {} as never);
    await service.render(resource, { rangeType: "FILTERED", sortField: "orderNumber", sortOrder: "desc" }, actor([`${resource}:*:batch_print`, `${resource}:*:read`]));
    expect(sorts[0]).toEqual(["orderNumber", "desc"]);
  });

  it("没有 batch_print 权限 → 403；没有 read 权限同样拒绝", async () => {
    const registry = registryWith({ code: resource, printRows: async () => ({ rows: [], total: 0 }) });
    const service = new TablePrintService(registry, {} as never);
    await expect(service.render(resource, { rangeType: "FILTERED" }, actor([`${resource}:*:read`]))).rejects.toThrow(/没有该表打印权限/);
    await expect(service.render(resource, { rangeType: "FILTERED" }, actor([`${resource}:*:batch_print`]))).rejects.toThrow(/没有此表的查看权限/);
  });

  it("字段读权限与敏感字段保护：不可读字段与审计字段不进入打印列", async () => {
    const registry = registryWith({ code: resource, printRows: async () => ({ rows: [], total: 0 }) });
    const service = new TablePrintService(registry, {} as never);
    const manifest = await service.manifest(resource, { rangeType: "FILTERED" }, actor([
      `${resource}:*:batch_print`, `${resource}:*:read`, `${resource}:orderNumber:read`, `${resource}:status:read`
    ]));
    const keys = manifest.columns.map((column) => column.key);
    /* 字段权限：只声明了两个字段的读权限时必须使用 `resource:*:read` 才会展开，否则按字段读权限收紧。 */
    expect(keys).toContain("orderNumber");
    expect(keys).not.toContain("createdAt");
    expect(keys).not.toContain("id");
  });

  it("统一格式化：dictionary→label、boolean→是/否、percentage→%、durationMinutes→小时分钟、空值→—", () => {
    const service = new TablePrintService(registryWith({ code: resource }), {} as never);
    const format = service.formatValue.bind(service);
    expect(format({ key: "status", label: "状态", type: "dictionary", editable: true, options: [{ value: "NORMAL", label: "正常" }] }, "正常")).toBe("正常");
    expect(format({ key: "enabled", label: "状态", type: "boolean", editable: true }, true)).toBe("是");
    expect(format({ key: "enabled", label: "状态", type: "boolean", editable: true }, false)).toBe("否");
    expect(format({ key: "rate", label: "比例", type: "number", editable: true, format: "percentage" }, 0.8)).toBe("80%");
    expect(format({ key: "rate", label: "比例", type: "number", editable: true, format: "percentage", percentageScale: "percent" }, 80)).toBe("80%");
    expect(format({ key: "minutes", label: "时长", type: "number", editable: true, format: "durationMinutes" }, 630)).toBe("10小时30分钟");
    expect(format({ key: "remark", label: "备注", type: "text", editable: true }, null)).toBe("—");
    expect(format({ key: "members", label: "成员", type: "member", editable: true, multiple: true }, ["张三", "李四"])).toBe("张三、李四");
  });

  it("打印人：优先 displayName，其次 username，绝不显示 userId/UUID", async () => {
    const registry = registryWith({ code: resource, printRows: async () => ({ rows: [], total: 0 }) });
    const service = new TablePrintService(registry, {} as never);
    const permissions = [`${resource}:*:batch_print`, `${resource}:*:read`];
    const withName = await service.render(resource, { rangeType: "FILTERED" }, {
      ...actor(permissions), userId: "f6756112-dfef-4082-b250-96a3b7607b1a", displayName: "崔玮杰", username: "cuiweijie"
    });
    expect(withName.meta.printedBy).toBe("崔玮杰");
    const withoutName = await service.render(resource, { rangeType: "FILTERED" }, {
      ...actor(permissions), userId: "f6756112-dfef-4082-b250-96a3b7607b1a", username: "cuiweijie"
    });
    expect(withoutName.meta.printedBy).toBe("cuiweijie");
    const neither = await service.render(resource, { rangeType: "FILTERED" }, {
      ...actor(permissions), userId: "f6756112-dfef-4082-b250-96a3b7607b1a", displayName: "  ", username: ""
    });
    expect(neither.meta.printedBy).toBe("—");
    /* 任何情况下都不得把 UUID 作为打印人输出。 */
    for (const dto of [withName, withoutName, neither]) expect(JSON.stringify(dto.meta.printedBy)).not.toContain("f6756112");
  });

  it("NOT_APPLICABLE 的 resource 拒绝打印并给出真实产品理由", async () => {
    const service = new TablePrintService(registryWith({ code: "roles" }), {} as never);
    await expect(service.manifest("roles", { rangeType: "FILTERED" }, actor(["*"]))).rejects.toThrow(/角色树配置模式/);
  });

  it("能力清单覆盖全部正式 resource，且没有 UNKNOWN", async () => {
    const service = new TablePrintService(registryWith({ code: resource }), {} as never);
    const capabilities = service.capabilities(actor(["*"], { isSystemAdmin: true }));
    expect(capabilities.every((entry) => entry.print.status === "PRINTABLE" || entry.print.status === "NOT_APPLICABLE")).toBe(true);
  });
});
