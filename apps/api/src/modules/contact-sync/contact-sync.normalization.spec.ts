import { normalizeOrganizationDisplayName, normalizeOrganizationPath } from "./contact-sync.normalization";
import { ContactSyncApplicationService } from "./contact-sync.application.service";
import { AuditLog, Contact, OrganizationUnit, User } from "../../entities";

describe("enterprise WeChat organization display normalization", () => {
  it.each(["厦门凯南展示制品有限公司", "凯南展示制品有限公司"])("shortens the company root %s", (source) => {
    expect(normalizeOrganizationDisplayName(source)).toBe("凯南");
    expect(normalizeOrganizationPath([source, "事业四部", "生产部"])).toEqual(["凯南", "事业四部", "生产部"]);
  });

  it("does not change stable child department names", () => {
    expect(normalizeOrganizationPath(["凯南", "事业一部"])).toEqual(["凯南", "事业一部"]);
  });

  it("updates existing organization and member paths through one audited application command", async () => {
    const organization = { id: "organization-1", name: "厦门凯南展示制品有限公司" };
    const contact = { id: "contact-1", departmentPaths: [["厦门凯南展示制品有限公司", "事业四部"]] };
    const user = { id: "user-1", departmentPaths: [["厦门凯南展示制品有限公司", "事业四部"]] };
    const manager = {
      find: jest.fn((entity) => Promise.resolve(entity === OrganizationUnit ? [organization] : entity === Contact ? [contact] : [user])),
      save: jest.fn((_entity, value) => Promise.resolve(value))
    };
    const dataSource = { transaction: jest.fn((work) => work(manager)) } as any;
    const service = new ContactSyncApplicationService(dataSource, null as any, null as any, null as any, null as any, null as any, null as any);

    const result = await service.normalizeExistingOrganizationDisplayNames({ userId: null, name: "测试", requestId: "request-1", source: "api" });

    expect(result).toEqual({ organizationUpdates: 1, contactUpdates: 1, userUpdates: 1, displayName: "凯南" });
    expect(organization.name).toBe("凯南");
    expect(contact.departmentPaths).toEqual([["凯南", "事业四部"]]);
    expect(user.departmentPaths).toEqual([["凯南", "事业四部"]]);
    expect(manager.save).toHaveBeenCalledWith(OrganizationUnit, organization);
    expect(manager.save).toHaveBeenCalledWith(Contact, contact);
    expect(manager.save).toHaveBeenCalledWith(User, user);
    expect(manager.save).toHaveBeenCalledWith(AuditLog, expect.objectContaining({ action: "wecom.organization_display_names_normalized" }));
  });

  it("rejects an empty or structurally incomplete organization snapshot before sync", async () => {
    const organizations = { count: jest.fn().mockResolvedValue(1), find: jest.fn().mockResolvedValue([]) };
    const service = new ContactSyncApplicationService({} as any, null as any, null as any, organizations as any, null as any, null as any, null as any);
    await expect((service as any).normalize({ departments: [], contacts: [] })).rejects.toThrow("未包含组织架构");
    await expect((service as any).normalize({
      departments: [{ externalId: "child", name: "生产部", parentExternalId: "missing", path: ["凯南", "生产部"] }], contacts: []
    })).rejects.toThrow("缺少上级部门");
  });

  it("does not silently rebind a managed organization when its external ID changes at the same path", async () => {
    const organization = { id: "organization-1", name: "事业一部", wechatDepartmentId: "old-id", parentId: null, level: 1, sortOrder: 0 };
    const organizations = { count: jest.fn().mockResolvedValue(1), find: jest.fn().mockResolvedValue([organization]) };
    const users = { find: jest.fn().mockResolvedValue([]) };
    const contacts = { find: jest.fn().mockResolvedValue([]) };
    const manager = { save: jest.fn().mockResolvedValue({}) };
    const dataSource = { transaction: jest.fn((work: (manager: unknown) => unknown) => work(manager)) };
    const service = new ContactSyncApplicationService(dataSource as any, users as any, contacts as any, organizations as any, null as any, null as any, null as any);
    await expect(service.sync({
      capturedAt: new Date().toISOString(), sourceHash: "fixture", departments: [{ externalId: "new-id", name: "事业一部", parentExternalId: null, path: ["事业一部"], sortOrder: 0 }], contacts: []
    }, { userId: null, name: "测试", requestId: "request-2", source: "api" }, true)).rejects.toMatchObject({
      response: expect.objectContaining({ message: expect.stringContaining("部门ID变化") })
    });
  });
});
