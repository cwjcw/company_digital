import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import ExcelJS from "exceljs";
import { MarketingApplicationService } from "./marketing.application.service";
import type { MarketingActor, OrderScheduleInput } from "./marketing.types";

export const scheduleColumns = [
  ["客户代码", "customerCode"], ["订单编号", "orderNumber"], ["品项编码", "itemNumber"],
  ["品项名称", "itemName"], ["客户交期", "customerDueDate"], ["订单总数量", "orderTotalQuantity"],
  ["生产单位", "productionUnit"], ["订单完成比例", "completionRatio"], ["状态", "status"]
] as const;
@Injectable()
export class OrderScheduleImportService {
  constructor(private readonly application: MarketingApplicationService) {}
  private signature(value: string) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new BadRequestException("导入签名配置缺失，请联系管理员");
    return createHmac("sha256", secret).update(value).digest("hex");
  }
  async template(actor: MarketingActor) {
    this.application.assertScheduleImport(actor);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("订单排期");
    sheet.columns = scheduleColumns.map(([header, key]) => ({ header, key, width: 24, style: { numFmt: "@" } }));
    sheet.getRow(1).font = { bold: true };
    const notes = workbook.addWorksheet("填写说明");
    notes.addRows([["订单编号 + 品项编码唯一；相同组合更新已有记录，不同组合新增。"], ["客户代码、订单编号、品项编码、品项名称、订单总数量必填。编码请按文本填写以保留前导零。"], ["客户交期填写 YYYY-MM-DD；数量最多4位小数；完成比例填写0至100（例如50表示50%），留空为0。"], ["状态只允许填写“正常”或“作废”，留空默认为正常。"], ["请勿修改表头。空白客户交期和生产单位会清空已有值。部门、课室、业务员通过原有同步按钮维护。"], ["任何行校验失败均不写入；请修正后重新上传预览。"]]);
    notes.getColumn(1).width = 120;
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  async preview(file: Express.Multer.File, actor: MarketingActor) {
    this.application.assertScheduleImport(actor);
    if (!file?.buffer?.length || !/\.xlsx$/i.test(file.originalname)) throw new BadRequestException("请选择 .xlsx Excel 文件");
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(file.buffer as any); } catch { throw new BadRequestException("Excel 文件损坏、加密或格式不正确，请使用导出的模板"); }
    const sheet = workbook.getWorksheet("订单排期") ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Excel 文件没有工作表");
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, col) => { if (headers.has(cell.text.trim())) throw new BadRequestException(`表头重复：${cell.text}`); headers.set(cell.text.trim(), col); });
    for (const [label] of scheduleColumns) if (label !== "状态" && !headers.has(label)) throw new BadRequestException(`缺少表头：${label}，请使用导出的模板`);
    if (sheet.rowCount > 50001) throw new BadRequestException("单次最多导入50000行");
    const inputs: Array<{ row: number; input: OrderScheduleInput }> = [];
    const errors: Array<{ row: number; reason: string }> = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const input: Record<string, unknown> = {};
      if (!scheduleColumns.some(([label]) => row.getCell(headers.get(label)!).text.trim())) return;
      for (const [label, key] of scheduleColumns) {
        const column = headers.get(label);
        if (!column) { input[key] = ""; continue; }
        const cell = row.getCell(column);
        if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) errors.push({ row: number, reason: `${label}不能包含公式或错误值` });
        input[key] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text.trim();
      }
      input.completionRatio ||= "0";
      const statusText = String(input.status ?? "").trim();
      input.status = statusText === "作废" ? "VOID" : statusText === "正常" || !statusText ? "NORMAL" : statusText;
      inputs.push({ row: number, input: input as OrderScheduleInput });
    });
    const validated = await this.application.validateScheduleImport(inputs, actor);
    errors.push(...validated.errors);
    if (!inputs.length) errors.push({ row: 2, reason: "文件中没有可导入的数据" });
    if (errors.length) return { total: inputs.length, errors, token: null, rows: [] };
    const payload = Buffer.from(JSON.stringify({ tenant: actor.tenantCode, user: actor.userId, expires: Date.now() + 30 * 60 * 1000, hash: createHash("sha256").update(file.buffer).digest("hex"), rows: validated.rows })).toString("base64url");
    return { total: inputs.length, errors: [], token: `${payload}.${this.signature(payload)}`, rows: validated.rows.slice(0, 20).map((entry) => entry.input) };
  }
  async confirm(token: string, actor: MarketingActor) {
    this.application.assertScheduleImport(actor);
    if (typeof token !== "string") throw new BadRequestException("请先上传并预览文件");
    const [payload, signature] = token.split(".");
    const expected = this.signature(payload ?? "");
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new BadRequestException("导入预览已失效，请重新上传");
    const data = JSON.parse(Buffer.from(payload!, "base64url").toString());
    if (data.tenant !== actor.tenantCode || data.user !== actor.userId || data.expires < Date.now()) throw new BadRequestException("导入预览已过期或不属于当前用户，请重新上传");
    return this.application.importSchedules(data.rows, data.hash, actor);
  }
}
