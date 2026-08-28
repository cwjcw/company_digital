import ExcelJS from "exceljs";
import { HrDepartureCheckApplicationService } from "./hr-departure-check.application.service";

describe("HrDepartureCheckApplicationService", () => {
  it("compares account and name against the latest enabled directory state", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("人员");
    sheet.addRow(["账号", "姓名"]); sheet.addRow(["05504", "李婷"]); sheet.addRow(["09999", "已离职"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const users = { find: jest.fn().mockResolvedValue([
      { username: "05504", employeeNo: "05504", displayName: "李婷", enabled: true },
      { username: "09999", employeeNo: "09999", displayName: "已离职", enabled: false }
    ]) };
    const audits = { save: jest.fn().mockResolvedValue({}) };
    const service = new HrDepartureCheckApplicationService(users as never, audits as never);
    const result = await service.check({ originalname: "人员.xlsx", buffer } as Express.Multer.File, { userId: "user-1", username: "HR", permissions: ["hr-departure-check:*:import"], requestId: "request-1" });
    expect(result.rows).toEqual([{ account: "05504", name: "李婷", status: "入职" }, { account: "09999", name: "已离职", status: "离职" }]);
    expect(result.summary).toEqual({ total: 2, active: 1, departed: 1 });
    expect(audits.save).toHaveBeenCalledWith(expect.objectContaining({ action: "hr.departure_check.completed", afterJson: expect.objectContaining({ rows: 2, active: 1, departed: 1 }) }));
  });
});
