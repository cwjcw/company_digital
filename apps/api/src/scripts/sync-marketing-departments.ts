import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { MarketingApplicationService } from "../modules/marketing/marketing.application.service";

async function run() {
  const application = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const service = application.get(MarketingApplicationService);
    const result = await service.syncMappingDepartmentsFromDirectory({
      userId: null,
      username: "system:marketing-directory-sync",
      tenantCode: process.env.KDOS_DEFAULT_TENANT_CODE || "KAINAN",
      permissions: ["*"],
      requestId: `marketing-directory-sync:${randomUUID()}`
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await application.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
