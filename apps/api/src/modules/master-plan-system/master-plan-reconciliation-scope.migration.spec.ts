import { MasterPlanReconciliationScope1722920065000 } from "../../migrations/1722920065000-MasterPlanReconciliationScope";

describe("KN-MPS-PERF-REPORT-001 reconciliation scope migration", () => {
  it("adds only the durable outbox scope needed for targeted report reconciliation", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new MasterPlanReconciliationScope1722920065000();
    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith("ALTER TABLE mps_reconciliation_outbox ADD COLUMN IF NOT EXISTS scope_json jsonb NULL");
    await migration.down({ query } as never);
    expect(query).toHaveBeenCalledWith("ALTER TABLE mps_reconciliation_outbox DROP COLUMN IF EXISTS scope_json");
  });
});
