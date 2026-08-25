import { BadRequestException, ForbiddenException } from "@nestjs/common";
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
});
