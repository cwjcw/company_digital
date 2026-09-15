import { tablePermissionFieldsFor, type TablePermissionFieldDefinition, type TableResourceCode } from "@kdos/contracts";

export type MasterPlanResource = {
  code: TableResourceCode; table: string; create: boolean; remove: boolean; defaultOrder: string;
  divisionField?: string; requiredOnCreate?: string[]; requiredOnUpdate?: string[]; requiredAlways?: string[]; weeklyAdmissionRequiredFields?: string[]; uniqueKeyFields?: string[];
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
  { code: "mps-process-reports", table: "mps_process_reports", create: true, remove: true, defaultOrder: "production_date DESC,order_number,item_code,delivery_number", divisionField: "divisionId", requiredOnCreate: ["weeklyPlanId", "processCode", "productionDate", "productionQuantity"], extraColumns: { processName: "process_name" } },
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
  processCode: [["cutting","下料"],["machining","机加"],["bending","折弯"],["spotWelding","点焊"],["welding","焊接"],["woodworking","木作"],["grinding","研磨"],["surfaceTreatment","表面处理"],["packaging","包装"]].map(([value,label]) => ({ value, label }))
};
function optionsFor(resource: TableResourceCode, fieldKey: string) {
  if (fieldKey === "status" && resource === "mps-technical-reports") return ["已完成", "未完成", "延期"].map((value) => ({ value, label: value }));
  if (fieldKey === "status" && resource === "mps-outsourcing-reports") return ["未开始", "进行中", "延期", "已入库"].map((value) => ({ value, label: value }));
  return commonOptions[fieldKey] ?? [];
}
const camelToSnake = (value: string) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const processes = ["cutting", "machining", "bending", "spotWelding", "welding", "woodworking", "grinding", "surfaceTreatment", "packaging"] as const;

