import { tablePermissionFieldsFor, tableSupportFieldsFor, type TablePermissionFieldDefinition, type TableResourceCode } from "@kdos/contracts";
import { standardProcesses } from "@tracker/shared";

export type MasterPlanResource = {
  code: TableResourceCode; table: string; create: boolean; remove: boolean; defaultOrder: string;
  divisionField?: string; requiredOnCreate?: string[]; requiredOnUpdate?: string[]; requiredAlways?: string[]; weeklyAdmissionRequiredFields?: string[]; uniqueKeyFields?: string[];
  /** 身份字段：创建时必须提供，记录生成后禁止普通修改（例如实际报工的所属周计划与工序）。 */
  createOnlyFields?: string[];
  extraColumns?: Record<string, string>;
};

export const MASTER_PLAN_RESOURCES: MasterPlanResource[] = [
  { code: "mps-erp-orders", table: "mps_erp_order_lines", create: false, remove: false, defaultOrder: "order_date DESC,order_number,item_code" },
  { code: "mps-customer-divisions", table: "mps_customer_division_mappings", create: true, remove: true, defaultOrder: "customer_code", divisionField: "primaryDivisionId", requiredOnCreate: ["customerCode", "primaryDivisionId"], uniqueKeyFields: ["customerCode"] },
  { code: "mps-order-allocations", table: "mps_order_allocations", create: true, remove: false, defaultOrder: "order_date DESC,order_number,item_code", divisionField: "divisionId", requiredOnCreate: ["orderNumber", "itemCode", "allocatedQuantity", "divisionId"], uniqueKeyFields: ["orderNumber", "itemCode"] },
  { code: "mps-process-cycles", table: "mps_process_cycles", create: true, remove: true, defaultOrder: "item_code", requiredOnCreate: ["itemCode"], uniqueKeyFields: ["itemCode"] },
  { code: "mps-group-plans", table: "mps_group_plans", create: false, remove: false, defaultOrder: "order_date DESC,order_number", divisionField: "primaryDivisionId" },
  { code: "mps-monthly-plans", table: "mps_monthly_plans", create: false, remove: false, defaultOrder: "order_date DESC,order_number,item_code", divisionField: "divisionId" },
  { code: "mps-shipping-plans", table: "mps_shipping_plans", create: true, remove: true, defaultOrder: "latest_customer_due_date,order_number,item_code,delivery_number", divisionField: "divisionId", requiredOnCreate: ["customerCode", "orderNumber", "itemCode", "itemName", "deliveryNumber", "latestCustomerDueDate", "plannedQuantity", "divisionId"], requiredAlways: ["itemName", "divisionId"], uniqueKeyFields: ["orderNumber", "itemCode", "deliveryNumber"], extraColumns: { monthlyPlanId: "monthly_plan_id" } },
  { code: "mps-base-plans", table: "mps_base_plans", create: true, remove: false, defaultOrder: "latest_customer_due_date,order_number,item_code,delivery_number", divisionField: "divisionId", requiredOnCreate: ["orderNumber", "itemCode", "deliveryNumber", "latestCustomerDueDate", "plannedQuantity", "latestReviewDueDate", "productAttribute", "surfaceNature", "manufacturingMethod"], requiredOnUpdate: ["orderNumber", "itemCode", "deliveryNumber", "latestCustomerDueDate", "plannedQuantity"], weeklyAdmissionRequiredFields: ["latestReviewDueDate", "productAttribute", "surfaceNature", "manufacturingMethod"], uniqueKeyFields: ["orderNumber", "itemCode", "deliveryNumber"] },
  { code: "mps-weekly-plans", table: "mps_weekly_plans", create: false, remove: false, defaultOrder: "latest_review_due_date,order_number,item_code,delivery_number", divisionField: "divisionId", requiredOnCreate: ["orderNumber", "itemCode", "deliveryNumber", "latestCustomerDueDate", "latestReviewDueDate", "plannedQuantity"], uniqueKeyFields: ["orderNumber", "itemCode", "deliveryNumber"] },
  { code: "mps-weekly-process-plans", table: "mps_weekly_process_plans", create: true, remove: false, defaultOrder: "report_date DESC,due_date,weekly_plan_id", requiredOnCreate: ["weeklyPlanId", "processCode"], uniqueKeyFields: ["weeklyPlanId", "processCode"], extraColumns: { processName: "process_name", sequence: "sequence" } },
  { code: "mps-technical-reports", table: "mps_technical_reports", create: false, remove: false, defaultOrder: "drawing_due_date,order_number,item_code,delivery_number", divisionField: "divisionId" },
  { code: "mps-material-reports", table: "mps_material_reports", create: true, remove: true, defaultOrder: "order_number,item_code,delivery_number,material_name", divisionField: "divisionId", requiredOnCreate: ["weeklyPlanId", "materialName"], uniqueKeyFields: ["weeklyPlanId", "materialName"] },
  { code: "mps-outsourcing-reports", table: "mps_outsourcing_reports", create: false, remove: false, defaultOrder: "outsourcing_due_date,order_number,item_code,delivery_number", divisionField: "divisionId" },
  { code: "mps-process-reports", table: "mps_process_reports", create: true, remove: true, defaultOrder: "production_date DESC,order_number,item_code,delivery_number", divisionField: "divisionId", requiredOnCreate: ["weeklyPlanId", "processCode", "productionDate", "productionQuantity"], createOnlyFields: ["weeklyPlanId", "processCode"], extraColumns: { processName: "process_name" } },
  { code: "mps-sync-configs", table: "mps_sync_configs", create: false, remove: false, defaultOrder: "name" },
  { code: "mps-sync-logs", table: "mps_sync_logs", create: false, remove: false, defaultOrder: "started_at DESC" },
  { code: "mps-data-exceptions", table: "mps_data_exceptions", create: false, remove: false, defaultOrder: "active DESC,severity DESC,updated_at DESC" },
  { code: "mps-system-settings", table: "mps_system_settings", create: false, remove: false, defaultOrder: "setting_key" }
];

