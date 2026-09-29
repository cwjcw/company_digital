import { ForbiddenException } from "@nestjs/common";
import { RdHistoryScanService } from "./rd-history-scan.service";
import { canRd } from "./rd.types";

const ordinaryReader = {
  tenantId: "KAINAN", userId: "user-1", username: "研发人员", permissions: ["rd-material-duplicates:*:read"], moduleAdminCodes: [],
  isSystemAdmin: false, tableDataScopes: [], requestId: "request-1", source: "web" as const,
};

describe("研发中心全量计算权限", () => {
  it("普通用户即使直接请求 FULL 也返回 403", async () => {
    const dataSource = { query: jest.fn() };
    const service = new RdHistoryScanService(dataSource as never);

    await expect(service.start(ordinaryReader, "FULL")).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it("复用资源级 update 权限作为全量计算权限", () => {
    expect(canRd({ ...ordinaryReader, permissions: ["rd-material-duplicates:*:update"] }, "rd-material-duplicates", "update")).toBe(true);
    expect(canRd(ordinaryReader, "rd-material-duplicates", "update")).toBe(false);
  });
});
