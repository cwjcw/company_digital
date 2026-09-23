export type PermissionAction = "read" | "create" | "copy" | "update" | "delete" | "batch_print" | "batch_update" | "import" | "export";
export type ResourceKey =
  | "rolling-plan"
  | "monthly-plan"
  | "suppliers"
  | "dictionaries"
  | "processes"
  | "finished-goods-inbound"
  | "finished-goods-outbound"
  | "sales-orders"
  | "sales-summary-dashboard"
  | "organization"
  | "users"
  | "roles"
  | "audit-logs"
  | "imports";

export interface SessionUser {
  sub: string;
  username: string;
  roles: string[];
  divisions: string[] | "*";
  permissions: string[];
}

export interface PlanPeriod {
  id: string;
  year: number;
  month: number;
  status: string;
}

export const dictionarySeeds = {
  modelAge: ["新", "旧"],
  productAttribute: ["五金", "木作", "五金+木作"],
  surfaceNature: ["烤漆", "电镀"],
  specialItem: ["亚克力"],
  handlingMethod: ["自制", "中心外购", "外协", "自制+外协"],
  outsourcingMethod: ["成品", "毛坯", "部件"],
  division: ["事业一部", "事业二部", "事业三部", "事业四部", "贻居", "电镀厂"],
  deliveryMethod: ["空运", "海运", "汽运", "火车", "内河船运", "其他"]
} as const;

/**
 * KDOS 唯一正式标准工序 registry（KN-PROC-001）。
 * 旧 Planning 的 14 个 legacy process definitions 已彻底退役：工序下拉、字段权限、周期字段、
 * 倒排计划、工序报工、周计划/月度计划展示、seed 与 process_definitions 主数据都必须从这一份定义派生，
 * 不得再维护第二份工序名单，也不得重新引入 legacy code（woodwork / bakingPlating / assemblyPacking 等）。
 */
export type ProcessDefinition = {
  /** 数据库与接口使用的稳定 code。 */
  code: string;
  /** 界面展示名称。 */
  name: string;
  /** 1-based 正式顺序：下料→机加→折弯→点焊→焊接→木作→研磨→毛坯→表面处理→包装。 */
  order: number;
  /** 工序周期字段名（mps_process_cycles 列由 camelCase 转 snake_case，例如 blank → blank_days）。 */
  cycleField: string;
};

export const standardProcesses: ProcessDefinition[] = [
  { code: "cutting", name: "下料", order: 1, cycleField: "cuttingDays" },
  { code: "machining", name: "机加", order: 2, cycleField: "machiningDays" },
  { code: "bending", name: "折弯", order: 3, cycleField: "bendingDays" },
  { code: "spotWelding", name: "点焊", order: 4, cycleField: "spotWeldingDays" },
  { code: "welding", name: "焊接", order: 5, cycleField: "weldingDays" },
  { code: "woodworking", name: "木作", order: 6, cycleField: "woodworkingDays" },
  { code: "grinding", name: "研磨", order: 7, cycleField: "grindingDays" },
  { code: "blank", name: "毛坯", order: 8, cycleField: "blankDays" },
  { code: "surfaceTreatment", name: "表面处理", order: 9, cycleField: "surfaceTreatmentDays" },
  { code: "packaging", name: "包装", order: 10, cycleField: "packagingDays" }
];

/** 兼容导出：`processDefinitions` 就是这份唯一正式工序 registry，不再存在 legacy 14 工序表。 */
export const processDefinitions: ProcessDefinition[] = standardProcesses;

export const standardProcessCodes: readonly string[] = standardProcesses.map((process) => process.code);
export const standardProcessLabels: ReadonlyMap<string, string> = new Map(standardProcesses.map((process) => [process.code, process.name]));
export type StandardProcessCode = string;

/** 主计划周/月计划统一的生产进度口径：输入是 1.0 = 100% 的比例。 */
export function productionProgressRatio(value: unknown): number | null {
  if (value == null || value === "") return null;
  const ratio = Number(value);
  return Number.isFinite(ratio) ? ratio : null;
}

/** 前端单元格与导出说明共用的生产进度展示格式，不封顶。 */
export function formatProductionProgress(value: unknown): string {
  const ratio = productionProgressRatio(value);
  if (ratio == null) return "—";
  const percent = ratio * 100;
  return `${Number.isInteger(percent) ? percent : Math.round(percent * 10) / 10}%`;
}

if (standardProcesses.length !== 10) throw new Error(`KDOS must define exactly 10 standard processes, got ${standardProcesses.length}`);
if (standardProcesses.some((process, index) => process.order !== index + 1)) throw new Error("Standard process order must be 1..10 without gaps");
if (standardProcesses.some((process) => !process.code || !process.name || !process.cycleField)) throw new Error("Standard process entries require code, name and cycleField");
