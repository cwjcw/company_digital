import { tablePermissionFieldsFor, type TablePermissionFieldDefinition, type TableResourceCode } from "@kdos/contracts";

export type MasterPlanResource = {
  code: TableResourceCode; table: string; create: boolean; remove: boolean; defaultOrder: string;
  divisionField?: string; requiredOnCreate?: string[]; requiredAlways?: string[]; uniqueKeyFields?: string[];
  allowedValues?: Partial<Record<string, string[]>>; extraColumns?: Record<string, string>;
};

export const MASTER_PLAN_RESOURCES: MasterPlanResource[] = [
  { code: "mps-erp-orders", table: "mps_erp_order_lines", create: false, remove: false, defaultOrder: "order_date DESC,order_number,item_code" },
  { code: "mps-customer-divisions", table: "mps_customer_division_mappings", create: true, remove: true, defaultOrder: "customer_code", divisionField: "primaryDivisionId", requiredOnCreate: ["customerCode", "primaryDivisionId"], uniqueKeyFields: ["customerCode"] },
  { code: "mps-order-allocations", table: "mps_order_allocations", create: true, remove: false, defaultOrder: "order_date DESC,order_number,item_code", divisionField: "divisionId", requiredOnCreate: ["orderNumber", "itemCode", "allocatedQuantity", "divisionId"], uniqueKeyFields: ["orderNumber", "itemCode"] },
  { code: "mps-process-cycles", table: "mps_process_cycles", create: true, remove: true, defaultOrder: "item_code", requiredOnCreate: ["itemCode"], uniqueKeyFields: ["itemCode"] },
  { code: "mps-group-plans", table: "mps_group_plans", create: false, remove: false, defaultOrder: "order_date DESC,order_number", divisionField: "primaryDivisionId" },
  { code: "mps-monthly-plans", table: "mps_monthly_plans", create: false, remove: false, defaultOrder: "order_date DESC,order_number,item_code", divisionField: "divisionId" },
  { code: "mps-shipping-plans", table: "mps_shipping_plans", create: true, remove: true, defaultOrder: "latest_customer_due_date,order_number,item_code,delivery_number", divisionField: "divisionId", requiredOnCreate: ["customerCode", "orderNumber", "itemCode", "itemName", "deliveryNumber", "latestCustomerDueDate", "plannedQuantity", "divisionId", "modelAge"], requiredAlways: ["itemName", "divisionId", "modelAge"], uniqueKeyFields: ["orderNumber", "itemCode", "deliveryNumber"], allowedValues: { modelAge: ["新", "旧"] }, extraColumns: { monthlyPlanId: "monthly_plan_id" } },
  { code: "mps-base-plans", table: "mps_base_plans", create: true, remove: false, defaultOrder: "latest_customer_due_date,order_number,item_code,delivery_number", divisionField: "divisionId", requiredOnCreate: ["orderNumber", "itemCode", "deliveryNumber", "latestCustomerDueDate", "plannedQuantity", "latestReviewDueDate", "productAttribute", "modelAge", "surfaceNature", "manufacturingMethod"], requiredAlways: ["latestReviewDueDate", "productAttribute", "modelAge", "surfaceNature", "manufacturingMethod"], uniqueKeyFields: ["orderNumber", "itemCode", "deliveryNumber"], allowedValues: { productAttribute: ["五金", "木作", "亚克力", "五金+木作"], surfaceNature: ["烤漆", "电镀"], modelAge: ["新", "旧"], manufacturingMethod: ["自制", "中心外购", "外协", "自制+外协"] } },
  { code: "mps-weekly-plans", table: "mps_weekly_plans", create: true, remove: false, defaultOrder: "latest_review_due_date,order_number,item_code,delivery_number", divisionField: "divisionId", requiredOnCreate: ["orderNumber", "itemCode", "deliveryNumber", "latestCustomerDueDate", "latestReviewDueDate", "plannedQuantity"], uniqueKeyFields: ["orderNumber", "itemCode", "deliveryNumber"] },
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
const camelToSnake = (value: string) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const processes = ["cutting", "machining", "bending", "spotWelding", "welding", "woodworking", "grinding", "surfaceTreatment", "packaging"] as const;

function virtualColumns(resource: MasterPlanResource) {
  const output: Record<string, string> = {};
  for (const code of processes) {
    if (resource.code === "mps-weekly-plans") {
      const base = `FROM mps_weekly_process_plans process WHERE process.tenant_id=record.tenant_id AND process.weekly_plan_id=record.id AND process.process_code='${code}'`;
      output[`${code}CycleDays`] = `(SELECT process.cycle_days ${base})`;
      output[`${code}DueDate`] = `(SELECT process.due_date ${base})`;
      output[`${code}Status`] = `(SELECT process.status ${base})`;
      output[`${code}Exception`] = `(SELECT process.exception_text ${base})`;
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
    technicalStatus: `(SELECT status FROM mps_technical_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    technicalException: `(SELECT exception_text FROM mps_technical_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    hardwareStatus: `(SELECT CASE WHEN received OR actual_inbound_date IS NOT NULL THEN '已完成' WHEN record.hardware_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='五金')`,
    hardwareException: `(SELECT exception_text FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='五金')`,
    woodStatus: `(SELECT CASE WHEN received OR actual_inbound_date IS NOT NULL THEN '已完成' WHEN record.wood_due_date<CURRENT_DATE THEN '延期' ELSE '未开始' END FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='木作')`,
    woodException: `(SELECT exception_text FROM mps_material_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id AND report.material_name='木作')`,
    outsourcingStatus: `(SELECT status FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingException: `(SELECT exception_text FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingCycleDays: `(SELECT cycle_days FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingDueDate: `(SELECT outsourcing_due_date FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`,
    outsourcingActualInboundDate: `(SELECT actual_inbound_date FROM mps_outsourcing_reports report WHERE report.tenant_id=record.tenant_id AND report.weekly_plan_id=record.id)`
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
export function fieldsFor(resource: MasterPlanResource): TablePermissionFieldDefinition[] { return tablePermissionFieldsFor(resource.code); }
export function columnsFor(resource: MasterPlanResource): Record<string, string> {
  return { ...Object.fromEntries(fieldsFor(resource).map((field) => [field.key, camelToSnake(field.key)])), ...virtualColumns(resource), ...(resource.extraColumns ?? {}) };
}
