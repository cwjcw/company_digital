import { MpsProcessRoutingV11722920107000 } from "../../migrations/1722920107000-MpsProcessRoutingV1";

describe("MpsProcessRoutingV11722920107000", () => {
  it("adds tenant scoped routing tables and guards structural snapshot writes", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MpsProcessRoutingV11722920107000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");

    expect(sql).toContain("CREATE TABLE mps_division_process_configs");
    expect(sql).toContain("UNIQUE(tenant_id,division_id,process_code)");
    expect(sql).toContain("CREATE TABLE mps_item_process_routes");
    expect(sql).toContain("UNIQUE(tenant_id,item_code,process_code)");
    expect(sql).toContain("ALTER TABLE mps_item_process_routes ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("process_config_locked_at");
    expect(sql).toContain("UPDATE mps_weekly_plans weekly SET process_config_locked_at=now()");
    expect(sql).toContain("app.mps_process_config_write_mode");
    expect(sql).toContain("write_mode='INITIALIZE'");
    expect(sql).toContain("write_mode='CONFIRM'");
    expect(sql).toContain("AFTER INSERT OR UPDATE OF production_quantity ON mps_process_reports");
    expect(sql).not.toContain("INSERT INTO mps_item_process_routes");
    expect(sql).not.toContain("UPDATE mps_process_cycles");
  });
});
