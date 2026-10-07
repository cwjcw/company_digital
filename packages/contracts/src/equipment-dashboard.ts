/** Six dashboard views share one export contract; keys refer to the existing read model. */
export type EquipmentDashboardExportColumn = {
  key: string; label: string; permissionField: string;
  kind: "text" | "number" | "percentage" | "duration" | "division" | "members";
};
const column = (key: string, label: string, kind: EquipmentDashboardExportColumn["kind"] = "number", permissionField = key): EquipmentDashboardExportColumn => ({ key, label, kind, permissionField });
const reporting = [
  column("expectedEquipmentCount", "应填设备"), column("filledEquipmentCount", "已填设备"), column("unfilledEquipmentCount", "未填设备"),
  column("reportingRate", "填报率", "percentage"), column("plannedRuntimeMinutes", "计划运行时间", "duration"),
  column("runtimeMinutes", "实际运行时长", "duration"), column("utilizationRate", "稼动率", "percentage")
];
const operation = [
  column("equipmentCount", "监控设备"), column("normalCount", "正常运行"), column("faultCount", "存在故障"),
  column("idleCount", "未运行"), column("unreportedCount", "未填报"), column("plannedRuntimeMinutes", "计划运行时间", "duration"),
  column("runtimeMinutes", "实际运行总时长", "duration"), column("runtimeDailyAverageMinutes", "实际运行日均", "duration"),
  column("utilizationRate", "稼动率", "percentage"), column("faultMinutes", "故障总时长", "duration"), column("faultDailyAverageMinutes", "故障日均", "duration")
];
export const equipmentDashboardExportDefinitions = {
  unreported: { title: "未填报设备明细", filenamePrefix: "equipment_unreported", columns: [
    column("divisionName", "所属事业部", "text", "divisionId"), column("usageDepartmentName", "所属部门", "text", "departmentId"),
    column("equipmentCode", "设备编码", "text"), column("equipmentName", "设备名称", "text"), column("responsibleUsers", "责任人", "members", "responsibleUserIds")
  ] },
  division_reporting: { title: "事业部填报与稼动情况", filenamePrefix: "equipment_division_reporting", columns: [column("division", "所属事业部", "division", "divisionId"), ...reporting] },
  department_reporting: { title: "部门填报与稼动情况", filenamePrefix: "equipment_department_reporting", columns: [column("division", "所属事业部", "division", "divisionId"), column("department", "使用部门/车间", "text", "departmentId"), ...reporting] },
  division_operation: { title: "事业部设备运行分析", filenamePrefix: "equipment_division_operation", columns: [column("division", "事业部", "text", "divisionId"), ...operation] },
  department_operation: { title: "按车间/使用部门设备运行分析", filenamePrefix: "equipment_department_operation", columns: [column("division", "事业部", "text", "divisionId"), column("department", "部门", "text", "departmentId"), ...operation] },
  utilization_detail: { title: "设备稼动率明细", filenamePrefix: "equipment_utilization_detail", columns: [
    column("division", "事业部", "text", "divisionId"), column("department", "使用部门/车间", "text", "departmentId"),
    column("equipmentCode", "设备编号", "text"), column("equipmentName", "设备名称", "text"),
    column("plannedRuntimeMinutes", "计划运行时间", "duration"), column("runtimeMinutes", "实际运行时长", "duration"),
    column("utilizationRate", "稼动率", "percentage"), column("faultMinutes", "故障时长", "duration")
  ] }
} as const;
export type EquipmentDashboardExportTable = keyof typeof equipmentDashboardExportDefinitions;
export const equipmentDashboardExportTables = Object.keys(equipmentDashboardExportDefinitions) as EquipmentDashboardExportTable[];
export function equipmentDashboardFilename(table: EquipmentDashboardExportTable, businessDate: string) {
  return `${equipmentDashboardExportDefinitions[table].filenamePrefix}_${businessDate}.xlsx`;
}
export function equipmentDashboardDivisionName(value: string) {
  return ["凯南事业一部", "凯南事业二部", "凯南事业三部", "凯南事业四部"].includes(value) ? value.slice(2) : value;
}
