import { NotificationInfrastructure1722920067000 } from "../../migrations/1722920067000-NotificationInfrastructure";
import { NotificationRoutingAndRecipientDeliveries1722920068000 } from "../../migrations/1722920068000-NotificationRoutingAndRecipientDeliveries";

describe("KDOS notification infrastructure migration", () => {
  it("creates tenant-scoped rules, outbox and delivery log tables", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new NotificationInfrastructure1722920067000().up({ query } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("CREATE TABLE notification_rules");
    expect(sql).toContain("CREATE TABLE notification_outbox");
    expect(sql).toContain("CREATE TABLE notification_delivery_logs");
    expect(sql).toContain("UNIQUE(tenant_id,dedup_key)");
    expect(sql).toContain("status IN ('PENDING','PROCESSING','SENT','FAILED')");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("notification_outbox(tenant_id,id)");
  });

  it("drops dependent tables in reverse order", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new NotificationInfrastructure1722920067000().down({ query } as never);
    expect(String(query.mock.calls[0]?.[0])).toMatch(/notification_delivery_logs[\s\S]*notification_outbox[\s\S]*notification_rules/);
  });

  it("adds formal equipment routing and recipient-level delivery state", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new NotificationRoutingAndRecipientDeliveries1722920068000().up({ query } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("recipient_rule");
    expect(sql).toContain("EQUIPMENT_RESPONSIBLE");
    expect(sql).toContain("SKIPPED");
    expect(sql).toContain("uq_notification_delivery_recipient_attempt");
  });
});