export const MASTER_PLAN_RESOURCE_MAP = new Map(MASTER_PLAN_RESOURCES.map((resource) => [resource.code, resource]));
const commonOptions: Record<string, Array<{ value: string; label: string }>> = {
  manufacturingMethod: ["自制", "中心外购", "外协", "自制+外协"].map((value) => ({ value, label: value })),
  materialName: ["五金", "木作"].map((value) => ({ value, label: value })), outsourcingMethod: ["成品", "毛坯", "部件"].map((value) => ({ value, label: value })),
  modelAge: ["新", "旧"].map((value) => ({ value, label: value })), productAttribute: ["五金", "木作", "亚克力", "五金+木作"].map((value) => ({ value, label: value })), surfaceNature: ["烤漆", "电镀"].map((value) => ({ value, label: value })),
  /* 工序选项唯一来源：@tracker/shared canonical registry（含毛坯，顺序与正式工序一致）。 */
  processCode: standardProcesses.map((process) => ({ value: process.code, label: process.name }))
};
function optionsFor(resource: TableResourceCode, fieldKey: string) {
  if (fieldKey === "status" && resource === "mps-technical-reports") return ["已完成", "未完成", "延期"].map((value) => ({ value, label: value }));
  if (fieldKey === "status" && resource === "mps-outsourcing-reports") return ["未开始", "进行中", "延期", "已入库"].map((value) => ({ value, label: value }));
  return commonOptions[fieldKey] ?? [];
}
const camelToSnake = (value: string) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const processes = standardProcesses.map((process) => process.code);


/** 周计划某工序的累计实际报工（按 tenant+weekly_plan_id+process_code 聚合，禁止 JOIN 重复累计）。 */
const weeklyReportSum = (code: string) =>
  `(SELECT COALESCE(sum(report.production_quantity),0) FROM mps_process_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.process_code='${code}')`;
