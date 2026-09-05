import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { DataSource } from "typeorm";
import { AppModule } from "../../app.module";
import { modificationContext } from "../../modification-audit";
import { EquipmentApplicationService } from "./equipment.application.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const dataSource = app.get(DataSource);
    const application = app.get(EquipmentApplicationService);
    const [admin] = await dataSource.query(`SELECT id FROM users WHERE username='admin' AND enabled=true LIMIT 1`);
    const actor = {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: admin?.id ?? null,
      username: "设备填报状态重置任务",
      permissions: ["*"],
      tableDataScopes: [],
      requestId: `equipment-monitoring-reset-${randomUUID()}`,
      source: "import" as const
    };
    const result = await modificationContext.run(
      { actor: actor.username, actorId: actor.userId, requestId: actor.requestId, source: "import" },
      () => application.resetAllMonitoring(actor)
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
