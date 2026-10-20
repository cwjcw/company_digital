import ExcelJS from "exceljs";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";

const code = "mps-shipping-plans";
const id = "22222222-2222-4222-8222-222222222222";
const divisionId = "33333333-3333-4333-8333-333333333333";
const actor = { tenantId: "TEST", userId: "11111111-1111-4111-8111-111111111111", username: "tester", permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "shipping-optional", source: "web" as const };
const required = { customerCode: "TEST-C", orderNumber: "TEST-SO", itemCode: "TEST-I", latestCustomerDueDate: "2026-10-30", plannedQuantity: 0, divisionId };
const blank = { itemName: "", orderDate: "", modelAge: "" };
const record = { id, version: 2, customer_code: required.customerCode, order_number: required.orderNumber, item_code: required.itemCode, latest_customer_due_date: required.latestCustomerDueDate, planned_quantity: 0, division_id: divisionId, delivery_number: "001", item_name: "原有品项名称", order_date: "2026-10-01", model_age: "新" };
const clearedRecord = { ...record, item_name: null, order_date: null, model_age: null };

// Synthetic persistence only: exercise the real Application validation from preview through confirm.
function harness() {
  let payload: unknown;
  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<any[]> => {
    if (sql.startsWith("SELECT setting_key,value_json")) return [{ setting_key: "shipping_edit_weekday", value_json: "1,2,3,4,5,6,7" }];
    if (sql.includes("INSERT INTO mps_delivery_code_counters")) return [{ generated: "1" }];
    if (sql.startsWith("SELECT * FROM mps_shipping_plans")) return params[1] === id ? [record] : [];
    if (sql.startsWith("INSERT INTO mps_shipping_plans")) return [{ ...clearedRecord, version: 1 }];
    if (sql.startsWith("UPDATE mps_shipping_plans")) return [[{ ...clearedRecord, version: 3 }], 1];
    if (sql.startsWith("INSERT INTO mps_import_previews")) { payload = JSON.parse(String(params[4])); return [{ id }]; }
    if (sql.startsWith("SELECT * FROM mps_import_previews")) return [{ id, file_hash: "synthetic", payload_json: payload }];
    return [];
  });
  const manager = { query };
  const dataSource = { manager, query, transaction: (work: (value: typeof manager) => unknown) => work(manager) };
  const application = new MasterPlanApplicationService(dataSource as never, { processOutbox: jest.fn().mockResolvedValue(undefined) } as never);
  const directory = { listEnabled: jest.fn().mockResolvedValue([{ id: divisionId, pathLabel: "测试 / 事业部" }]), resolve: jest.fn((raw: string) => ({ id: raw === "测试 / 事业部" ? divisionId : raw })) };
  const spreadsheet = new MasterPlanSpreadsheetService(dataSource as never, {} as never, application, directory as never);
  return { query, application, spreadsheet };
}

async function fileFor(values: Record<string, unknown> = {}, edit?: (sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook) => void) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(code);
  const fields = [{ key: "id", label: "记录ID" }, { key: "version", label: "版本" }, ...tablePermissionFieldsFor(code).filter((field) => field.editable)];
  sheet.addRow(fields.map((field) => field.label));
  const schema = workbook.addWorksheet("_字段定义", { state: "veryHidden" });
  schema.addRow(["resource", code]); schema.addRow(["fieldKey", "column", "templateLabel"]);
  fields.forEach((field, index) => schema.addRow([field.key, index + 1, field.label]));
  const labels: Record<string, unknown> = { 记录ID: "", 版本: "", 客户编码: required.customerCode, 订单编号: required.orderNumber, 品项编码: required.itemCode, 最迟客户交期: required.latestCustomerDueDate, 计划数量: 0, 承接事业部: divisionId, 品项名称: "", 下单日期: "", 新旧款: "", ...values };
  sheet.getRow(1).eachCell((cell, column) => { sheet.getCell(2, column).value = labels[cell.text] as ExcelJS.CellValue; });
  edit?.(sheet, workbook);
  return { originalname: "synthetic-shipping.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } as Express.Multer.File;
}

function assertNullWrite(query: ReturnType<typeof harness>["query"], prefix: string) {
  const call = query.mock.calls.find(([sql]) => sql.startsWith(prefix))!;
  expect(call).toBeDefined();
  const [sql, params] = call;
  for (const column of ["item_name", "order_date", "model_age"]) {
    if (prefix.startsWith("UPDATE")) {
      const parameter = Number(new RegExp(`${column}=\\$(\\d+)`).exec(sql)![1]);
      expect(params![parameter - 1]).toBeNull();
    } else {
      const columns = /\(([^)]+)\) VALUES/.exec(sql)![1]!.split(",");
      const placeholders = /\) VALUES\(([^)]+)\)/.exec(sql)![1]!.split(",");
      const parameter = Number(/\$(\d+)/.exec(placeholders[columns.indexOf(column)]!)![1]);
      expect(params![parameter - 1]).toBeNull();
    }
  }
}