/** 月计划：先按 tenant+weekly_plan_id+process_code 聚合报工，再按关联周计划求和（避免一对多 JOIN 放大）。 */
const monthlyReportSum = (code: string) =>
  `(SELECT COALESCE(sum(per_week.reported),0) FROM mps_weekly_plans weekly JOIN (SELECT report.tenant_id,report.weekly_plan_id,sum(report.production_quantity) reported FROM mps_process_reports report WHERE report.process_code='${code}' GROUP BY report.tenant_id,report.weekly_plan_id) per_week ON per_week.tenant_id=weekly.tenant_id AND per_week.weekly_plan_id=weekly.id WHERE weekly.tenant_id=record.tenant_id AND weekly.order_number=record.order_number AND weekly.item_code=record.item_code)`;
/**
 * KN-MPS-EXEC-001 口径修正：月计划生产进度 = 整个订单/月度总需求完成率。
 * 分母固定使用月计划正式总需求 `record.required_quantity`；
 * 禁止使用 SUM(关联周计划 planned_quantity)（那只是“已下达周计划数量”，会高估完成率）。
 */
const monthlyReportedTotal = (code: string) => `(${monthlyReportSum(code)})::numeric`;
/**
 * KN-MPS-UI-001：月计划唯一的「已下达周计划数量」= 当前月计划范围内所有关联周计划 planned_quantity 之和。
 * 它与工序无关，因此只计算一次（不再是 10 个重复的 per-process 字段），且绝不参与生产进度分母。
 */
export const dispatchedWeeklyQuantitySql = `(SELECT COALESCE(sum(weekly.planned_quantity),0) FROM mps_weekly_plans weekly WHERE weekly.tenant_id=record.tenant_id AND weekly.order_number=record.order_number AND weekly.item_code=record.item_code)`;

/**
 * KN-MPS-UI-001：异常只来自人工报工事实，因此工序异常的来源是 `mps_process_reports.exception_text`。
 * `mps_weekly_process_plans.exception_text` 只是系统/计划提示，绝不参与统一异常汇总。
 */
const processReportExceptionSource = (code: string, from: string) =>
  `SELECT string_agg(DISTINCT report.exception_text,'、' ORDER BY report.exception_text) FROM ${from} AND report.process_code='${code}' AND btrim(COALESCE(report.exception_text,''))<>''`;

/** 单一来源异常片段：来源标签 + 去重后的异常文本（同一来源多条用「、」连接）。 */
const exceptionPart = (label: string, sql: string) => `NULLIF(('${label}：'||(${sql})),'')`;

/**
 * 周计划统一异常：严格只读人工报工事实表 `mps_technical_reports` / `mps_material_reports` /
 * `mps_outsourcing_reports` / `mps_process_reports`，顺序固定为 技术 → 五金主材 → 木作主材 → 外协 → 10 个标准工序。
 * 系统提示、计划配置缺失、数据质量问题（例如 weekly_process_plans.exception_text / mps_data_exceptions）绝不进入异常。
 */
function weeklyExceptionSummary() {
  const weeklySource = (table: string, extra: string) =>
    `SELECT string_agg(DISTINCT report.exception_text,'、' ORDER BY report.exception_text) FROM ${table} report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id ${extra} AND btrim(COALESCE(report.exception_text,''))<>''`;
  const parts = [
    exceptionPart("技术", weeklySource("mps_technical_reports", "")),
    exceptionPart("五金主材", weeklySource("mps_material_reports", "AND report.material_name='五金'")),
    exceptionPart("木作主材", weeklySource("mps_material_reports", "AND report.material_name='木作'")),
    exceptionPart("外协", weeklySource("mps_outsourcing_reports", "")),
    ...[...standardProcesses].sort((left, right) => left.order - right.order).map((process) =>
      exceptionPart(process.name, processReportExceptionSource(process.code, `mps_process_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id`)))
  ];
  /* 必须以 ( 开头：列表查询对非括号表达式会自动加 record. 前缀，裸函数会被当成 schema 限定调用。 */
  return `(concat_ws('；',${parts.join(",")}))`;
}

