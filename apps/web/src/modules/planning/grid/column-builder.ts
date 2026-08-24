import type { ColDef, ColGroupDef } from "ag-grid-community";
import dayjs from "dayjs";
import type { FieldAccess, PlanningFieldDefinition } from "./column-registry";
import { getValue } from "../../../api";
import { formatDueDate, isDueDateLabel } from "../../../shared/date-format";

export type DictionaryOptions = Record<string, string[]>;
export type RuntimePlanningField = PlanningFieldDefinition & { access?: FieldAccess };

const collapsibleStages = [
  { header: "毛坯", groups: ["前道配件", "机加", "焊接/点焊", "研磨", "毛坯"], representative: "毛坯", tone: "a" },
  { header: "烤漆/电镀", groups: ["木作", "油漆", "亚克力", "烤漆/电镀"], representative: "烤漆/电镀", tone: "b" },
  { header: "组装&包装", groups: ["后道包材&配件", "组装&包装"], representative: "组装&包装", tone: "a" }
] as const;

function tone(field: RuntimePlanningField) {
  const fixed: Record<string, "a" | "b"> = { "外协相关": "a", "图纸&BOM": "b", "五金主材": "a", "木作主材": "b" };
  return fixed[field.groupLabel] || collapsibleStages.find((stage) => stage.groups.includes(field.groupLabel as never))?.tone;
}

function column(field: RuntimePlanningField, editMode: boolean, dictionaries: DictionaryOptions): ColDef {
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
    valueFormatter: field.dataType === "image" ? ({ value }) => value ? `${value} 张` : "上传"
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

export function buildPlanningColumns(fields: RuntimePlanningField[], editMode: boolean, hidden: string[], dictionaries: DictionaryOptions) {
  const visible = fields.filter((field) => field.visible && !hidden.includes(field.code) && field.access !== "HIDDEN").sort((a, b) => a.order - b.order);
  const output: Array<ColDef | ColGroupDef> = [];
  const handled = new Set<string>();
  const stages = new Set<string>();
  for (const field of visible) {
    const group = field.groupLabel;
    if (handled.has(group)) continue;
    const stage = collapsibleStages.find((entry) => entry.groups.includes(group as never));
    if (stage) {
      if (stages.has(stage.header)) continue;
      stages.add(stage.header);
      const children = stage.groups.flatMap((stageGroup) => {
        const groupFields = visible.filter((entry) => entry.groupLabel === stageGroup);
        if (!groupFields.length) return [];
        handled.add(stageGroup);
        return [{ headerName: stageGroup, marryChildren: true, columnGroupShow: stageGroup === stage.representative ? undefined : "open", headerClass: `column-tone-${stage.tone}-header`, children: groupFields.map((entry) => column(entry, editMode, dictionaries)) } as ColGroupDef];
      });
      if (children.length) output.push({ headerName: stage.header, marryChildren: true, openByDefault: false, headerClass: `column-tone-${stage.tone}-header`, children });
      continue;
    }
    handled.add(group);
    const groupFields = visible.filter((entry) => entry.groupLabel === group);
    const fieldTone = tone(field);
    output.push({ headerName: group, marryChildren: true, headerClass: fieldTone ? `column-tone-${fieldTone}-header` : undefined, children: groupFields.map((entry) => column(entry, editMode, dictionaries)) });
  }
  output.push({ headerName: "审计信息", marryChildren: true, children: [
    { headerName: "创建时间", field: "createdAt", editable: false, width: 168, valueFormatter: ({ value }) => value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—" },
    { headerName: "最后修改时间", field: "updatedAt", editable: false, width: 168, valueFormatter: ({ value }) => value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—" }
  ] });
  return output;
}
