import { fields } from "./rd-progress.model";
export type StatusTone = "default" | "processing" | "warning" | "success" | "error";
const tones: Record<string, StatusTone> = { NOT_APPLICABLE: "default", NOT_STARTED: "error", DESIGN_IN_PROGRESS: "warning", IN_PROGRESS: "processing", WAITING_ROUTING: "warning", ROUTING_IN_PROGRESS: "processing", COMPLETE: "success", ABNORMAL: "error" };
export const statusOptions = (field: string) => fields.find(entry => entry.key === field)?.options ?? [];
export const rdStatuses = statusOptions("rdStatus");
export const statusMeta = (value: unknown, field = "rdStatus") => ({
  label: statusOptions(field).find(option => option.value === value)?.label ?? String(value ?? "—"),
  tone: tones[String(value)] ?? "default"
});
export const orderStatuses: Record<string, string> = { COMPLETE: "研发完成", IN_PROGRESS: "研发进行中", ABNORMAL: "异常", NOT_APPLICABLE: "不适用" };
export const routingSources: Record<string, string> = { STANDARD_ROUTING_REFERENCE: "标准路线", ITEM_PLANT_MATCH: "品项路线" };