/** 月计划统一异常：同样只读人工报工事实，跨当前月计划范围内所有关联周计划汇总（同一来源+文本只出现一次）。 */
function monthlyExceptionSummary() {
  const monthlyWhere = `weekly.tenant_id=record.tenant_id AND weekly.order_number=record.order_number AND weekly.item_code=record.item_code`;
  const joinedSource = (table: string, extra: string) =>
    `SELECT string_agg(DISTINCT report.exception_text,'、' ORDER BY report.exception_text) FROM mps_weekly_plans weekly JOIN ${table} report ON report.tenant_id=weekly.tenant_id AND report.weekly_plan_id=weekly.id WHERE ${monthlyWhere} ${extra} AND btrim(COALESCE(report.exception_text,''))<>''`;
  const parts = [
    exceptionPart("技术", joinedSource("mps_technical_reports", "")),
    exceptionPart("五金主材", joinedSource("mps_material_reports", "AND report.material_name='五金'")),
    exceptionPart("木作主材", joinedSource("mps_material_reports", "AND report.material_name='木作'")),
    exceptionPart("外协", joinedSource("mps_outsourcing_reports", "")),
    ...[...standardProcesses].sort((left, right) => left.order - right.order).map((process) =>
      exceptionPart(process.name, processReportExceptionSource(process.code, `mps_weekly_plans weekly JOIN mps_process_reports report ON report.tenant_id=weekly.tenant_id AND report.weekly_plan_id=weekly.id WHERE ${monthlyWhere}`)))
  ];
  /* 必须以 ( 开头：列表查询对非括号表达式会自动加 record. 前缀，裸函数会被当成 schema 限定调用。 */
  return `(concat_ws('；',${parts.join(",")}))`;
}

