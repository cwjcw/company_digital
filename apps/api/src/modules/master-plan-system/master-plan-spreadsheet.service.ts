import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import ExcelJS from "exceljs";
import { assertSpreadsheetNotEncrypted } from "../../spreadsheet-upload";
import { fieldsFor, MASTER_PLAN_RESOURCE_MAP } from "./master-plan.config";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { PlanningOrganizationDirectoryService } from "../planning/planning-organization-directory.service";

type ImportRow = { row: number; id: string | null; expectedVersion: number | null; values: Record<string, unknown> };

@Injectable()
export class MasterPlanSpreadsheetService {
  constructor(private readonly queries: MasterPlanQueryService, private readonly application: MasterPlanApplicationService, private readonly directory: PlanningOrganizationDirectoryService) {}

  private resource(code: string) {
    const resource = MASTER_PLAN_RESOURCE_MAP.get(code as never);
    if (!resource) throw new BadRequestException("主计划表不存在");
    return resource;
  }

  private signature(value: string) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new BadRequestException("导入签名配置缺失，请联系管理员");
    return createHmac("sha256", secret).update(value).digest("hex");
  }

  async template(code: string, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new BadRequestException("当前权限组没有该表导入权限");
    const fields = this.importFields(resource, code, actor);
    return this.workbook(resource.code, fields, []);
  }

  async export(code: string, input: Record<string, unknown>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    const result = await this.queries.exportRows(code, input, actor);
    const fields = fieldsFor(resource).filter((field) => result.visibleFields.includes(field.key));
    return this.workbook(resource.code, fields, result.rows);
  }

  async preview(code: string, file: Express.Multer.File, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!file?.buffer?.length || !/\.xlsx$/i.test(file.originalname)) throw new BadRequestException("请选择 .xlsx Excel 文件");
    assertSpreadsheetNotEncrypted(file.buffer);
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(file.buffer as never); } catch { throw new BadRequestException("Excel 文件损坏或格式不正确，请使用导出的模板"); }
    const sheet = workbook.getWorksheet(resource.code) ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Excel 文件没有工作表");
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => { const label = cell.text.trim(); if (headers.has(label)) throw new BadRequestException(`表头重复：${label}`); headers.set(label, column); });
    const schema = workbook.getWorksheet("_字段定义");
    const columnsByKey = new Map<string, number>();
    if (schema) {
      if (schema.getCell("B1").text !== resource.code) throw new BadRequestException("Excel 字段定义与当前表不一致，请下载当前表模板");
      for (let index = 3; index <= schema.rowCount; index++) {
        const key = schema.getRow(index).getCell(1).text.trim(); const column = Number(schema.getRow(index).getCell(2).value);
        if (key && Number.isInteger(column) && column > 0) columnsByKey.set(key, column);
      }
    } else {
      if (!headers.has("记录ID") || !headers.has("版本")) throw new BadRequestException("缺少记录ID或版本列，请使用系统导出的文件");
      columnsByKey.set("id", headers.get("记录ID")!); columnsByKey.set("version", headers.get("版本")!);
    }
    if (!columnsByKey.has("id") || !columnsByKey.has("version")) throw new BadRequestException("缺少记录ID或版本字段定义，请使用系统导出的文件");
    const editableFields = this.importFields(resource, code, actor);
    const includedFields = editableFields.filter((field) => schema ? columnsByKey.has(field.key) : headers.has(field.label));
    if (!schema) for (const field of includedFields) columnsByKey.set(field.key, headers.get(field.label)!);
    if (!includedFields.length) throw new BadRequestException("文件中没有可导入的可编辑字段");
    if (sheet.rowCount > 50_001) throw new BadRequestException("单次最多导入50000行");
    const rows: ImportRow[] = []; const parseErrors: Array<{ row: number; reason: string }> = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const idText = row.getCell(columnsByKey.get("id")!).text.trim();
      const versionText = row.getCell(columnsByKey.get("version")!).text.trim();
      if (!idText && !versionText && !includedFields.some((field) => row.getCell(columnsByKey.get(field.key)!).text.trim())) return;
      if (Boolean(idText) !== Boolean(versionText)) parseErrors.push({ row: number, reason: "新增时记录ID和版本都应留空；更新时必须同时填写" });
      const values: Record<string, unknown> = {};
      for (const field of includedFields) {
        const cell = row.getCell(columnsByKey.get(field.key)!);
        if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) parseErrors.push({ row: number, reason: `${field.label}不能包含公式或错误值` });
        values[field.key] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text.trim();
      }
      rows.push({ row: number, id: idText || null, expectedVersion: versionText ? Number(versionText) : null, values });
    });
    if (!rows.length) parseErrors.push({ row: 2, reason: "文件中没有可导入的数据" });
    const departmentFields = includedFields.filter((field) => field.type === "department");
    if (departmentFields.length) {
      const options = await this.directory.listEnabled();
      for (const row of rows) for (const field of departmentFields) {
        const raw = row.values[field.key];
        if (raw == null || raw === "") continue;
        try { row.values[field.key] = this.directory.resolve(raw, options, `第${row.row}行${field.label}`)?.id ?? null; }
        catch (error) {
          const response = (error as { getResponse?: () => unknown }).getResponse?.();
          const reason = typeof response === "object" && response && "message" in response ? String((response as { message: unknown }).message) : (error as Error).message;
          parseErrors.push({ row: row.row, reason });
        }
      }
    }
    const errors = parseErrors.length ? parseErrors : await this.application.validateImportUpdates(code, rows, actor);
    if (errors.length) return { total: rows.length, errors, token: null, rows: [] };
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    const payload = Buffer.from(JSON.stringify({ tenant: actor.tenantId, user: actor.userId, resource: code, expires: Date.now() + 30 * 60 * 1000, hash, rows })).toString("base64url");
    return { total: rows.length, errors: [], token: `${payload}.${this.signature(payload)}`, rows: rows.slice(0, 20) };
  }

  async confirm(code: string, token: string, actor: MasterPlanActor) {
    const [payload, signature] = String(token ?? "").split("."); const expected = this.signature(payload ?? "");
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new BadRequestException("导入预览已失效，请重新上传");
    const data = JSON.parse(Buffer.from(payload!, "base64url").toString());
    if (data.tenant !== actor.tenantId || data.user !== actor.userId || data.resource !== code || data.expires < Date.now()) throw new BadRequestException("导入预览已过期或不属于当前用户，请重新上传");
    return this.application.importUpdates(code, data.rows, data.hash, actor);
  }

  private async workbook(label: string, fields: ReturnType<typeof fieldsFor>, rows: Array<Record<string, unknown>>) {
    const workbook = new ExcelJS.Workbook(); workbook.creator = "KDOS 主计划系统";
    const sheet = workbook.addWorksheet(label.slice(0, 31));
    sheet.columns = [{ header: "记录ID", key: "id", width: 38 }, { header: "版本", key: "version", width: 10 }, ...fields.map((field) => ({ header: field.label, key: field.key, width: 20 }))];
    const organizationPaths = new Map((await this.directory.listEnabled()).map((option) => [option.id, option.pathLabel]));
    for (const row of rows) sheet.addRow({ id: row.id, version: row.version, ...Object.fromEntries(fields.map((field) => [field.key, field.type === "department" && row[field.key] ? organizationPaths.get(String(row[field.key])) ?? row[field.key] : row[field.key] ?? null])) });
    sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }]; sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
    const schema = workbook.addWorksheet("_字段定义", { state: "veryHidden" });
    schema.addRow(["resource", label]); schema.addRow(["fieldKey", "column", "templateLabel"]);
    [{ key: "id", label: "记录ID" }, { key: "version", label: "版本" }, ...fields].forEach((field, index) => schema.addRow([field.key, index + 1, field.label]));
    const optionSheet = workbook.addWorksheet("_选项", { state: "veryHidden" }); let optionColumn = 1;
    for (const [fieldIndex, field] of fields.entries()) {
      let options = field.options ?? [];
      if (field.type === "boolean") options = [{ value: "是", label: "是" }, { value: "否", label: "否" }];
      if (field.type === "department") options = [...organizationPaths.entries()].map(([value, label]) => ({ value, label }));
      if (!options.length) continue;
      optionSheet.getCell(1, optionColumn).value = field.key;
      options.forEach((option, index) => { optionSheet.getCell(index + 2, optionColumn).value = option.label; });
      const letter = optionSheet.getCell(1, optionColumn).address.replace(/\d+/g, ""); const name = `mps_options_${optionColumn}_${fieldIndex}`;
      workbook.definedNames.add(`'_选项'!$${letter}$2:$${letter}$${options.length + 1}`, name);
      const targetLetter = sheet.getCell(1, fieldIndex + 3).address.replace(/\d+/g, "");
      (sheet as unknown as { dataValidations: { add: (range: string, rule: unknown) => void } }).dataValidations.add(`${targetLetter}2:${targetLetter}50001`, { type: "list", allowBlank: !field.required, formulae: [name], showErrorMessage: true, errorTitle: "选项无效", error: `请选择${field.label}下拉选项` });
      optionColumn++;
    }
    const notes = workbook.addWorksheet("填写说明"); notes.getColumn(1).width = 120;
    notes.addRows([
      ["记录ID：系统为每条记录自动生成的唯一标识。新增导入时留空，由系统生成；更新已导出记录时必须原样保留且不得修改。"],
      ["版本：系统自动维护的正整数，用于防止多人同时修改时覆盖新数据。新增导入时留空；更新导入时必须保留导出时的版本，版本已变化时整批拒绝并提示刷新后重试。"],
      ["新增规则：记录ID和版本必须同时留空；更新规则：记录ID和版本必须同时填写。只填写其中一个会校验失败。"],
      ["仅可修改有字段编辑权限的业务字段；空白单元格表示清空该字段。"],
      ["上传后必须先预览校验，确认后整批事务提交；单次最多50000行。"],
      ["创建人、创建时间、更新人、更新时间不参与导入。"]
    ]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private importFields(resource: ReturnType<MasterPlanSpreadsheetService["resource"]>, code: string, actor: MasterPlanActor) {
    const canCreate = resource.create && hasMasterPlanPermission(actor, code, "create");
    const canReadTable = hasMasterPlanPermission(actor, code, "read");
    return fieldsFor(resource).filter((field) => field.editable && (
      hasMasterPlanFieldPermission(actor, code, field.key, "update")
      || (canCreate && (hasMasterPlanFieldPermission(actor, code, field.key, "read") || !canReadTable))
    ));
  }
}
