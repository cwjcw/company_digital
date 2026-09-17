import { standardProcesses } from "@tracker/shared";
import { MasterPlanBlankProcessCycle1722920058000 } from "../../migrations/1722920058000-MasterPlanBlankProcessCycle";
import { MasterPlanProcessCodeConstraint1722920059000 } from "../../migrations/1722920059000-MasterPlanProcessCodeConstraint";
import { MASTER_PLAN_RESOURCE_MAP, columnsFor, fieldsFor, virtualColumns } from "./master-plan.config";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import type { MasterPlanActor } from "./master-plan.types";

const actor: MasterPlanActor = {
  tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester",
  permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-1", source: "web"
};
const directory = { listEnabled: jest.fn().mockResolvedValue([]) };
const PROCESS_ORDER = ["cutting", "machining", "bending", "spotWelding", "welding", "woodworking", "grinding", "blank", "surfaceTreatment", "packaging"];

describe("KN-PROC-001 unified process registry", () => {
  it("exposes the ten canonical processes with 毛坯 at order 8 between grinding and surfaceTreatment", () => {
    expect(standardProcesses.map((process) => process.code)).toEqual(PROCESS_ORDER);
    expect(standardProcesses.map((process) => process.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(standardProcesses.find((process) => process.code === "blank")).toMatchObject({ name: "毛坯", order: 8, cycleField: "blankDays" });
    expect(standardProcesses.find((process) => process.code === "surfaceTreatment")?.cycleField).toBe("surfaceTreatmentDays");
  });

  it("derives the 工序周期表 columns from the registry, including 毛坯周期 in the approved position", () => {
    const cycles = fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-process-cycles")!).map((field) => field.key);
    expect(cycles).toEqual([
      "itemCode", "itemName", "technicalDays",
      "cuttingDays", "machiningDays", "bendingDays", "spotWeldingDays", "weldingDays",
      "woodworkingDays", "grindingDays", "blankDays", "surfaceTreatmentDays", "packagingDays",
      "createdBy", "createdAt", "updatedBy", "updatedAt"
    ]);
    expect(cycles.indexOf("blankDays")).toBeGreaterThan(cycles.indexOf("grindingDays"));
    expect(cycles.indexOf("blankDays")).toBeLessThan(cycles.indexOf("surfaceTreatmentDays"));
    expect(columnsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-process-cycles")!).blankDays).toBe("blank_days");
  });

  it("keeps only the ten canonical process options everywhere processCode is selectable", () => {
    const options = fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-process-reports")!).find((field) => field.key === "processCode")?.options;
    expect(options?.map((option) => option.value)).toEqual(PROCESS_ORDER);
    expect(options?.find((option) => option.value === "blank")?.label).toBe("毛坯");
    for (const retired of ["drawingBom", "metalMain", "woodMain", "frontParts", "woodwork", "painting", "acrylic", "bakingPlating", "rearPackingParts", "assemblyPacking"]) {
      expect(options?.map((option) => option.value)).not.toContain(retired);
    }
  });

  it("exposes the ten processes and the 毛坯 weekly-plan field group through metadata", async () => {
    const metadata = new MasterPlanQueryService({} as never, directory as never).metadata("mps-weekly-plans", actor);
    expect(metadata.processes.map((process: { code: string }) => process.code)).toEqual(PROCESS_ORDER);
    const keys = metadata.fields.map((field: { key: string }) => field.key);
    /* KN-MPS-UI-001：每工序只保留 周期/交期/状态/生产进度，异常统一到唯一 exceptionSummary。 */
    expect(keys).toEqual(expect.arrayContaining(["blankCycleDays", "blankDueDate", "blankStatus", "blankProductionProgress"]));
    expect(keys).not.toContain("blankException");
    expect(keys.indexOf("blankStatus")).toBeGreaterThan(keys.indexOf("grindingStatus"));
    expect(keys.indexOf("blankStatus")).toBeLessThan(keys.indexOf("surfaceTreatmentStatus"));

    const columns = virtualColumns(MASTER_PLAN_RESOURCE_MAP.get("mps-weekly-plans")!);
    expect(Object.keys(columns)).toEqual(expect.arrayContaining(["blankCycleDays", "blankDueDate", "blankStatus", "blankProductionProgress"]));
    expect(Object.keys(columns)).not.toContain("blankException");
    expect(columns.blankStatus).toContain("process.process_code='blank'");
  });

  it("filters 毛坯 to the stable value blank on process reports", async () => {
    const query = jest.fn(async (sql: string) => sql.includes("count(*)") ? [{ count: 0 }] : []);
    const service = new MasterPlanQueryService({ query } as never, directory as never);
    await service.list("mps-process-reports", { filters: JSON.stringify({ processCode: "毛坯" }) }, actor);
    const dataSql = String(query.mock.calls.find(([sql]) => String(sql).startsWith("SELECT record.id"))?.[0] ?? "");
    const params = (query.mock.calls as unknown[][]).map((call) => call[1]);
    expect(dataSql).toContain("record.process_code::text = ANY($");
    expect(JSON.stringify(params)).toContain("blank");
  });

  it("creates the 毛坯 execution task and never duplicates it on re-run", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const service = new MasterPlanSyncService({} as never);
    const weekly = {
      id: "01a09d95-de03-7fe8-8fdc-934a6414ebf9", division_id: "22222222-2222-4222-8222-222222222222",
      order_number: "SO-1", item_code: "ITEM-1", item_name: "品项", delivery_number: 1,
      latest_review_due_date: "2026-09-30", planned_quantity: "100", manufacturing_method: "自制",
      technical_days: 1, cutting_days: 1, machining_days: 1, bending_days: 1, spot_welding_days: 1, welding_days: 1,
      woodworking_days: 1, grinding_days: 1, blank_days: 2, surface_treatment_days: 1, packaging_days: 1
    };
    await (service as any).ensureExecutionRows(manager, weekly, "KAINAN", "11111111-1111-4111-8111-111111111111", "tester");
    const inserts = manager.query.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.startsWith("INSERT INTO mps_weekly_process_plans"));
    expect(inserts).toHaveLength(10);
    expect(JSON.stringify(manager.query.mock.calls)).toContain("blank");
    expect(inserts.every((sql) => sql.includes("ON CONFLICT(tenant_id,weekly_plan_id,process_code)"))).toBe(true);
    /* 重跑同一周计划不会生成第二条毛坯任务（唯一身份仍是 tenant+weekly_plan_id+process_code）。 */
    manager.query.mockClear();
    await (service as any).ensureExecutionRows(manager, weekly, "KAINAN", "11111111-1111-4111-8111-111111111111", "tester");
    expect(manager.query.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.startsWith("INSERT INTO mps_weekly_process_plans"))).toHaveLength(10);
  });
});