describe("shipping optional fields and Excel identity", () => {
  it.each(["", null, undefined])("creates with all three optional fields %s and no substitute name", async (value) => {
    const { application, query } = harness();
    const optional = value === undefined ? {} : { itemName: value, orderDate: value, modelAge: value };
    await expect(application.create(code, { ...required, ...optional }, actor)).resolves.toMatchObject({ item_name: null, order_date: null, model_age: null });
    if (value !== undefined) assertNullWrite(query, "INSERT INTO mps_shipping_plans");
  });

  it("clears all three optional fields by PATCH with optimistic version", async () => {
    const { application, query } = harness();
    await expect(application.update(code, id, { ...blank, expectedVersion: 2 }, actor)).resolves.toMatchObject({ version: 3, values: { itemName: null, orderDate: null, modelAge: null } });
    assertNullWrite(query, "UPDATE mps_shipping_plans");
  });

  it.each([false, true])("previews and confirms a row with all optional fields empty (update=%s)", async (updating) => {
    const { spreadsheet, query } = harness();
    const file = await fileFor(updating ? { 记录ID: id, 版本: 2 } : {});
    const preview = await spreadsheet.preview(code, file, actor);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]).toMatchObject({ id: updating ? id : null, expectedVersion: updating ? 2 : null, values: blank });
    await expect(spreadsheet.confirm(code, preview.previewId!, actor)).resolves.toMatchObject({ created: updating ? 0 : 1, updated: updating ? 1 : 0 });
    assertNullWrite(query, updating ? "UPDATE mps_shipping_plans" : "INSERT INTO mps_shipping_plans");
  });

  it.each([
    ["customerCode", "客户编码"], ["orderNumber", "订单编号"], ["itemCode", "品项编码"],
    ["latestCustomerDueDate", "最迟客户交期"], ["plannedQuantity", "计划数量"], ["divisionId", "承接事业部"]
  ])("still rejects missing %s on create, preview and confirm command", async (field, label) => {
    const { application, spreadsheet, query } = harness();
    const values = { ...required, ...blank, [field]: "" };
    await expect(application.create(code, values, actor)).rejects.toThrow(`${label}不能为空`);
    const preview = await spreadsheet.preview(code, await fileFor({ [label]: "" }), actor);
    expect(preview.previewId).toBeNull();
    expect(preview.errors).toContainEqual({ row: 2, reason: `${label}不能为空` });
    await expect(application.importUpdates(code, [{ id: null, expectedVersion: null, values }], "synthetic", actor)).rejects.toThrow(`${label}不能为空`);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO mps_shipping_plans"))).toBe(false);
  });

  it("uses physical headers after deleting optional columns, preserving omitted fields on updates", async () => {
    const { spreadsheet } = harness();
    const file = await fileFor({ 记录ID: id, 版本: 2 }, (sheet) => {
      for (const label of ["品项名称", "下单日期", "新旧款"]) {
        const column = (sheet.getRow(1).values as unknown[]).indexOf(label);
        sheet.spliceColumns(column, 1);
      }
    });
    const preview = await spreadsheet.preview(code, file, actor);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]).toMatchObject({ id, expectedVersion: 2, values: { plannedQuantity: "0", divisionId, latestCustomerDueDate: required.latestCustomerDueDate } });
    expect(preview.rows[0]!.values).not.toHaveProperty("itemName");
    expect(preview.rows[0]!.values).not.toHaveProperty("orderDate");
    expect(preview.rows[0]!.values).not.toHaveProperty("modelAge");
  });

  it.each([false, true])("uses actual ID/version columns despite stale hidden positions (update=%s)", async (updating) => {
    const { spreadsheet } = harness();
    const file = await fileFor(updating ? { 记录ID: id, 版本: 2 } : {}, (sheet, workbook) => {
      // Move the physical identity columns behind business data; keep stale _字段定义.
      const identities = [sheet.getCell(2, 1).value, sheet.getCell(2, 2).value];
      sheet.spliceColumns(1, 2);
      const last = sheet.columnCount;
      sheet.getCell(1, last + 1).value = "版本"; sheet.getCell(2, last + 1).value = identities[1]!;
      sheet.getCell(1, last + 2).value = "记录ID"; sheet.getCell(2, last + 2).value = identities[0]!;
      workbook.getWorksheet("_字段定义")!.getCell("B3").value = 999;
    });
    const preview = await spreadsheet.preview(code, file, actor);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]).toMatchObject({ id: updating ? id : null, expectedVersion: updating ? 2 : null, values: { customerCode: required.customerCode } });
  });

  it.each([["记录ID"], ["版本"], ["记录ID", "版本"]])("rejects deleted identity columns %s rather than guessing a create", async (...deleted) => {
    const { spreadsheet } = harness();
    const file = await fileFor({}, (sheet) => {
      for (const label of deleted) sheet.spliceColumns((sheet.getRow(1).values as unknown[]).indexOf(label), 1);
    });
    await expect(spreadsheet.preview(code, file, actor)).rejects.toThrow("缺少记录ID或版本列");
  });

  it.each([{ 记录ID: id, 版本: "" }, { 记录ID: "", 版本: 2 }])("rejects a partial identity pair even with hidden definitions: %o", async (identity) => {
    const { spreadsheet } = harness();
    const preview = await spreadsheet.preview(code, await fileFor(identity), actor);
    expect(preview.previewId).toBeNull();
    expect(preview.errors).toContainEqual({ row: 2, reason: "新增时记录ID和版本都应留空；更新时必须同时填写" });
  });

  it.each([
    ["not-an-id", 2, "记录ID格式无效"], [id, 0, "版本必须为正整数"],
    [id, 1, "记录版本已变化"], [divisionId, 2, "记录不存在或已超出当前租户"]
  ])("requires a real current ID/version (%s, %s)", async (recordId, version, reason) => {
    const { spreadsheet } = harness();
    const preview = await spreadsheet.preview(code, await fileFor({ 记录ID: recordId, 版本: version }), actor);
    expect(preview.previewId).toBeNull();
    expect(preview.errors[0]!.reason).toContain(reason);
  });
});
