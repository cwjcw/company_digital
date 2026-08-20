import { DrizzlePlanningRepository } from "./drizzle-planning.repository";

describe("DrizzlePlanningRepository risk dates", () => {
  it("normalizes PostgreSQL date objects before risk comparisons", async () => {
    const query = jest.fn(async (sql: string) => sql.includes("FROM planning.process_progress")
      ? { rows: [{ plan_item_id: "item-1", process_code: "machining", planned_date: new Date("2026-08-18T00:00:00Z"), status: "进行中", exception: null }] }
      : { rows: [
        { id: "item-1", order_number: "SO-1", item_number: "I-1", delivery_date: new Date("2026-08-19T00:00:00Z"), status: "PENDING", exception: "异常" },
        { id: "item-2", order_number: "SO-2", item_number: "I-2", delivery_date: new Date("2026-08-25T00:00:00Z"), status: "PENDING", exception: null }
      ] });
    const repository = new DrizzlePlanningRepository({ pool: { query } } as any);
    await expect(repository.riskSummary("tenant", "version", 7, "2026-08-20")).resolves.toMatchObject({ overdue: [{ id: "item-1", deliveryDate: "2026-08-19" }], dueSoon: [{ id: "item-2", deliveryDate: "2026-08-25" }], processOverdue: [{ processCode: "machining", plannedDate: "2026-08-18" }], openExceptions: [{ planItemId: "item-1", exception: "异常" }] });
  });
  it("rolls back all work when an import/repository transaction fails", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] }); const release = jest.fn();
    const repository = new DrizzlePlanningRepository({ pool: { connect: jest.fn().mockResolvedValue({ query, release }) } } as any);
    await expect((repository as any).transaction("tenant-1", async (client: any) => { await client.query("INSERT first imported row"); throw new Error("second row failed"); })).rejects.toThrow("second row failed");
    expect(query.mock.calls.map((entry) => entry[0])).toEqual(["BEGIN", "SELECT set_config('app.tenant_id', $1, true)", "INSERT first imported row", "ROLLBACK"]);
    expect(release).toHaveBeenCalled();
  });
});
