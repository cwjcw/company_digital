import type { ColDef, ColGroupDef } from "ag-grid-community";
import dayjs from "dayjs";
import type { FieldAccess, PlanningFieldDefinition } from "./column-registry";
import { getValue } from "../../../api";
import { formatDueDate, isDueDateLabel } from "../../../shared/date-format";
import { formatAuditUser } from "../../../shared/audit-fields";

export type DictionaryOptions = Record<string, string[]>;
export type DepartmentOption = { id: string; name: string; pathLabel: string };
export type RuntimePlanningField = PlanningFieldDefinition & { access?: FieldAccess };

const monthlyPlanNonDisplayFields = new Set(["unitPrice", "inboundAmount", "balanceAmount"]);

export function monthlyPlanDisplayFields(fields: RuntimePlanningField[]): RuntimePlanningField[] {
  const ordered = fields.filter((field) => !monthlyPlanNonDisplayFields.has(field.code));
  const customerIndex = ordered.findIndex((field) => field.code === "customer");
  const orderNumberIndex = ordered.findIndex((field) => field.code === "orderNumber");
  if (customerIndex >= 0 && orderNumberIndex >= 0) {
    const [customer] = ordered.splice(customerIndex, 1);
    ordered.splice(ordered.findIndex((field) => field.code === "orderNumber"), 0, { ...customer!, pinned: true });
  }
  return ordered.map((field, index) => ({ ...field, order: index }));
}

function tone(field: RuntimePlanningField) {
  const groups = ["外协相关", "图纸&BOM", "五金主材", "木作主材", "机加", "焊接", "毛坯", "电镀", "亚克力", "烤漆", "组装&包装", "包装打托"];
  const index = groups.indexOf(field.groupLabel);
  return index < 0 ? undefined : index % 2 === 0 ? "a" : "b";
}

function column(field: RuntimePlanningField, editMode: boolean, dictionaries: DictionaryOptions, auditNames: ReadonlyMap<string, string>, departments: DepartmentOption[]): ColDef {
  const numeric = ["decimal", "integer"].includes(field.dataType);
  const fieldTone = tone(field);
  const departmentNames = new Map(departments.map((department) => [department.id, department.name]));
  const departmentPaths = new Map(departments.map((department) => [department.id, department.pathLabel]));
  return {
    field: field.code, headerName: field.label,
    editable: editMode && field.access === "EDITABLE" && field.editable,
    pinned: field.pinned ? "left" : undefined, width: field.width, minWidth: field.code === "sequence" ? 48 : 52,
    resizable: true, sortable: field.sortable, headerTooltip: field.label,
    filter: "agTextColumnFilter",
    filterParams: { filterOptions: ["contains"], maxNumConditions: 1, buttons: ["apply", "clear"], closeOnApply: true },
    filterValueGetter: ({ data }) => {
      const value = getValue(data, field.code);
      return field.dataType === "department" && value ? departmentNames.get(String(value)) ?? String(value) : value;
    },
    tooltipValueGetter: ({ value }) => value == null || value === "" ? field.label : field.dataType === "department" ? departmentNames.get(String(value)) ?? String(value) : String(value),
    type: numeric ? "numericColumn" : undefined,
    cellEditor: field.dataType === "date" ? "agDateStringCellEditor" : ["dictionary", "department"].includes(field.editorType ?? "") ? "agSelectCellEditor" : undefined,
    cellEditorParams: field.editorType === "dictionary" ? { values: dictionaries[field.dictionaryCode ?? ""] ?? [] }
      : field.editorType === "department" ? { values: departments.map((department) => department.id), formatValue: (value: string) => departmentPaths.get(value) ?? value } : undefined,
    headerClass: fieldTone ? `column-tone-${fieldTone}-header` : undefined,
    cellClass: fieldTone ? `column-tone-${fieldTone}` : undefined,
    valueGetter: ({ data }) => field.dataType === "image" ? (data?.imageRefs?.length ?? 0) : getValue(data, field.code),
    valueFormatter: ["createdBy", "updatedBy"].includes(field.code) ? ({ value }) => formatAuditUser(value, auditNames)
      : field.dataType === "department" ? ({ value }) => value ? departmentNames.get(String(value)) ?? String(value) : ""
      : field.dataType === "image" ? ({ value }) => value ? `${value} 张` : "上传"
      : field.rendererType === "datetime" ? ({ value }) => value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—"
      : field.dataType === "date" ? ({ value }) => isDueDateLabel(field.label) ? formatDueDate(value) : value ? dayjs(value).format("MM-DD") : "" : undefined,
    valueParser: numeric ? ({ newValue }) => newValue === "" ? null : Number(newValue) : undefined,
    cellClassRules: field.rendererType === "status" ? {
      "process-status-complete": ({ value }) => value === "已完成" || value === "完成" || value === "COMPLETED",
      "process-status-progress": ({ value }) => value === "进行中" || value === "IN_PROGRESS",
      "process-status-warning": ({ value }) => value === "即将延期",
      "process-status-overdue": ({ value }) => value === "延期"
    } : undefined
  };
}

export function buildPlanningColumns(fields: RuntimePlanningField[], editMode: boolean, hidden: string[], dictionaries: DictionaryOptions, auditNames: ReadonlyMap<string, string> = new Map(), departments: DepartmentOption[] = []) {
  const visible = fields.filter((field) => field.visible && !hidden.includes(field.code) && field.access !== "HIDDEN").sort((a, b) => a.order - b.order);
  const output: Array<ColDef | ColGroupDef> = [];
  for (let index = 0; index < visible.length;) {
    const field = visible[index]!;
    const group = field.groupLabel;
    let end = index + 1;
    while (end < visible.length && visible[end]!.groupLabel === group) end++;
    const groupFields = visible.slice(index, end);
    const fieldTone = tone(field);
    output.push({ headerName: group, marryChildren: true, headerClass: fieldTone ? `column-tone-${fieldTone}-header` : undefined, children: groupFields.map((entry) => column(entry, editMode, dictionaries, auditNames, departments)) });
    index = end;
  }
  return output;
}
