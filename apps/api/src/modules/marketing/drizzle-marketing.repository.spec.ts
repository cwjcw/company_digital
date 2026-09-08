import { DrizzleMarketingRepository } from "./drizzle-marketing.repository";

describe("DrizzleMarketingRepository order-schedule batch deletion", () => {
  it("locks, version-checks, deletes, and audits every selected row in one transaction", async () => {
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("SELECT * FROM marketing.order_schedules")) return { rows: [{ id: values?.[1], version: 3 }], rowCount: 1 };
      if (sql.startsWith("DELETE FROM marketing.order_schedules")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const release = jest.fn();
    const repository = new DrizzleMarketingRepository({ pool: { connect: jest.fn().mockResolvedValue({ query, release }) } } as any);

    await expect(repository.batchDeleteSchedules("tenant-1", [
      { id: "schedule-1", expectedVersion: 3 }, { id: "schedule-2", expectedVersion: 3 }
    ], {
      userId: "user-1", username: "测试用户", tenantCode: "KAINAN", permissions: ["order-schedule:*:delete"], requestId: "request-1"
    })).resolves.toEqual({ deleted: 2 });

    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith("SELECT * FROM marketing.order_schedules"))).toHaveLength(2);
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith("DELETE FROM marketing.order_schedules"))).toHaveLength(2);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO audit.audit_logs"))).toHaveLength(3);
    expect(query.mock.calls.map(([sql]) => sql).slice(-1)).toEqual(["COMMIT"]);
    expect(release).toHaveBeenCalled();
  });
});

describe("DrizzleMarketingRepository division review confirmation", () => {
  it("creates by order and item, but updates only the three approved target business fields", async () => {
    let sourceIndex = 0;
    const sources = [
      { id: "review-1", source_order_schedule_id: "schedule-1", customer_code: "C001", order_number: "SO001", item_number: "ITEM001", item_name: "品项1", customer_due_date: "2026-09-20", division_review_due_date: "2026-09-18", order_total_quantity: "12.5000", status: "NORMAL", version: 2 },
      { id: "review-2", source_order_schedule_id: "schedule-2", customer_code: "C002", order_number: "SO002", item_number: "ITEM002", item_name: "品项2", customer_due_date: "2026-09-21", division_review_due_date: "2026-09-19", order_total_quantity: "8.0000", status: "NORMAL", version: 4 }
    ];
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith("SELECT result FROM integration.import_jobs")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT * FROM planning.division_order_reviews")) return { rows: [sources[sourceIndex++]], rowCount: 1 };
      if (sql.startsWith("SELECT * FROM planning.rolling_plan_items")) return sourceIndex === 1
        ? { rows: [{ id: "target-1", customer_name: "保留客户", responsible_org_id: "keep-org", legacy_data: { itemName: "保留品名" } }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
      if (sql.startsWith("UPDATE planning.rolling_plan_items")) return { rows: [{ id: "target-1" }], rowCount: 1 };
      if (sql.startsWith("SELECT coalesce(max(sequence)")) return { rows: [{ value: 10 }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO planning.rolling_plan_items")) return { rows: [{ id: "target-2" }], rowCount: 1 };
      if (sql.startsWith("UPDATE planning.division_order_reviews")) return { rows: [{ id: sourceIndex === 1 ? "review-1" : "review-2" }], rowCount: 1 };
      if (sql.startsWith("SELECT count(*)::integer")) return { rows: [{ count: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const release = jest.fn();
    const repository = new DrizzleMarketingRepository({ pool: { connect: jest.fn().mockResolvedValue({ query, release }) } } as any);

    await expect(repository.confirmDivisionOrderReviews("tenant-1", [
      { id: "review-1", expectedVersion: 2, responsibleOrgId: null },
      { id: "review-2", expectedVersion: 4, responsibleOrgId: "org-2" }
    ], 2, [], "00000000-0000-7000-8000-000000000099", {
      userId: "user-1", username: "测试用户", tenantCode: "KAINAN", permissions: ["*"], requestId: "request-1"
    })).resolves.toMatchObject({ confirmed: 2, matched: 1, created: 1, updated: 1, failed: [] });

    const targetUpdateSql = String(query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE planning.rolling_plan_items"))?.[0]);
    expect(targetUpdateSql).toContain("production_quantity=$4");
    expect(targetUpdateSql).toContain("delivery_date=$5");
    expect(targetUpdateSql).toContain("reviewDueDate");
    expect(targetUpdateSql).not.toContain("customer_name=");
    expect(targetUpdateSql).not.toContain("responsible_org_id=");
    expect(targetUpdateSql).not.toContain("itemName");
    expect(query.mock.calls.map(([sql]) => sql).slice(-1)).toEqual(["COMMIT"]);
    expect(release).toHaveBeenCalled();
  });
});
