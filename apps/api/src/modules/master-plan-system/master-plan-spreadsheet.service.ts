import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { DataSource } from "typeorm";
import { assertSpreadsheetNotEncrypted } from "../../spreadsheet-upload";
import { fieldsFor, MASTER_PLAN_RESOURCE_MAP, processReportPendingFields } from "./master-plan.config";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { OrganizationDirectoryService } from "../organization-directory/organization-directory.service";

type ImportRow = { row: number; id: string | null; expectedVersion: number | null; values: Record<string, unknown> };
const legacyFieldAliases: Record<string, string[]> = { orderDate: ["订单日期"] };
const unreadableSpreadsheetMessage = "Excel 未解密或文件损坏，请解密或检查确保文件正确后导入。";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pendingTemplateNotes = [
  "待报工任务导入：一行表示对一条待报工任务进行一次新的实际报工（CREATE 报工记录），不会覆盖历史报工。",
  "本次报工数量、生产日期由用户填写；订单编号、品项编码、品项名称、工序、计划数量、累计报工、剩余数量仅用于核对，请勿修改。",
  "记录ID 是待报工任务的稳定标识、版本是该任务的乐观锁版本，均由系统维护，请勿修改；任务版本变化时该行会被拒绝并提示重新导出。",
  "同一任务可以多次导入报工（不同生产日期或同一天多笔），累计报工会自动重新汇总；累计达到计划数量后该任务不再出现在待报工列表。",
  "上传后必须先预览校验，确认后整批事务提交；单次最多50000行。"
];

@Injectable()
export class MasterPlanSpreadsheetService {
  constructor(private readonly dataSource: DataSource, private readonly queries: MasterPlanQueryService, private readonly application: MasterPlanApplicationService, private readonly directory: OrganizationDirectoryService) {}

  private resource(code: string) {
    const resource = MASTER_PLAN_RESOURCE_MAP.get(code as never);
    if (!resource) throw new BadRequestException("主计划表不存在");
    return resource;
  }

