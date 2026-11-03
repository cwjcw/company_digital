import { UserTablePreferences1722920117000 } from "./1722920117000-UserTablePreferences";

describe("UserTablePreferences migration", () => {
  it("adds/removes the preference JSONB on the existing user/tenant record", async () => {
    const query = jest.fn();
    const migration = new UserTablePreferences1722920117000();
    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ALTER TABLE users ADD COLUMN IF NOT EXISTS table_preferences jsonb"));
    await migration.down({ query } as never);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("DROP COLUMN IF EXISTS table_preferences"));
  });
});
