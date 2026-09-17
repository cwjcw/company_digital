import { describe, expect, it } from "vitest";
import {
  auditTableFieldMetadata, auditTableFilterCapabilities, auditTablePrintCapabilities,
  isTablePrintFieldSafe, isTablePrintFieldPrintable, tablePrintResourceCapabilities, isTableFieldFilterable, masterPlanResourceDefinitions,
  referenceLabelFieldsFor, tableFilterDynamicDateKeys, tableFilterDynamicDateOptions, tableFilterOperatorsFor,
  tableFilterResourceCapabilities, tableFilterUiOperatorsFor, tablePermissionFieldsFor, tableResourceRegistry
} from "./index";

describe("KN-FILTER-001 field metadata audit gate", () => {
  it("audits every formal resource and field without metadata errors", () => {
    const audit = auditTableFieldMetadata();
    expect(audit.errors).toEqual([]);
    expect(audit.resources).toBe(tableResourceRegistry.length);
    expect(audit.resources).toBeGreaterThanOrEqual(42);
    expect(audit.fields).toBeGreaterThanOrEqual(673);
  });

  it("separates date from datetime and types audit timestamps as datetime", () => {
    for (const resource of ["mps-process-reports", "mps-base-plans", "equipment-status-report", "mps-sync-logs"]) {
      const fields = tablePermissionFieldsFor(resource as never);
      expect(fields.find((field) => field.key === "createdAt")?.type).toBe("datetime");
      expect(fields.find((field) => field.key === "updatedAt")?.type).toBe("datetime");
    }
    expect(tablePermissionFieldsFor("mps-sync-logs" as never).find((field) => field.key === "startedAt")?.type).toBe("datetime");
    expect(tablePermissionFieldsFor("mps-process-reports" as never).find((field) => field.key === "productionDate")?.type).toBe("date");
  });

  it("declares references with their candidate source and never as plain text", () => {
    const expectations: Array<[string, string, string]> = [
      ["mps-process-reports", "weeklyPlanId", "mps-weekly-plans"],
      ["mps-material-reports", "weeklyPlanId", "mps-weekly-plans"],
      ["mps-weekly-process-plans", "weeklyPlanId", "mps-weekly-plans"],
      ["equipment-status-report", "equipmentId", "equipment-register"],
      ["mps-outsourcing-reports", "supplierId", "supplier-list"]
    ];
    for (const [resource, key, target] of expectations) {
      const field = tablePermissionFieldsFor(resource as never).find((candidate) => candidate.key === key)!;
      expect(field.type).toBe("reference");
      expect(field.filterBinding?.referenceResource).toBe(target);
    }
  });

  it("marks multi-value fields, number formats and structured policy explicitly", () => {
    expect(tablePermissionFieldsFor("equipment-register" as never).find((field) => field.key === "responsibleUserIds")?.multiple).toBe(true);
    expect(tablePermissionFieldsFor("equipment-register" as never).find((field) => field.key === "plannedStartupMinutes")?.format).toBe("durationMinutes");
    expect(tablePermissionFieldsFor("mps-group-plans" as never).find((field) => field.key === "completionRate")?.format).toBe("percentage");
    expect(tablePermissionFieldsFor("mps-group-plans" as never).find((field) => field.key === "orderAmount")?.format).toBe("currency");
    const structured = tablePermissionFieldsFor("mps-system-settings" as never).find((field) => field.key === "valueJson")!;
    expect(structured.type).toBe("structured");
    expect(structured.filterable).toBe(false);
    expect(isTableFieldFilterable(structured)).toBe(false);
  });

  it("derives operators from the field type and exposes a single dynamic-date keyword list", () => {
    const operators = (resource: string, key: string) => tableFilterOperatorsFor(tablePermissionFieldsFor(resource as never).find((field) => field.key === key)!).map((entry) => entry.operator);
    expect(operators("mps-process-reports", "orderNumber")).toEqual(expect.arrayContaining(["contains", "in", "is_empty"]));
    expect(operators("mps-process-reports", "productionQuantity")).toEqual(expect.arrayContaining(["gt", "between", "not_in"]));
    /* 日期与时间共用一套操作符：等于/不等于/大于/小于/大于等于/小于等于/选择范围/动态筛选/为空/不为空。 */
    expect(operators("mps-process-reports", "productionDate")).toEqual(["eq", "neq", "gt", "lt", "gte", "lte", "between", "dynamic", "is_empty", "is_not_empty"]);
    expect(tablePermissionFieldsFor("mps-sync-logs" as never).find((field) => field.key === "startedAt")?.type).toBe("datetime");
    expect(operators("mps-process-reports", "processCode")).toEqual(expect.arrayContaining(["eq", "in", "is_not_empty"]));
    expect(operators("mps-process-reports", "processCode")).not.toContain("contains");
    expect(tableFilterDynamicDateKeys).toEqual([
      "YESTERDAY", "TODAY", "TOMORROW", "NEXT_1_WEEK", "NEXT_2_WEEKS",
      "LAST_MONTH", "THIS_MONTH", "NEXT_MONTH", "LAST_YEAR", "THIS_YEAR", "NEXT_YEAR"
    ]);
    expect(tableFilterDynamicDateOptions.map((option) => option.label)).toEqual([
      "昨天", "今天", "明天", "未来1周", "未来2周", "上月", "本月", "下月", "去年", "今年", "明年"
    ]);
  });

  it("keeps the process dictionary field filterable so the UI can offer the canonical 10 processes", () => {
    /* 工序候选值由主计划平台从 @tracker/shared 的 canonical registry 注入（不在此重复维护名单）。 */
    const field = tablePermissionFieldsFor("mps-process-reports" as never).find((candidate) => candidate.key === "processCode")!;
    expect(field.type).toBe("dictionary");
    expect(isTableFieldFilterable(field)).toBe(true);
    expect(tableFilterOperatorsFor(field).map((entry) => entry.operator)).toContain("in");
  });
});

