import { MasterPlanWeeklyIdentity1722920056000 } from "../../migrations/1722920056000-MasterPlanWeeklyIdentity";

describe("MasterPlanWeeklyIdentity1722920056000", () => {
  it("guards base ownership, merges duplicate children and replaces business-key uniqueness", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanWeeklyIdentity1722920056000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");

    expect(sql).toContain("mps_weekly_plans contains rows without base_plan_id");
    expect(sql).toContain("ALTER COLUMN base_plan_id SET NOT NULL");
    expect(sql).toContain("ADD CONSTRAINT uq_mps_weekly_base UNIQUE(tenant_id,base_plan_id)");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS uq_mps_technical_report");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS uq_mps_material_report");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS uq_mps_outsourcing_report");
    expect(sql).toContain("WEEKLY_CHILD_DUPLICATE_REPAIRED");
    expect(sql).toContain("drawing_due_date=COALESCE(target.drawing_due_date");
    expect(sql).toContain("actual_inbound_date=COALESCE(target.actual_inbound_date");
    expect(sql).toContain("ADD CONSTRAINT uq_mps_technical_weekly UNIQUE(tenant_id,weekly_plan_id)");
    expect(sql).toContain("ADD CONSTRAINT uq_mps_material_weekly UNIQUE(tenant_id,weekly_plan_id,material_name)");
  });
});
