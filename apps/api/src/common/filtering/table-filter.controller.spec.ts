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
});
