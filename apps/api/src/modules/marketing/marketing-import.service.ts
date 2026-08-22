import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { MarketingApplicationService } from "./marketing.application.service";
import type { BusinessCustomerMappingInput, MarketingActor } from "./marketing.types";

@Injectable()
export class MarketingImportService {
  constructor(private readonly application: MarketingApplicationService) {}

  private cellText(cell: ExcelJS.Cell) {
    const value: any = cell.value;
    if (value && typeof value === "object" && Array.isArray(value.richText)) return value.richText.map((part: any) => String(part.text ?? "")).join("").trim();
    if (value && typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
    if (value && typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
    return String(value ?? "").trim();
  }

  async importMappings(file: Express.Multer.File, actor: MarketingActor) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择业务接单周报 Excel 文件");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);
    const sheet = workbook.getWorksheet("工作表1");
    if (!sheet) throw new BadRequestException("Excel 中缺少“工作表1”");
    const headers = new Map<string, number>();
    sheet.getRow(2).eachCell((cell, column) => headers.set(this.cellText(cell).replace(/\s+/g, ""), column));
    const required = ["部门", "课室", "业务", "客户代码"];
    if (required.some((header) => !headers.has(header))) throw new BadRequestException("工作表1 缺少部门、课室、业务或客户代码字段");
    const groups = new Map<string, BusinessCustomerMappingInput & { codes: Set<string> }>();
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 2) return;
      const get = (header: string) => this.cellText(row.getCell(headers.get(header)!));
      const department = get("部门"); const section = get("课室"); const salesperson = get("业务"); const customerCode = get("客户代码");
      if (!department || !salesperson || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(customerCode)) return;
      const key = `${department}\u0000${section}\u0000${salesperson}`;
      const current = groups.get(key) ?? { department, section, salesperson, customerCodes: "", codes: new Set<string>() };
      current.codes.add(customerCode); groups.set(key, current);
    });
    const rows = [...groups.values()].map(({ codes, ...row }) => ({ ...row, customerCodes: [...codes].join("|") }));
    return this.application.replaceMappings(rows, file.originalname, createHash("sha256").update(file.buffer).digest("hex"), actor);
  }
}
