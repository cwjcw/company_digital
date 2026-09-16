import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { assertSpreadsheetNotEncrypted } from "./spreadsheet-upload";

const isStandardXlsx = (buffer: Buffer) => buffer.subarray(0, 4).toString("hex") === "504b0304";

async function normalizeSpreadsheetMlPrefixes(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.endsWith(".xml")) continue;
    const xml = await entry.async("string");
    if (!xml.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) continue;
    zip.file(name, xml
      .replace('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
      .replaceAll("<x:", "<")
      .replaceAll("</x:", "</"));
    changed = true;
  }
  return changed ? Buffer.from(await zip.generateAsync({ type: "nodebuffer" })) : buffer;
}

/**
 * 统一 Excel 读取入口（加密检测 → 标准 XLSX 校验 → WPS/分片命名空间归一化）。
 * 旧 Planning 的 14 工序月度计划导入（preview/confirm 与 legacy 97/85 列契约）已在 KN-PROC-001 退役；
 * 新主计划各表统一使用 MasterPlanSpreadsheetService 的模板/预览/确认链路。
 */
@Injectable()
export class ImportService {
  async loadWorkbook(file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException("请选择 Excel 文件");
    let importBuffer = file.buffer;
    assertSpreadsheetNotEncrypted(importBuffer);
    if (!isStandardXlsx(importBuffer)) throw new BadRequestException("文件不是标准 XLSX 格式或已损坏");
    try {
      importBuffer = await normalizeSpreadsheetMlPrefixes(importBuffer);
    } catch {
      throw new BadRequestException("XLSX 文件结构无效或已损坏");
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(importBuffer as any);
    } catch {
      throw new BadRequestException("无法读取 XLSX 内容，请确认文件已转换为标准的非加密 XLSX");
    }
    return workbook;
  }
}
