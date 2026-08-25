import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { monthlyPlanningFieldRegistry, type PlanningFieldDefinition } from "@kdos/contracts";
import ExcelJS from "exceljs";
import type { CreatePlanItemInput, PlanningActor } from "./planning.types";
import { PlanningApplicationService } from "./planning.application.service";

function setNested(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split("."); let cursor = target;
  for (const part of parts.slice(0, -1)) { cursor[part] = typeof cursor[part] === "object" && cursor[part] ? cursor[part] : {}; cursor = cursor[part] as Record<string, unknown>; }
  cursor[parts.at(-1)!] = value;
}
function dateValue(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}
function numberValue(value: unknown) {
  const text = String(value ?? "").trim(); if (!text) return undefined;
  const number = Number(text); return Number.isFinite(number) ? number : undefined;
}

@Injectable()
export class PlanningImportService {
  constructor(private readonly commands: PlanningApplicationService) {}

  private csv(buffer: Buffer) {
    const lines = buffer.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    const parse = (line: string) => { const output: string[] = []; let value = ""; let quoted = false; for (let index=0; index<line.length; index++) { const char=line[index]!; if (char==='"' && line[index+1]==='"') { value+='"'; index++; } else if (char==='"') quoted=!quoted; else if (char===',' && !quoted) { output.push(value.trim()); value=""; } else value+=char; } output.push(value.trim()); return output; };
    const headers = parse(lines.shift() ?? ""); return lines.map((line) => Object.fromEntries(parse(line).map((value, index) => [headers[index] ?? `column_${index + 1}`, value])));
  }

  private async excel(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets.find((entry) => entry.state === "visible") ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Excel 没有可读取的工作表");
    let headerRow = 0;
    for (let row = 1; row <= Math.min(sheet.rowCount, 10); row++) {
      const texts = sheet.getRow(row).values as unknown[];
      if (texts.some((value) => String(value ?? "").trim() === "订单号") && texts.some((value) => String(value ?? "").trim() === "品号")) { headerRow = row; break; }
    }
    if (!headerRow) throw new BadRequestException("未找到同时包含“订单号”和“品号”的表头行");
    const headers: string[] = []; let currentGroup = "";
    if (headerRow > 1) {
      for (let column = 1; column <= sheet.columnCount; column++) {
        const group = sheet.getCell(headerRow - 1, column).text.trim(); if (group) currentGroup = group;
        const label = sheet.getCell(headerRow, column).text.trim(); headers.push(label ? `${currentGroup}::${label}` : currentGroup || `column_${column}`);
      }
    } else {
      const hasSecondHeader = Array.from({ length: sheet.columnCount }, (_, index) => sheet.getCell(2, index + 1).text.trim()).some(Boolean);
      for (let column = 1; column <= sheet.columnCount; column++) {
        const top = sheet.getCell(1, column).text.trim(); if (top) currentGroup = top;
        const bottom = hasSecondHeader ? sheet.getCell(2, column).text.trim() : "";
        headers.push(bottom ? `${currentGroup}::${bottom}` : top || `column_${column}`);
      }
      if (hasSecondHeader) headerRow = 2;
    }
    const rows: Record<string, unknown>[] = [];
    for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
      const record = Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, sheet.getCell(row, index + 1).value]));
      if (Object.values(record).some((value) => value !== null && value !== undefined && String(value).trim())) rows.push(record);
    }
    return rows;
  }

  async preview(versionId: string, file: Express.Multer.File, actor: PlanningActor) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择导入文件");
    const lower = file.originalname.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) throw new BadRequestException("仅支持标准 .xlsx 或 .csv 文件");
    const sourceRows = lower.endsWith(".csv") ? this.csv(file.buffer) : await this.excel(file.buffer);
    const codeMap = new Map(monthlyPlanningFieldRegistry.map((field) => [field.code, field]));
    const compositeMap = new Map(monthlyPlanningFieldRegistry.map((field) => [`${field.groupLabel}::${field.label}`, field]));
    const labelGroups = new Map<string, PlanningFieldDefinition[]>();
    for (const field of monthlyPlanningFieldRegistry) labelGroups.set(field.label, [...(labelGroups.get(field.label) ?? []), field]);
    const fieldFor = (header: string) => codeMap.get(header) ?? compositeMap.get(header) ?? (labelGroups.get(header)?.length === 1 ? labelGroups.get(header)![0] : undefined);
    const warnings: string[] = []; const deduplicated = new Map<string, CreatePlanItemInput>();
    sourceRows.forEach((source, index) => {
      const legacyData: Record<string, unknown> = {}; const mapped = new Map<string, unknown>();
      for (const [label, value] of Object.entries(source)) {
        const field = fieldFor(label); if (!field || value == null || value === "") continue;
        const normalized = field.dataType === "date" ? dateValue(value) : ["decimal", "integer"].includes(field.dataType) ? numberValue(value) : String(value).trim();
        if (normalized !== undefined) { setNested(legacyData, field.code, normalized); mapped.set(field.code, normalized); }
      }
      const orderNumber = String(mapped.get("orderNumber") ?? "").trim(); const itemNumber = String(mapped.get("itemNumber") ?? "").trim();
      if (!orderNumber || !itemNumber) { warnings.push(`第 ${index + 2} 行缺少订单号或品号，已跳过`); return; }
      const input: CreatePlanItemInput = {
        orderNumber, itemNumber, itemName: String(mapped.get("itemName") ?? "").trim() || undefined,
        customerName: String(mapped.get("customer") ?? "").trim() || undefined,
        orderQuantity: numberValue(mapped.get("productionQuantity")) ?? 0,
        productionQuantity: numberValue(mapped.get("productionQuantity")) ?? 0,
        deliveryDate: dateValue(mapped.get("customerDueDate")),
        priority: numberValue(mapped.get("priority")) ?? 50, sequence: numberValue(mapped.get("planSequence")),
        responsibleOrgId: String(mapped.get("responsibleOrgId") ?? "").trim() || undefined,
        ownerUserId: String(mapped.get("ownerUserId") ?? "").trim() || undefined,
        remark: String(mapped.get("remark") ?? "").trim() || undefined, legacyData
      };
      const key = `${orderNumber}\u0000${itemNumber}`;
      if (deduplicated.has(key)) warnings.push(`第 ${index + 2} 行订单号 + 品号重复，采用最后一行`);
      deduplicated.set(key, input);
    });
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    return this.commands.previewImport(versionId, file.originalname, hash, [...deduplicated.values()], warnings, actor);
  }
}
