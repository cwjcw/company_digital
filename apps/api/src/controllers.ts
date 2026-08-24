import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req,
  Res, UploadedFile, UseGuards, UseInterceptors
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { InjectRepository } from "@nestjs/typeorm";
import ExcelJS from "exceljs";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { DataSource, Repository } from "typeorm";
import { dictionarySeeds, monthlyPlanColumns } from "@tracker/shared";
import { AuthGuard, AuthService } from "./auth";
import {
  ApiKey, AuditLog, DictionaryType, DictionaryValue, FinishedGoodsInbound, Permission,
  Contact, OrganizationUnit, ProcessDefinitionEntity, Role, RoleOrganizationScope, SalesOrder, Supplier, User, UserRole
} from "./entities";
import { ImportService } from "./import.service";
import { PlanService } from "./plan.service";
import { StorageService } from "./storage.service";
import { currentModificationActor } from "./modification-audit";
import { DEFAULT_USER_PASSWORD, isPrimaryAdminUsername } from "./user-defaults";
import { AdminQueryService } from "./modules/admin/admin-query.service";

type UserRequest = Request & { user: any; requestId: string };

const salesOrderImportFields: Array<{ property: keyof SalesOrder; headers: string[]; kind?: "date" | "number" | "integer" }> = [
  { property: "documentDate", headers: ["DOC_DATE", "单据日期"], kind: "date" },
  { property: "orderDate", headers: ["ORDER_DATE", "订单日期", "下单日期"], kind: "date" },
  { property: "orderNumber", headers: ["DOC_NO", "订单编号", "订单号"] },
  { property: "documentName", headers: ["DOC_NAME", "单据名称"] },
  { property: "closeStatus", headers: ["CLOSE", "关闭状态"] },
  { property: "customerCode", headers: ["CUSTOMER_CODE", "客户代码"] },
  { property: "shipToCustomerCode", headers: ["SHIP_TO_CUSTOMER_CODE", "送货客户代码"] },
  { property: "invoiceCustomerCode", headers: ["INVOICE_CUSTOMER_CODE", "开票客户代码"] },
  { property: "employeeName", headers: ["EMPLOYEE_NAME", "业务员"] },
  { property: "taxIncluded", headers: ["TAX_INCLUDED", "含税标识"] },
  { property: "currencyCode", headers: ["CURRENCY_CODE", "币种"] },
  { property: "exchangeRate", headers: ["EXCHANGE_RATE", "汇率"], kind: "number" },
  { property: "sequenceNumber", headers: ["SequenceNumber", "SEQUENCE_NUMBER", "序号"], kind: "integer" },
  { property: "itemNumber", headers: ["ITEM_CODE", "品项编码", "品号"] },
  { property: "itemName", headers: ["ITEM_DESCRIPTION", "品项名称", "品名"] },
  { property: "specification", headers: ["ITEM_SPECIFICATION", "规格"] },
  { property: "unitName", headers: ["UNIT_NAME", "业务单位"] },
  { property: "businessQuantity", headers: ["BUSINESS_QTY", "订单数量"], kind: "number" },
  { property: "priceQuantity", headers: ["PRICE_QTY", "计价数量"], kind: "number" },
  { property: "price", headers: ["PRICE", "单价"], kind: "number" },
  { property: "rmbPrice", headers: ["RMB_PRICE", "人民币单价"], kind: "number" },
  { property: "rmbTaxIncludedAmount", headers: ["人民币含税价", "RMB_TAX_INCLUDED_AMOUNT"], kind: "number" },
  { property: "deliveredBusinessQuantity", headers: ["DELIVER_BUSINESS_QTY", "已交数量"], kind: "number" },
  { property: "plannedDeliveryDate", headers: ["PLAN_DELIVERY_DATE", "计划交期"], kind: "date" },
  { property: "taxRate", headers: ["TAX_RATE", "税率"], kind: "number" },
  { property: "amountExcludingTaxBc", headers: ["AMT_UNINCLUDE_TAX_BC", "本币未税金额"], kind: "number" },
  { property: "taxBc", headers: ["TAX_BC", "本币税额"], kind: "number" },
  { property: "creatorUserId", headers: ["USER_ID", "制单人编号"] },
  { property: "creatorUserName", headers: ["USER_NAME", "制单人"] },
  { property: "adminUnitName", headers: ["ADMIN_UNIT_NAME", "管理单位"] },
  { property: "ownerDepartment", headers: ["Owner_Dept", "责任部门"] },
  { property: "ownerEmployee", headers: ["Owner_Emp", "责任业务"] },
  { property: "ownerDivision", headers: ["Owner_Division", "责任事业部"] }
];

function requireTablePermission(req: UserRequest, resource: string, action: string) {
  const permissions = req.user.permissions ?? [];
  if (permissions.includes("*") || permissions.includes(`${resource}:*:${action}`)) return;
  throw new ForbiddenException("当前权限组没有此表的操作权限");
}

function requireSystemAdmin(req: UserRequest) {
  if (req.user.roles?.includes("系统管理员")) return;
  throw new ForbiddenException("仅系统管理员可以访问系统管理模块");
}

@ApiTags("系统")
@Controller()
export class SystemController {
  @Get("health") health() { return { status: "ok", timestamp: new Date().toISOString() }; }
}

@ApiTags("业务参考数据")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("reference-data")
export class ReferenceDataController {
  @Get("dictionaries")
  dictionaries() {
    return Object.entries(dictionarySeeds).map(([code, values]) => ({
      code, name: code, values: values.map((value, index) => ({ id: `demo-${code}-${index + 1}`, value, sortOrder: index + 1, enabled: true }))
    }));
  }

  @Get("suppliers")
  suppliers() {
    return [{ id: "demo-supplier-1", code: "DEMO-SUPPLIER", name: "演示外协供应商", enabled: true }];
  }
}

@ApiTags("登录")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("login") login(@Body() body: { username: string; password: string }) {
    return this.auth.login(body.username, body.password);
  }
  @Post("refresh") refresh(@Body() body: { refreshToken: string }) { return this.auth.refresh(body.refreshToken); }
  @Post("logout") logout(@Body() body: { refreshToken: string }) { return this.auth.logout(body.refreshToken); }
  @Post("change-password")
  @UseGuards(AuthGuard)
  changePassword(@Body() body: { currentPassword: string; nextPassword: string }, @Req() req: UserRequest) {
    return this.auth.changePassword(req.user.sub, body.currentPassword, body.nextPassword);
  }
}

