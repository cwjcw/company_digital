import { MasterPlanThreeDayWorkOrders1722920063000 } from "../../migrations/1722920063000-MasterPlanThreeDayWorkOrders";

describe("MasterPlanThreeDayWorkOrders1722920063000", () => {
  it("up：基础计划新增两个可空 date 列，并创建 3天生产工单表（weeklyPlanId 唯一身份 + FK + 日期约束 + RLS）", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanThreeDayWorkOrders1722920063000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");

    expect(sql).toContain("ALTER TABLE mps_base_plans ADD COLUMN IF NOT EXISTS blank_completion_date date NULL");
    expect(sql).toContain("ALTER TABLE mps_base_plans ADD COLUMN IF NOT EXISTS packaging_completion_date date NULL");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS mps_three_day_work_orders");
    /* 同步身份：weekly_plan_id NOT NULL + UNIQUE(tenant_id, weekly_plan_id) + FK→mps_weekly_plans；不含 delivery_number。 */
    expect(sql).toContain("weekly_plan_id uuid NOT NULL REFERENCES mps_weekly_plans(id) ON DELETE RESTRICT");
    expect(sql).toContain("CONSTRAINT uq_mps_three_day_work_order UNIQUE (tenant_id, weekly_plan_id)");
    expect(sql).not.toContain("delivery_number");
    /* 生产日期拆两个原子 date 列 + 同时为空/同时有值 + start<=end。 */
    expect(sql).toContain("production_start_date date");
    expect(sql).toContain("production_end_date date");
    expect(sql).toContain("CHECK ((production_start_date IS NULL) = (production_end_date IS NULL))");
    expect(sql).toContain("CHECK (production_start_date IS NULL OR production_end_date IS NULL OR production_start_date <= production_end_date)");
    /* 审计/版本 + 多租户 RLS。 */
    expect(sql).toContain("created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT");
    expect(sql).toContain("CONSTRAINT ck_mps_three_day_work_order_version CHECK (version > 0)");
    expect(sql).toContain("ALTER TABLE mps_three_day_work_orders ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY mps_three_day_work_orders_tenant_policy");
  });

  it("down：删除新表与基础计划两个日期列", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanThreeDayWorkOrders1722920063000().down({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("DROP TABLE IF EXISTS mps_three_day_work_orders");
    expect(sql).toContain("ALTER TABLE mps_base_plans DROP COLUMN IF EXISTS blank_completion_date");
    expect(sql).toContain("ALTER TABLE mps_base_plans DROP COLUMN IF EXISTS packaging_completion_date");
  });
});
