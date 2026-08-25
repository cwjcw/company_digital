import type { ColDef, ColGroupDef } from "ag-grid-community";
import dayjs from "dayjs";
import type { FieldAccess, PlanningFieldDefinition } from "./column-registry";
import { getValue } from "../../../api";
import { formatDueDate, isDueDateLabel } from "../../../shared/date-format";
import { formatAuditUser } from "../../../shared/audit-fields";

export type DictionaryOptions = Record<string, string[]>;
export type RuntimePlanningField = PlanningFieldDefinition & { access?: FieldAccess };

function tone(field: RuntimePlanningField) {
  const groups = ["外协相关", "图纸&BOM", "五金主材", "木作主材", "机加", "焊接", "毛坯", "电镀", "亚克力", "烤漆", "组装&包装", "包装打托"];
  const index = groups.indexOf(field.groupLabel);
  return index < 0 ? undefined : index % 2 === 0 ? "a" : "b";
}

function column(field: RuntimePlanningField, editMode: boolean, dictionaries: DictionaryOptions, auditNames: ReadonlyMap<string, string>): ColDef {
  const numeric = ["decimal", "integer"].includes(field.dataType);
  const fieldTone = tone(field);
  return {
    field: field.code, headerName: field.label,
    editable: editMode && field.access === "EDITABLE" && field.editable,
    pinned: field.pinned ? "left" : undefined, width: field.width, minWidth: field.code === "sequence" ? 48 : 52,
    resizable: true, sortable: field.sortable, headerTooltip: field.label,
    tooltipValueGetter: ({ value }) => value == null || value === "" ? field.label : String(value),
    type: numeric ? "numericColumn" : undefined,
    cellEditor: field.dataType === "date" ? "agDateStringCellEditor" : field.editorType === "dictionary" ? "agSelectCellEditor" : undefined,
    cellEditorParams: field.editorType === "dictionary" ? { values: dictionaries[field.dictionaryCode ?? ""] ?? [] } : undefined,
    headerClass: fieldTone ? `column-tone-${fieldTone}-header` : undefined,
    cellClass: fieldTone ? `column-tone-${fieldTone}` : undefined,
    valueGetter: ({ data }) => field.dataType === "image" ? (data?.imageRefs?.length ?? 0) : getValue(data, field.code),
    valueFormatter: ["createdBy", "updatedBy"].includes(field.code) ? ({ value }) => formatAuditUser(value, auditNames)
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

export function buildPlanningColumns(fields: RuntimePlanningField[], editMode: boolean, hidden: string[], dictionaries: DictionaryOptions, auditNames: ReadonlyMap<string, string> = new Map()) {
  const visible = fields.filter((field) => field.visible && !hidden.includes(field.code) && field.access !== "HIDDEN").sort((a, b) => a.order - b.order);
  const output: Array<ColDef | ColGroupDef> = [];
  for (let index = 0; index < visible.length;) {
    const field = visible[index]!;
    const group = field.groupLabel;
    let end = index + 1;
    while (end < visible.length && visible[end]!.groupLabel === group) end++;
    const groupFields = visible.slice(index, end);
    const fieldTone = tone(field);
    output.push({ headerName: group, marryChildren: true, headerClass: fieldTone ? `column-tone-${fieldTone}-header` : undefined, children: groupFields.map((entry) => column(entry, editMode, dictionaries, auditNames)) });
    index = end;
  }
  return output;
}