@ApiTags("计划")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("plans")
export class PlanController {
  constructor(
    private readonly plans: PlanService,
    private readonly storage: StorageService,
    private readonly imports: ImportService
  ) {}
  @Get("periods") periods(@Req() req: UserRequest) { requireTablePermission(req, "monthly-plan", "read"); return this.plans.periodsList(); }
  @Get("monthly")
  monthly(@Query("year", ParseIntPipe) year: number, @Query("month", ParseIntPipe) month: number, @Req() req: UserRequest) {
    requireTablePermission(req, "monthly-plan", "read");
    return this.plans.monthly(year, month, req.user);
  }
  @Get("daily-progress")
  dailyProgress(@Query("date") date: string, @Req() req: UserRequest) {
    requireTablePermission(req, "daily-progress", "read");
    return this.plans.dailyProgressList(date, req.user);
  }
  @Patch("daily-progress/:orderItemId")
  updateDailyProgress(
    @Param("orderItemId") orderItemId: string,
    @Body() body: { date: string; processCode: string; quantity: unknown },
    @Req() req: UserRequest
  ) {
    requireTablePermission(req, "daily-progress", "update");
    return this.plans.updateDailyProgress(orderItemId, body, req.user, req.requestId);
  }
  @Get("rolling") rolling(@Req() req: UserRequest) { requireTablePermission(req, "rolling-plan", "read"); return this.plans.rolling(req.user); }
  @Get("sales-dashboard") dashboard(@Req() req: UserRequest) { requireTablePermission(req, "sales-summary-dashboard", "read"); return this.plans.rolling(req.user); }
  @Post("orders") createOrder(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    requireTablePermission(req, "rolling-plan", "create");
    return this.plans.createOrder(body, req.user, req.requestId);
  }
  @Post("orders/import-file") @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 200 * 1024 * 1024 } }))
  async importOrders(@UploadedFile() file: Express.Multer.File, @Req() req: UserRequest) {
    requireTablePermission(req, "rolling-plan", "import");
    const workbook = await this.imports.loadWorkbook(file);
    const sheet = workbook.getWorksheet("接单汇总") ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Excel 中没有工作表");
    const fieldMap: Record<string, string> = {
      客户: "customer", 业务员: "salesperson", 订单号: "orderNumber", 下单日期: "orderDate",
      客户要求交期: "customerDueDate", 产前评审交期: "reviewDueDate",
      异常后二次交期: "exceptionDueDate", 异常交货方式: "exceptionDeliveryMethod",
      订单金额: "orderAmount", 承产单位: "division", 订单实际完成日期: "actualCompletionDate",
      出货日期: "shippingDate", 交期评分: "deliveryScore", 品质评分: "qualityScore"
    };
    const headers = new Map<number, string>();
    sheet.getRow(2).eachCell((cell, column) => {
      const key = fieldMap[cell.text.replace(/\s+/g, "").trim()];
      if (key) headers.set(column, key);
    });
    if (![...headers.values()].includes("orderNumber")) throw new BadRequestException("接单汇总缺少订单号字段");
    const rows: Record<string, unknown>[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 3) return;
      const record: Record<string, unknown> = {};
      for (const [column, field] of headers) {
        const cell = row.getCell(column);
        const cellValue: any = cell.value;
        record[field] = cellValue && typeof cellValue === "object" && "result" in cellValue
          ? cellValue.result
          : cellValue && typeof cellValue === "object" && "richText" in cellValue
            ? cellValue.richText.map((part: { text?: string }) => part.text ?? "").join("")
            : cellValue && typeof cellValue === "object" && "text" in cellValue
              ? cellValue.text
              : cellValue;
      }
      if (Object.values(record).some((value) => value !== null && value !== undefined && value !== "")) rows.push(record);
      record.__row = rowNumber;
    });
    return this.plans.importOrders(rows, req.user, req.requestId);
  }
  @Patch("orders/:id") updateOrder(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() req: UserRequest) { requireTablePermission(req, "rolling-plan", "update"); return this.plans.updateOrder(id, body, req.user, req.requestId); }
  @Post("orders/delete") deleteOrders() { throw new ForbiddenException("销售接单汇总不允许手工删除"); }
  @Post("rows/import") importRows(@Body() body: { rows: Array<{ year: number; month: number; orderNumber: string; itemNumber: string; itemName?: string; customer?: string; division?: string }> }, @Req() req: UserRequest) { requireTablePermission(req, "monthly-plan", "import"); return this.plans.importPlanRows(body.rows, req.user, req.requestId); }
  @Post("items") createItem(@Body() body: { year: number; month: number; orderNumber: string; itemNumber: string; itemName?: string; customer?: string; division?: string }, @Req() req: UserRequest) { requireTablePermission(req, "monthly-plan", "create"); return this.plans.createItem(body, req.user, req.requestId); }
  @Post("items/delete") deleteItems() { throw new ForbiddenException("月度计划不允许手工删除"); }
  @Post("items/move")
  moveItems(
    @Body() body: { ids: string[]; targetYear: number; targetMonth: number },
    @Req() req: UserRequest
  ) {
    requireTablePermission(req, "monthly-plan", "update");
    return this.plans.moveItems(body.ids, body.targetYear, body.targetMonth, req.user, req.requestId);
  }
  @Patch("items/:id/cell")
  update(@Param("id") id: string, @Body() body: { field: string; value: unknown; expectedVersion: number }, @Req() req: UserRequest) {
    requireTablePermission(req, "monthly-plan", "update");
    return this.plans.updateCell(id, body, req.user, req.requestId);
  }
  @Post("items/bulk")
  bulkUpdate(@Body() body: { updates: Array<{ id: string; field: string; value: unknown; expectedVersion: number }> }, @Req() req: UserRequest) {
    requireTablePermission(req, "monthly-plan", "update");
    const idempotencyKey = req.headers["idempotency-key"];
    return this.plans.bulkUpdate(body.updates, req.user, req.requestId, typeof idempotencyKey === "string" ? idempotencyKey : "");
  }
  @Post("items/:id/images")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadImage(@Param("id") id: string, @UploadedFile() image: Express.Multer.File, @Req() req: UserRequest) {
    requireTablePermission(req, "monthly-plan", "update");
    return this.storage.addImages(id, image ? [image] : [], req.user, req.requestId);
  }
  @Get("monthly/export")
  async exportMonthly(
    @Query("year", ParseIntPipe) year: number, @Query("month", ParseIntPipe) month: number,
    @Req() req: UserRequest, @Res() response: Response
  ) {
    requireTablePermission(req, "monthly-plan", "export");
    const result = await this.plans.monthly(year, month, req.user);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`${month}月计划`, { views: [{ state: "frozen", xSplit: 12, ySplit: 2 }] });
    sheet.addRow(monthlyPlanColumns.map((column) => column.group ?? column.header));
    sheet.addRow(monthlyPlanColumns.map((column) => column.group ? column.header : ""));
    for (const row of result.rows) sheet.addRow(monthlyPlanColumns.map((column) => {
      const parts = column.key.split(".");
      return parts.reduce((value: any, part) => value?.[part], row as any) ?? null;
    }));
    let groupStart = 1;
    for (let col = 2; col <= monthlyPlanColumns.length + 1; col++) {
      const previous = monthlyPlanColumns[col - 2]?.group ?? null;
      const current = monthlyPlanColumns[col - 1]?.group ?? null;
      if (current !== previous) {
        if (previous && col - groupStart > 1) sheet.mergeCells(1, groupStart, 1, col - 1);
        groupStart = col;
      }
    }
    if (monthlyPlanColumns.at(-1)?.group && monthlyPlanColumns.length + 1 - groupStart > 0) sheet.mergeCells(1, groupStart, 1, monthlyPlanColumns.length);
    sheet.getRows(1, 2)?.forEach((row) => { row.font = { bold: true, color: { argb: "FFFFFFFF" } }; row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4B70" } }; });
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${year}-${month}月计划.xlsx`)}`);
    await workbook.xlsx.write(response);
    response.end();
  }
}

@ApiTags("导入")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("imports")
export class ImportController {
  constructor(private readonly imports: ImportService) {}
  @Post("preview")
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" }, year: { type: "integer" }, month: { type: "integer" } } } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 200 * 1024 * 1024 } }))
  preview(@UploadedFile() file: Express.Multer.File, @Body() body: { year: string; month: string }, @Req() req: UserRequest) {
    requireTablePermission(req, "monthly-plan", "import");
    return this.imports.preview(file, Number(body.year), Number(body.month), req.user.sub);
  }
  @Post(":id/confirm") confirm(@Param("id") id: string, @Req() req: UserRequest) { requireTablePermission(req, "monthly-plan", "import"); return this.imports.confirm(id); }
}

