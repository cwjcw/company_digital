import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { FieldCandidateService } from "./field-candidate.service";
import { TableFilterController } from "./table-filter.controller";
import { TableFilterRegistry } from "./table-filter.registry";

const fields: TablePermissionFieldDefinition[] = [
  { key: "division", label: "事业部", type: "text", editable: false },
  { key: "department", label: "部门", type: "text", editable: false },
  { key: "customer", label: "客户", type: "text", editable: false }
];
const runQuery = jest.fn(async (sql: string) => sql.includes("DISTINCT") ? [{ value: "二部" }] : [{ count: 1 }]);
const registry = new TableFilterRegistry();
registry.register({ code: "test-table", table: "test_records", fields,
  columns: { division: "division", department: "department", customer: "customer" },
  buildScope: () => "record.active=true", runQuery });
const controller = new TableFilterController(new FieldCandidateService({} as never), registry, {} as never, {} as never);
const request = (permissions: string[]) => ({ user: { sub: "u1", permissions, isSystemAdmin: permissions.includes("*") } }) as never;

describe("平台 candidate 联动与排序权限", () => {
  beforeEach(() => runQuery.mockClear());
  const advanced = { logic: "OR", rules: [{ field: "customer", operator: "eq", value: "甲" }, { field: "customer", operator: "eq", value: "乙" }] };
  const header = { logic: "AND", rules: [], groups: [{ logic: "OR", rules: [{ field: "division", operator: "in", values: ["二部"] }] }] };

  it("其他字段候选继承 tenant/scope/quick search/advanced/header", async () => {
    const result = await controller.candidateOptions({ resource: "test-table", field: "department", tableSearch: "设备", advancedFilterGroup: JSON.stringify(advanced), headerFilterGroup: JSON.stringify(header), withMeta: "1" }, request(["*"]));
    expect(result).toEqual({ options: [{ value: "二部", label: "二部" }], hasMore: false });
    const [sql, params] = runQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("record.tenant_id=$1");
    expect(sql).toContain("record.active=true");
    expect(sql).toContain("record.division");
    expect(sql).toContain("record.customer");
    expect(sql).toContain("ILIKE");
    expect(params).toContain("%设备%");
  });

  it("打开当前字段候选时移除自身 header 条件，保留 advanced", async () => {
    await controller.candidateOptions({ resource: "test-table", field: "division", advancedFilterGroup: JSON.stringify(advanced), headerFilterGroup: JSON.stringify(header), withMeta: "1" }, request(["*"]));
    const sql = String(runQuery.mock.calls[0]?.[0] ?? "");
    expect(sql).not.toContain("record.division =ANY");
    expect(sql).toContain("record.customer");
  });

  it("无读权限的候选与排序拒绝，未知排序字段400", async () => {
    const limited = request(["test-table:*:read", "test-table:division:read"]);
    await expect(controller.candidateOptions({ resource: "test-table", field: "department" }, limited)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.rows({ resource: "test-table", sortField: "department" }, limited)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.rows({ resource: "test-table", sortField: "ghost" }, request(["*"]))).rejects.toBeInstanceOf(BadRequestException);
  });

  it("候选快速搜索可复用展示列，但仅在对应字段可读时参与", async () => {
    registry.register({ code: "search-table", table: "test_records", fields,
      columns: { division: "division", department: "department", customer: "customer" },
      searchColumns: ["customer"], searchAliases: [{ expression: "record.division_name_snapshot", permissionField: "division" }],
      buildScope: () => "record.active=true", runQuery });
    await controller.candidateOptions({ resource: "search-table", field: "department", tableSearch: "二部" },
      request(["search-table:*:read", "search-table:department:read", "search-table:customer:read"]));
    expect(String(runQuery.mock.calls[0]?.[0])).not.toContain("division_name_snapshot");
    runQuery.mockClear();
    await controller.candidateOptions({ resource: "search-table", field: "department", tableSearch: "二部" },
      request(["search-table:*:read", "search-table:department:read", "search-table:customer:read", "search-table:division:read"]));
    expect(String(runQuery.mock.calls[0]?.[0])).toContain("division_name_snapshot");
  });

  it("listRows资源的candidates仍返回字段候选，rows继续返回分页报表结果", async () => {
    const listRows = jest.fn(async () => ({ rows: [{ divisionId: "report-page-value" }], total: 1 }));
    registry.register({ code: "report-table", table: "test_records",
      fields: [{ key: "divisionId", label: "承接事业部", type: "department", editable: false }],
      columns: { divisionId: "division_id" }, buildScope: () => "record.active=true", runQuery,
      departmentCandidates: async (term) => term === "事业一部" ? [{ value: "division-1", label: "事业一部" }] : [{ value: "division-1", label: "事业一部" }],
      listRows });
    runQuery.mockImplementation(async (sql: string) => sql.includes("DISTINCT") ? [{ value: "division-1" }] : [{ count: 1 }]);

    const options = await controller.candidateOptions({ resource: "report-table", field: "divisionId", search: "事业一部" }, request(["*"]));
    expect(options).toEqual([{ value: "division-1", label: "事业一部" }]);
    expect(listRows).not.toHaveBeenCalled();

    const meta = await controller.candidateOptions({ resource: "report-table", field: "divisionId", withMeta: "1" }, request(["*"]));
    expect(meta).toEqual({ options: [{ value: "division-1", label: "事业一部" }], hasMore: false });
    const page = await controller.rows({ resource: "report-table", page: "2", pageSize: "50" }, request(["*"]));
    expect(page).toEqual({ rows: [{ divisionId: "report-page-value" }], total: 1, page: 2, pageSize: 50 });
    expect(listRows).toHaveBeenCalledTimes(1);
  });

  it("派生listRows资源通过类型化候选扩展返回withMeta，不调用分页报表", async () => {
    const listRows = jest.fn();
    const candidateValues = jest.fn(async () => ({ options: [{ value: "C001", label: "客户一" }], hasMore: false }));
    registry.register({ code: "derived-report", table: "derived_reporting", fields: [
      { key: "customerCode", label: "客户", type: "text", editable: false }
    ], columns: { customerCode: "customer_code" }, buildScope: () => "1=1", listRows, candidateValues });
    const result = await controller.candidateOptions({ resource: "derived-report", field: "customerCode", search: "客户", withMeta: "1" }, request(["*"]));
    expect(result).toEqual({ options: [{ value: "C001", label: "客户一" }], hasMore: false });
    expect(candidateValues).toHaveBeenCalledWith(expect.objectContaining({ fieldKey: "customerCode", search: "客户", limit: 50 }));
    expect(listRows).not.toHaveBeenCalled();
  });
});
