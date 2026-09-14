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

  it("shows creation only when the resource create permission is present", () => {
    const allowed = service.metadata("mps-weekly-plans", actor(["mps-weekly-plans:*:read", "mps-weekly-plans:*:create", "mps-weekly-plans:orderNumber:read"]));
    expect(allowed.actions.create).toBe(true);
    expect(allowed.createFields.map((field) => field.key)).toContain("orderNumber");

    const denied = service.metadata("mps-weekly-plans", actor(["mps-weekly-plans:*:read", "mps-weekly-plans:orderNumber:read"]));
    expect(denied.actions.create).toBe(false);
    expect(denied.createFields).toEqual([]);
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
