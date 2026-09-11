import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { MarketingApplicationService } from "./marketing.application.service";
import { MarketingDirectoryQueryService } from "./marketing-directory-query.service";
import type { BusinessCustomerMappingInput, MappingImportSummary, MarketingActor } from "./marketing.types";
import { assertSpreadsheetNotEncrypted } from "../../spreadsheet-upload";

@Injectable()
export class MarketingImportService {
  constructor(
    private readonly application: MarketingApplicationService,
    private readonly directory: MarketingDirectoryQueryService
  ) {}

  private cellText(cell: ExcelJS.Cell): string {
    const value: any = cell.value;
    if (value && typeof value === "object" && Array.isArray(value.richText)) return value.richText.map((part: any) => String(part.text ?? "")).join("").trim();
    if (value && typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
    if (value && typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
    return String(value ?? "").trim();
  }

  private originalFileName(value: string) {
    const decoded = Buffer.from(value, "latin1").toString("utf8");
    return decoded.includes("\uFFFD") ? value : decoded;
  }

  async importMappings(file: Express.Multer.File, actor: MarketingActor) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择业务接单周报 Excel 文件");
    assertSpreadsheetNotEncrypted(file.buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);
    const aliases = new Map([["部门", "部门"], ["课室", "课室"], ["业务", "业务"], ["业务员", "业务"], ["客户代码", "客户"], ["客户", "客户"]]);
    let target: { sheet: ExcelJS.Worksheet; headerRow: number; headers: Map<string, number> } | undefined;
    for (const sheet of workbook.worksheets) {
      for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 5); rowNumber += 1) {
        const headers = new Map<string, number>();
        sheet.getRow(rowNumber).eachCell((cell, column) => {
          const normalized = this.cellText(cell).replace(/\s+/g, "");
          const canonical = aliases.get(normalized);
          if (canonical) headers.set(canonical, column);
        });
        if (["部门", "课室", "业务", "客户"].every((header) => headers.has(header))) {
          target = { sheet, headerRow: rowNumber, headers };
          break;
        }
      }
      if (target) break;
    }
    if (!target) throw new BadRequestException("Excel 中没有找到部门、课室、业务员和客户字段");

    type CustomerGroup = { department: string; section: string; customerCode: string; salespersonNames: Set<string>; locations: Set<string> };
    const customers = new Map<string, CustomerGroup>();
    let ignoredBlankCustomerRows = 0;
    let sourceRows = 0;
    let carriedDepartment = "";
    let carriedSection = "";
    let carriedSalespeople = "";
    target.sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= target!.headerRow) return;
      sourceRows += 1;
      const get = (header: string): string => this.cellText(row.getCell(target!.headers.get(header)!));
      const rawDepartment = get("部门");
      const rawSection = get("课室");
      const rawSalespeople = get("业务");
      const customerText = get("客户");
      if (rawDepartment && !["小计", "合计"].includes(rawDepartment)) carriedDepartment = rawDepartment;
      if (rawSection && !["小计", "合计"].includes(rawSection)) carriedSection = rawSection;
      if (rawSalespeople && !["小计", "合计"].includes(rawSalespeople)) carriedSalespeople = rawSalespeople;
      if (!customerText) {
        ignoredBlankCustomerRows += 1;
        return;
      }
      const department = rawDepartment || carriedDepartment;
      const section = rawSection || carriedSection;
      if (!department) throw new BadRequestException(`第 ${rowNumber} 行客户 ${customerText} 缺少部门`);
      const salespersonNames = (rawSalespeople || carriedSalespeople).split(/[/|、,，;；\n]+/).map((name) => name.trim()).filter(Boolean);
      const customerCodes = customerText.split(/[|、,，;；\n]+/).map((code) => code.trim()).filter(Boolean);
      for (const customerCode of customerCodes) {
        const key = customerCode.toLocaleUpperCase();
        const location = `${department}\u0000${section}`;
        const current = customers.get(key) ?? { department, section, customerCode, salespersonNames: new Set<string>(), locations: new Set<string>() };
        current.locations.add(location);
        salespersonNames.forEach((name) => current.salespersonNames.add(name));
        customers.set(key, current);
      }
    });

    const allNames = [...new Set([...customers.values()].flatMap((row) => [...row.salespersonNames]))];
    const directoryMatches = await this.directory.resolveEnabledUsersByNames(allNames);
    const unmatchedSalespeople = allNames.filter((name) => !directoryMatches.has(name)).sort((left, right) => left.localeCompare(right, "zh-CN"));
    const ambiguousSalespeople = allNames.flatMap((name) => {
      const matches = directoryMatches.get(name) ?? [];
      return matches.length > 1 ? [{ name, userIds: matches.map((user) => user.id) }] : [];
    });
    const rows: BusinessCustomerMappingInput[] = [...customers.values()].map((row) => ({
      department: row.department,
      section: row.section,
      customerCode: row.customerCode,
      salespersonUserIds: [...row.salespersonNames].flatMap((name) => {
        const matches = directoryMatches.get(name) ?? [];
        return matches.length === 1 ? [matches[0]!.id] : [];
      }).filter((id, index, ids) => ids.indexOf(id) === index)
    }));
    const summary: MappingImportSummary = {
      ignoredBlankCustomerRows,
      sourceRows,
      unmatchedSalespeople,
      ambiguousSalespeople,
      crossSectionCustomers: [...customers.values()].filter((row) => row.locations.size > 1).map((row) => ({
        customerCode: row.customerCode,
        locations: [...row.locations].map((location) => location.split("\u0000").filter(Boolean).join(" / "))
      }))
    };
    return this.application.replaceMappings(rows, this.originalFileName(file.originalname), createHash("sha256").update(file.buffer).digest("hex"), summary, actor);
  }
}
