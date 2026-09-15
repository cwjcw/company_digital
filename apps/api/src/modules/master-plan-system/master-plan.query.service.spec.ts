import { ForbiddenException } from "@nestjs/common";
import { MasterPlanQueryService } from "./master-plan.query.service";
import type { MasterPlanActor } from "./master-plan.types";

const actor = (permissions: string[]): MasterPlanActor => ({
  tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester",
  permissions, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-1", source: "web"
});

describe("MasterPlanQueryService metadata", () => {
  const directory = { listEnabled: jest.fn().mockResolvedValue([{ id: "org-1", name: "事业一部", pathLabel: "凯南 / 事业一部" }]) };
  const service = new MasterPlanQueryService({} as never, directory as never);

  it("never exposes direct weekly-plan creation even when a create claim exists", () => {
    const allowed = service.metadata("mps-weekly-plans", actor(["mps-weekly-plans:*:read", "mps-weekly-plans:*:create", "mps-weekly-plans:orderNumber:read"]));
    expect(allowed.actions.create).toBe(false);
    expect(allowed.createFields).toEqual([]);

    const denied = service.metadata("mps-weekly-plans", actor(["mps-weekly-plans:*:read", "mps-weekly-plans:orderNumber:read"]));
    expect(denied.actions.create).toBe(false);
    expect(denied.createFields).toEqual([]);
  });

  it("uses deterministic aggregates so duplicate historical children cannot crash weekly list", async () => {
    const query = jest.fn(async (sql: string) => sql.includes("count(*)::integer count") ? [{ count: 1 }] : [{ id: "weekly-1", version: 1 }]);
    const weeklyActor = { ...actor(["*"]), isSystemAdmin: true };
    const result = await new MasterPlanQueryService({ query } as never, directory as never).list("mps-weekly-plans", {}, weeklyActor);
    const dataSql = query.mock.calls.map(([sql]) => sql).find((sql) => sql.startsWith("SELECT record.id")) ?? "";
    expect(result.total).toBe(1);
    expect(dataSql).toContain("string_agg(DISTINCT report.exception_text");
    expect(dataSql).toContain("bool_or(report.status='延期')");
    expect(dataSql).toContain("bool_or(report.received OR report.actual_inbound_date IS NOT NULL)");
    expect(dataSql).not.toContain("(SELECT status FROM mps_technical_reports");
  });

  it("still requires read permission to open a table", () => {
    expect(() => service.metadata("mps-weekly-plans", actor(["mps-weekly-plans:*:create"]))).toThrow(ForbiddenException);
  });

  it("authorizes organization references against the actual resource and department field", async () => {
    await expect(service.organizationOptions("mps-shipping-plans", actor(["mps-shipping-plans:*:read", "mps-shipping-plans:divisionId:read"]))).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "org-1" })]));
    await expect(service.organizationOptions("mps-shipping-plans", actor(["mps-monthly-plans:*:read", "mps-monthly-plans:divisionId:read"]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.organizationOptions("mps-shipping-plans", actor(["mps-shipping-plans:*:read"]))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("MasterPlanQueryService report divisions", () => {
  const organization = { id: "22222222-2222-4222-8222-222222222222", name: "事业一部", pathLabel: "凯南 / 制造中心 / 事业一部" };

  it.each(["mps-technical-reports", "mps-material-reports", "mps-outsourcing-reports", "mps-process-reports"])("applies division field permission, path filter, data scope and export to %s", async (resource) => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 1 }] : [{ id: "row-1", version: 1, divisionId: organization.id, canUpdate: false }]);
    const service = new MasterPlanQueryService({ query } as never, { listEnabled: jest.fn().mockResolvedValue([organization]) } as never);
    const scopedActor: MasterPlanActor = {
      ...actor([`${resource}:*:read`, `${resource}:*:export`, `${resource}:divisionId:read`]),
      tableDataScopes: [{ resource, scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: organization.id }] }]
    };

    expect(service.metadata(resource, scopedActor).fields).toEqual(expect.arrayContaining([expect.objectContaining({ key: "divisionId", editable: false })]));
    const result = await service.exportRows(resource, { filters: JSON.stringify({ divisionId: organization.pathLabel }) }, scopedActor);

    expect(result.rows).toEqual([expect.objectContaining({ divisionId: organization.id, divisionName: organization.pathLabel })]);
    expect(query.mock.calls.every(([, params]) => JSON.stringify(params).includes(organization.id))).toBe(true);
    expect(query.mock.calls.map(([sql]) => sql).join(" ")).toContain("division_id");
  });

  it("builds pending process rows from eligible tasks without inserting fake process reports", async () => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 0 }] : []);
    const resource = "mps-process-reports";
    const service = new MasterPlanQueryService({ query } as never, { listEnabled: jest.fn().mockResolvedValue([]) } as never);
    const result = await service.list(resource, { view: "PENDING" }, actor([`${resource}:*:read`, `${resource}:divisionId:read`]));
    const sql = query.mock.calls.map(([statement]) => String(statement)).join(" ");
    expect(result.rows).toEqual([]);
    expect(sql).toContain("FROM mps_weekly_process_plans task");
    expect(sql).not.toContain("INSERT INTO mps_process_reports");
  });
});
