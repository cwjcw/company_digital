import { BadRequestException } from "@nestjs/common";
import { presetPermissionGroupTypes, presetTablePermissionMatrix, tablePermissionActions } from "@kdos/contracts";
import { AuditLog, Permission, PermissionGroupSubject, Role } from "../../entities";
import { TablePermissionGroupApplicationService } from "./table-permission-group.application.service";

describe("TablePermissionGroupApplicationService", () => {
  const service = new TablePermissionGroupApplicationService({} as never) as any;

  it("uses the immutable server preset matrix", () => {
    for (const groupType of presetPermissionGroupTypes) {
      expect(service.actions({ groupType })).toEqual(tablePermissionActions.filter((action) => presetTablePermissionMatrix[groupType][action]));
    }
  });

  it("requires read whenever custom permissions manage existing rows", () => {
    expect(() => service.actions({ groupType: "CUSTOM", actions: ["update"] })).toThrow(BadRequestException);
  });

  it("never permits audit fields to become editable", () => {
    expect(() => service.fields("mps-process-reports", { groupType: "CUSTOM", fields: [{ fieldKey: "createdBy", visible: true, editable: true }] }, ["read", "update"]))
      .toThrow(BadRequestException);
  });

  it("creates a custom group using explicit entity targets throughout the transaction", async () => {
    const queryBuilder: any = {};
    queryBuilder.insert = jest.fn(() => queryBuilder);
    queryBuilder.into = jest.fn(() => queryBuilder);
    queryBuilder.values = jest.fn(() => queryBuilder);
    queryBuilder.orIgnore = jest.fn(() => queryBuilder);
    queryBuilder.execute = jest.fn().mockResolvedValue({ identifiers: [] });
    const save = jest.fn(async (target: unknown, value?: any) => {
      if (value === undefined) throw new Error("entity target required");
      if (target === Role && !value.id) return { id: "permission-role-1", version: 0, ...value };
      if (target === Permission && !value.roleId) throw new Error("permission roleId required");
      return value;
    });
    const manager = {
      count: jest.fn().mockResolvedValue(1),
      findOneBy: jest.fn().mockResolvedValue(null),
      save,
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: jest.fn(() => queryBuilder)
    };
    const dataSource = { transaction: jest.fn((work: (entityManager: typeof manager) => unknown) => work(manager)) };
    const application = new TablePermissionGroupApplicationService(dataSource as never);

    await application.create({
      resource: "mps-process-reports",
      groupType: "CUSTOM",
      displayName: "测试自定义权限",
      actions: ["read"],
      fields: [{ fieldKey: "createdBy", visible: true, editable: false }],
      subjects: [{ type: "USER", id: "user-1" }]
    }, { userId: "admin-1", name: "管理员", requestId: "request-1" });

    expect(save).toHaveBeenCalledWith(Role, expect.objectContaining({ id: "permission-role-1", version: 1 }));
    expect(save).toHaveBeenCalledWith(Permission, expect.objectContaining({ roleId: "permission-role-1", resource: "mps-process-reports", fieldKey: "*", read: true }));
    expect(save).toHaveBeenCalledWith(AuditLog, expect.objectContaining({ action: "table_permission_group.created_or_members_added" }));
    expect(queryBuilder.into).toHaveBeenCalledWith(PermissionGroupSubject);
    expect(save.mock.calls.every((call) => call.length === 2)).toBe(true);
  });
});
