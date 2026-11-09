import { TableExportController } from "./table-export.controller";

describe("标准导出控制器的已选范围合同", () => {
  it("POST只接受SELECTED并把稳定ID、上下文与可见列交给服务端重新校验", async () => {
    const workbook = Buffer.from("xlsx");
    const exports = {
      exportXlsx: jest.fn().mockResolvedValue(workbook),
      exportFilenameFor: jest.fn().mockReturnValue("demo.xlsx")
    };
    const controller = new TableExportController(exports as never);
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const request = { user: { sub: "trusted-user", displayName: "员工", username: "worker", permissions: ["demo:*:read", "demo:*:export"] } };
    const body = {
      rangeType: "SELECTED", selectedIds: ["row-1", "row-2"], context: { view: "main" },
      sortField: "orderNumber", sortOrder: "desc", columnKeys: ["orderNumber", "quantity"]
    };

    await controller.exportSelected("demo", body, request as never, response as never);

    expect(exports.exportXlsx).toHaveBeenCalledWith("demo", {
      rangeType: "SELECTED", selectedIds: ["row-1", "row-2"], context: { view: "main" },
      sortField: "orderNumber", sortOrder: "desc", columnKeys: ["orderNumber", "quantity"]
    }, expect.objectContaining({ userId: "trusted-user", permissions: ["demo:*:read", "demo:*:export"] }));
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.send).toHaveBeenCalledWith(workbook);
  });

  it("拒绝把筛选结果范围伪装成POST已选导出", async () => {
    const exports = { exportXlsx: jest.fn() };
    const controller = new TableExportController(exports as never);
    await expect(controller.exportSelected("demo", { rangeType: "FILTERED", selectedIds: ["row-1"] }, { user: {} } as never, {} as never))
      .rejects.toThrow("POST 导出只接受已选记录范围");
    expect(exports.exportXlsx).not.toHaveBeenCalled();
  });
});
