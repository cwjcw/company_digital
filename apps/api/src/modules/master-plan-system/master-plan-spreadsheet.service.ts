import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import ExcelJS from "exceljs";
import { assertSpreadsheetNotEncrypted } from "../../spreadsheet-upload";
import { fieldsFor, MASTER_PLAN_RESOURCE_MAP } from "./master-plan.config";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

type ImportRow = { row: number; id: string; expectedVersion: number; values: Record<string, unknown> };

@Injectable()
export class MasterPlanSpreadsheetService {
  constructor(private readonly queries: MasterPlanQueryService, private readonly application: MasterPlanApplicationService) {}

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
    const fields = fieldsFor(resource).filter((field) => field.editable && hasMasterPlanFieldPermission(actor, code, field.key, "update"));
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
    if (!headers.has("记录ID") || !headers.has("版本")) throw new BadRequestException("缺少记录ID或版本列，请使用系统导出的文件");
    const editableFields = fieldsFor(resource).filter((field) => field.editable && hasMasterPlanFieldPermission(actor, code, field.key, "update"));
    const includedFields = editableFields.filter((field) => headers.has(field.label));
    if (!includedFields.length) throw new BadRequestException("文件中没有可导入的可编辑字段");
    if (sheet.rowCount > 50_001) throw new BadRequestException("单次最多导入50000行");
    const rows: ImportRow[] = []; const parseErrors: Array<{ row: number; reason: string }> = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const id = row.getCell(headers.get("记录ID")!).text.trim();
      if (!id && !includedFields.some((field) => row.getCell(headers.get(field.label)!).text.trim())) return;
      const values: Record<string, unknown> = {};
      for (const field of includedFields) {
        const cell = row.getCell(headers.get(field.label)!);
        if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) parseErrors.push({ row: number, reason: `${field.label}不能包含公式或错误值` });
        values[field.key] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text.trim();
      }
      rows.push({ row: number, id, expectedVersion: Number(row.getCell(headers.get("版本")!).value), values });
    });
    if (!rows.length) parseErrors.push({ row: 2, reason: "文件中没有可导入的数据" });
    const errors = [...parseErrors, ...await this.application.validateImportUpdates(code, rows, actor)];
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
    for (const row of rows) sheet.addRow({ id: row.id, version: row.version, ...Object.fromEntries(fields.map((field) => [field.key, row[field.key] ?? null])) });
    sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }]; sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
    const notes = workbook.addWorksheet("填写说明"); notes.getColumn(1).width = 120;
    notes.addRows([["记录ID和版本不可修改；系统按稳定记录ID更新，版本冲突时整批拒绝。"], ["仅可修改有字段编辑权限的业务字段；空白单元格表示清空该字段。"], ["上传后必须先预览校验，确认后整批事务提交；单次最多50000行。"], ["创建人、创建时间、更新人、更新时间不参与导入。"]]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
