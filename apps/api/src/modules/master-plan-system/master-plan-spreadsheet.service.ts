import { ReviewDueDateImportApplicationService, type ReviewDueImportRow } from './review-due-date-import.application.service';
import { reviewDueImportCapabilities } from './review-due-date.query.service';
import { reviewDueDateCreateFields, reviewDueDateTemplateNotes, tableResourceRegistry, type ReviewDueImportMode } from '@kdos/contracts';
import { allocationVendorTargetError, allocationChange, allocationColumn, ALLOCATION_FIELDS, parseAllocationWorkbook } from "./order-allocation.domain";
import { resolveAllocationRoutes } from "../notifications/order-allocation.routing";
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
import { productionProgressRatio } from "@tracker/shared";
import { ReviewDueDateQueryService } from './review-due-date.query.service';
import { Optional } from '@nestjs/common';

type ImportRow = { row: number; id: string | null; expectedVersion: number | null; values: Record<string, unknown> };
/* KN-MPS-UI-001：异常字段统一显示为「异常」，历史模板的「异常说明」表头继续可导入。 */
const legacyFieldAliases: Record<string, string[]> = { orderDate: ["订单日期"], exceptionText: ["异常说明"] };
const unreadableSpreadsheetMessage = "Excel 未解密或文件损坏，请解密或检查确保文件正确后导入。";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allocationTemplateNotes = [
  "每次上传并确认都会建立独立批次；每条有效源行独立新增，即使订单号、品号、序号或整行内容相同。",
  "同一次预览重复确认不会重复新增。重新上传相同文件将新增另一批次，请在预览核对。",
  "ERP两列同时存在时，仅取未分配数量映射已分配数量；KDOS模板只填写已分配数量，不允许留空。",
  "数量公式仅读取已保存的缓存结果；错误或缺少缓存请在Excel重新计算、保存后再上传。",
  "旧导出的记录ID和版本会被忽略；修改历史记录请在页面按记录编辑。批次来源信息由系统维护。",
  "金额及单价不导入。上传后先预览校验，再由用户确认整批提交；单次最多50000行。"
];
const pendingTemplateNotes = [
  "待报工任务导入：一行表示对一条待报工任务进行一次新的实际报工（CREATE 报工记录），不会覆盖历史报工。",
  "本次报工数量、生产日期由用户填写；订单编号、品项编码、品项名称、工序、计划数量、累计报工、剩余数量仅用于核对，请勿修改。",
  "异常为可选项，仅填写实际生产过程中人工确认的异常；系统提示、计划缺失等无需填写。",
  "记录ID 是待报工任务的稳定标识、版本是该任务的乐观锁版本，均由系统维护，请勿修改；任务版本变化时该行会被拒绝并提示重新导出。",
  "同一任务可以多次导入报工（不同生产日期或同一天多笔），累计报工会自动重新汇总；累计达到计划数量后该任务不再出现在待报工列表。",
  "上传后必须先预览校验，确认后整批事务提交；单次最多50000行。"
];

/**
 * KN-MPS-WO-001：3天生产工单的 Excel 约定。
 * - 导出不包含技术身份列（weeklyPlanId）与服务端合并展示列（productionDateRange）：Excel 始终是「生产开始日期 + 生产结束日期」两列；
 * - 记录ID/版本保留在工作簿但隐藏，导入仍按 ID+version 定位（乐观锁），绝不按订单号+品项定位；
 * - 只有 4 个人工列可填写，其余来源列仅供核对，误改也不会写回数据库。
 */
const exportExcludedFields: Record<string, string[]> = { "mps-three-day-work-orders": ["weeklyPlanId", "productionDateRange"] };
const exportNotes: Record<string, string[]> = {
  "mps-three-day-work-orders": [
    "3天生产工单只能由「从周计划同步」生成，Excel 不能新增工单；如果表格里没有需要的工单，请先在系统点击「从周计划同步」。",
    "只有浅黄色底色的 4 列可以填写：生产开始日期、生产结束日期、备注、加工备注；其余列来自事业部周计划，请勿修改（误改也不会写回数据库）。",
    "只生产一天时，生产开始日期与生产结束日期填写同一天；暂时不排产时两列都留空；生产开始日期不能晚于生产结束日期。",
    "生产开始日期与生产结束日期请使用 yyyy-mm-dd（例如 2026-09-20）。",
    "记录ID、版本由系统维护（已隐藏），请勿修改；版本已变化时该行会被拒绝并提示重新导出。",
    "上传后必须先预览校验，确认后整批事务提交；单次最多50000行。"
  ]
};

