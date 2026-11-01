import { NotificationInfrastructure1722920067000 } from "../../migrations/1722920067000-NotificationInfrastructure";
import { NotificationRoutingAndRecipientDeliveries1722920068000 } from "../../migrations/1722920068000-NotificationRoutingAndRecipientDeliveries";
import { NotificationTestModeDelivery1722920070000 } from "../../migrations/1722920070000-NotificationTestModeDelivery";
import { NotificationProductionCutover1722920081000 } from "../../migrations/1722920081000-NotificationProductionCutover";
import { NotificationGroupWebhookRouting1722920113000 } from "../../migrations/1722920113000-NotificationGroupWebhookRouting";
import { NotificationRecipientGroups1722920114000 } from "../../migrations/1722920114000-NotificationRecipientGroups";

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

  it("adds separate actual TEST MODE recipient fields without rewriting history", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new NotificationTestModeDelivery1722920070000().up({ query } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("actual_recipient_user_id");
    expect(sql).toContain("actual_wechat_user_id");
    expect(sql).toContain("test_mode boolean NOT NULL DEFAULT false");
    expect(sql).toContain("idx_notification_delivery_actual_recipient");
  });

  it("preserves the historical migration and removes its retired runtime projection in a new migration", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new NotificationProductionCutover1722920081000().up({ query } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("DROP INDEX IF EXISTS idx_notification_delivery_actual_recipient");
    expect(sql).toContain("DROP COLUMN IF EXISTS test_mode");
    expect(sql).toContain("DROP COLUMN IF EXISTS actual_wechat_user_id");
    expect(sql).toContain("DROP COLUMN IF EXISTS actual_recipient_user_id");
  });

  it("adds tenant-scoped encrypted group targets, routes, image components and per-target delivery identity", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new NotificationGroupWebhookRouting1722920113000().up({ query } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("webhook_ciphertext text NOT NULL");
    expect(sql).toContain("CREATE TABLE notification_routes");
    expect(sql).toContain("CREATE TABLE notification_route_targets");
    expect(sql).toContain("CREATE TABLE notification_event_components");
    expect(sql).toContain("CREATE UNIQUE INDEX uq_notification_delivery_group_attempt");
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(4);
  });

  it("adds tenant-scoped recipient groups and permits both group and direct route targets", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new NotificationRecipientGroups1722920114000().up({ query } as never);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("CREATE TABLE notification_recipient_groups");
    expect(sql).toContain("CREATE TABLE notification_recipient_group_members");
    expect(sql).toContain("FOREIGN KEY(tenant_id,target_id) REFERENCES notification_group_webhooks(tenant_id,id)");
    expect(sql).toContain("target_type IN ('WECHAT_GROUP_WEBHOOK','RECIPIENT_GROUP')");
    expect(sql).toContain("PRIMARY KEY(tenant_id,route_id,target_type,target_id)");
    expect(sql).toContain("DROP INDEX IF EXISTS uq_notification_delivery_legacy_attempt");
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(2);
  });
});
