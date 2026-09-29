import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("KDOS-DELIVERY-CODE-AUTO-001 migration", () => {
  const sql = readFileSync(join(__dirname, "../../migrations/1722920075000-MasterPlanDeliveryCodeAuto.ts"), "utf8");

  it("keeps the existing UUID primary key and adds a tenant/order/item counter", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS mps_delivery_code_counters");
    expect(sql).toContain("CONSTRAINT uq_mps_delivery_code_counter UNIQUE(tenant_id,order_number,item_code)");
    expect(sql).toContain("ALTER COLUMN delivery_number TYPE varchar(32)");
    expect(sql).toContain("USING lpad(delivery_number::text,3,'0')");
    expect(sql).not.toContain("DROP COLUMN id");
  });

  it("seeds the counter from existing source/base records and never uses a count", () => {
    expect(sql).toContain("max(delivery_number::bigint)+1");
    expect(sql).toContain("mps_shipping_plans");
    expect(sql).toContain("mps_base_plans");
    expect(sql).not.toMatch(/count\s*\(/i);
    expect(sql).toContain("ON CONFLICT(tenant_id,order_number,item_code) DO UPDATE");
  });

  it("uses a positive numeric string constraint that supports 1000 and beyond", () => {
    expect(sql).toContain("CHECK(delivery_number ~ '^0*[1-9][0-9]*$')");
    expect(sql).toContain("next_number bigint");
  });
});