@Injectable()
export class MasterPlanSpreadsheetService {
  constructor(private readonly dataSource: DataSource, private readonly queries: MasterPlanQueryService, private readonly application: MasterPlanApplicationService, private readonly directory: OrganizationDirectoryService, @Optional() private readonly reviewDue?: ReviewDueDateQueryService, @Optional() private readonly reviewImport?: ReviewDueDateImportApplicationService) {}

  private resource(code: string) {
    const resource = MASTER_PLAN_RESOURCE_MAP.get(code as never);
    if (!resource) throw new BadRequestException("主计划表不存在");
    return resource;
  }

  async template(code: string, actor: MasterPlanActor, view?: unknown) {
    const resource = this.resource(code);
    if(code==='mps-review-due-dates'){
      const capabilities=reviewDueImportCapabilities(actor);if(!capabilities.template)throw new ForbiddenException('没有评审交期模板字段权限');
      return this.workbook(code,capabilities.templateFields,[],capabilities.templateFields.length===6?reviewDueDateTemplateNotes:[reviewDueDateTemplateNotes[1],"此模板仅作获权字段结构参考，不可直接导入；导入需要完整模板列和相应写入授权。",...capabilities.templateFields.map(f=>`${f.label}：${f.required?"必填":"可空"}；类型${f.type}`)],{exactNumericText:true});
    }
    if (!hasMasterPlanPermission(actor, code, "import")) throw new BadRequestException("当前权限组没有该表导入权限");
    if (this.isPendingImport(code, view)) {
      /* 待报工模板与页面共用同一份权威字段定义：只填本次报工数量与生产日期，其余列用于识别任务。 */
      const fields = this.pendingImportFields(actor);
      const { rows } = await this.queries.pendingReportRows(actor);
      return this.workbook(this.pendingTemplateLabel(resource.code), fields as never, rows, pendingTemplateNotes);
    }
    const fields = this.importFields(resource, code, actor);
    return this.workbook(resource.code, fields, [], code==="mps-order-allocations"?allocationTemplateNotes:undefined, {includeIdentityColumns:code!=="mps-order-allocations"});
  }

  async export(code: string, input: Record<string, unknown>, actor: MasterPlanActor) {
    if(code==='mps-review-due-dates') {
      if(!this.reviewDue) throw new ForbiddenException('评审交期导出服务未配置');
      return this.reviewDue.export(input,actor);
    }
    const resource = this.resource(code);
    const result = await this.queries.exportRows(code, input, actor);
    const excluded = new Set(exportExcludedFields[resource.code] ?? []);
    const fields = fieldsFor(resource).filter((field) => result.visibleFields.includes(field.key) && !excluded.has(field.key));
    return this.workbook(resource.code, fields, result.rows, code==="mps-order-allocations"?allocationTemplateNotes:exportNotes[resource.code], {
      includeIdentityColumns:code!=="mps-order-allocations",
      hideIdentityColumns: resource.code === "mps-three-day-work-orders",
      highlightEditableColumns: resource.code === "mps-three-day-work-orders"
    });
  }