describe("active PMC resources", () => {

  describe("KN-FILTER-001 第四轮筛选能力与 UI 白名单", () => {
    it("每个正式 resource 都有确定筛选状态，且没有 UNKNOWN / 未处理", () => {
      const audit = auditTableFilterCapabilities();
      expect(audit.errors).toEqual([]);
      expect(audit.total).toBe(tableResourceRegistry.length);
      for (const resource of tableResourceRegistry) {
        const status = tableFilterResourceCapabilities[resource.code]?.status;
        expect(["REGISTERED_AND_FILTERABLE", "REGISTERED_NOT_FILTERABLE", "NOT_APPLICABLE", "BLOCKED"]).toContain(status);
      }
    });

    it("最终收口：BLOCKED = 0，UNKNOWN = 0，users 已注册，roles 为 NOT_APPLICABLE 且有产品理由", () => {
      const statuses = tableResourceRegistry.map((resource) => tableFilterResourceCapabilities[resource.code]?.status);
      expect(statuses).not.toContain("BLOCKED");
      expect(statuses.every((status) => status === "REGISTERED_AND_FILTERABLE" || status === "NOT_APPLICABLE")).toBe(true);
      expect(tableFilterResourceCapabilities.users!.status).toBe("REGISTERED_AND_FILTERABLE");
      expect(tableFilterResourceCapabilities.roles!.status).toBe("NOT_APPLICABLE");
      /* 理由必须说明“角色树配置模式 / 右侧是用户成员”，不能只写“暂不支持”。 */
      expect(tableFilterResourceCapabilities.roles!.reason).toMatch(/角色树/);
      expect(tableFilterResourceCapabilities.roles!.reason).toMatch(/用户成员|users/);
    });

    it("用户与角色是真实关系：roleIds 为多值关系字段，departmentPaths 不参与筛选", () => {
      const roleIds = tablePermissionFieldsFor("users").find((field) => field.key === "roleIds")!;
      expect(roleIds.multiple).toBe(true);
      expect(roleIds.filterBinding?.kind).toBe("relation");
      const departmentPaths = tablePermissionFieldsFor("users").find((field) => field.key === "departmentPaths")!;
      expect(departmentPaths.filterable).toBe(false);
      expect(isTableFieldFilterable(departmentPaths)).toBe(false);
    });

    it("KN-PRINT-001 打印能力覆盖全部正式 resource，且没有 UNKNOWN", () => {
      const audit = auditTablePrintCapabilities();
      expect(audit.errors).toEqual([]);
      expect(audit.total).toBe(tableResourceRegistry.length);
      expect(audit.printable + audit.notApplicable).toBe(tableResourceRegistry.length);
      for (const resource of tableResourceRegistry) {
        const capability = tablePrintResourceCapabilities[resource.code]!;
        expect(["PRINTABLE", "NOT_APPLICABLE"]).toContain(capability.status);
        if (capability.status === "NOT_APPLICABLE") expect(capability.reason!.length).toBeGreaterThan(10);
      }
      /* roles 是角色树配置视图，api-keys 是安全配置页：两者都不得打印。 */
      expect(tablePrintResourceCapabilities.roles!.status).toBe("NOT_APPLICABLE");
      expect(tablePrintResourceCapabilities["api-keys"]!.status).toBe("NOT_APPLICABLE");
    });

    it("KN-PRINT-001 敏感字段永不进入打印投影，审计字段默认不打印", () => {
      for (const key of ["passwordHash", "password_hash", "key_hash", "apiKeySecret", "accessToken", "refreshToken", "secret"]) {
        expect(isTablePrintFieldSafe(key), key).toBe(false);
      }
      expect(isTablePrintFieldSafe("displayName")).toBe(true);
      expect(isTablePrintFieldPrintable({ key: "createdAt", label: "创建时间", type: "datetime", editable: false })).toBe(false);
      expect(isTablePrintFieldPrintable({ key: "scopes", label: "权限范围", type: "structured", editable: true })).toBe(false);
      expect(isTablePrintFieldPrintable({ key: "orderNumber", label: "订单编号", type: "text", editable: true })).toBe(true);
      expect(isTablePrintFieldPrintable({ key: "remark", label: "备注", type: "text", editable: true, printable: true })).toBe(true);
    });

    it("BLOCKED / NOT_APPLICABLE 必须写明真实原因", () => {
      const items = Object.entries(tableFilterResourceCapabilities).filter(([, capability]) => capability.status !== "REGISTERED_AND_FILTERABLE");
      expect(items.length).toBeGreaterThan(0);
      for (const [code, capability] of items) {
        expect(capability.reason, `${code} 缺少原因`).toBeTruthy();
      }
    });

    it("关联字段必须有显式标签定义，不靠猜字段", () => {
      expect(referenceLabelFieldsFor("supplier-list", "code,name")).toEqual(["code", "name"]);
      expect(referenceLabelFieldsFor("equipment-register")).toContain("equipment_code");
      expect(referenceLabelFieldsFor("mps-weekly-plans").length).toBeGreaterThan(1);
      expect(referenceLabelFieldsFor("unknown-resource")).toEqual([]);
      expect(referenceLabelFieldsFor("unknown-resource", "name")).toEqual(["name"]);
    });

    it("正式 UI 不暴露未确认操作符（starts_with / count_* / 数值 in）", () => {
      const text = tablePermissionFieldsFor("sales-orders").find((field) => field.key === "orderNumber")!;
      const textOperators = tableFilterUiOperatorsFor(text).map((entry) => entry.operator);
      expect(textOperators).toContain("contains");
      expect(textOperators).not.toContain("starts_with");

      const number = tablePermissionFieldsFor("sales-orders").find((field) => field.key === "businessQuantity")!;
      const numberOperators = tableFilterUiOperatorsFor(number).map((entry) => entry.operator);
      expect(numberOperators).toEqual(["eq", "neq", "gte", "lte", "between", "is_empty", "is_not_empty"]);

      const multiple = tablePermissionFieldsFor("equipment-register").find((field) => field.key === "responsibleUserIds")!;
      const multipleOperators = tableFilterUiOperatorsFor(multiple).map((entry) => entry.operator);
      expect(multipleOperators).toContain("contains_any");
      expect(multipleOperators).not.toContain("count_gte");
    });

    it("数据结构化字段不进入正式筛选，日期时间共用一套操作符", () => {
      const structured = tablePermissionFieldsFor("api-keys").find((field) => field.key === "scopes")!;
      expect(structured.type).toBe("structured");
      expect(structured.filterable).toBe(false);
      expect(isTableFieldFilterable(structured)).toBe(false);

      const date = tablePermissionFieldsFor("sales-orders").find((field) => field.key === "orderDate")!;
      const datetime = tablePermissionFieldsFor("audit-logs").find((field) => field.key === "createdAt")!;
      expect(tableFilterUiOperatorsFor(date).map((entry) => entry.operator)).toEqual(tableFilterUiOperatorsFor(datetime).map((entry) => entry.operator));
      expect(tableFilterUiOperatorsFor(datetime).map((entry) => entry.operator)).toContain("dynamic");
    });

    it("数据中心 metadata 与真实业务列一致（订单/入库/出库）", () => {
      const orderFields = tablePermissionFieldsFor("sales-orders").map((field) => field.key);
      expect(orderFields).toEqual(expect.arrayContaining(["orderNumber", "itemNumber", "businessQuantity", "plannedDeliveryDate", "ownerDivision"]));
      const inboundFields = tablePermissionFieldsFor("finished-goods-inbound").map((field) => field.key);
      expect(inboundFields).toEqual(expect.arrayContaining(["documentNumber", "inventoryCode", "inboundDate", "receivedQuantity"]));
      const outboundFields = tablePermissionFieldsFor("finished-goods-outbound").map((field) => field.key);
      expect(outboundFields).toEqual(expect.arrayContaining(["documentNumber", "customerName", "itemNumber", "totalAmount"]));
      /* 审计日志的操作人是快照文本，不是成员关联。 */
      expect(tablePermissionFieldsFor("audit-logs").find((field) => field.key === "actorName")?.type).toBe("text");
    });
  });

  it("KN-MPS-EXEC-001：已下达周计划数量只属于月计划只读辅助字段，不进入周计划", () => {
    const monthlyKeys = tablePermissionFieldsFor("mps-monthly-plans").map((field) => field.key);
    const weeklyKeys = tablePermissionFieldsFor("mps-weekly-plans").map((field) => field.key);
    /* 月计划：10 个工序各有「已下达周计划数量」只读辅助字段，且不是可编辑字段。 */
    const dispatched = tablePermissionFieldsFor("mps-monthly-plans").filter((field) => field.key.endsWith("DispatchedQuantity"));
    expect(dispatched).toHaveLength(10);
    for (const field of dispatched) {
      expect(field.editable).toBe(false);
      expect(field.format).toBe("decimal");
      expect(field.label).toMatch(/·已下达周计划数量$/);
    }
    /* 周计划没有该辅助字段。 */
    expect(weeklyKeys.some((key) => key.endsWith("DispatchedQuantity"))).toBe(false);
    /* 月/周计划都有 10 个只读 percentage 生产进度字段（唯一事实来源是 mps_process_reports 累计报工）。 */
    for (const keys of [monthlyKeys, weeklyKeys]) {
      expect(keys.filter((key) => key.endsWith("ProductionProgress"))).toHaveLength(10);
    }
    expect(monthlyKeys).toContain("requiredQuantity");
  });

  it("keeps the current master-plan resources and excludes retired planning UI resources", () => {
    const masterPlanCodes = masterPlanResourceDefinitions.map((resource) => resource.code);
    expect(masterPlanCodes).toContain("mps-erp-orders");
    expect(masterPlanCodes).toContain("mps-group-plans");
    expect(masterPlanCodes).toContain("mps-monthly-plans");
    expect(masterPlanCodes).toContain("mps-weekly-plans");

    const activeCodes = tableResourceRegistry.map((resource) => resource.code);
    expect(activeCodes).not.toEqual(expect.arrayContaining([
      "on-hand-summary-dashboard", "rolling-plan", "monthly-plan", "rolling-plan-table",
      "division-order-review", "weekly-plan", "work-report"
    ]));
  });
});
