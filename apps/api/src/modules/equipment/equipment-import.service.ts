import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import ExcelJS from "exceljs";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentActor, EquipmentStatusImportRow, EquipmentStatusImportSourceRow, hasEquipmentPermission } from "./equipment.types";
import { assertSpreadsheetNotEncrypted } from "../../spreadsheet-upload";

type ConfirmInput = { fileHash: string; signature: string; rows: EquipmentStatusImportRow[] };

@Injectable()
export class EquipmentImportService {
  constructor(private readonly application: EquipmentApplicationService) {}

  async previewStatus(file: Express.Multer.File, actor: EquipmentActor) {
    if (!hasEquipmentPermission(actor, "equipment-status-report", "import")) throw new ForbiddenException("当前权限组没有此表的导入权限");
    if (!file?.buffer?.length) throw new BadRequestException("请选择设备状态 Excel 或 CSV 文件");
    assertSpreadsheetNotEncrypted(file.buffer);
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new BadRequestException("仅支持 .xlsx 或 .csv 文件");
    const sourceRows = file.originalname.toLowerCase().endsWith(".csv") ? this.csvRows(file.buffer) : await this.xlsxRows(file.buffer);
    if (!sourceRows.length) throw new BadRequestException("文件中没有可导入的数据");
    const preview = await this.application.previewStatusImport(sourceRows, actor);
    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    return { ...preview, fileHash, signature: this.sign(fileHash, preview.rows) };
  }

  async confirmStatus(input: ConfirmInput, actor: EquipmentActor) {
    if (!hasEquipmentPermission(actor, "equipment-status-report", "import")) throw new ForbiddenException("当前权限组没有此表的导入权限");
    const expected = this.sign(String(input.fileHash ?? ""), input.rows ?? []);
    const actual = String(input.signature ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new BadRequestException("导入预览已失效或内容被修改，请重新选择文件");
    return this.application.confirmStatusImport(input.rows, input.fileHash, { ...actor, source: "import" });
  }

  private sign(fileHash: string, rows: EquipmentStatusImportRow[]) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error("JWT_ACCESS_SECRET 未配置");
    return createHmac("sha256", secret).update(JSON.stringify({ fileHash, rows })).digest("hex");
  }

  private async xlsxRows(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("设备状态填报") ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Excel 中没有工作表");
    const header = this.headerMap(sheet.getRow(1).values as unknown[]);
    const rows: EquipmentStatusImportSourceRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const read = (name: string) => row.getCell(header.get(name)!).value;
      if (["事业部", "设备编号", "填报日期", "运行时长", "故障时长", "故障原因"].every((name) => String(read(name) ?? "").trim() === "")) return;
      rows.push({
        rowNumber, divisionName: this.text(read("事业部")), equipmentCode: this.text(read("设备编号")),
        reportDate: this.date(read("填报日期")), runtimeMinutes: this.duration(read("运行时长")),
        faultMinutes: this.duration(read("故障时长")), faultReason: this.text(read("故障原因")) || null
      });
    });
    return rows;
  }

  private csvRows(buffer: Buffer) {
    const lines = buffer.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) throw new BadRequestException("CSV 文件为空");
    const parsed = lines.map((line) => this.csvLine(line)); const header = this.headerMap(parsed[0]!);
    return parsed.slice(1).flatMap((values, index) => {
      const read = (name: string) => values[header.get(name)!] ?? "";
      if (["事业部", "设备编号", "填报日期", "运行时长", "故障时长", "故障原因"].every((name) => String(read(name)).trim() === "")) return [];
      return [{
        rowNumber: index + 2, divisionName: this.text(read("事业部")), equipmentCode: this.text(read("设备编号")),
        reportDate: this.date(read("填报日期")), runtimeMinutes: this.duration(read("运行时长")),
        faultMinutes: this.duration(read("故障时长")), faultReason: this.text(read("故障原因")) || null
      }];
    });
  }

  private headerMap(values: unknown[]) {
    const aliases: Record<string, string> = { "事业部": "事业部", "设备编号": "设备编号", "填报日期": "填报日期", "运行时长": "运行时长", "故障时长": "故障时长", "故障原因": "故障原因" };
    const map = new Map<string, number>();
    values.forEach((value, index) => { const name = aliases[this.text(value).replace(/\s+/g, "")]; if (name) map.set(name, index); });
    const missing = Object.values(aliases).filter((name) => !map.has(name));
    if (missing.length) throw new BadRequestException(`缺少字段：${missing.join("、")}`);
    return map;
  }

  private text(value: unknown) {
    if (value && typeof value === "object" && "text" in value) return String((value as { text?: unknown }).text ?? "").trim();
    if (value && typeof value === "object" && "result" in value) return String((value as { result?: unknown }).result ?? "").trim();
    return String(value ?? "").trim();
  }

  private date(value: unknown) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000)).toISOString().slice(0, 10);
    const text = this.text(value).replaceAll("/", "-"); const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    return match ? `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}` : text;
  }

  private duration(value: unknown) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    const text = this.text(value);
    if (!text) return 0;
    if (/^\d+$/.test(text)) return Number(text);
    const chinese = /^(\d+)小时(?:(\d{1,2})分钟)?$/.exec(text);
    if (chinese && Number(chinese[2] ?? 0) < 60) return Number(chinese[1]) * 60 + Number(chinese[2] ?? 0);
    const minutes = /^(\d+)分钟$/.exec(text);
    if (minutes) return Number(minutes[1]);
    const clock = /^(\d+):(\d{1,2})$/.exec(text);
    if (clock && Number(clock[2]) < 60) return Number(clock[1]) * 60 + Number(clock[2]);
    return Number.NaN;
  }

  private csvLine(line: string) {
    const values: string[] = []; let current = ""; let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]!;
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { values.push(current.trim()); current = ""; }
      else current += char;
    }
    values.push(current.trim()); return values;
  }
}
