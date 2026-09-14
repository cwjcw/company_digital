import { BadRequestException } from "@nestjs/common";
import { PlanningOrganizationDirectoryService, type PlanningOrganizationOption } from "./planning-organization-directory.service";

describe("PlanningOrganizationDirectoryService resolve", () => {
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const options: PlanningOrganizationOption[] = [
    { id: firstId, name: "事业一部", path: ["凯南", "制造中心", "事业一部"], pathLabel: "凯南 / 制造中心 / 事业一部" },
    { id: secondId, name: "事业二部", path: ["凯南", "制造中心", "事业二部"], pathLabel: "凯南 / 制造中心 / 事业二部" }
  ];
  const service = new PlanningOrganizationDirectoryService({} as never);

  it("resolves a unique organization name and a stable UUID", () => {
    expect(service.resolve("事业一部", options)?.id).toBe(firstId);
    expect(service.resolve(secondId, options)?.id).toBe(secondId);
  });

  it("rejects an organization outside the enabled directory", () => {
    expect(() => service.resolve("不存在事业部", options)).toThrow(new BadRequestException("事业部“不存在事业部”不在企业微信组织架构中"));
  });

  it("rejects duplicate short names and returns full-path candidates", () => {
    const duplicate = { id: "33333333-3333-4333-8333-333333333333", name: "事业一部", path: ["凯南", "另一中心", "事业一部"], pathLabel: "凯南 / 另一中心 / 事业一部" };
    try {
      service.resolve("事业一部", [...options, duplicate]);
      throw new Error("expected duplicate organization to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(expect.objectContaining({
        message: expect.stringContaining("请使用完整组织路径"),
        candidates: [options[0]!.pathLabel, duplicate.pathLabel]
      }));
    }
  });
});