function virtualColumns(resource: MasterPlanResource) {
  const output: Record<string, string> = {};
  for (const code of processes) {
    if (resource.code === "mps-weekly-plans") {
      const base = `FROM mps_weekly_process_plans process WHERE process.tenant_id=record.tenant_id AND process.weekly_plan_id=record.id AND process.process_code='${code}'`;
      output[`${code}CycleDays`] = `(SELECT max(process.cycle_days) ${base})`;
      output[`${code}DueDate`] = `(SELECT min(process.due_date) ${base})`;
      output[`${code}Status`] = `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(process.status='延期') THEN '延期' WHEN bool_and(process.status='已完成') THEN '已完成' WHEN bool_or(process.status='进行中') THEN '进行中' ELSE '未开始' END ${base})`;
      output[`${code}Exception`] = `(SELECT string_agg(DISTINCT process.exception_text,'；' ORDER BY process.exception_text) ${base} AND btrim(COALESCE(process.exception_text,''))<>'')`;
    }
    if (resource.code === "mps-monthly-plans") {
      const joined = `FROM mps_weekly_plans weekly JOIN mps_weekly_process_plans process ON process.tenant_id=weekly.tenant_id AND process.weekly_plan_id=weekly.id WHERE weekly.tenant_id=record.tenant_id AND weekly.order_number=record.order_number AND weekly.item_code=record.item_code AND process.process_code='${code}'`;
      output[`${code}CycleDays`] = `(SELECT max(process.cycle_days) ${joined})`;
      output[`${code}DueDate`] = `(SELECT min(process.due_date) ${joined} AND process.status<>'已完成')`;
      output[`${code}Status`] = `(SELECT CASE WHEN bool_or(process.status='延期') THEN '延期' WHEN bool_and(process.status='已完成') THEN '已完成' WHEN bool_or(process.status='进行中') THEN '进行中' ELSE '未开始' END ${joined})`;
      output[`${code}Exception`] = `(SELECT string_agg(DISTINCT process.exception_text,'；') ${joined} AND btrim(COALESCE(process.exception_text,''))<>'')`;
    }
  }
  if (resource.code === "mps-weekly-plans") Object.assign(output, {
    technicalStatus: `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(report.status='延期') THEN '延期' WHEN bool_and(report.status='已完成') THEN '已完成' ELSE '未完成' END FROM mps_technical_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    technicalException: `(SELECT string_agg(DISTINCT report.exception_text,'；' ORDER BY report.exception_text) FROM mps_technical_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND btrim(COALESCE(report.exception_text,''))<>'')`,
    hardwareStatus: `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(report.received OR report.actual_inbound_date IS NOT NULL) THEN '已完成' WHEN record.hardware_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='五金')`,
    hardwareException: `(SELECT string_agg(DISTINCT report.exception_text,'；' ORDER BY report.exception_text) FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='五金' AND btrim(COALESCE(report.exception_text,''))<>'')`,
    woodStatus: `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(report.received OR report.actual_inbound_date IS NOT NULL) THEN '已完成' WHEN record.wood_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='木作')`,
    woodException: `(SELECT string_agg(DISTINCT report.exception_text,'；' ORDER BY report.exception_text) FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='木作' AND btrim(COALESCE(report.exception_text,''))<>'')`,
    outsourcingStatus: `(SELECT CASE WHEN count(*)=0 THEN NULL WHEN bool_or(report.status='延期') THEN '延期' WHEN bool_and(report.status='已入库') THEN '已入库' WHEN bool_or(report.status='进行中') THEN '进行中' ELSE '未开始' END FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingException: `(SELECT string_agg(DISTINCT report.exception_text,'；' ORDER BY report.exception_text) FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND btrim(COALESCE(report.exception_text,''))<>'')`,
    outsourcingCycleDays: `(SELECT max(report.cycle_days) FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingDueDate: `(SELECT min(report.outsourcing_due_date) FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingActualInboundDate: `(SELECT max(report.actual_inbound_date) FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`
  });
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
      technicalException: `(SELECT string_agg(DISTINCT technical.exception_text,'；') ${weeklyFrom} JOIN mps_technical_reports technical ON technical.tenant_id=weekly.tenant_id AND technical.weekly_plan_id=weekly.id WHERE ${weeklyWhere} AND btrim(COALESCE(technical.exception_text,''))<>'')`,
      hardwareCycleDays: `(SELECT max(weekly.hardware_cycle_days) ${weekly})`,
      hardwareDueDate: `(SELECT min(weekly.hardware_due_date) ${weekly} AND weekly.pending_quantity>0)`,
      hardwareStatus: `(SELECT ${statusAggregate("CASE WHEN material.received OR material.actual_inbound_date IS NOT NULL THEN '已完成' WHEN weekly.hardware_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END")} ${weeklyFrom} JOIN mps_material_reports material ON material.tenant_id=weekly.tenant_id AND material.weekly_plan_id=weekly.id AND material.material_name='五金' WHERE ${weeklyWhere})`,
      hardwareException: `(SELECT string_agg(DISTINCT material.exception_text,'；') ${weeklyFrom} JOIN mps_material_reports material ON material.tenant_id=weekly.tenant_id AND material.weekly_plan_id=weekly.id AND material.material_name='五金' WHERE ${weeklyWhere} AND btrim(COALESCE(material.exception_text,''))<>'')`,
      woodCycleDays: `(SELECT max(weekly.wood_cycle_days) ${weekly})`,
      woodDueDate: `(SELECT min(weekly.wood_due_date) ${weekly} AND weekly.pending_quantity>0)`,
      woodStatus: `(SELECT ${statusAggregate("CASE WHEN material.received OR material.actual_inbound_date IS NOT NULL THEN '已完成' WHEN weekly.wood_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END")} ${weeklyFrom} JOIN mps_material_reports material ON material.tenant_id=weekly.tenant_id AND material.weekly_plan_id=weekly.id AND material.material_name='木作' WHERE ${weeklyWhere})`,
      woodException: `(SELECT string_agg(DISTINCT material.exception_text,'；') ${weeklyFrom} JOIN mps_material_reports material ON material.tenant_id=weekly.tenant_id AND material.weekly_plan_id=weekly.id AND material.material_name='木作' WHERE ${weeklyWhere} AND btrim(COALESCE(material.exception_text,''))<>'')`,
      outsourcingCycleDays: `(SELECT max(outsource.cycle_days) ${weeklyFrom} JOIN mps_outsourcing_reports outsource ON outsource.tenant_id=weekly.tenant_id AND outsource.weekly_plan_id=weekly.id WHERE ${weeklyWhere})`,
      outsourcingDueDate: `(SELECT min(outsource.outsourcing_due_date) ${weeklyFrom} JOIN mps_outsourcing_reports outsource ON outsource.tenant_id=weekly.tenant_id AND outsource.weekly_plan_id=weekly.id WHERE ${weeklyWhere} AND outsource.status<>'已入库')`,
      outsourcingStatus: `(SELECT ${statusAggregate("outsourcing.status")} ${weeklyFrom} JOIN mps_outsourcing_reports outsourcing ON outsourcing.tenant_id=weekly.tenant_id AND outsourcing.weekly_plan_id=weekly.id WHERE ${weeklyWhere})`,
      outsourcingException: `(SELECT string_agg(DISTINCT outsource.exception_text,'；') ${weeklyFrom} JOIN mps_outsourcing_reports outsource ON outsource.tenant_id=weekly.tenant_id AND outsource.weekly_plan_id=weekly.id WHERE ${weeklyWhere} AND btrim(COALESCE(outsource.exception_text,''))<>'')`,
      outsourcingActualInboundDate: `(SELECT max(outsource.actual_inbound_date) ${weeklyFrom} JOIN mps_outsourcing_reports outsource ON outsource.tenant_id=weekly.tenant_id AND outsource.weekly_plan_id=weekly.id WHERE ${weeklyWhere})`
    });
  }
  return output;
}
export function fieldsFor(resource: MasterPlanResource): TablePermissionFieldDefinition[] {
  return tablePermissionFieldsFor(resource.code).map((field) => {
    const options = optionsFor(resource.code, field.key);
    return options.length ? { ...field, options } : field;
  });
}
export function columnsFor(resource: MasterPlanResource): Record<string, string> {
  return { ...Object.fromEntries(fieldsFor(resource).map((field) => [field.key, camelToSnake(field.key)])), ...virtualColumns(resource), ...(resource.extraColumns ?? {}) };
}

/** The only definition of fields required to progress a base plan into a weekly plan. */
export function weeklyAdmissionSql(resource: MasterPlanResource, tableAlias = "") {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  const columns = columnsFor(resource);
  return (resource.weeklyAdmissionRequiredFields ?? []).map((field) => `${prefix}${columns[field]} IS NOT NULL`).join(" AND ") || "true";
}

export function weeklyAdmissionMissingFields(resource: MasterPlanResource, values: Record<string, unknown>) {
  return (resource.weeklyAdmissionRequiredFields ?? []).filter((field) => values[field] == null || String(values[field]).trim() === "");
}