export function virtualColumns(resource: MasterPlanResource) {
  const output: Record<string, string> = {};
  for (const code of processes) {
    if (resource.code === "mps-weekly-plans") {
      const base = `FROM mps_weekly_process_plans process WHERE process.tenant_id=record.tenant_id AND process.weekly_plan_id=record.id AND process.process_code='${code}'`;
      output[`${code}CycleDays`] = `(SELECT max(process.cycle_days) ${base})`;
      output[`${code}DueDate`] = `(SELECT min(process.due_date) ${base})`;
      output[`${code}Status`] = `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(process.status='延期') THEN '延期' WHEN bool_and(process.status='已完成') THEN '已完成' WHEN bool_or(process.status='进行中') THEN '进行中' ELSE '未开始' END ${base})`;
      /*
       * KN-MPS-EXEC-001：生产进度 = 累计实际报工 / 工序需求（周计划需求取正式 planned_quantity，与 PENDING 同源）。
       * KN-MPS-UI-001：累计报工改为辅助计算字段（support projection，仅供 Tooltip），不再是业务列。
       */
        output[`${code}ReportedQuantity`] = weeklyReportSum(code);
      output[`${code}ProductionProgress`] = `(CASE WHEN COALESCE(record.planned_quantity,0) > 0 THEN (${weeklyReportSum(code)})::numeric / record.planned_quantity ELSE NULL END)`;
    }
    if (resource.code === "mps-monthly-plans") {
      const joined = `FROM mps_weekly_plans weekly JOIN mps_weekly_process_plans process ON process.tenant_id=weekly.tenant_id AND process.weekly_plan_id=weekly.id WHERE weekly.tenant_id=record.tenant_id AND weekly.order_number=record.order_number AND weekly.item_code=record.item_code AND process.process_code='${code}'`;
      output[`${code}CycleDays`] = `(SELECT max(process.cycle_days) ${joined})`;
      output[`${code}DueDate`] = `(SELECT min(process.due_date) ${joined} AND process.status<>'已完成')`;
      output[`${code}Status`] = `(SELECT CASE WHEN bool_or(process.status='延期') THEN '延期' WHEN bool_and(process.status='已完成') THEN '已完成' WHEN bool_or(process.status='进行中') THEN '进行中' ELSE '未开始' END ${joined})`;
      /* KN-MPS-EXEC-001：月计划生产进度 = SUM(累计实际报工) / SUM(所有关联周计划的工序需求)，禁止平均百分比。 */
      output[`${code}ReportedQuantity`] = monthlyReportSum(code);
      output[`${code}ProductionProgress`] = `(CASE WHEN COALESCE(record.required_quantity,0) > 0 THEN ${monthlyReportedTotal(code)} / record.required_quantity ELSE NULL END)`;
    }
  }
  /* KN-MPS-UI-001：月计划全表唯一的「已下达周计划数量」（基础数量区域，与工序无关，不参与生产进度分母）。 */
  if (resource.code === "mps-monthly-plans") output.dispatchedWeeklyQuantity = dispatchedWeeklyQuantitySql;
  if (resource.code === "mps-weekly-plans") Object.assign(output, {
    technicalStatus: `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(report.status='延期') THEN '延期' WHEN bool_and(report.status='已完成') THEN '已完成' ELSE '未完成' END FROM mps_technical_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    hardwareStatus: `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(report.received OR report.actual_inbound_date IS NOT NULL) THEN '已完成' WHEN record.hardware_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='五金')`,
    woodStatus: `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(report.received OR report.actual_inbound_date IS NOT NULL) THEN '已完成' WHEN record.wood_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='木作')`,
    outsourcingStatus: `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(report.status='延期') THEN '延期' WHEN bool_and(report.status='已入库') THEN '已入库' WHEN bool_or(report.status='进行中') THEN '进行中' ELSE '未开始' END FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingCycleDays: `(SELECT max(report.cycle_days) FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingDueDate: `(SELECT min(report.outsourcing_due_date) FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingActualInboundDate: `(SELECT max(report.actual_inbound_date) FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`
  });
  if (resource.code === "mps-weekly-plans") output.exceptionSummary = weeklyExceptionSummary();
  if (resource.code === "mps-monthly-plans") output.exceptionSummary = monthlyExceptionSummary();
  if (resource.code === "mps-base-plans") {
    const admission = weeklyAdmissionSql(resource, "record");
    const missing = weeklyAdmissionMissingSql(resource, "record");
    const linkedWeekly = "EXISTS(SELECT 1 FROM mps_weekly_plans weekly WHERE weekly.tenant_id=record.tenant_id AND weekly.base_plan_id=record.id)";
    Object.assign(output, {
      weeklyPlanState: `(CASE WHEN ${linkedWeekly} THEN '已进入周计划' WHEN ${admission} THEN '已具备条件' ELSE '待完善' END)`,
      weeklyPlanMissingFields: `(CASE WHEN ${linkedWeekly} OR ${admission} THEN NULL ELSE ${missing} END)`,
      weeklyPlanGenerationIssue: `(SELECT event.last_error FROM mps_reconciliation_outbox event WHERE event.tenant_id=record.tenant_id AND event.resource='mps-base-plans' AND event.record_id=record.id AND event.sync_key='base-to-weekly' ORDER BY event.created_at DESC LIMIT 1)`
    });
  }
  if (resource.code === "mps-monthly-plans") {
    const weeklyFrom = `FROM mps_weekly_plans weekly`;
    const weeklyWhere = `weekly.tenant_id=record.tenant_id AND weekly.order_number=record.order_number AND weekly.item_code=record.item_code`;
    const weekly = `${weeklyFrom} WHERE ${weeklyWhere}`;
    const statusAggregate = (statusSql: string) => `CASE WHEN bool_or((${statusSql})='延期') THEN '延期' WHEN bool_and((${statusSql}) IN ('已完成','已入库')) THEN '已完成' WHEN bool_or((${statusSql})='进行中') THEN '进行中' ELSE '未开始' END`;
    Object.assign(output, {
      latestCustomerDueDate: `(SELECT COALESCE(min(weekly.latest_customer_due_date) FILTER (WHERE weekly.pending_quantity>0),max(weekly.latest_customer_due_date),record.latest_customer_due_date) ${weekly})`,
      technicalCycleDays: `(SELECT max(weekly.technical_cycle_days) ${weekly})`,
      drawingDueDate: `(SELECT min(technical.drawing_due_date) ${weeklyFrom} JOIN mps_technical_reports technical ON technical.tenant_id=weekly.tenant_id AND technical.weekly_plan_id=weekly.id WHERE ${weeklyWhere} AND technical.status<>'已完成')`,
      technicalStatus: `(SELECT ${statusAggregate("technical.status")} ${weeklyFrom} JOIN mps_technical_reports technical ON technical.tenant_id=weekly.tenant_id AND technical.weekly_plan_id=weekly.id WHERE ${weeklyWhere})`,
      hardwareCycleDays: `(SELECT max(weekly.hardware_cycle_days) ${weekly})`,
      hardwareDueDate: `(SELECT min(weekly.hardware_due_date) ${weekly} AND weekly.pending_quantity>0)`,
      hardwareStatus: `(SELECT ${statusAggregate("CASE WHEN material.received OR material.actual_inbound_date IS NOT NULL THEN '已完成' WHEN weekly.hardware_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END")} ${weeklyFrom} JOIN mps_material_reports material ON material.tenant_id=weekly.tenant_id AND material.weekly_plan_id=weekly.id AND material.material_name='五金' WHERE ${weeklyWhere})`,
      woodCycleDays: `(SELECT max(weekly.wood_cycle_days) ${weekly})`,
      woodDueDate: `(SELECT min(weekly.wood_due_date) ${weekly} AND weekly.pending_quantity>0)`,
      woodStatus: `(SELECT ${statusAggregate("CASE WHEN material.received OR material.actual_inbound_date IS NOT NULL THEN '已完成' WHEN weekly.wood_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END")} ${weeklyFrom} JOIN mps_material_reports material ON material.tenant_id=weekly.tenant_id AND material.weekly_plan_id=weekly.id AND material.material_name='木作' WHERE ${weeklyWhere})`,
      outsourcingCycleDays: `(SELECT max(outsource.cycle_days) ${weeklyFrom} JOIN mps_outsourcing_reports outsource ON outsource.tenant_id=weekly.tenant_id AND outsource.weekly_plan_id=weekly.id WHERE ${weeklyWhere})`,
      outsourcingDueDate: `(SELECT min(outsource.outsourcing_due_date) ${weeklyFrom} JOIN mps_outsourcing_reports outsource ON outsource.tenant_id=weekly.tenant_id AND outsource.weekly_plan_id=weekly.id WHERE ${weeklyWhere} AND outsource.status<>'已入库')`,
      outsourcingStatus: `(SELECT ${statusAggregate("outsourcing.status")} ${weeklyFrom} JOIN mps_outsourcing_reports outsourcing ON outsourcing.tenant_id=weekly.tenant_id AND outsourcing.weekly_plan_id=weekly.id WHERE ${weeklyWhere})`,
      outsourcingActualInboundDate: `(SELECT max(outsource.actual_inbound_date) ${weeklyFrom} JOIN mps_outsourcing_reports outsource ON outsource.tenant_id=weekly.tenant_id AND outsource.weekly_plan_id=weekly.id WHERE ${weeklyWhere})`
    });
  }
  return output;
}
export function fieldsFor(resource: MasterPlanResource): TablePermissionFieldDefinition[] {
  return tablePermissionFieldsFor(resource.code).map((field) => {
    const options = optionsFor(resource.code, field.key);
    const createOnly = (resource.createOnlyFields ?? []).includes(field.key);
    const resolved = options.length ? { ...field, options } : field;
    /* 身份字段创建后只读：行内编辑、批量修改、导入更新与普通 PATCH 都不得修改所属周计划或工序。 */
    return createOnly ? { ...resolved, editable: false, createOnly: true } as TablePermissionFieldDefinition : resolved;
  });
}
export function columnsFor(resource: MasterPlanResource): Record<string, string> {
  return {
    ...Object.fromEntries(fieldsFor(resource).map((field) => [field.key, camelToSnake(field.key)])),
    /* KN-MPS-UI-001：辅助计算字段只用于行投影（例如生产进度 Tooltip 的累计报工），不是业务列。 */
    ...Object.fromEntries(tableSupportFieldsFor(resource.code).map((field) => [field.key, camelToSnake(field.key)])),
    ...virtualColumns(resource),
    ...(resource.extraColumns ?? {})
  };
}

