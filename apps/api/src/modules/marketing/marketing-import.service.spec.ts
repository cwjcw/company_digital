import ExcelJS from "exceljs";
import type { MarketingApplicationService } from "./marketing.application.service";
import type { MarketingDirectoryQueryService } from "./marketing-directory-query.service";
import { MarketingImportService } from "./marketing-import.service";
import type { MarketingActor } from "./marketing.types";

const actor: MarketingActor = {
  userId: "00000000-0000-7000-8000-000000000002", username: "测试用户", tenantCode: "KAINAN",
  permissions: ["business-customer-mapping:*:import"], requestId: "request-1"
};

describe("MarketingImportService", () => {
  it("imports one row per customer and reports non-blocking directory and section anomalies", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("report");
    sheet.addRow(["部门", "业务", "课室", "客户代码"]);
    sheet.addRow(["业务一部", "张三/通讯录缺失", "一课", "A001"]);
    sheet.addRow(["业务二部", "李四", "二课", "A001"]);
    sheet.addRow(["业务一部", "张三", "一课", ""]);
    const buffer = await workbook.xlsx.writeBuffer();
    const application = { replaceMappings: jest.fn().mockResolvedValue({ imported: 1, repeated: false }) } as unknown as jest.Mocked<MarketingApplicationService>;
    const directory = { resolveEnabledUsersByNames: jest.fn().mockResolvedValue(new Map([
      ["张三", [{ id: "00000000-0000-7000-8000-000000000003", displayName: "张三", departmentPaths: [], enabled: true }]],
      ["李四", [{ id: "00000000-0000-7000-8000-000000000004", displayName: "李四", departmentPaths: [], enabled: true }]]
    ])) } as unknown as jest.Mocked<MarketingDirectoryQueryService>;
    const service = new MarketingImportService(application, directory);

    await service.importMappings({ buffer: Buffer.from(buffer), originalname: "业务接单周报.xlsx" } as Express.Multer.File, actor);

    expect(application.replaceMappings).toHaveBeenCalledWith(
      [expect.objectContaining({ department: "业务一部", section: "一课", customerCode: "A001", salespersonUserIds: expect.arrayContaining(["00000000-0000-7000-8000-000000000003", "00000000-0000-7000-8000-000000000004"]) })],
      "业务接单周报.xlsx", expect.any(String),
      expect.objectContaining({ ignoredBlankCustomerRows: 1, unmatchedSalespeople: ["通讯录缺失"], crossSectionCustomers: [{ customerCode: "A001", locations: ["业务一部 / 一课", "业务二部 / 二课"] }] }),
      actor
    );
  });
});
