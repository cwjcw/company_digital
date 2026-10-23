import { MpsProcessDueDateRefreshV11722920108000 } from "../../migrations/1722920108000-MpsProcessDueDateRefresh";

describe("MpsProcessDueDateRefreshV1", () => {
  it("permits due-date-only refresh while preserving every process snapshot field", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MpsProcessDueDateRefreshV11722920108000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("write_mode='RECALCULATE_DATES'");
    expect(sql).toContain("OLD.cycle_days,OLD.execution_enabled)");
    expect(sql).toContain("NEW.cycle_days,NEW.execution_enabled)");
    expect(sql).toContain("TG_OP='UPDATE'");
  });
});
