import { MasterPlanLiveAdmission1722920064000 } from "../../migrations/1722920064000-MasterPlanLiveAdmission";
import { MASTER_PLAN_ERP_ADMISSION } from "./master-plan.erp-admission";

/** KN-MPS-LIVE-002：准入边界 Migration 的只增不改与可回滚性。 */
describe("MasterPlanLiveAdmission1722920064000", () => {
  const run = async (direction: "up" | "down") => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanLiveAdmission1722920064000()[direction]({ query } as never);
    return (query.mock.calls as Array<[unknown]>).map(([statement]) => String(statement)).join("\n");
  };

  it("up：新增来源身份别名表、水位/计数列，并去掉事业部列默认值", async () => {
    const sql = await run("up");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS mps_order_line_source_aliases");
    expect(sql).toContain("mps_order_line_id uuid NOT NULL REFERENCES mps_erp_order_lines(id) ON DELETE RESTRICT");
    expect(sql).toContain("CONSTRAINT uq_mps_order_line_alias_source UNIQUE (tenant_id, source_system, source_database, source_key)");
    expect(sql).toContain("bound_at timestamptz NOT NULL DEFAULT now()");
    expect(sql).toContain("bound_reason varchar(64) NOT NULL");
    /* 多租户 RLS 与其它 mps_* 表一致。 */
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY mps_order_line_source_aliases_tenant_policy");
    expect(sql).toContain("ALTER TABLE mps_sync_configs ADD COLUMN IF NOT EXISTS watermark_at timestamptz");
    expect(sql).toContain("ALTER TABLE mps_sync_logs ADD COLUMN IF NOT EXISTS metrics jsonb");
    expect(sql).toContain("ALTER TABLE mps_order_allocations ALTER COLUMN division_id DROP DEFAULT");
    expect(sql).toContain("多个开放星期请使用英文逗号分隔，例如：2,4,5");
    /* 绝不重建/清空主计划业务表。 */
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS mps_(erp_order_lines|order_allocations|monthly_plans|base_plans|weekly_plans)\b/);
    expect(sql).not.toMatch(/TRUNCATE|DELETE FROM/i);
  });

  it("down：完整回滚（表/列/默认值/说明），且不删除业务数据", async () => {
    const sql = await run("down");

    expect(sql).toContain("DROP TABLE IF EXISTS mps_order_line_source_aliases");
    expect(sql).toContain("ALTER TABLE mps_sync_logs DROP COLUMN IF EXISTS metrics");
    expect(sql).toContain("ALTER TABLE mps_sync_configs DROP COLUMN IF EXISTS watermark_at");
    expect(sql).toContain("ALTER TABLE mps_order_allocations ALTER COLUMN division_id SET DEFAULT 'd23442f9-4862-4641-b4a7-c8d470bc56ea'::uuid");
    expect(sql).toContain("description='1=周一，5=周五，7=周日'");
    expect(sql).not.toMatch(/DELETE FROM mps_/);
  });

  it("账套白名单常量与 Migration 描述保持一致（只读科加）", () => {
    expect(MASTER_PLAN_ERP_ADMISSION.sourceDatabase).toBe("UFTData418971_000003");
    expect(MASTER_PLAN_ERP_ADMISSION.orderDateFrom).toBe("2026-09-17");
  });
});
