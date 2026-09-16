import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { FieldCandidateService } from "../../common/filtering/field-candidate.service";
import { MASTER_PLAN_RESOURCE_MAP, fieldsFor } from "./master-plan.config";
import { MasterPlanQueryService } from "./master-plan.query.service";
import type { MasterPlanActor } from "./master-plan.types";

const actor: MasterPlanActor = {
  tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester",
  permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-1", source: "web"
};
const directory = { listEnabled: jest.fn().mockResolvedValue([{ id: "org-1", name: "事业一部", pathLabel: "凯南 / 制造中心 / 事业一部" }]) };

describe("KN-FILTER-001 field candidates", () => {
  const context = (query = jest.fn().mockResolvedValue([])) => ({
    service: new FieldCandidateService({ query } as never),
    context: {
      fields: fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-process-reports")!),
      expressions: { orderNumber: "order_number" },
      canReadField: () => true,
      scopedWhere: "SELECT record.* FROM mps_process_reports record WHERE record.tenant_id=$1 AND 1=1",
      scopedParams: ["KAINAN"],
      departmentCandidates: async (term: string, size: number) => [{ value: "org-1", label: "凯南 / 制造中心 / 事业一部" }].slice(0, size),
      memberCandidates: async () => [{ value: "user-1", label: "张工" }],
      referenceCandidates: async () => [{ value: "weekly-1", label: "2026A027192 / TGG919BDP-1/1" }]
    }
  });

  it("returns dictionary options from the canonical metadata instead of querying historical values", async () => {
    const { service, context: ctx } = context();
    const options = await service.resolve("processCode", "", 50, ctx);
    expect(options.map((option) => option.value)).toEqual(["cutting", "machining", "bending", "spotWelding", "welding", "woodworking", "grinding", "blank", "surfaceTreatment", "packaging"]);
    expect(options.find((option) => option.value === "blank")?.label).toBe("毛坯");
  });

  it("resolves department, member and reference candidates from their formal sources", async () => {
    const { service, context: ctx } = context();
    expect(await service.resolve("divisionId", "事业", 10, ctx)).toEqual([{ value: "org-1", label: "凯南 / 制造中心 / 事业一部" }]);
    expect(await service.resolve("weeklyPlanId", "", 10, ctx)).toEqual([{ value: "weekly-1", label: "2026A027192 / TGG919BDP-1/1" }]);
    const memberField = { key: "responsibleUserId", label: "责任人", type: "member" as const, editable: true };
    expect(await service.resolve("responsibleUserId", "", 10, { ...ctx, fields: [...ctx.fields, memberField] })).toEqual([{ value: "user-1", label: "张工" }]);
  });

  it("queries text candidates with tenant+scope and a server-side limit (never the whole DISTINCT set)", async () => {
    const query = jest.fn().mockResolvedValue([{ value: "2026A027192" }]);
    const { service, context: ctx } = context(query);
    const rows = await service.resolve("orderNumber", "2026A", 20, ctx);
    expect(rows).toEqual([{ value: "2026A027192", label: "2026A027192" }]);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("SELECT DISTINCT");
    expect(sql).toContain("LIMIT $");
    expect(sql).toContain("record.tenant_id=$1");
    expect(params).toEqual(["KAINAN", "%2026A%", 20]);
  });

  it("rejects fields without read permission and unsupported field kinds", async () => {
    const { service, context: ctx } = context();
    await expect(service.resolve("orderNumber", "", 10, { ...ctx, canReadField: () => false })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.resolve("unknownField", "", 10, ctx)).rejects.toThrow("不存在");
    const structured = { key: "valueJson", label: "参数值", type: "structured" as const, editable: true, filterable: false };
    await expect(service.resolve("valueJson", "", 10, { ...ctx, fields: [...ctx.fields, structured] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requires resource read permission on the master-plan candidate endpoint", async () => {
    const service = new MasterPlanQueryService({ query: jest.fn() } as never, directory as never);
    await expect(service.fieldCandidates("mps-process-reports", "processCode", "", 10, { ...actor, isSystemAdmin: false, permissions: [] })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
