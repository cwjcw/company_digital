import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { ContactSyncApplicationService } from "./contact-sync.application.service";

async function main() {
  const application = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const result = await application.get(ContactSyncApplicationService).normalizeExistingOrganizationDisplayNames({
      userId: null, name: "组织显示名称规范化", requestId: "normalize-organization-display-names", source: "api"
    });
    process.stdout.write(JSON.stringify(result));
  } finally {
    await application.close();
  }
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