@ApiTags("基础资料")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("master-data")
export class MasterDataController {
  constructor(
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(DictionaryType) private readonly dictionaryTypes: Repository<DictionaryType>,
    @InjectRepository(DictionaryValue) private readonly dictionaryValues: Repository<DictionaryValue>,
    @InjectRepository(ProcessDefinitionEntity) private readonly processes: Repository<ProcessDefinitionEntity>,
    @InjectRepository(SalesOrder) private readonly salesOrders: Repository<SalesOrder>,
    @InjectRepository(FinishedGoodsInbound) private readonly finishedGoodsInbound: Repository<FinishedGoodsInbound>,
    private readonly imports: ImportService,
    private readonly dataSource: DataSource
  ) {}
  private enabledValue(value: unknown) { return !["false", "0", "否", "停用", "禁用"].includes(String(value ?? "是").trim().toLowerCase()); }
  private csvRows(buffer: Buffer): Record<string, unknown>[] {
    const lines = buffer.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    const parse = (line: string) => { const values: string[] = []; let current = ""; let quoted = false; for (let i = 0; i < line.length; i++) { const char = line[i]!; if (char === '"' && line[i + 1] === '"') { current += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { values.push(current.trim()); current = ""; } else current += char; } values.push(current.trim()); return values; };
    const headers = parse(lines.shift() ?? "");
    return lines.map((line, rowIndex) => ({
      ...Object.fromEntries(parse(line).map((value, index) => [headers[index], value])), __row: rowIndex + 2
    }));
  }
  private async uploadedRows(file: Express.Multer.File): Promise<Record<string, unknown>[]> {
    if (!file?.buffer) throw new BadRequestException("请选择 CSV 或 XLSX 文件");
    if (file.originalname.toLowerCase().endsWith(".csv")) return this.csvRows(file.buffer);
    const workbook = await this.imports.loadWorkbook(file);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Excel 中没有工作表");
    const headers = sheet.getRow(1).values as unknown[];
    const rows: Record<string, unknown>[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: Record<string, unknown> = {};
      for (let column = 1; column < headers.length; column++) record[String(headers[column] ?? "").trim()] = row.getCell(column).text.trim();
      if (Object.values(record).some((value) => value !== "")) rows.push({ ...record, __row: rowNumber });
    });
    return rows;
  }
  @Get("templates/:kind")
  async downloadTemplate(@Param("kind") kind: string, @Query("format") format: string, @Req() req: UserRequest, @Res() response: Response) {
    const names: Record<string, string> = {
      suppliers: "供应商导入模板",
      dictionaries: "字典导入模板",
      "sales-orders": "销售订单导入模板",
      "finished-goods-inbound": "成品入库导入模板"
    };
    const baseName = names[kind];
    if (!baseName) throw new BadRequestException("未知模板类型");
    const resourceByKind: Record<string, string> = { suppliers: "suppliers", dictionaries: "dictionaries", "sales-orders": "sales-orders", "finished-goods-inbound": "finished-goods-inbound" };
    if (["suppliers", "dictionaries", "processes"].includes(kind)) requireSystemAdmin(req);
    else requireTablePermission(req, resourceByKind[kind]!, "import");
    const extension = format === "csv" ? "csv" : "xlsx";
    const dynamicHeaders: Record<string, string[]> = {
      "sales-orders": salesOrderImportFields.map((field) => field.headers[0]!),
      "finished-goods-inbound": [
        "分类编号", "入库单单号", "单据全称", "单据日期", "入库日期", "序号", "工单单号", "销售单号",
        "产品品号", "快捷码", "品名", "规格", "允收数量", "业务单位", "类别"
      ]
    };
    const headers = dynamicHeaders[kind];
    if (headers) {
      response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${baseName}.${extension}`)}`);
      if (extension === "csv") {
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.send(`\uFEFF${headers.join(",")}\r\n`);
        return;
      }
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(kind === "sales-orders" ? "销售订单" : "入库数据");
      sheet.addRow(headers);
      for (let index = 0; index < 100; index++) sheet.addRow([]);
      sheet.getRow(1).font = kind === "sales-orders"
        ? { name: "微软雅黑", size: 10, bold: true, color: { argb: "FFFFFFFF" } }
        : { name: "新宋体", size: 9, bold: true, color: { argb: "FF000000" } };
      sheet.getRow(1).fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: kind === "sales-orders" ? "FF1F4B70" : "FFF2F2F2" }
      };
      sheet.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
      if (kind === "finished-goods-inbound") {
        sheet.getColumn("D").numFmt = "yyyy-mm-dd";
        sheet.getColumn("E").numFmt = "yyyy-mm-dd";
        sheet.getColumn("F").numFmt = "0";
        sheet.getColumn("M").numFmt = "0.####";
        const widths = [12, 22, 20, 15, 15, 8, 22, 22, 22, 12, 24, 18, 14, 12, 12];
        widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
      } else {
        for (const [index, field] of salesOrderImportFields.entries()) {
          if (field.kind === "date") sheet.getColumn(index + 1).numFmt = "yyyy-mm-dd";
          if (field.kind === "number") sheet.getColumn(index + 1).numFmt = "0.######";
          if (field.kind === "integer") sheet.getColumn(index + 1).numFmt = "0";
          sheet.getColumn(index + 1).width = field.property === "itemName" ? 28 : 18;
        }
      }
      for (let row = 1; row <= 101; row++) {
        sheet.getRow(row).height = kind === "sales-orders" ? 20 : 18;
        for (let column = 1; column <= headers.length; column++) {
          const cell = sheet.getCell(row, column);
          cell.border = {
            top: { style: "thin", color: { argb: "FF7F7F7F" } },
            bottom: { style: "thin", color: { argb: "FF7F7F7F" } },
            left: { style: "thin", color: { argb: "FF7F7F7F" } },
            right: { style: "thin", color: { argb: "FF7F7F7F" } }
          };
        }
      }
      response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await workbook.xlsx.write(response);
      response.end();
      return;
    }
    const templatePath = path.resolve(__dirname, "../../../data/templates", `${baseName}.${extension}`);
    const content = await fs.readFile(templatePath);
    response.setHeader("Content-Type", extension === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${baseName}.${extension}`)}`);
    response.send(content);
  }
  @Get("suppliers") listSuppliers(@Req() req: UserRequest) { requireSystemAdmin(req); return this.suppliers.find({ order: { name: "ASC" } }); }
  @Post("suppliers") async addSupplier(@Body() body: { code: string; name: string; remark?: string; enabled?: boolean }, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const code = body.code?.trim();
    if (!code || !body.name?.trim()) throw new BadRequestException("供应商编码和名称为必填项");
    if (await this.suppliers.findOneBy({ code })) throw new ConflictException("供应商编码已存在");
    return this.suppliers.save({ code, name: body.name.trim(), remark: body.remark ?? null, enabled: body.enabled ?? true });
  }
  @Patch("suppliers/:id") async updateSupplier(@Param("id") id: string, @Body() body: { code?: string; name?: string; remark?: string; enabled?: boolean }, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    if (body.code !== undefined) {
      const code = body.code.trim(); if (!code) throw new BadRequestException("供应商编码不能为空");
      const duplicate = await this.suppliers.findOneBy({ code }); if (duplicate && duplicate.id !== id) throw new ConflictException("供应商编码已存在"); body.code = code;
    }
    return this.suppliers.update(id, body);
  }
  @Post("suppliers/delete") async deleteSuppliers(@Body() body: { ids: string[] }, @Req() req: UserRequest) { requireSystemAdmin(req); await this.suppliers.update(body.ids, { enabled: false }); return { affected: body.ids?.length ?? 0 }; }
  @Post("suppliers/import") async importSuppliers(@Body() body: { rows: Array<{ code?: string; name: string; remark?: string; enabled?: boolean }> }, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const errors: string[] = []; const seen = new Set<string>();
    for (const [index, row] of (body.rows ?? []).entries()) {
      const code = row.code?.trim(); const line = Number((row as any).__row) || index + 2;
      if (!code || !row.name?.trim()) errors.push(`第 ${line} 行：供应商编码和名称不能为空`);
      else if (seen.has(code)) errors.push(`第 ${line} 行：供应商编码“${code}”在文件内重复`); else seen.add(code);
    }
    if (!body.rows?.length) errors.push("文件中没有可导入的数据行");
    if (errors.length) throw new BadRequestException({ message: `导入校验失败，共 ${errors.length} 处错误，未写入任何数据`, errors });
    await this.dataSource.transaction(async (manager) => {
      for (const row of body.rows) await manager.createQueryBuilder().insert().into(Supplier).values({ code: row.code!.trim(), name: row.name.trim(), remark: row.remark?.trim() || null, enabled: row.enabled ?? true, updatedBy: currentModificationActor() }).orUpdate(["name", "remark", "enabled", "updated_by"], ["code"]).execute();
    });
    return { imported: body.rows.length, skipped: 0, message: `全部校验通过，成功导入 ${body.rows.length} 行` };
  }
  @Post("suppliers/import-file") @ApiConsumes("multipart/form-data") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
  async importSupplierFile(@UploadedFile() file: Express.Multer.File, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const raw = await this.uploadedRows(file);
    return this.importSuppliers({ rows: raw.map((row: any) => ({ code: row.code ?? row["编码"], name: row.name ?? row["名称"], remark: row.remark ?? row["备注"], enabled: this.enabledValue(row.enabled ?? row["是否启用"]), __row: row.__row })) as any }, req);
  }
  @Get("dictionaries") async dictionaries(@Req() req: UserRequest) {
    requireSystemAdmin(req);
    const types = await this.dictionaryTypes.find();
    const values = await this.dictionaryValues.find({ order: { sortOrder: "ASC" } });
    return types.map((type) => ({ ...type, values: values.filter((value) => value.typeId === type.id) }));
  }
  @Post("dictionaries/import") async importDictionaries(@Body() body: { rows: Array<{ code: string; name?: string; value: string }> }, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const errors: string[] = []; const seen = new Set<string>();
    for (const [index, row] of (body.rows ?? []).entries()) {
      const code = row.code?.trim(); const value = row.value?.trim(); const line = Number((row as any).__row) || index + 2;
      if (!code || !value) errors.push(`第 ${line} 行：字典编码和字典值不能为空`);
      else if (seen.has(`${code}\u0000${value}`)) errors.push(`第 ${line} 行：字典编码/值“${code}/${value}”在文件内重复`); else seen.add(`${code}\u0000${value}`);
    }
    if (!body.rows?.length) errors.push("文件中没有可导入的数据行");
    if (errors.length) throw new BadRequestException({ message: `导入校验失败，共 ${errors.length} 处错误，未写入任何数据`, errors });
    await this.dataSource.transaction(async (manager) => {
      for (const row of body.rows) {
        const code = row.code.trim();
        let type = await manager.findOneBy(DictionaryType, { code });
        type ??= await manager.save(DictionaryType, { code, name: row.name?.trim() || code });
        await manager.createQueryBuilder().insert().into(DictionaryValue).values({ typeId: type.id, value: row.value.trim(), sortOrder: 0, enabled: true }).orIgnore().execute();
      }
    });
    return { imported: body.rows.length, skipped: 0, message: `全部校验通过，成功导入 ${body.rows.length} 行` };
  }
  @Post("dictionaries/import-file") @ApiConsumes("multipart/form-data") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
  async importDictionaryFile(@UploadedFile() file: Express.Multer.File, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const raw = await this.uploadedRows(file);
    return this.importDictionaries({ rows: raw.map((row: any) => ({ code: row.code ?? row["字典编码"], name: row.name ?? row["字典名称"], value: row.value ?? row["字典值"], __row: row.__row })) as any }, req);
  }
  @Post("dictionaries") async addDictionaryValue(@Body() body: { code: string; name?: string; value: string }, @Req() req: UserRequest) { return this.importDictionaries({ rows: [body] }, req); }
  @Patch("dictionary-types/:id") updateDictionaryType(@Param("id") id: string, @Body() body: { code?: string; name?: string }, @Req() req: UserRequest) { requireSystemAdmin(req); return this.dictionaryTypes.update(id, body); }
  @Patch("dictionary-values/:id") updateDictionaryValue(@Param("id") id: string, @Body() body: { value?: string; sortOrder?: number; enabled?: boolean }, @Req() req: UserRequest) { requireSystemAdmin(req); return this.dictionaryValues.update(id, body); }
  @Post("dictionary-values/delete") async deleteDictionaryValues(@Body() body: { ids: string[] }, @Req() req: UserRequest) { requireSystemAdmin(req); await this.dictionaryValues.update(body.ids, { enabled: false }); return { affected: body.ids?.length ?? 0 }; }
  @Get("processes") processesList(@Req() req: UserRequest) { requireSystemAdmin(req); return this.processes.find({ order: { sortOrder: "ASC" } }); }
  @Post("processes") addProcess(@Body() body: Partial<ProcessDefinitionEntity>, @Req() req: UserRequest) { requireSystemAdmin(req); return this.processes.save({ ...body, enabled: body.enabled ?? true }); }
  @Patch("processes/:id") updateProcess(@Param("id") id: string, @Body() body: Partial<ProcessDefinitionEntity>, @Req() req: UserRequest) { requireSystemAdmin(req); return this.processes.update(id, body); }
  @Post("processes/delete") async deleteProcesses(@Body() body: { ids: string[] }, @Req() req: UserRequest) { requireSystemAdmin(req); await this.processes.update(body.ids, { enabled: false }); return { affected: body.ids?.length ?? 0 }; }
  @Post("processes/import") async importProcesses(@Body() body: { rows: Array<Partial<ProcessDefinitionEntity>> }, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const errors: string[] = []; const seen = new Set<string>();
    for (const [index, row] of (body.rows ?? []).entries()) {
      const line = Number((row as any).__row) || index + 2; const code = row.code?.trim();
      if (!code || !row.name?.trim()) errors.push(`第 ${line} 行：工序编码和名称不能为空`);
      else if (seen.has(code)) errors.push(`第 ${line} 行：工序编码“${code}”在文件内重复`); else seen.add(code);
      if (row.sortOrder !== undefined && !Number.isFinite(Number(row.sortOrder))) errors.push(`第 ${line} 行：排序必须为数字`);
    }
    if (!body.rows?.length) errors.push("文件中没有可导入的数据行");
    if (errors.length) throw new BadRequestException({ message: `导入校验失败，共 ${errors.length} 处错误，未写入任何数据`, errors });
    await this.dataSource.transaction(async (manager) => {
      for (const row of body.rows) await manager.createQueryBuilder().insert().into(ProcessDefinitionEntity).values({ ...row, enabled: row.enabled ?? true, updatedBy: currentModificationActor() }).orUpdate(["name", "sort_order", "enable_required_days", "enable_due_date", "enable_status", "enable_exception", "enabled", "updated_by"], ["code"]).execute();
    });
    return { imported: body.rows.length, skipped: 0, message: `全部校验通过，成功导入 ${body.rows.length} 行` };
  }

  private text(value: unknown) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
  }
  private date(value: unknown) {
    const normalized = this.text(value);
    if (!normalized) return null;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  private dateTime(value: unknown) {
    const normalized = this.text(value);
    if (!normalized) return null;
    const parsed = new Date(normalized.replace(" ", "T"));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  private numeric(value: unknown) {
    const normalized = this.text(value)?.replace(/,/g, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? String(parsed) : null;
  }
  private importValueErrors(value: unknown, kind: "date" | "datetime" | "number", field: string, line: number) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    if (kind === "number" && !Number.isFinite(Number(String(value).replace(/,/g, "")))) return `第 ${line} 行：${field}必须为数字`;
    if (kind === "date" && !this.date(value)) return `第 ${line} 行：${field}日期格式无效，应为 YYYY-MM-DD`;
    if (kind === "datetime" && !this.dateTime(value)) return `第 ${line} 行：${field}时间格式无效`;
    return null;
  }

  private salesOrderValue(row: Record<string, unknown>, property: keyof SalesOrder, headers: string[]) {
    if (row[property] !== undefined) return row[property];
    for (const header of headers) if (row[header] !== undefined) return row[header];
    return undefined;
  }
  private salesOrderRow(row: Record<string, unknown>) {
    const result: Record<string, unknown> = {};
    for (const field of salesOrderImportFields) {
      const value = this.salesOrderValue(row, field.property, field.headers);
      result[field.property] = field.kind === "date" ? this.date(value)
        : field.kind === "number" ? this.numeric(value)
          : field.kind === "integer" ? (this.numeric(value) === null ? null : Number(this.numeric(value)))
            : this.text(value);
    }
    result.quantity = result.businessQuantity;
    result.reviewDueDate = result.plannedDeliveryDate;
    result.remark = this.text(row.remark ?? row["备注"]);
    return result as Partial<SalesOrder> & { orderNumber: string | null; itemNumber: string | null; sequenceNumber: number | null };
  }

  @Get("sales-orders")
  listSalesOrders(@Req() req: UserRequest) {
    requireTablePermission(req, "sales-orders", "read");
    return this.salesOrders.find({ order: { orderDate: "DESC", orderNumber: "ASC", itemNumber: "ASC" } });
  }
  @Post("sales-orders")
  async addSalesOrder(@Body() body: Partial<SalesOrder>, @Req() req: UserRequest) {
    requireTablePermission(req, "sales-orders", "create");
    const row = this.salesOrderRow(body as Record<string, unknown>);
    if (!row.orderNumber || !row.itemNumber) throw new BadRequestException("订单编号和品项编码为必填项");
    const duplicate = await this.salesOrders.createQueryBuilder("salesOrder").where("salesOrder.orderNumber=:orderNumber", { orderNumber: row.orderNumber }).andWhere("salesOrder.itemNumber=:itemNumber", { itemNumber: row.itemNumber }).andWhere(row.sequenceNumber === null ? "salesOrder.sequenceNumber IS NULL" : "salesOrder.sequenceNumber=:sequenceNumber", { sequenceNumber: row.sequenceNumber }).getOne();
    if (duplicate) throw new ConflictException("该订单编号、品项编码和序号已存在");
    return this.salesOrders.save(row as SalesOrder);
  }
  @Patch("sales-orders/:id")
  async updateSalesOrder(@Param("id") id: string, @Body() body: Partial<SalesOrder>, @Req() req: UserRequest) {
    requireTablePermission(req, "sales-orders", "update");
    const current = await this.salesOrders.findOneBy({ id });
    if (!current) throw new BadRequestException("销售订单不存在");
    const next = this.salesOrderRow({ ...current, ...body } as Record<string, unknown>);
    if (!next.orderNumber || !next.itemNumber) throw new BadRequestException("订单编号和品项编码为必填项");
    const duplicate = await this.salesOrders.createQueryBuilder("salesOrder").where("salesOrder.orderNumber=:orderNumber", { orderNumber: next.orderNumber }).andWhere("salesOrder.itemNumber=:itemNumber", { itemNumber: next.itemNumber }).andWhere(next.sequenceNumber === null ? "salesOrder.sequenceNumber IS NULL" : "salesOrder.sequenceNumber=:sequenceNumber", { sequenceNumber: next.sequenceNumber }).getOne();
    if (duplicate && duplicate.id !== id) throw new ConflictException("该订单号和品号已存在");
    await this.salesOrders.update(id, next);
    return this.salesOrders.findOneByOrFail({ id });
  }
  @Post("sales-orders/import-file") @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
  async importSalesOrders(@UploadedFile() file: Express.Multer.File, @Req() req: UserRequest) {
    requireTablePermission(req, "sales-orders", "import");
    const rows = await this.uploadedRows(file);
    const errors: string[] = []; const prepared: any[] = []; const seen = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const line = Number(row.__row) || index + 2;
      const normalized = this.salesOrderRow(row);
      if (!normalized.orderNumber || !normalized.itemNumber) errors.push(`第 ${line} 行：DOC_NO/ITEM_CODE 为必填项`);
      const key = `${normalized.orderNumber}\u0000${normalized.itemNumber}\u0000${normalized.sequenceNumber ?? ""}`;
      if (seen.has(key)) errors.push(`第 ${line} 行：订单编号/品项编码/序号在文件内重复`); else seen.add(key);
      for (const field of salesOrderImportFields) {
        const value = this.salesOrderValue(row, field.property, field.headers);
        if (field.kind === "date") { const error = this.importValueErrors(value, "date", field.headers[0]!, line); if (error) errors.push(error); }
        if (field.kind === "number" || field.kind === "integer") { const error = this.importValueErrors(value, "number", field.headers[0]!, line); if (error) errors.push(error); }
      }
      prepared.push(normalized);
    }
    if (!rows.length) errors.push("文件中没有可导入的数据行");
    if (errors.length) throw new BadRequestException({ message: `导入校验失败，共 ${errors.length} 处错误，未写入任何数据`, errors });
    await this.dataSource.transaction(async (manager) => {
      for (const row of prepared) await manager.createQueryBuilder().insert().into(SalesOrder).values({ ...row, updatedBy: currentModificationActor() }).orUpdate(
        salesOrderImportFields.filter((field) => !["orderNumber", "itemNumber", "sequenceNumber"].includes(field.property)).map((field) => this.salesOrders.metadata.findColumnWithPropertyName(String(field.property))!.databaseName).concat(["quantity", "review_due_date", "updated_by"]),
        ["order_number", "item_number", "sequence_number"]
      ).execute();
    });
    return { imported: prepared.length, skipped: 0, message: `全部校验通过，成功导入 ${prepared.length} 行` };
  }

  @Get("finished-goods-inbound")
  listFinishedGoodsInbound(@Req() req: UserRequest) {
    requireTablePermission(req, "finished-goods-inbound", "read");
    return this.finishedGoodsInbound.find({ order: { inboundDate: "DESC", documentNumber: "ASC", lineNumber: "ASC" } });
  }
  @Get("finished-goods-inbound/export")
  async exportFinishedGoodsInbound(@Query("format") format: string, @Req() req: UserRequest, @Res() response: Response) {
    requireTablePermission(req, "finished-goods-inbound", "export");
    const rows = await this.finishedGoodsInbound.find({
      order: { inboundDate: "DESC", documentNumber: "ASC", lineNumber: "ASC" }
    });
    const fields: Array<[keyof FinishedGoodsInbound, string]> = [
      ["categoryNumber", "分类编号"], ["documentNumber", "入库单单号"], ["documentFullName", "单据全称"],
      ["documentDate", "单据日期"], ["inboundDate", "入库日期"], ["lineNumber", "序号"],
      ["workOrderNumber", "工单单号"], ["salesOrderNumber", "销售单号"], ["inventoryCode", "产品品号"],
      ["quickCode", "快捷码"], ["inventoryName", "品名"], ["specification", "规格"],
      ["receivedQuantity", "允收数量"], ["unit", "业务单位"], ["category", "类别"]
    ];
    const extension = format === "csv" ? "csv" : "xlsx";
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`成品入库数据.${extension}`)}`);
    if (extension === "csv") {
      const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const lines = [fields.map(([, header]) => escape(header)).join(",")];
      for (const row of rows) {
        lines.push(fields.map(([field]) => {
          const value = row[field];
          return escape(value instanceof Date ? value.toISOString().replace("T", " ").slice(0, 19) : value);
        }).join(","));
      }
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.send(`\uFEFF${lines.join("\r\n")}`);
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("入库数据", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(fields.map(([, header]) => header));
    const numericFields = new Set<keyof FinishedGoodsInbound>(["receivedQuantity", "unitPrice", "totalAmount"]);
    for (const row of rows) sheet.addRow(fields.map(([field]) => {
      const value = row[field];
      if (field === "documentDate" && value) return new Date(`${value}T00:00:00`);
      if (numericFields.has(field) && value !== null && value !== undefined && value !== "") return Number(value);
      return value ?? null;
    }));
    sheet.autoFilter = { from: "A1", to: "O1" };
    sheet.getRow(1).font = { name: "新宋体", size: 9, bold: true };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    sheet.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getColumn("D").numFmt = "yyyy-mm-dd";
    sheet.getColumn("E").numFmt = "yyyy-mm-dd";
    sheet.getColumn("M").numFmt = "0.####";
    const widths = [12, 22, 20, 15, 15, 8, 22, 22, 22, 12, 24, 18, 14, 12, 12];
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await workbook.xlsx.write(response);
    response.end();
  }
  @Post("finished-goods-inbound")
  async addFinishedGoodsInbound(@Body() body: Partial<FinishedGoodsInbound>, @Req() req: UserRequest) {
    requireTablePermission(req, "finished-goods-inbound", "create");
    const row = this.finishedGoodsRow(body as Record<string, unknown>);
    if (!row.documentNumber || !row.inventoryCode || !row.relationInfo) {
      throw new BadRequestException("单据编号、存货编码和关联信息为必填项");
    }
    if (await this.finishedGoodsInbound.findOneBy({
      documentNumber: row.documentNumber, inventoryCode: row.inventoryCode, relationInfo: row.relationInfo
    })) throw new ConflictException("该成品入库记录已存在");
    return this.finishedGoodsInbound.save(row);
  }
  @Patch("finished-goods-inbound/:id")
  async updateFinishedGoodsInbound(@Param("id") id: string, @Body() body: Partial<FinishedGoodsInbound>, @Req() req: UserRequest) {
    requireTablePermission(req, "finished-goods-inbound", "update");
    const current = await this.finishedGoodsInbound.findOneBy({ id });
    if (!current) throw new BadRequestException("成品入库记录不存在");
    const normalized = this.finishedGoodsRow({ ...current, ...body });
    if (!normalized.documentNumber || !normalized.inventoryCode || !normalized.relationInfo) {
      throw new BadRequestException("单据编号、存货编码和关联信息为必填项");
    }
    const duplicate = await this.finishedGoodsInbound.findOneBy({
      documentNumber: normalized.documentNumber,
      inventoryCode: normalized.inventoryCode,
      relationInfo: normalized.relationInfo
    });
    if (duplicate && duplicate.id !== id) throw new ConflictException("该成品入库记录已存在");
    await this.finishedGoodsInbound.update(id, normalized);
    return this.finishedGoodsInbound.findOneByOrFail({ id });
  }
  @Post("finished-goods-inbound/import-file") @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 100 * 1024 * 1024 } }))
  async importFinishedGoodsInbound(@UploadedFile() file: Express.Multer.File, @Req() req: UserRequest) {
    requireTablePermission(req, "finished-goods-inbound", "import");
    const rows = await this.uploadedRows(file);
    const errors: string[] = []; const prepared: any[] = []; const seen = new Set<string>();
    for (const [index, source] of rows.entries()) {
      const line = Number(source.__row) || index + 2;
      const row = this.finishedGoodsRow(source);
      if (!row.documentNumber || !row.inventoryCode || !row.relationInfo) errors.push(`第 ${line} 行：单据编号、存货编码和关联信息为必填项`);
      const key = `${row.documentNumber}\u0000${row.inventoryCode}\u0000${row.relationInfo}`;
      if (seen.has(key)) errors.push(`第 ${line} 行：单据编号/存货编码/关联信息在文件内重复`); else seen.add(key);
      for (const error of [
        this.importValueErrors(source.documentDate ?? source["单据日期"], "date", "单据日期", line),
        this.importValueErrors(source.inboundDate ?? source["入库日期"], "date", "入库日期", line),
        this.importValueErrors(source.lineNumber ?? source["序号"], "number", "序号", line),
        this.importValueErrors(source.receivedQuantity ?? source["允收数量"] ?? source["实收数量"], "number", "允收数量", line)
      ]) if (error) errors.push(error);
      prepared.push(row);
    }
    if (!rows.length) errors.push("文件中没有可导入的数据行");
    if (errors.length) throw new BadRequestException({ message: `导入校验失败，共 ${errors.length} 处错误，未写入任何数据`, errors });
    await this.dataSource.transaction(async (manager) => {
      for (const row of prepared) await manager.createQueryBuilder().insert().into(FinishedGoodsInbound).values({ ...row, updatedBy: currentModificationActor() }).orUpdate([
        "category_number", "document_full_name", "inbound_date", "line_number", "work_order_number", "quick_code", "category",
        "sales_order_number", "document_date", "created_time", "business_type", "warehouse_code",
        "warehouse", "inbound_category", "workshop_code", "workshop", "handler_code", "handler",
        "remark", "creator", "auditor", "inventory_name", "specification", "unit",
        "received_quantity", "unit_price", "total_amount", "voucher_word", "updated_by"
      ], ["document_number", "inventory_code", "relation_info"]).execute();
    });
    return { imported: prepared.length, skipped: 0, message: `全部校验通过，成功导入 ${prepared.length} 行` };
  }
  private finishedGoodsRow(row: Record<string, unknown>): Omit<FinishedGoodsInbound, "id" | "createdAt" | "updatedAt" | "updatedBy"> {
    const lineNumberValue = this.numeric(row.lineNumber ?? row["序号"]);
    const workOrderNumber = this.text(row.workOrderNumber ?? row["工单单号"]);
    return {
      categoryNumber: this.text(row.categoryNumber ?? row["分类编号"]),
      salesOrderNumber: this.text(row.salesOrderNumber ?? row["销售单号"] ?? row["销售订单号"]),
      documentFullName: this.text(row.documentFullName ?? row["单据全称"]),
      documentDate: this.date(row.documentDate ?? row["单据日期"]),
      inboundDate: this.date(row.inboundDate ?? row["入库日期"]),
      lineNumber: lineNumberValue === null ? null : Number(lineNumberValue),
      workOrderNumber,
      createdTime: this.dateTime(row.createdTime ?? row["创建时间"]),
      documentNumber: this.text(row.documentNumber ?? row["入库单单号"] ?? row["单据编号"]) ?? "",
      businessType: this.text(row.businessType ?? row["业务类型"]),
      warehouseCode: this.text(row.warehouseCode ?? row["仓库编码"]),
      warehouse: this.text(row.warehouse ?? row["仓库"]),
      inboundCategory: this.text(row.inboundCategory ?? row["入库类别"]),
      workshopCode: this.text(row.workshopCode ?? row["生产车间编码"]),
      workshop: this.text(row.workshop ?? row["生产车间"]),
      handlerCode: this.text(row.handlerCode ?? row["经手人编码"]),
      handler: this.text(row.handler ?? row["经手人"]),
      remark: this.text(row.remark ?? row["备注"]),
      creator: this.text(row.creator ?? row["制单人"]),
      auditor: this.text(row.auditor ?? row["审核人"]),
      inventoryCode: this.text(row.inventoryCode ?? row["产品品号"] ?? row["存货编码"]) ?? "",
      quickCode: this.text(row.quickCode ?? row["快捷码"]),
      inventoryName: this.text(row.inventoryName ?? row["品名"] ?? row["存货"]),
      specification: this.text(row.specification ?? row["规格"] ?? row["规格型号"]),
      unit: this.text(row.unit ?? row["业务单位"] ?? row["计量单位"]),
      relationInfo: this.text(row.relationInfo ?? row["关联信息"]) ?? `${workOrderNumber ?? ""}|${lineNumberValue ?? ""}`,
      receivedQuantity: this.numeric(row.receivedQuantity ?? row["允收数量"] ?? row["实收数量"]),
      unitPrice: this.numeric(row.unitPrice ?? row["单价"]),
      totalAmount: this.numeric(row.totalAmount ?? row["总金额"]),
      voucherWord: this.text(row.voucherWord ?? row["凭证字号"]),
      category: this.text(row.category ?? row["类别"])
    };
  }
}

@ApiTags("审计")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("audit-logs")
export class AuditController {
  constructor(@InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>) {}
  @Get()
  list(@Query("user") user: string | undefined, @Query("action") action: string | undefined, @Query("order") order: string | undefined, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const query = this.audits.createQueryBuilder("a").orderBy("a.createdAt", "DESC").take(500);
    if (user) query.andWhere("a.actorName ILIKE :user", { user: `%${user}%` });
    if (action) query.andWhere("a.action = :action", { action });
    if (order) query.andWhere("a.afterJson::text ILIKE :order", { order: `%${order}%` });
    return query.getMany();
  }
}

@ApiTags("API Key")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("api-keys")
export class ApiKeyController {
  constructor(@InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>) {}

  @Get()
  async list(@Req() req: UserRequest) {
    requireSystemAdmin(req);
    const rows = await this.apiKeys.find({ order: { name: "ASC" } });
    return rows.map((row) => ({
      id: row.id, name: row.name, scopes: row.scopes, expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt, enabled: row.enabled, userId: row.userId, roleId: row.roleId,
      createdAt: row.createdAt, updatedAt: row.updatedAt, updatedBy: row.updatedBy
    }));
  }

  @Post()
  async create(@Body() body: { name: string; scopes: string[]; expiresAt?: string; userId?: string; roleId?: string }, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const secret = `fdt_${randomBytes(32).toString("base64url")}`;
    const apiKey = await this.apiKeys.save({
      name: body.name.trim(), keyHash: createHash("sha256").update(secret).digest("hex"),
      scopes: body.scopes?.length ? body.scopes : ["monthly-plan:*:read"],
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, lastUsedAt: null, enabled: true, userId: body.userId ?? null, roleId: body.roleId ?? null
    });
    return { id: apiKey.id, name: apiKey.name, apiKey: secret, message: "请立即保存该 API Key；系统不会再次显示。" };
  }

  @Post(":id/regenerate")
  async regenerate(@Param("id") id: string, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    const record = await this.apiKeys.findOneBy({ id });
    if (!record) throw new NotFoundException("API Key 记录不存在");
    const secret = `fdt_${randomBytes(32).toString("base64url")}`;
    record.keyHash = createHash("sha256").update(secret).digest("hex");
    record.enabled = true;
    record.lastUsedAt = null;
    await this.apiKeys.save(record);
    return { id: record.id, name: record.name, apiKey: secret, message: "API Key 已重新生成，旧 KEY 已失效。" };
  }

  @Patch(":id/disable")
  async disable(@Param("id") id: string, @Req() req: UserRequest) {
    requireSystemAdmin(req);
    await this.apiKeys.update(id, { enabled: false });
    return { status: "disabled" };
  }
}

@ApiTags("用户与权限")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("admin")
export class AdminController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(OrganizationUnit) private readonly organizationUnits: Repository<OrganizationUnit>,
    @InjectRepository(RoleOrganizationScope) private readonly organizationScopes: Repository<RoleOrganizationScope>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly imports: ImportService,
    private readonly dataSource: DataSource,
    private readonly adminQueries: AdminQueryService
  ) {}

  private admin(req: UserRequest) {
    requireSystemAdmin(req);
  }

  @Get("users")
  async listUsers(@Query("search") search: string | undefined, @Req() req: UserRequest) {
    this.admin(req);
    return this.adminQueries.listUsers(search);
  }

  @Get("roles")
  async listRoles(@Req() req: UserRequest) {
    this.admin(req);
    const [roles, permissions, userRoles, organizationScopes] = await Promise.all([this.roles.find({ order: { name: "ASC" } }), this.permissions.find(), this.userRoles.find(), this.organizationScopes.find()]);
    return roles.map((role) => ({ ...role, permissions: permissions.filter((permission) => permission.roleId === role.id), userIds: userRoles.filter((link) => link.roleId === role.id).map((link) => link.userId), organizationUnitIds: organizationScopes.filter((scope) => scope.roleId === role.id).map((scope) => scope.organizationUnitId) }));
  }

  @Get("organization-units")
  async listOrganizationUnits(@Req() req: UserRequest) {
    this.admin(req);
    return this.organizationUnits.find({ order: { level: "ASC", sortOrder: "ASC", name: "ASC" } });
  }

  @Get("contacts")
  async listContacts(@Req() req: UserRequest) {
    this.admin(req);
    return this.contacts.find({ order: { name: "ASC" } });
  }

  @Post("contacts/import-file")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
  async importContacts(@UploadedFile() file: Express.Multer.File, @Req() req: UserRequest) {
    this.admin(req);
    const workbook = await this.imports.loadWorkbook(file);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("通讯录文件中没有工作表");
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => headers.set(cell.text.trim(), column));
    const column = (name: string) => headers.get(name);
    const required = column("userid");
    if (!required) throw new BadRequestException("通讯录缺少 userid 字段");
    type ContactInput = { wechatUserId: string; employeeNo: string | null; name: string; position: string | null; telephone: string | null; directLeaders: string[]; paths: string[][]; enabled: boolean };
    const grouped = new Map<string, ContactInput>();
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const text = (name: string) => { const index = column(name); return index ? row.getCell(index).text.trim() : ""; };
      const wechatUserId = text("userid"); if (!wechatUserId) return;
      const path = ["部门1", "部门2", "部门3", "部门4", "部门5"].map(text).filter(Boolean).filter((value, index, values) => index === 0 || value !== values[index - 1]);
      const existing = grouped.get(wechatUserId);
      const leaders = (() => { try { const parsed = JSON.parse(text("direct_leader") || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } })();
      if (existing) { if (path.length && !existing.paths.some((candidate) => candidate.join("/") === path.join("/"))) existing.paths.push(path); existing.directLeaders = [...new Set([...existing.directLeaders, ...leaders])]; return; }
      grouped.set(wechatUserId, { wechatUserId, employeeNo: text("工号") || null, name: text("name") || wechatUserId, position: text("position") || null, telephone: text("telephone") || null, directLeaders: leaders, paths: path.length ? [path] : [], enabled: text("enable") !== "0" });
    });
    const whiteboard = await this.roles.findOneBy({ name: "白板" });
    for (const contact of grouped.values()) {
      await this.contacts.createQueryBuilder().insert().values({ ...contact, departmentPaths: contact.paths, updatedBy: currentModificationActor() }).orUpdate(["employee_no", "name", "position", "telephone", "direct_leaders", "department_paths", "enabled", "imported_at", "updated_by"], ["wechat_user_id"]).execute();
      if (!whiteboard) continue;
      const username = contact.employeeNo ?? contact.wechatUserId;
      let user = contact.employeeNo ? await this.users.findOneBy({ employeeNo: contact.employeeNo }) : await this.users.findOneBy({ username });
      if (!user && isPrimaryAdminUsername(username)) continue;
      if (!user) user = await this.users.save({ username, displayName: contact.name, passwordHash: await bcrypt.hash(DEFAULT_USER_PASSWORD, 12), enabled: contact.enabled, employeeNo: contact.employeeNo, wechatUserId: contact.wechatUserId, position: contact.position, departmentPaths: contact.paths, division: contact.paths[0]?.find((value) => value.includes("事业部")) ?? null, mustChangePassword: true, lastLoginAt: null });
      else { await this.users.update(user.id, { displayName: contact.name, enabled: contact.enabled, employeeNo: contact.employeeNo, wechatUserId: contact.wechatUserId, position: contact.position, departmentPaths: contact.paths }); }
      const assigned = await this.userRoles.find({ where: { userId: user.id } });
      const assignedRoles = assigned.length ? await this.roles.createQueryBuilder("r").where("r.id IN (:...ids)", { ids: assigned.map((link) => link.roleId) }).getMany() : [];
      if (!assignedRoles.some((role) => ["系统管理员", "集团管理员"].includes(role.name))) await this.userRoles.createQueryBuilder().insert().values({ userId: user.id, roleId: whiteboard.id }).orIgnore().execute();
    }
    return { imported: grouped.size, sourceRows: Math.max(0, sheet.rowCount - 1) };
  }

  @Post("organization-units")
  async createOrganizationUnit(@Body() body: { name: string; level: number; parentId?: string | null; division?: string | null; sortOrder?: number }, @Req() req: UserRequest) {
    this.admin(req);
    if (!body.name?.trim() || !Number.isInteger(Number(body.level)) || Number(body.level) < 1 || Number(body.level) > 5) throw new BadRequestException("组织名称必填，层级只能为 1 至 5 级");
    if (Number(body.level) > 1 && !body.parentId) throw new BadRequestException("第二级至第五级必须选择上级组织");
    if (body.parentId) {
      const parent = await this.organizationUnits.findOneBy({ id: body.parentId });
      if (!parent || parent.level !== Number(body.level) - 1) throw new BadRequestException("上级组织必须是相邻的上一级");
    }
    return this.organizationUnits.save({ name: body.name.trim(), level: Number(body.level), parentId: body.parentId ?? null, division: body.division?.trim() || null, sortOrder: Number(body.sortOrder ?? 0), enabled: true });
  }

  @Patch("organization-units/:id")
  async updateOrganizationUnit(@Param("id") id: string, @Body() body: Partial<OrganizationUnit>, @Req() req: UserRequest) {
    this.admin(req);
    const patch: Partial<OrganizationUnit> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.division !== undefined) patch.division = body.division || null;
    if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder);
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    return this.organizationUnits.update(id, patch);
  }

  @Delete("organization-units/:id")
  async deleteOrganizationUnit(@Param("id") id: string, @Req() req: UserRequest) {
    this.admin(req);
    return this.dataSource.transaction(async (manager) => {
      const all = await manager.find(OrganizationUnit);
      if (!all.some((unit) => unit.id === id)) throw new BadRequestException("组织单元不存在");
      const ids = new Set<string>([id]);
      let changed = true;
      while (changed) { changed = false; for (const unit of all) if (unit.parentId && ids.has(unit.parentId) && !ids.has(unit.id)) { ids.add(unit.id); changed = true; } }
      await manager.delete(RoleOrganizationScope, [...ids].map((organizationUnitId) => ({ organizationUnitId })));
      await manager.delete(OrganizationUnit, [...ids].map((unitId) => ({ id: unitId })));
      return { deleted: ids.size };
    });
  }

  @Post("users")
  async createUser(@Body() body: { username: string; displayName: string; password?: string; division?: string; roleIds: string[] }, @Req() req: UserRequest) {
    this.admin(req);
    const password = body.password || DEFAULT_USER_PASSWORD;
    if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(body.username) || !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) throw new ForbiddenException("用户名或密码不符合安全要求");
    if (isPrimaryAdminUsername(body.username) && password === DEFAULT_USER_PASSWORD) throw new ForbiddenException("admin 账户不能使用普通用户默认密码");
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.save(User, {
        username: body.username, displayName: body.displayName.trim(), passwordHash: await bcrypt.hash(password, 12),
        enabled: true, division: body.division || null, mustChangePassword: true, lastLoginAt: null
      });
      for (const roleId of [...new Set(body.roleIds ?? [])]) await manager.insert(UserRole, { userId: user.id, roleId });
      return { id: user.id, username: user.username };
    });
  }

  @Post("users/import")
  async importUsers(@Body() body: { rows: Array<{ username: string; displayName: string; division?: string; roleIds?: string[] }> }, @Req() req: UserRequest) {
    this.admin(req);
    for (const row of body.rows ?? []) {
      if (!row.username?.trim() || !row.displayName?.trim()) continue;
      let user = await this.users.findOneBy({ username: row.username.trim() });
      if (!user && isPrimaryAdminUsername(row.username)) continue;
      if (!user) user = await this.users.save({ username: row.username.trim(), displayName: row.displayName.trim(), passwordHash: await bcrypt.hash(DEFAULT_USER_PASSWORD, 12), enabled: true, division: row.division || null, mustChangePassword: true, lastLoginAt: null });
      if (row.roleIds?.length) { await this.userRoles.delete({ userId: user.id }); for (const roleId of [...new Set(row.roleIds)]) await this.userRoles.insert({ userId: user.id, roleId }); }
    }
    return { imported: body.rows?.length ?? 0 };
  }

  @Patch("users/:id")
  async updateUser(@Param("id") id: string, @Body() body: { displayName?: string; division?: string | null; enabled?: boolean; roleIds?: string[]; password?: string }, @Req() req: UserRequest) {
    this.admin(req);
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOneBy(User, { id });
      if (!user) throw new ForbiddenException("用户不存在");
      if (body.displayName !== undefined) user.displayName = body.displayName.trim();
      if (body.division !== undefined) user.division = body.division;
      if (body.enabled !== undefined) user.enabled = body.enabled;
      if (body.password) {
        if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(body.password)) throw new ForbiddenException("密码至少 8 位，且必须同时包含字母和数字");
        user.passwordHash = await bcrypt.hash(body.password, 12); user.mustChangePassword = true;
      }
      await manager.save(user);
      if (body.roleIds) {
        await manager.delete(UserRole, { userId: id });
        for (const roleId of [...new Set(body.roleIds)]) await manager.insert(UserRole, { userId: id, roleId });
      }
      return { id: user.id, enabled: user.enabled };
    });
  }

  @Post("users/:id/reset-password")
  async resetUserPassword(@Param("id") id: string, @Req() req: UserRequest) {
    this.admin(req);
    const user = await this.users.findOneBy({ id });
    if (!user) throw new BadRequestException("用户不存在");
    if (isPrimaryAdminUsername(user.username)) throw new BadRequestException("admin 账户不能重置为普通用户默认密码");
    user.passwordHash = await bcrypt.hash(DEFAULT_USER_PASSWORD, 12);
    user.mustChangePassword = true;
    await this.users.save(user);
    return { id, reset: true, mustChangePassword: true };
  }

  @Post("users/delete")
  async deleteUsers(@Body() body: { ids: string[] }, @Req() req: UserRequest) { this.admin(req); await this.users.update(body.ids, { enabled: false }); return { affected: body.ids?.length ?? 0 }; }

  @Post("roles")
  async createRole(@Body() body: { name: string; description?: string; permissions?: Array<Partial<Permission>>; userIds?: string[]; organizationUnitIds?: string[] }, @Req() req: UserRequest) {
    this.admin(req);
    const name = body.name?.trim();
    if (!name) throw new BadRequestException("角色名称不能为空");
    if (await this.roles.findOneBy({ name })) throw new ConflictException("角色名称已存在");
    return this.dataSource.transaction(async (manager) => {
      const role = await manager.save(Role, { name, description: body.description?.trim() || null });
      for (const permission of body.permissions ?? []) await manager.save(Permission, { ...permission, roleId: role.id, resource: permission.resource!, fieldKey: permission.fieldKey ?? "*" });
      for (const userId of [...new Set(body.userIds ?? [])]) await manager.save(UserRole, { userId, roleId: role.id });
      for (const organizationUnitId of [...new Set(body.organizationUnitIds ?? [])]) await manager.save(RoleOrganizationScope, { roleId: role.id, organizationUnitId });
      return role;
    });
  }

  @Patch("roles/:id")
  async updateRole(@Param("id") id: string, @Body() body: { name?: string; description?: string; permissions?: Array<Partial<Permission>>; userIds?: string[]; organizationUnitIds?: string[] }, @Req() req: UserRequest) {
    this.admin(req);
    return this.dataSource.transaction(async (manager) => {
      const role = await manager.findOneBy(Role, { id });
      if (!role) throw new ForbiddenException("角色不存在");
      if (body.name !== undefined) {
        const name = body.name.trim();
        if (!name) throw new BadRequestException("角色名称不能为空");
        const duplicate = await manager.findOneBy(Role, { name });
        if (duplicate && duplicate.id !== id) throw new ConflictException("角色名称已存在");
        role.name = name;
      }
      if (body.description !== undefined) role.description = body.description || null;
      await manager.save(role);
      if (body.permissions) { await manager.delete(Permission, { roleId: id }); for (const p of body.permissions) await manager.save(Permission, { ...p, roleId: id, resource: p.resource!, fieldKey: p.fieldKey ?? "*" }); }
      if (body.userIds) { await manager.delete(UserRole, { roleId: id }); for (const userId of [...new Set(body.userIds)]) await manager.save(UserRole, { userId, roleId: id }); }
      if (body.organizationUnitIds) { await manager.delete(RoleOrganizationScope, { roleId: id }); for (const organizationUnitId of [...new Set(body.organizationUnitIds)]) await manager.save(RoleOrganizationScope, { roleId: id, organizationUnitId }); }
      return role;
    });
  }

  @Post("roles/import")
  async importRoles(@Body() body: { rows: Array<{ name: string; description?: string }> }, @Req() req: UserRequest) {
    this.admin(req);
    for (const row of body.rows ?? []) if (row.name?.trim()) await this.roles.createQueryBuilder().insert().values({ name: row.name.trim(), description: row.description?.trim() || null, updatedBy: currentModificationActor() }).orUpdate(["description", "updated_by"], ["name"]).execute();
    return { imported: body.rows?.length ?? 0 };
  }
}
