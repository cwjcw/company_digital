import ExcelJS from "exceljs";
import { auditPermissionFields, tablePermissionFieldsFor, isTablePrintFieldPrintable } from "@kdos/contracts";
import { TablePrintService } from "./table-print.service";
import { TableFilterRegistry } from "../filtering/table-filter.registry";

const known = "04ada40c-21aa-496b-941c-8c4c969c477b";
const disabled = "0199e000-0000-7000-8000-000000000001";
const unknown = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const actors = [known, disabled, "system", unknown, "migration", "旧ERP制单人"];
const rows = actors.map((value, i) => ({ id: String(i), createdBy: value, updatedBy: value }));
const actor = { tenantId: "KAINAN", userId: known, permissions: ["*"], isSystemAdmin: true };

describe("合法审计列的print/export共用resolver", () => {
  it("当前正式资源仍默认排除审计列，不擅自增加输出字段", () => {
    expect(tablePermissionFieldsFor("mps-weekly-plans").filter(f => f.format === "auditActor").some(isTablePrintFieldPrintable)).toBe(false);
  });

  it.each(["print", "export"])("未来显式printable的审计列%s输出统一姓名，不查询enabled目录", async mode => {
    const fields = auditPermissionFields.filter(f => f.format === "auditActor");
    for (const field of fields) field.printable = true;
    try {
      const registry = new TableFilterRegistry();
      registry.register({ code: "mps-weekly-plans", table: "example", columns: { id: "id", createdBy: "created_by", updatedBy: "updated_by" },
        fields: tablePermissionFieldsFor("mps-weekly-plans"), buildScope: () => "1=1", printRows: async () => ({ rows, total: rows.length }) });
      const query = jest.fn(async () => [{ id: known, username: "08977", displayName: "王家威" }, { id: disabled, username: "__kdos_system__", displayName: "KDOS系统任务" }]);
      const service = new TablePrintService(registry, { query } as never);
      const expected = ["王家威", "KDOS系统任务", "系统", "未知用户", "migration", "旧ERP制单人"];
      if (mode === "print") {
        const result = await service.render("mps-weekly-plans", {}, actor);
        expect(result.rows.map(r => r.updatedBy)).toEqual(expected);
        expect(result.rows.map(r => r.createdBy)).toEqual(expected);
      } else {
        const book = new ExcelJS.Workbook(); await book.xlsx.load(await service.exportXlsx("mps-weekly-plans", {}, actor) as never);
        expect(Array.from({ length: rows.length }, (_, i) => book.worksheets[0]!.getCell(i + 2, 2).text)).toEqual(expected);
      }
      expect(query).toHaveBeenCalledTimes(1);
    } finally { for (const field of fields) delete field.printable; }
  });
});