  async preview(code: string, file: Express.Multer.File, actor: MasterPlanActor, view?: unknown) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new ForbiddenException("当前权限组没有该表导入权限");
    if(code==='mps-review-due-dates')return this.reviewPreview(file,actor,view);
    if (code === "mps-order-allocations") return this.allocationPreview(file, actor, view === "OVERRIDE_DIVISION");
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
    }
    /* Excel 删除/移动列不会更新隐藏字段定义的旧列号。始终用当前表头定位，
     * 禁止把业务列误读为记录ID/版本，也不能把删除身份列的文件静默当作新增。 */
    if (!headers.has("记录ID") || !headers.has("版本")) throw new BadRequestException("缺少记录ID或版本列，请使用系统导出的文件；新增时两列均保留并留空，更新时必须同时填写真实ID和版本");
    columnsByKey.set("id", headers.get("记录ID")!);
    columnsByKey.set("version", headers.get("版本")!);
    /* 待报工导入：列取自同一份待报工权威定义；其余资源沿用可导入字段。 */
    const editableFields = pending ? this.pendingImportFields(actor) as ReturnType<typeof fieldsFor> : this.importFields(resource, code, actor);
    for (const field of editableFields) {
      const labels = [field.label, ...(legacyFieldAliases[field.key] ?? [])].filter((label) => headers.has(label));
      if (labels.length > 1) throw new BadRequestException(`字段表头重复：${field.label}`);
      if (labels.length) columnsByKey.set(field.key, headers.get(labels[0]!)!);
    }
    /* 兼容仅改显示标题的旧模板，但必须整张表的列结构仍与字段定义吻合。
     * 任何删列、插列或已知表头移动都会禁用位置回退，身份列始终不回退。 */
    if (schema) {
      const definitions = [] as Array<{ key: string; column: number; label: string }>;
      for (let index = 3; index <= schema.rowCount; index++) definitions.push({ key: schema.getCell(index, 1).text.trim(), column: Number(schema.getCell(index, 2).value), label: schema.getCell(index, 3).text.trim() });
      const knownLabels = new Set(["记录ID", "版本", ...fieldsFor(resource).flatMap(field => [field.label, ...(legacyFieldAliases[field.key] ?? [])]), ...editableFields.map(field => field.label)]);
      const aligned = definitions.length === headers.size && new Set(definitions.map(field => field.column)).size === definitions.length && definitions.every(field => {
        if (!Number.isInteger(field.column) || field.column < 1 || field.column > headers.size) return false;
        const label = sheet.getCell(1, field.column).text.trim();
        return label === field.label || (Boolean(label) && !knownLabels.has(label) && !headers.has(field.label));
      });
      if (aligned) for (const field of editableFields) {
        const definition = definitions.find(entry => entry.key === field.key);
        if (!columnsByKey.has(field.key) && definition) columnsByKey.set(field.key, definition.column);
      }
    }
    const includedFields = editableFields.filter((field) => columnsByKey.has(field.key));
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
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await manager.query("DELETE FROM mps_import_previews WHERE tenant_id=$1 AND expires_at<=now()",[actor.tenantId]);
      return manager.query(`INSERT INTO mps_import_previews(tenant_id,user_id,resource,file_hash,payload_json,expires_at,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5::jsonb,now() + interval '30 minutes',$2::uuid,$2::uuid) RETURNING id`, [actor.tenantId, actor.userId, code, hash, JSON.stringify({ rows: businessRows, view: pending ? "PENDING" : undefined })]);
    });
    return { total: rows.length, errors: [], previewId: preview.id, rows: businessRows.slice(0, 20) };
  }

  async confirm(code: string, previewId: string, actor: MasterPlanActor) {
    this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new ForbiddenException("当前权限组没有该表导入权限");
    if (!actor.userId) throw new ForbiddenException("当前用户身份无效，无法确认导入预览");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(previewId))) throw new BadRequestException("导入预览不存在，请重新上传");
    const committed = await this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await manager.query("DELETE FROM mps_import_previews WHERE tenant_id=$1 AND expires_at<=now()",[actor.tenantId]);
      const [preview] = await manager.query(`SELECT * FROM mps_import_previews WHERE id=$1::uuid AND tenant_id=$2 AND user_id=$3::uuid AND resource=$4 FOR UPDATE`, [previewId, actor.tenantId, actor.userId, code]);
      if (!preview) throw new BadRequestException("导入预览已过期、无权访问或不存在，请重新上传。");
      if(code==='mps-review-due-dates'){
        if(!this.reviewImport)throw new ForbiddenException('评审交期导入服务未配置');
        if(preview.confirmed_at){const visible=await this.reviewImport.replayAccess(preview.payload_json.rows,actor,manager);return {...preview.confirmation_result,...(!visible?{earlier:null,later:null,quantityChanged:null}:{}),repeated:true};}
        const result=await this.reviewImport.confirm(preview.payload_json.rows,preview.payload_json.mode,preview.file_hash,preview.id,actor,manager);
        await manager.query('UPDATE mps_import_previews SET confirmed_at=now(),confirmation_result=$2::jsonb,updated_at=now(),updated_by=$3::uuid,version=version+1 WHERE id=$1::uuid',[previewId,JSON.stringify(result),actor.userId]);return result;
      }
      if (preview.confirmed_at) return { ...preview.confirmation_result, repeated: true };
      const result = code === "mps-order-allocations"
        ? await this.application.importUpdates(code, preview.payload_json.rows, `${preview.file_hash}:${preview.id}`, actor, manager, {id:preview.payload_json.importBatchId,worksheet:preview.payload_json.sourceWorksheet,fileHash:preview.file_hash})
        : await this.application.importUpdates(code, preview.payload_json.rows, preview.file_hash, actor, manager);
      await manager.query("UPDATE mps_import_previews SET confirmed_at=now(),confirmation_result=$2::jsonb,updated_at=now(),updated_by=$3::uuid,version=version+1 WHERE id=$1::uuid", [previewId, JSON.stringify(result), actor.userId]);
      return result;
    });
    return code==='mps-review-due-dates'?committed:this.application.completeImportReconciliation(code,committed);
  }

  /** Resource adapter over the existing ExcelJS + preview ledger, never a second import store. */
  private async reviewPreview(file:Express.Multer.File,actor:MasterPlanActor,view:unknown) {
    if(!this.reviewImport)throw new ForbiddenException('评审交期导入服务未配置');
    if(view!=='STANDARD'&&view!=='SOURCE')throw new BadRequestException('请明确选择标准模板或原始六列来源模式');
    const mode=view as ReviewDueImportMode;
    if(!file?.buffer?.length||!/\.xlsx$/i.test(file.originalname))throw new BadRequestException('请选择 .xlsx Excel 文件');
    assertSpreadsheetNotEncrypted(file.buffer);
    const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(file.buffer as never);}catch{throw new BadRequestException(unreadableSpreadsheetMessage);}
    const sheet=workbook.getWorksheet('mps-review-due-dates')??workbook.worksheets.find(x=>!x.name.startsWith('_')&&x.name!=='填写说明');if(!sheet)throw new BadRequestException('文件没有业务工作表');
    const allowed=new Map<string,string>([...(mode==='STANDARD'?[['记录ID','id'],['版本','version']]:[]),...reviewDueDateCreateFields.map(f=>[f.label,f.key])] as Array<[string,string]>);
    const columns=new Map<string,number>();sheet.getRow(1).eachCell((cell,index)=>{const label=cell.text.trim(),key=allowed.get(label);if(!key||cell.type===ExcelJS.ValueType.Formula)throw new BadRequestException('当前模式不接受表头：'+label);if(columns.has(key))throw new BadRequestException('表头重复：'+label);columns.set(key,index);});
    const required=[...(mode==='STANDARD'?['id','version']:[]),...reviewDueDateCreateFields.map(f=>f.key)];
    if(required.some(k=>!columns.has(k)))throw new BadRequestException(mode==='STANDARD'?'标准模板必须保留记录ID、版本及六个业务列；新增时两个技术列均留空':'来源模式必须使用原始六列文件，不得带ID或版本');
    const schema=workbook.getWorksheet('_字段定义');
    if(schema){
      if(schema.getCell('B1').text!=='mps-review-due-dates'||schema.rowCount-2!==columns.size)throw new BadRequestException('隐藏字段映射与当前表头不一致，请重新下载模板');
      const seen=new Set<string>();for(let n=3;n<=schema.rowCount;n++){const key=schema.getCell(n,1).text,position=Number(schema.getCell(n,2).value),label=schema.getCell(n,3).text;if(seen.has(key)||columns.get(key)!==position||sheet.getCell(1,position).text.trim()!==label||allowed.get(label)!==key)throw new BadRequestException('隐藏字段映射与当前表头不一致，请重新下载模板');seen.add(key);}
    }
    if(sheet.rowCount>50001)throw new BadRequestException('单次最多导入50000行');
    const rows:ReviewDueImportRow[]=[],errors:Array<{row:number;reason:string}>=[];
    const value=(cell:ExcelJS.Cell,key:string)=>{
      let v=cell.value;
      if(cell.type===ExcelJS.ValueType.Error)throw new Error('单元格包含错误值');
      if(cell.type===ExcelJS.ValueType.Formula){v=(v as ExcelJS.CellFormulaValue).result??null;if(v==null||typeof v==='object'&&!(v instanceof Date))throw new Error('公式缺少有效缓存结果，请在Excel重算并保存');}
      if(key==='inboundDate'&&typeof v==='number'){if(!Number.isInteger(v)||v<1||v>2958465)throw new Error('入库时间不是有效Excel日期');v=new Date((v-(workbook.properties.date1904?24107:25569))*86400000);}
      if(v instanceof Date)return v.toISOString().slice(0,10);
      if(key==='quantity'&&typeof v==='number'&&(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER||v.toString().replace(/[.e+-]/g,'').length>15))throw new Error('数量数值精度不可靠，请使用精确十进制文本');
      return v==null?'':typeof v==='object'?cell.text.trim():String(v).trim();
    };
    sheet.eachRow((row,index)=>{
      if(index===1||![...columns.values()].some(c=>row.getCell(c).value!=null&&row.getCell(c).text.trim()!==''))return;
      try{const cells=Object.fromEntries([...columns].map(([key,col])=>[key,value(row.getCell(col),key)])),id=cells.id||null,version=cells.version||null;
        if(Boolean(id)!==Boolean(version))throw new Error('新增时记录ID和版本都应留空；更新时必须同时填写');
        rows.push({row:index,id,expectedVersion:version?Number(version):null,values:Object.fromEntries(reviewDueDateCreateFields.filter(f=>columns.has(f.key)).map(f=>[f.key,cells[f.key]]))});
      }catch(e){errors.push({row:index,reason:(e as Error).message});}
    });
    if(!rows.length&&!errors.length)errors.push({row:2,reason:'文件中没有可导入的数据'});
    if(errors.length)return {total:rows.length+errors.length,counts:{total:rows.length+errors.length,created:0,updated:0,earlier:0,later:0,quantityChanged:0,unchanged:0,conflicts:0,errors:errors.length},errors,rows:[],previewId:null,mode};
    const fileHash=createHash('sha256').update(file.buffer).digest('hex');
    return this.dataSource.transaction(async m=>{
      const result=await this.reviewImport!.prepare(rows,mode,actor,m);
      if(result.errors.length)return {total:rows.length,counts:result.publicCounts,restrictedComparison:result.restrictedComparison,errors:result.errors,rows:result.previewRows,previewId:null,mode};
      const [preview]=await m.query(`INSERT INTO mps_import_previews(tenant_id,user_id,resource,file_hash,payload_json,expires_at,created_by,updated_by)
        VALUES($1,$2::uuid,'mps-review-due-dates',$3,$4::jsonb,now()+interval '30 minutes',$2::uuid,$2::uuid) RETURNING id`,[actor.tenantId,actor.userId,fileHash,JSON.stringify({rows:result.rows,mode})]);
      return {total:rows.length,counts:result.publicCounts,restrictedComparison:result.restrictedComparison,errors:[],rows:result.previewRows,previewId:preview.id,mode};
    });
  }

  private async allocationPreview(file: Express.Multer.File, actor: MasterPlanActor, overrideDivision: boolean) {
    if (!file?.buffer?.length || !/\.xlsx$/i.test(file.originalname)) throw new BadRequestException("请选择 .xlsx Excel 文件");
    for (const [key] of ALLOCATION_FIELDS) if (!hasMasterPlanFieldPermission(actor,"mps-order-allocations",key,"read")) throw new ForbiddenException("导入预览需要全部非金额业务字段的读取权限");
    const parsed=await parseAllocationWorkbook(file.buffer),errors=[...parsed.errors];
    const hash=createHash("sha256").update(file.buffer).digest("hex");
    const resolved=await this.dataSource.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [{id:importBatchId}]=await manager.query("SELECT uuidv7() AS id");
      const vendors=await manager.query("SELECT supplier_name,division_id,enabled FROM mps_allocation_vendor_mappings WHERE tenant_id=$1",[actor.tenantId]);
      const organizations=await this.directory.listEnabled();
      const conflicts:Array<Record<string,unknown>>=[],changes:ReturnType<typeof allocationChange>[]=[];
      const rows=parsed.rows.map(input=>{
        const values={...input.values};
        if(values.divisionId){try{values.divisionId=this.directory.resolve(values.divisionId,organizations,"承接事业部")?.id;}catch{errors.push({row:input.row,reason:"承接事业部无法精确匹配"});}}
        if(values.supplierName){
          const map=vendors.find((v:Record<string,unknown>)=>v.supplier_name===values.supplierName);
          if(!map)errors.push({row:input.row,reason:`供应商名称未配置映射：${values.supplierName}`});
          else if(!map.enabled)errors.push({row:input.row,reason:`供应商名称映射已停用：${values.supplierName}，请联系PMC管理员核实并启用`});
          else if(!organizations.some(o=>o.id===map.division_id))errors.push({row:input.row,reason:"供应商映射的承接组织不存在或已停用"});
          else if(allocationVendorTargetError(String(values.supplierName),organizations.find(o=>o.id===map.division_id)!))errors.push({row:input.row,reason:"供应链必须映射采购部，请联系PMC管理员修复映射"});
          else if(values.divisionId&&values.divisionId!==map.division_id){
            conflicts.push({row:input.row,before:organizations.find(u=>u.id===values.divisionId)?.name??values.divisionId,after:organizations.find(u=>u.id===map.division_id)?.name??map.division_id,overridden:overrideDivision});
            if(overrideDivision){
              if(!hasMasterPlanFieldPermission(actor,"mps-order-allocations","divisionId","update"))errors.push({row:input.row,reason:"没有覆盖承接事业部的修改权限"});
              values.divisionId=map.division_id;
            }
          }else values.divisionId=map.division_id;
        }
        const after={...Object.fromEntries(Object.entries(values).map(([k,v])=>[allocationColumn(k),v])),id:`row-${input.row}`};
        const change=allocationChange(null,after);changes.push(change);
        return {row:input.row,id:null,expectedVersion:null,values,classification:"NEW",fields:change.fields.map(f=>f.key==="divisionId"?{...f,after:organizations.find(u=>u.id===f.after)?.name??f.after}:f)};
      });
      const routing=await resolveAllocationRoutes(manager,actor.tenantId,changes);
      const [history]=await manager.query(`SELECT EXISTS(SELECT 1 FROM mps_allocation_import_batches WHERE tenant_id=$1 AND file_hash=$2) OR EXISTS(
        SELECT 1 FROM mps_import_previews WHERE tenant_id=$1 AND resource='mps-order-allocations' AND file_hash=$2 AND confirmed_at IS NOT NULL) AS repeated`,[actor.tenantId,hash]);
      return {rows,conflicts,routing,importBatchId,repeatedFile:history.repeated};
    });
    if(!errors.length)errors.push(...await this.application.validateImportUpdates("mps-order-allocations",resolved.rows,actor));
    const errorRows=new Set(errors.map(e=>e.row));for(const row of resolved.rows)if(errorRows.has(row.row)){row.classification="ERROR";row.fields=[];}
    const counts={created:resolved.rows.filter(r=>r.classification==="NEW").length,updated:0,unchanged:0,errors:errorRows.size};
    const group=(key:string)=>Object.entries(resolved.rows.reduce((m:Record<string,number>,r)=>{const k=String(r.values[key]??"未填写");m[k]=(m[k]??0)+1;return m;},{})).map(([name,count])=>({name,count}));
    let previewId=null;
    if(!errors.length){
      if(!actor.userId)throw new ForbiddenException("当前用户身份无效");
      const [preview]=await this.dataSource.transaction(async manager=>{
        await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
        return manager.query(`INSERT INTO mps_import_previews(tenant_id,user_id,resource,file_hash,payload_json,expires_at,created_by,updated_by) VALUES($1,$2::uuid,'mps-order-allocations',$3,$4::jsonb,now()+interval '30 minutes',$2::uuid,$2::uuid) RETURNING id`,[actor.tenantId,actor.userId,hash,JSON.stringify({rows:resolved.rows.map(({row,id,expectedVersion,values})=>({row,id,expectedVersion,values})),importBatchId:resolved.importBatchId,sourceWorksheet:parsed.sourceWorksheet,overrideDivision})]);
      });previewId=preview.id;
    }
    return {previewId,total:resolved.rows.length,fileTotalRows:parsed.fileTotalRows,validRows:counts.created,orderCount:parsed.orderCount,importBatchId:resolved.importBatchId,quantitySource:parsed.quantitySource,ignoredIdentity:parsed.ignoredIdentity,repeatedFile:resolved.repeatedFile,
      errors,counts,rows:resolved.rows,conflicts:resolved.conflicts,byDivision:group("divisionId"),bySalesperson:group("salespersonName"),
      recipients:(errors.length?[]:resolved.routing.recipients).map(r=>({userId:r.userId,displayName:r.displayName,count:r.changes.length,identities:r.identities})),recipientErrors:resolved.routing.errors};
  }

  private async workbook(label: string, fields: ReturnType<typeof fieldsFor>, rows: Array<Record<string, unknown>>, notes?: string[], options: { hideIdentityColumns?: boolean; highlightEditableColumns?: boolean; includeIdentityColumns?: boolean; exactNumericText?:boolean } = {}) {
    const workbook = new ExcelJS.Workbook(); workbook.creator = "KDOS 主计划系统";
    if(options.exactNumericText)workbook.title=tableResourceRegistry.find(r=>r.code===label)?.label??label;
    const sheet = workbook.addWorksheet(label.slice(0, 31));
    const firstBusinessColumn=options.includeIdentityColumns===false?1:3;
    sheet.columns = [
      ...(options.includeIdentityColumns===false?[]:[{ header: "记录ID", key: "id", width: 38 }, { header: "版本", key: "version", width: 10 }]),
      /* 日期列统一按 yyyy-mm-dd 显示（用户看到 2026-09-20，而不是序列号或带时间的日期）。 */
      ...fields.map((field) => ({
        header: field.label, key: field.key, width: field.type === "date" ? 14 : 20,
        ...(field.type === "date" ? { style: { numFmt: "yyyy-mm-dd" } } : {}),
        ...(options.exactNumericText&&field.exactNumeric ? { style:{numFmt:"@"} } : {}),
        ...(this.isProductionProgressField(field) ? { style: { numFmt: "0.#%" } } : {})
      }))
    ];
    if (options.hideIdentityColumns && options.includeIdentityColumns!==false) { sheet.getColumn(1).hidden = true; sheet.getColumn(2).hidden = true; }
    const organizationPaths = new Map((options.exactNumericText?[]:await this.directory.listEnabled()).map((option) => [option.id, option.pathLabel]));
    /* 模板/导出按用户看到的名称展示：部门显示完整路径，字典字段显示 label（数据库仍存稳定 value）。 */
    for (const row of rows) sheet.addRow({ id: row.id, version: row.version, ...Object.fromEntries(fields.map((field) => [field.key, field.key==="importedBy"?row.importedByName??(row.importedBy?"未匹配操作人":null):this.displayValue(field, row[field.key], organizationPaths)])) });
    /* 需要人工填写的列给一个简洁的浅色底纹，明确「可填写区域」。 */
    if (options.highlightEditableColumns) for (const row of sheet.getRows(2, Math.max(rows.length, 1)) ?? []) fields.forEach((field, index) => { if (field.editable) row.getCell(index + firstBusinessColumn).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E0" } }; });
    sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }]; sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
    const schema = workbook.addWorksheet("_字段定义", { state: "veryHidden" });
    schema.addRow(["resource", label]); schema.addRow(["fieldKey", "column", "templateLabel"]);
    [...(options.includeIdentityColumns===false?[]:[{ key: "id", label: "记录ID" }, { key: "version", label: "版本" }]), ...fields].forEach((field, index) => schema.addRow([field.key, index + 1, field.label]));
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
      const targetLetter = sheet.getCell(1, fieldIndex + firstBusinessColumn).address.replace(/\d+/g, "");
      (sheet as unknown as { dataValidations: { add: (range: string, rule: unknown) => void } }).dataValidations.add(`${targetLetter}2:${targetLetter}50001`, { type: "list", allowBlank: !field.required, formulae: [name], showErrorMessage: true, errorTitle: "选项无效", error: `请选择${field.label}下拉选项` });
      optionColumn++;
    }
    /*
     * KN-MPS-WO-001 §59：所有 date 字段补上通用日期校验（yyyy-mm-dd），避免低熟练用户在单元格里输入自定义日期范围字符串。
     * 服务端始终是最终权威校验；这里只是 Excel 侧提示。
     */
    for (const [fieldIndex, field] of fields.entries()) {
      if (field.type !== "date") continue;
      const targetLetter = sheet.getCell(1, fieldIndex + firstBusinessColumn).address.replace(/\d+/g, "");
      (sheet as unknown as { dataValidations: { add: (range: string, rule: unknown) => void } }).dataValidations.add(`${targetLetter}2:${targetLetter}50001`, {
        type: "date", operator: "between", allowBlank: true,
        formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2100, 11, 31))],
        showErrorMessage: true, errorTitle: "日期格式无效", error: `${field.label}请填写 yyyy-mm-dd 格式的日期`
      });
    }
    const noteSheet = workbook.addWorksheet("填写说明"); noteSheet.getColumn(1).width = 120;
    /* KN-MPS-UI-001：支持人工异常的报工表（含待报工视图）必须写明异常可选、只填人工确认的异常。 */
    noteSheet.addRows(notes?.map((line) => [line]) ?? [
      ["记录ID：系统为每条记录自动生成的唯一标识。新增导入时留空，由系统生成；更新已导出记录时必须原样保留且不得修改。"],
      ["版本：系统自动维护的正整数，用于防止多人同时修改时覆盖新数据。新增导入时留空；更新导入时必须保留导出时的版本，版本已变化时整批拒绝并提示刷新后重试。"],
      ["新增规则：记录ID和版本必须同时留空；更新规则：记录ID和版本必须同时填写。只填写其中一个会校验失败。"],
      ...(fields.some((field) => field.key === "exceptionText") ? [["异常为可选项，仅填写实际生产过程中人工确认的异常；系统提示、计划缺失等无需填写。"]] : []),
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
    if (field.type === "datetime") return new Date(String(raw)).toLocaleString("sv-SE",{timeZone:"Asia/Shanghai"});
    if (field.type === "boolean") return raw === true ? "是" : raw === false ? "否" : raw;
    /* KN-MPS-WO-001：日期按真正的日期单元格导出（配合 yyyy-mm-dd 数字格式），用户看到 2026-09-20 而不是序列号。 */
    if (field.type === "date") return this.excelDate(raw);
    /* 生产进度的数据库比例可能由 PostgreSQL numeric 返回字符串，Excel 必须收到数值并使用百分比格式。 */
    if (this.isProductionProgressField(field)) return productionProgressRatio(raw);
    const options = field.options ?? [];
    return options.find((option) => String(option.value) === String(raw))?.label ?? raw;
  }

  private isProductionProgressField(field: TablePermissionFieldDefinition) {
    return field.key.endsWith("ProductionProgress");
  }

  /** 把数据库返回的日期值规范成 Excel 日期单元格（UTC 零点，避免时区偏移导致少一天）。 */
  private excelDate(raw: unknown) {
    if (raw instanceof Date) return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
    const text = String(raw).trim();
    const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (!matched) return raw;
    return new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
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
      const rawQuantity = row.values.productionQuantity; const rawDate = row.values.productionDate;
      const quantityEmpty = rawQuantity == null || String(rawQuantity).trim() === "";
      const dateEmpty = rawDate == null || String(rawDate).trim() === "";
      /* 模板预置全部待报工任务：填报两列都没写的行表示本次不报工，直接跳过（即使任务版本已变化也不报错）。 */
      if (quantityEmpty && dateEmpty) continue;
      if (!row.id || !uuidPattern.test(String(row.id))) { errors.push({ row: row.row, reason: "缺少有效的待报工任务ID，请使用系统导出的待报工模板" }); continue; }
      if (!Number.isInteger(row.expectedVersion) || (row.expectedVersion ?? 0) < 1) { errors.push({ row: row.row, reason: "待报工任务版本必须为正整数，请重新下载模板" }); continue; }
      const [task] = await this.dataSource.query(`SELECT task.id,task.version,task.weekly_plan_id,task.process_code
        FROM mps_weekly_process_plans task WHERE task.tenant_id=$1 AND task.id=$2::uuid AND task.execution_enabled=true`, [actor.tenantId, row.id]);
      if (!task) { errors.push({ row: row.row, reason: "待报工任务不存在或不属于当前租户" }); continue; }
      if (Number(task.version) !== row.expectedVersion) { errors.push({ row: row.row, reason: "任务版本已变化，请重新下载待报工模板后填写" }); continue; }
      if (quantityEmpty) { errors.push({ row: row.row, reason: "本次报工数量不能为空" }); continue; }
      if (dateEmpty) { errors.push({ row: row.row, reason: "生产日期不能为空" }); continue; }
      /* 异常是可选项：留空即不写入异常，非空原样保存为本次报工的人工异常事实。 */
      const rawException = row.values.exceptionText;
      const exceptionText = rawException == null || String(rawException).trim() === "" ? null : String(rawException).trim();
      createRows.push({ row: row.row, id: null, expectedVersion: null, values: { weeklyPlanId: task.weekly_plan_id, processCode: task.process_code, productionDate: rawDate, productionQuantity: rawQuantity, exceptionText } });
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
