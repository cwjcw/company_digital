import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AuditLog } from "../../entities";
import { AdminApplicationService } from "./admin-application.service";

describe("AdminApplicationService", () => {
  const setup = () => {
    const groups = { find: jest.fn(), findOneBy: jest.fn(), save: jest.fn(), delete: jest.fn() };
    const roles = { findOneBy: jest.fn(), countBy: jest.fn(), delete: jest.fn() };
    const users = { findOneBy: jest.fn() };
    const userRoles = {};
    const dataSource = { transaction: jest.fn() };
    return { service: new AdminApplicationService(dataSource as never, groups as never, roles as never, users as never, userRoles as never), groups, roles };
  };

  it("does not allow role groups to associate users", async () => {
    const { service } = setup();
    await expect(service.createRoleGroup({ name: "财务", userIds: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("protects built-in administrator roles from deletion", async () => {
    const { service, roles } = setup(); roles.findOneBy.mockResolvedValue({ id: "role-1", name: "系统管理员" });
    await expect(service.deleteRole("role-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(roles.delete).not.toHaveBeenCalled();
  });

  it("writes role changes with the lowercase legacy audit source", async () => {
    const { service, manager } = (() => {
      const groups = { find: jest.fn(), findOneBy: jest.fn(), save: jest.fn(), delete: jest.fn() };
      const roles = { findOneBy: jest.fn(), countBy: jest.fn(), delete: jest.fn() };
      const manager = {
        findOneBy: jest.fn().mockResolvedValue({ id: "role-1", name: "计划员", description: null, roleGroupId: "group-1" }),
        find: jest.fn().mockResolvedValue([]), save: jest.fn(async (...values) => values.at(-1)), delete: jest.fn()
      };
      const dataSource = { transaction: jest.fn(async (callback) => callback(manager)) };
      return { service: new AdminApplicationService(dataSource as never, groups as never, roles as never, {} as never, {} as never), manager };
    })();
    await service.updateRole("role-1", { name: "计划员2" }, { userId: null, name: "测试管理员", requestId: "request-1" });
    expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ id: "role-1", name: "计划员2" }));
    expect(manager.save).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
      action: "permission_group.updated", source: "web", requestId: "request-1"
    }));
  });
});