  async template(code: string, actor: MasterPlanActor, view?: unknown) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new BadRequestException("当前权限组没有该表导入权限");
    if (this.isPendingImport(code, view)) {
      /* 待报工模板与页面共用同一份权威字段定义：只填本次报工数量与生产日期，其余列用于识别任务。 */
      const fields = this.pendingImportFields(actor);
      const { rows } = await this.queries.pendingReportRows(actor);
      return this.workbook(this.pendingTemplateLabel(resource.code), fields as never, rows, pendingTemplateNotes);
    }
    const fields = this.importFields(resource, code, actor);
    return this.workbook(resource.code, fields, []);
  }

  async export(code: string, input: Record<string, unknown>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    const result = await this.queries.exportRows(code, input, actor);
    const fields = fieldsFor(resource).filter((field) => result.visibleFields.includes(field.key));
    return this.workbook(resource.code, fields, result.rows);
  }

  async preview(code: string, file: Express.Multer.File, actor: MasterPlanActor, view?: unknown) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new ForbiddenException("当前权限组没有该表导入权限");
    const pending = this.isPendingImport(code, view);
    if (!file?.buffer?.length || !/\.xlsx$/i.test(file.originalname)) throw new BadRequestException("请选择 .xlsx Excel 文件");
    assertSpreadsheetNotEncrypted(file.buffer);
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(file.buffer as never); } catch { throw new BadRequestException(unreadableSpreadsheetMessage); }
    const sheet = workbook.getWorksheet(resource.code) ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Excel 文件没有工作表");
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => { const label = cell.text.trim(); if (headers.has(label)) throw new BadRequestException(`表头重复：${label}`); headers.set(label, column); });
    const schema = workbook.getWorksheet("_字段定义");
    const columnsByKey = new Map<string, number>();
    if (schema) {
      const templateLabel = pending ? this.pendingTemplateLabel(code) : resource.code;
      if (schema.getCell("B1").text !== templateLabel) throw new BadRequestException("Excel 字段定义与当前表不一致，请下载当前表模板");
      for (let index = 3; index <= schema.rowCount; index++) {
        const key = schema.getRow(index).getCell(1).text.trim(); const column = Number(schema.getRow(index).getCell(2).value);
        if (key && Number.isInteger(column) && column > 0) columnsByKey.set(key, column);
      }
    } else {
      if (!headers.has("记录ID") || !headers.has("版本")) throw new BadRequestException("缺少记录ID或版本列，请使用系统导出的文件");
      columnsByKey.set("id", headers.get("记录ID")!); columnsByKey.set("version", headers.get("版本")!);
    }
    if (!columnsByKey.has("id") || !columnsByKey.has("version")) throw new BadRequestException("缺少记录ID或版本字段定义，请使用系统导出的文件");
    /* 待报工导入：列取自同一份待报工权威定义；其余资源沿用可导入字段。 */
    const editableFields = pending ? this.pendingImportFields(actor) as ReturnType<typeof fieldsFor> : this.importFields(resource, code, actor);
    const headerFor = (field: (typeof editableFields)[number]) => [field.label, ...(legacyFieldAliases[field.key] ?? [])].find((label) => headers.has(label));
    const includedFields = editableFields.filter((field) => schema ? columnsByKey.has(field.key) : Boolean(headerFor(field)));
    if (!schema) for (const field of includedFields) columnsByKey.set(field.key, headers.get(headerFor(field)!)!);
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
        const raw = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text.trim();
        values[field.key] = this.importValue(field, raw);
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
    const resolved = pending ? await this.resolvePendingReportRows(rows, actor) : { createRows: rows, errors: [] as Array<{ row: number; reason: string }> };
    const businessRows = resolved.createRows;
    const errors = parseErrors.length ? parseErrors : resolved.errors.length ? resolved.errors : await this.application.validateImportUpdates(code, businessRows, actor);
    if (errors.length) return { total: rows.length, errors, previewId: null, rows: [] };
    const blockedReason = await this.application.importBlockedReason(code, actor);
    if (blockedReason) return { total: rows.length, errors: [], previewId: null, rows: businessRows.slice(0, 20), blockedReason };
    if (!actor.userId) throw new ForbiddenException("当前用户身份无效，无法创建导入预览");
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    const [preview] = await this.dataSource.transaction(async (manager) => {
      await manager.query("DELETE FROM mps_import_previews WHERE expires_at<=now()");
      return manager.query(`INSERT INTO mps_import_previews(tenant_id,user_id,resource,file_hash,payload_json,expires_at,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5::jsonb,now() + interval '30 minutes',$2::uuid,$2::uuid) RETURNING id`, [actor.tenantId, actor.userId, code, hash, JSON.stringify({ rows: businessRows, view: pending ? "PENDING" : undefined })]);
    });
    return { total: rows.length, errors: [], previewId: preview.id, rows: businessRows.slice(0, 20) };
  }

  async confirm(code: string, previewId: string, actor: MasterPlanActor) {
    if (!actor.userId) throw new ForbiddenException("当前用户身份无效，无法确认导入预览");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(previewId))) throw new BadRequestException("导入预览不存在，请重新上传");
    return this.dataSource.transaction(async (manager) => {
      await manager.query("DELETE FROM mps_import_previews WHERE expires_at<=now()");
      const [preview] = await manager.query(`SELECT * FROM mps_import_previews WHERE id=$1::uuid AND tenant_id=$2 AND user_id=$3::uuid AND resource=$4 FOR UPDATE`, [previewId, actor.tenantId, actor.userId, code]);
      if (!preview) throw new BadRequestException("导入预览已过期、无权访问或不存在，请重新上传。");
      if (preview.confirmed_at) return { ...preview.confirmation_result, repeated: true };
      const result = await this.application.importUpdates(code, preview.payload_json.rows, preview.file_hash, actor);
      await manager.query("UPDATE mps_import_previews SET confirmed_at=now(),confirmation_result=$2::jsonb,updated_at=now(),updated_by=$3::uuid,version=version+1 WHERE id=$1::uuid", [previewId, JSON.stringify(result), actor.userId]);
      return result;
    });
  }

  private async workbook(label: string, fields: ReturnType<typeof fieldsFor>, rows: Array<Record<string, unknown>>, notes?: string[]) {
    const workbook = new ExcelJS.Workbook(); workbook.creator = "KDOS 主计划系统";
    const sheet = workbook.addWorksheet(label.slice(0, 31));
    sheet.columns = [{ header: "记录ID", key: "id", width: 38 }, { header: "版本", key: "version", width: 10 }, ...fields.map((field) => ({ header: field.label, key: field.key, width: 20 }))];
    const organizationPaths = new Map((await this.directory.listEnabled()).map((option) => [option.id, option.pathLabel]));
    /* 模板/导出按用户看到的名称展示：部门显示完整路径，字典字段显示 label（数据库仍存稳定 value）。 */
    for (const row of rows) sheet.addRow({ id: row.id, version: row.version, ...Object.fromEntries(fields.map((field) => [field.key, this.displayValue(field, row[field.key], organizationPaths)])) });
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
    const noteSheet = workbook.addWorksheet("填写说明"); noteSheet.getColumn(1).width = 120;
    noteSheet.addRows(notes?.map((line) => [line]) ?? [
      ["记录ID：系统为每条记录自动生成的唯一标识。新增导入时留空，由系统生成；更新已导出记录时必须原样保留且不得修改。"],
      ["版本：系统自动维护的正整数，用于防止多人同时修改时覆盖新数据。新增导入时留空；更新导入时必须保留导出时的版本，版本已变化时整批拒绝并提示刷新后重试。"],
      ["新增规则：记录ID和版本必须同时留空；更新规则：记录ID和版本必须同时填写。只填写其中一个会校验失败。"],
      ["仅可修改有字段编辑权限的业务字段；空白单元格表示清空该字段。"],
      ["上传后必须先预览校验，确认后整批事务提交；单次最多50000行。"],
      ["创建人、创建时间、更新人、更新时间不参与导入。"]
    ]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private isPendingImport(code: string, view: unknown) {
    return code === "mps-process-reports" && String(view ?? "").toUpperCase() === "PENDING";
  }

  private pendingTemplateLabel(code: string) { return `${code}-待报工`; }

  /** 单元格展示值：部门显示完整路径，字典字段显示 label，其余原样。 */
  private displayValue(field: TablePermissionFieldDefinition, raw: unknown, organizationPaths: Map<string, string>) {
    if (raw == null || raw === "") return null;
    if (field.type === "department") return organizationPaths.get(String(raw)) ?? raw;
    if (field.type === "boolean") return raw === true ? "是" : raw === false ? "否" : raw;
    const options = field.options ?? [];
    return options.find((option) => String(option.value) === String(raw))?.label ?? raw;
  }

  /** 单元格回写值：把用户填写的 label 解析回稳定 value（手机端/Excel 下拉只提供中文名称）。 */
  private importValue(field: TablePermissionFieldDefinition, raw: unknown) {
    if (raw == null || raw === "") return raw;
    const options = field.options ?? [];
    if (!options.length) return raw;
    const text = String(raw).trim();
    const matched = options.find((option) => String(option.label) === text || String(option.value) === text);
    return matched ? String(matched.value) : raw;
  }

  /** 待报工模板/预览字段：上下文列需读权限，本次报工数量与生产日期需新增权限（提交时按 CREATE 实际报工校验）。 */
  private pendingImportFields(actor: MasterPlanActor) {
    const canRead = hasMasterPlanPermission(actor, "mps-process-reports", "read");
    const canCreate = hasMasterPlanPermission(actor, "mps-process-reports", "create");
    return processReportPendingFields().filter((field) => field.input ? canCreate : canRead);
  }

  /**
   * 待报工导入一行 = 对一条待报工任务创建一次实际报工：
   * 任务身份与版本只从系统模板的隐藏/固定列读取，禁止用订单号+中文工序名模糊定位；版本变化、任务不存在或越权即整行报错。
   */
  private async resolvePendingReportRows(rows: ImportRow[], actor: MasterPlanActor) {
    const errors: Array<{ row: number; reason: string }> = []; const createRows: ImportRow[] = [];
    for (const row of rows) {
      if (!row.id || !uuidPattern.test(String(row.id))) { errors.push({ row: row.row, reason: "缺少有效的待报工任务ID，请使用系统导出的待报工模板" }); continue; }
      if (!Number.isInteger(row.expectedVersion) || (row.expectedVersion ?? 0) < 1) { errors.push({ row: row.row, reason: "待报工任务版本必须为正整数，请重新下载模板" }); continue; }
      const [task] = await this.dataSource.query(`SELECT task.id,task.version,task.weekly_plan_id,task.process_code
        FROM mps_weekly_process_plans task WHERE task.tenant_id=$1 AND task.id=$2::uuid AND task.execution_enabled=true`, [actor.tenantId, row.id]);
      if (!task) { errors.push({ row: row.row, reason: "待报工任务不存在或不属于当前租户" }); continue; }
      if (Number(task.version) !== row.expectedVersion) { errors.push({ row: row.row, reason: "任务版本已变化，请重新下载待报工模板后填写" }); continue; }
      const rawQuantity = row.values.productionQuantity; const rawDate = row.values.productionDate;
      if (rawQuantity == null || String(rawQuantity).trim() === "") { errors.push({ row: row.row, reason: "本次报工数量不能为空" }); continue; }
      if (rawDate == null || String(rawDate).trim() === "") { errors.push({ row: row.row, reason: "生产日期不能为空" }); continue; }
      createRows.push({ row: row.row, id: null, expectedVersion: null, values: { weeklyPlanId: task.weekly_plan_id, processCode: task.process_code, productionDate: rawDate, productionQuantity: rawQuantity } });
    }
    return { createRows, errors };
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
