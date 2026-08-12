import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { DataSource, Repository } from "typeorm";
import { excelMonthlyPlanColumns, milestoneProcessCodes, processDefinitions } from "@tracker/shared";
import {
  ImportJob, ImportJobError, ItemProcessProgress,
  Order, OrderItem, OutsourcingDetail, PlanPeriod, ProcessDefinitionEntity, Supplier
} from "./entities";

const epoch = Date.UTC(1899, 11, 30);
const dateKeys = new Set(excelMonthlyPlanColumns.filter((column) => column.kind === "date").map((column) => column.key));
const decimalKeys = new Set(excelMonthlyPlanColumns.filter((column) => column.kind === "decimal").map((column) => column.key));

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

function rawCell(cell: ExcelJS.Cell, key: string, warnings: string[]) {
  let value: any = cell.value;
  if (value && typeof value === "object" && "formula" in value) {
    warnings.push(`${cell.address} 来源为公式，仅使用缓存值`);
    value = value.result;
  }
  if (value && typeof value === "object" && "error" in value) {
    warnings.push(`${cell.address} 包含 Excel 错误值 ${value.error}，已置空`);
    return null;
  }
  if (value === null || value === undefined || value === "") return null;
  if (dateKeys.has(key)) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "number") return new Date(epoch + Math.floor(value) * 86400000).toISOString().slice(0, 10);
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }
  if (decimalKeys.has(key)) {
    const numeric = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(numeric) ? String(numeric) : null;
  }
  return String(value).trim();
}

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(ImportJob) private readonly jobs: Repository<ImportJob>,
    @InjectRepository(ImportJobError) private readonly errors: Repository<ImportJobError>,
    @InjectRepository(PlanPeriod) private readonly periods: Repository<PlanPeriod>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly items: Repository<OrderItem>,
    @InjectRepository(ProcessDefinitionEntity) private readonly processes: Repository<ProcessDefinitionEntity>,
    private readonly dataSource: DataSource
  ) {}

  async loadWorkbook(file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException("请选择 Excel 文件");
    let importBuffer = file.buffer;
    if (!isStandardXlsx(importBuffer)) throw new BadRequestException("该文件仍受企业加密保护，请先在本机转换为非加密 XLSX 或 CSV 后再导入");
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

  async preview(file: Express.Multer.File, year: number, month: number, userId?: string) {
    if (!file?.buffer) throw new BadRequestException("请选择 xlsx 文件");
    if (year < 2000 || year > 2200 || month < 1 || month > 12) throw new BadRequestException("必须明确确认计划年份和月份");
    const workbook = await this.loadWorkbook(file);
    const monthly = workbook.getWorksheet(`${month}月计划`)
      ?? workbook.getWorksheet("月度计划")
      ?? workbook.worksheets.find((sheet) => /^\d{1,2}月计划$/.test(sheet.name));
    if (!monthly) throw new BadRequestException(`缺少“${month}月计划”或“月度计划”Sheet`);
    const warnings: string[] = [];
    const rows: Record<string, any>[] = [];
    monthly!.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 2) return;
      const parsed: Record<string, any> = {};
      excelMonthlyPlanColumns.forEach((column, index) => {
        parsed[column.key] = rawCell(row.getCell(index + 1), column.key, warnings);
      });
      if (!parsed.orderNumber && !parsed.itemNumber) return;
      parsed.__row = rowNumber;
      rows.push(parsed);
    });
    const suppliers = (workbook.getWorksheet("供应商名单")?.getColumn(1).values.slice(2) ?? [])
      .map((value) => String(value ?? "").trim()).filter(Boolean);
    const dictionaries: Record<string, string[]> = {};
    const dictionarySheet = workbook.getWorksheet("字典表");
    dictionarySheet?.getRow(1).eachCell((cell, col) => {
      dictionaries[String(cell.value)] = dictionarySheet.getColumn(col).values.slice(2)
        .map((value) => String(value ?? "").trim()).filter(Boolean);
    });
    const duplicateSuppliers = suppliers.filter((name, index) => suppliers.indexOf(name) !== index);
    for (const name of suppliers) if (/^\d+$/.test(name) || name.startsWith("事业")) warnings.push(`供应商“${name}”疑似非供应商名称，请人工核对`);
    if (duplicateSuppliers.length) warnings.push(`供应商存在重复：${[...new Set(duplicateSuppliers)].join("、")}`);
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    const existing = await this.jobs.findOneBy({ fileHash: hash, status: "completed" });
    const payload = { year, month, rows, suppliers: [...new Set(suppliers)], dictionaries };
    const job = await this.jobs.save({
      fileName: file.originalname, fileHash: hash, status: "previewed",
      summary: { add: existing ? 0 : rows.length, update: existing ? rows.length : 0, skip: 0, warning: warnings.length, failure: 0 },
      previewPayload: payload, createdBy: userId ?? null
    });
    await this.errors.save(warnings.map((message) => ({
      jobId: job.id, sheetName: monthly!.name, rowNumber: null, fieldKey: null, level: "warning", message
    })));
    return { jobId: job.id, summary: job.summary, warnings: warnings.slice(0, 100), sheets: workbook.worksheets.map((sheet) => sheet.name) };
  }

  async confirm(jobId: string) {
    const job = await this.jobs.findOneBy({ id: jobId });
    if (!job || job.status !== "previewed") throw new NotFoundException("导入预览不存在或已确认");
    const payload = job.previewPayload as any;
    const processMap = new Map((await this.processes.find()).map((process) => [process.code, process]));
    await this.dataSource.transaction(async (manager) => {
      let period = await manager.findOneBy(PlanPeriod, { year: payload.year, month: payload.month });
      period ??= await manager.save(PlanPeriod, { year: payload.year, month: payload.month, status: "active" });
      for (const row of payload.rows) {
        if (!row.orderNumber || !row.itemNumber) continue;
        let order = await manager.findOneBy(Order, { orderNumber: row.orderNumber });
        const orderValues = {
          orderNumber: row.orderNumber, orderDate: row.orderDate, customerDueDate: row.customerDueDate,
          reviewDueDate: row.reviewDueDate, exceptionDueDate: row.exceptionDueDate,
          exceptionDeliveryMethod: row.exceptionDeliveryMethod, customer: row.customer, division: row.division
        };
        order = order ? Object.assign(order, orderValues) : manager.create(Order, orderValues);
        order = await manager.save(order);
        let item = await manager.findOneBy(OrderItem, { periodId: period.id, orderId: order.id, itemNumber: row.itemNumber });
        const itemValues = {
          orderId: order.id, periodId: period.id, itemNumber: row.itemNumber,
          relationKey: `${row.orderNumber}${row.itemNumber}`, itemName: row.itemName,
          customerDueDate: row.customerDueDate, reviewDueDate: row.reviewDueDate,
          exceptionDueDate: row.exceptionDueDate, exceptionDeliveryMethod: row.exceptionDeliveryMethod,
          customer: row.customer, division: row.division,
          containerDate: row.containerDate, modelAge: row.modelAge, productAttribute: row.productAttribute,
          surfaceNature: row.surfaceNature, specialItem: row.specialItem,
          productionQuantity: row.productionQuantity, historicalInboundQuantity: row.historicalInboundQuantity,
          todayInboundQuantity: row.todayInboundQuantity, handlingMethod: row.handlingMethod,
          planPage: row.planPage, orderException: row.orderException, inspection: row.inspection,
          inspectionQuantity: row.inspectionQuantity, remark: row.remark, orderWeeks: row.orderWeeks,
          month: period.month, unitPrice: row.unitPrice
        };
        item = item ? Object.assign(item, itemValues, { version: item.version + 1 }) : manager.create(OrderItem, itemValues);
        item = await manager.save(item);
        const outValues = {
          orderItemId: item.id, supplier: row["outsourcing.supplier"], method: row["outsourcing.method"],
          dueDate: row["outsourcing.dueDate"], exceptionDueDate: row["outsourcing.exceptionDueDate"]
        };
        const existingOut = await manager.findOneBy(OutsourcingDetail, { orderItemId: item.id });
        await manager.save(OutsourcingDetail, existingOut ? Object.assign(existingOut, outValues) : outValues);
        for (const process of processDefinitions) {
          const definition = processMap.get(process.code);
          if (!definition) continue;
          const sourceStatus = row[`processes.${process.code}.status`];
          const isMilestone = milestoneProcessCodes.includes(process.code as typeof milestoneProcessCodes[number]);
          const quantity = isMilestone && sourceStatus !== null && sourceStatus !== undefined && sourceStatus !== ""
            ? (/^-?[0-9]+([.][0-9]+)?$/.test(String(sourceStatus).trim())
                ? String(sourceStatus).trim()
                : String(sourceStatus).trim().toUpperCase() === "Y" ? item.productionQuantity : null)
            : null;
          const values = {
            orderItemId: item.id, processDefinitionId: definition.id,
            requiredDays: row[`processes.${process.code}.requiredDays`],
            dueDate: row[`processes.${process.code}.dueDate`],
            quantity,
            status: sourceStatus,
            exception: row[`processes.${process.code}.exception`]
          };
          const current = await manager.findOneBy(ItemProcessProgress, { orderItemId: item.id, processDefinitionId: definition.id });
          await manager.save(ItemProcessProgress, current ? Object.assign(current, values, { version: current.version + 1 }) : values);
        }
      }
      for (const name of payload.suppliers) {
        await manager.createQueryBuilder().insert().into(Supplier).values({ name }).orIgnore().execute();
      }
      job.status = "completed";
      job.previewPayload = null;
      await manager.save(job);
    });
    return { jobId, status: "completed", summary: job.summary };
  }
}
