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
});
