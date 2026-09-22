import { ForbiddenException } from "@nestjs/common";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { FieldCandidateService, type CandidateContext } from "./field-candidate.service";

const fields: TablePermissionFieldDefinition[] = [
  { key: "division", label: "事业部", type: "dictionary", editable: false, options: [{ value: "d1", label: "一部" }, { value: "d2", label: "二部" }] },
  { key: "department", label: "部门", type: "department", editable: false }
];
const calls: Array<{ sql: string; params: unknown[] }> = [];
const context: CandidateContext = {
  fields, expressions: { division: "record.division_id", department: "record.department_id" }, canReadField: () => true,
  scopedSource: "equipment_status_reports record",
  scopedWhere: "record.tenant_id=$1 AND record.division_id=$2 AND record.customer ILIKE $3",
  scopedParams: ["KAINAN", "d2", "%甲%"],
  executor: async (sql, params) => { calls.push({ sql, params }); return [{ value: "d2" }]; },
  departmentCandidates: async () => [{ value: "dept-2", label: "二部/下料" }]
};

describe("candidate 使用授权全集与上下文", () => {
  beforeEach(() => { calls.length = 0; });
  const service = new FieldCandidateService({} as never);

  it("静态字典仍先与租户/范围/搜索后的真实数据 DISTINCT 相交", async () => {
    const result = await service.resolveWithMeta("division", "二部", 200, context);
    expect(result).toEqual({ options: [{ value: "d2", label: "二部" }], hasMore: false });
    expect(calls[0]?.sql).toContain("record.tenant_id=$1 AND record.division_id=$2 AND record.customer ILIKE $3");
    expect(calls[0]?.params).toEqual(["KAINAN", "d2", "%甲%", ["d2"], 201]);
  });

  it("候选超过限制时显式告知 hasMore，不把前200条称为全集", async () => {
    const many = { ...context, executor: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params }); return Array.from({ length: 201 }, (_, index) => ({ value: `v${index}` }));
    } };
    const result = await service.resolveWithMeta("division", "", 200, many);
    expect(result.options).toHaveLength(200);
    expect(result.hasMore).toBe(true);
  });

  it("无字段读权限直接拒绝，不能通过候选值推断", async () => {
    await expect(service.resolveWithMeta("division", "", 200, { ...context, canReadField: () => false })).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toHaveLength(0);
  });
});