/** 待报工视图的输入列（用户本次填报）：列结构、提交载荷与 Excel 模板共用这一份来源。 */
export function processReportPendingInputKeys() {
  return PROCESS_REPORT_PENDING_FIELDS.filter((entry) => "input" in entry && entry.input === true).map((entry) => String(entry.key));
}

/**
 * 工序报工“待报工任务”（PENDING）视图的唯一权威字段定义：页面列与 Excel 待报工模板共用这一份顺序与名称。
 * 字段类型与字典 options 继续取 fieldsFor("mps-process-reports")，不新增第二套 schema 或字典；
 * input=true 是用户填报字段，其余字段是任务上下文，只读。
 */
export const PROCESS_REPORT_PENDING_FIELDS = [
  { key: "orderNumber", label: "订单编号" },
  { key: "itemCode", label: "品项编码" },
  { key: "itemName", label: "品项名称" },
  { key: "processCode", label: "工序" },
  { key: "plannedQuantity", label: "计划数量" },
  { key: "cumulativeReportedQuantity", label: "累计报工" },
  { key: "remainingQuantity", label: "剩余数量" },
  { key: "productionQuantity", label: "本次报工数量", input: true },
  { key: "productionDate", label: "生产日期", input: true },
  /* KN-MPS-UI-001：异常为可选项，提交时写入本次实际报工事实（mps_process_reports.exception_text）。 */
  { key: "exceptionText", label: "异常", input: true, optional: true }
] as const;

