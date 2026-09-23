import dataSource from "../../data-source";
import { MasterPlanApplicationService } from "./master-plan.application.service";

const integration = process.env.KDOS_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;

/**
 * This test deliberately calls MasterPlanApplicationService.update, not the
 * normalizer, so the production jsonb parameter path is covered end to end.
 * It restores the original JSON representation in finally.
 */
integration("shipping weekday PostgreSQL persistence", () => {
  it("stores 2,4,5 as jsonb string and reads it back as 2,4,5", async () => {
    await dataSource.initialize();
    const service = new MasterPlanApplicationService(dataSource, { processOutbox: jest.fn().mockResolvedValue(undefined) } as never);
    const [setting] = await dataSource.query(
      "SELECT id,version,value_json::text original_json FROM mps_system_settings WHERE tenant_id=$1 AND setting_key='shipping_edit_weekday'",
      [process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN"]
    );
    const [admin] = await dataSource.query("SELECT id FROM users WHERE username='admin' LIMIT 1");
    if (!setting || !admin) throw new Error("integration fixture missing shipping_edit_weekday or admin user");
    const actor = {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: admin.id,
      username: "admin",
      permissions: ["*"],
      isSystemAdmin: true,
      moduleAdminCodes: [],
      tableDataScopes: [],
      requestId: "postgres-weekday-" + Date.now(),
      source: "web" as const
    };
    try {
      const result = await service.update("mps-system-settings", setting.id, { valueJson: "2,4,5", expectedVersion: Number(setting.version) }, actor);
      expect(result.values.valueJson).toBe("2,4,5");
      const [stored] = await dataSource.query("SELECT value_json, jsonb_typeof(value_json) json_type FROM mps_system_settings WHERE id=$1", [setting.id]);
      expect(stored.json_type).toBe("string");
      expect(stored.value_json).toBe("2,4,5");
      const [refreshed] = await dataSource.query("SELECT value_json FROM mps_system_settings WHERE id=$1", [setting.id]);
      expect(refreshed.value_json).toBe("2,4,5");
    } finally {
      await dataSource.query("UPDATE mps_system_settings SET value_json=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1", [setting.id, setting.original_json]);
      await dataSource.destroy();
    }
  });
});
