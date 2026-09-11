import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DataSource } from "typeorm";
import { AppModule } from "../../app.module";
import { AdministratorGrant, User } from "../../entities";
import { modificationContext } from "../../modification-audit";
import { SupplyChainApplicationService } from "./supply-chain.application.service";

async function stdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const payload = JSON.parse(await stdin()) as { idempotencyKey?: unknown; rows?: unknown };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const dataSource = app.get(DataSource);
    const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
    const grant = await dataSource.getRepository(AdministratorGrant).findOne({ where: { tenantId, systemAdmin: true }, order: { createdAt: "ASC" } });
    if (!grant) throw new Error("未找到可用于供应商导入审计的系统管理员");
    const user = await dataSource.getRepository(User).findOneBy({ id: grant.userId, enabled: true });
    if (!user) throw new Error("供应商导入审计管理员不存在或已停用");
    const requestId = `tplus-supplier-import:${String(payload.idempotencyKey ?? "unknown")}`;
    const result = await modificationContext.run({ actor: user.displayName, actorId: user.id, requestId, source: "import" }, () =>
      app.get(SupplyChainApplicationService).importTplusSuppliers(payload, {
        tenantId, userId: user.id, username: user.displayName, permissions: ["*"], isSystemAdmin: true,
        moduleAdminCodes: [], tableDataScopes: [], requestId, source: "import"
      })
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
