import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AppModule } from "../../app.module";
import { MarketingApplicationService } from "./marketing.application.service";
async function run() {
  if (!process.argv.includes("--confirm-clear-order-schedules")) throw new Error("缺少清空订单排期的显式确认参数");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    console.log(JSON.stringify(await app.get(MarketingApplicationService).clearSchedules({ userId: null, username: "order-schedule-reset", tenantCode: process.env.KDOS_DEFAULT_TENANT_CODE || "KAINAN", permissions: ["*"], requestId: randomUUID() })));
  } finally { await app.close(); }
}
void run().catch((error) => { console.error(error.message); process.exitCode = 1; });
