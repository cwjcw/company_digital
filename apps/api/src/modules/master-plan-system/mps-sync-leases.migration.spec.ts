import { MpsSyncLeases1722920118000 } from "../../migrations/1722920118000-MpsSyncLeases";

describe("MPS 1A metadata migration", () => {
  it("adds only lease/scope/attempt metadata and indexes without replay, backfill or business DML", async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new MpsSyncLeases1722920118000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter(sql => sql.includes("ADD COLUMN lease_expires_at timestamptz NULL"))).toHaveLength(3);
    expect(statements.filter(sql => sql.startsWith("CREATE INDEX"))).toHaveLength(3);
    expect(statements.some(sql => sql.includes("attempts integer NOT NULL DEFAULT 0"))).toBe(true);
    expect(statements.some(sql => sql.includes("scope_json jsonb NULL"))).toBe(true);
    expect(statements.every(sql => /^(ALTER TABLE|CREATE INDEX)/.test(sql))).toBe(true);
    expect(statements.join("\n")).not.toMatch(/\b(UPDATE|DELETE|INSERT|TRUNCATE|DROP)\b/);
  });
  it("refuses a destructive down that would remove fencing and verification evidence", async () => {
    await expect(new MpsSyncLeases1722920118000().down()).rejects.toThrow("前向修复");
  });
});