describe("KN-PROC-001 migration", () => {
  it("adds blank_days and converges process_definitions to the ten canonical processes", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanBlankProcessCycle1722920058000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement));
    const joined = sql.join("\n");

    expect(sql.some((statement) => statement.includes("ADD COLUMN IF NOT EXISTS blank_days integer NULL"))).toBe(true);
    expect(joined).toContain("ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order");
    for (const code of PROCESS_ORDER) {
      expect(query.mock.calls.some(([, params]) => (params as unknown[])?.includes(code))).toBe(true);
    }
    expect(joined).toContain("DELETE FROM process_definitions definition");
    expect(joined).toContain("WHERE code <> ALL($1::varchar[])");
    /* 历史周期不得凭空填写。 */
    expect(joined).not.toContain("blank_days=");
  });

  it("rolls back the blank cycle column and restores the retired definitions on down", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanBlankProcessCycle1722920058000().down({ query } as never);
    const joined = query.mock.calls.map(([statement]) => String(statement)).join("\n");

    expect(joined).toContain("DROP COLUMN IF EXISTS blank_days");
    const restored = (query.mock.calls as unknown[][]).map((call) => call[1]).flat();
    expect(restored).toContain("drawingBom");
    expect(restored).toContain("assemblyPacking");
    expect(restored).toContain("焊接/点焊");
  });

  it("widens the weekly task and process report process gates to the ten canonical codes", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanProcessCodeConstraint1722920059000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");

    expect(sql).toContain("ALTER TABLE mps_weekly_process_plans ADD CONSTRAINT ck_mps_weekly_process_code CHECK(process_code IN ('cutting','machining','bending','spotWelding','welding','woodworking','grinding','blank','surfaceTreatment','packaging'))");
    expect(sql).toContain("ALTER TABLE mps_process_reports ADD CONSTRAINT ck_mps_process_report_code CHECK(process_code IN ('cutting','machining','bending','spotWelding','welding','woodworking','grinding','blank','surfaceTreatment','packaging'))");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS ck_mps_weekly_process_code");

    const rollback = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanProcessCodeConstraint1722920059000().down({ query: rollback } as never);
    const down = rollback.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(down).toContain("CHECK(process_code IN ('cutting','machining','bending','spotWelding','welding','woodworking','grinding','surfaceTreatment','packaging'))");
    expect(down).not.toContain("'blank'");
  });
});
