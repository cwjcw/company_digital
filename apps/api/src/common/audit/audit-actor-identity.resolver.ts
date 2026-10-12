import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { auditActorUserLabels, formatAuditActor, isAuditActorUuid, type AuditActorUser } from "@kdos/contracts";

/** 只解析已授权业务值；审计历史包含停用成员，与普通 member 选择分离。 */
@Injectable()
export class AuditActorIdentityResolver {
  constructor(private readonly dataSource: DataSource) {}

  async resolve(values: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(values)];
    const output = new Map<string, string>();
    for (let offset = 0; offset < unique.length; offset += 500) {
      const batch = unique.slice(offset, offset + 500);
      const ids = batch.filter(isAuditActorUuid).map((value) => value.toLowerCase());
      const usernames = batch.filter((value) => !isAuditActorUuid(value) && value !== "system" && value !== "");
      const users: AuditActorUser[] = ids.length || usernames.length ? await this.dataSource.query(
        `SELECT id,username,display_name AS "displayName" FROM users WHERE id=ANY($1::uuid[]) OR username=ANY($2::text[])`,
        [ids, usernames]
      ) : [];
      const labels = auditActorUserLabels(users);
      for (const value of batch) output.set(value, formatAuditActor(value, labels));
    }
    return output;
  }
}