/** 待报工视图的稳定列映射：任务上下文 + 由实际报工汇总得到的累计/剩余。 */
export function processReportPendingColumns(): Record<string, string> {
  return {
    divisionId: "division_id",
    orderNumber: "order_number", itemCode: "item_code", itemName: "item_name", processCode: "process_code",
    plannedQuantity: "planned_quantity", cumulativeReportedQuantity: "cumulative_reported_quantity",
    remainingQuantity: "remaining_quantity", productionQuantity: "production_quantity", productionDate: "production_date",
    exceptionText: "exception_text"
  };
}

export function processReportPendingFields(): Array<TablePermissionFieldDefinition & { input: boolean }> {
  const registry = new Map(fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-process-reports")!).map((field) => [field.key, field]));
  return PROCESS_REPORT_PENDING_FIELDS.map((entry) => {
    const input = "input" in entry && entry.input === true;
    /* 可选输入列（例如异常）不为必填；其余输入列保持必填。 */
    const required = input && !("optional" in entry && entry.optional === true);
    const definition = registry.get(entry.key);
    return {
      key: entry.key, label: entry.label, type: definition?.type ?? "number",
      ...(definition?.options?.length ? { options: definition.options } : {}),
      editable: input, required, input
    } as TablePermissionFieldDefinition & { input: boolean };
  });
}

/** The only definition of fields required to progress a base plan into a weekly plan. */
export function weeklyAdmissionSql(resource: MasterPlanResource, tableAlias = "") {
  return (resource.weeklyAdmissionRequiredFields ?? []).map((field) => weeklyAdmissionPresentSql(camelToSnake(field), tableAlias)).join(" AND ") || "true";
}

function weeklyAdmissionPresentSql(column: string, tableAlias = "") {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  return `NULLIF(btrim(${prefix}${column}::text),'') IS NOT NULL`;
}

/** Labels and predicates intentionally derive from weeklyAdmissionRequiredFields, not a second UI list. */
export function weeklyAdmissionMissingSql(resource: MasterPlanResource, tableAlias = "") {
  const labels = new Map(fieldsFor(resource).map((field) => [field.key, field.label]));
  return `concat_ws('、',${(resource.weeklyAdmissionRequiredFields ?? []).map((field) =>
    `CASE WHEN NOT (${weeklyAdmissionPresentSql(camelToSnake(field), tableAlias)}) THEN '${String(labels.get(field) ?? field).replace(/'/g, "''")}' END`
  ).join(",")})`;
}

export function weeklyAdmissionMissingFields(resource: MasterPlanResource, values: Record<string, unknown>) {
  return (resource.weeklyAdmissionRequiredFields ?? []).filter((field) => values[field] == null || String(values[field]).trim() === "");
}
