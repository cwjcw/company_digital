import { EquipmentStatusPlannedRuntimeAllowZero1722920074000 } from "../../migrations/1722920074000-EquipmentStatusPlannedRuntimeAllowZero";

describe("设备状态计划运行时间 allow-zero migration", () => {
  it("UP 将同名约束改为允许 NULL、0 和正数，并继续拒绝负数", async () => {
    const statements: string[] = [];
    await new EquipmentStatusPlannedRuntimeAllowZero1722920074000().up({
      query: async (sql: string) => { statements.push(sql); return []; }
    } as any);
    const sql = statements.join("\n");
    expect(sql).toContain("DROP CONSTRAINT ck_equipment_status_planned_runtime");
    expect(sql).toContain("ADD CONSTRAINT ck_equipment_status_planned_runtime");
    expect(sql).toContain("planned_runtime_minutes IS NULL OR planned_runtime_minutes >= 0");
    expect(sql).not.toContain("planned_runtime_minutes > 0");
    expect(sql).not.toMatch(/UPDATE|DELETE|SET\s+planned_runtime_minutes/i);
  });

  it("DOWN 只恢复旧约束，不为满足旧约束改写 0 值数据", async () => {
    const statements: string[] = [];
    await new EquipmentStatusPlannedRuntimeAllowZero1722920074000().down({
      query: async (sql: string) => { statements.push(sql); return []; }
    } as any);
    const sql = statements.join("\n");
    expect(sql).toContain("planned_runtime_minutes IS NULL OR planned_runtime_minutes > 0");
    expect(sql).not.toMatch(/UPDATE|DELETE|SET\s+planned_runtime_minutes/i);
  });
});
