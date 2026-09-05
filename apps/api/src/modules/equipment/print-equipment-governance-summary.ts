import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { EquipmentQueryService } from "./equipment.query.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const queries = app.get(EquipmentQueryService);
    const summary = await queries.governanceSummary({
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: null,
      username: "设备管理通报任务",
      permissions: ["*"],
      tableDataScopes: [],
      requestId: `equipment-governance-summary-${randomUUID()}`
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
