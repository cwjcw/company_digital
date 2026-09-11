import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { AuditLog, IdempotencyRecord, SupplyChainSupplier } from "../../entities";
import { hasSupplierListPermission, SupplyChainActor, TplusSupplierCanonicalRow } from "./supply-chain.types";

type ImportInput = { idempotencyKey?: unknown; rows?: unknown };
type ImportResult = { total: number; created: number; updated: number; unchanged: number; repeated: boolean };

const accountNames: Record<string, string> = {
  UFTData741219_000012: "凯南智能",
  UFTData418971_000003: "科加智能"
};

const nullableLimits: Record<keyof TplusSupplierCanonicalRow, number> = {
  sourceSystem: 32, sourceDatabase: 128, sourceAccountName: 128, sourceId: 128, code: 128, name: 500,
  abbreviation: 500, shorthand: 255, categoryCode: 128, categoryName: 500, partnerType: 0,
  partnerTypeLabel: 64, representative: 255, contact: 255, mobilePhone: 255, telephone: 255,
  fax: 255, email: 500, address: 0, enabled: 0, sourceUpdatedAt: 40
};

@Injectable()
export class SupplyChainApplicationService {
  constructor(private readonly dataSource: DataSource) {}

  async importTplusSuppliers(input: ImportInput, actor: SupplyChainActor): Promise<ImportResult> {
    if (!hasSupplierListPermission(actor, "import")) throw new ForbiddenException("当前权限组没有供应商清单导入权限");
    const idempotencyKey = String(input.idempotencyKey ?? "").trim();
    if (!/^[A-Za-z0-9:_-]{16,180}$/.test(idempotencyKey)) throw new BadRequestException("导入幂等标识无效");
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 5000) throw new BadRequestException("供应商数据必须为 1 至 5000 行");
    const rows = input.rows.map((row, index) => this.normalize(row, index + 1));
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.sourceDatabase}\u0000${row.sourceId}`;
      if (seen.has(key)) throw new BadRequestException(`供应商数据存在重复来源主键：${row.sourceDatabase}/${row.sourceId}`);
      seen.add(key);
    }
    const stableRows = [...rows].sort((left, right) => `${left.sourceDatabase}\u0000${left.sourceId}`.localeCompare(`${right.sourceDatabase}\u0000${right.sourceId}`));
    const requestHash = createHash("sha256").update(JSON.stringify(stableRows)).digest("hex");
    const storageKey = `supplier-list:${actor.tenantId}:${idempotencyKey}`;
    return this.dataSource.transaction(async (manager) => {
      const previous = await manager.findOneBy(IdempotencyRecord, { key: storageKey });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException("相同幂等标识对应的数据不一致");
        return { ...(previous.responseJson as ImportResult), repeated: true };
      }
      const existingRows = await manager.find(SupplyChainSupplier, { where: { tenantId: actor.tenantId, sourceSystem: "TPLUS" } });
      const existingBySource = new Map(existingRows.map((row) => [`${row.sourceDatabase}\u0000${row.sourceId}`, row]));
      let created = 0; let updated = 0; let unchanged = 0;
      for (const row of rows) {
        const sourceKey = `${row.sourceDatabase}\u0000${row.sourceId}`;
        const existing = existingBySource.get(sourceKey);
        if (!existing) {
          const saved = await manager.save(SupplyChainSupplier, manager.create(SupplyChainSupplier, {
            ...row, tenantId: actor.tenantId, createdBy: actor.userId, updatedBy: actor.userId ?? actor.username, version: 1
          }));
          await this.audit(manager, actor, saved.id, "supplier-list.imported.created", null, { sourceDatabase: row.sourceDatabase, sourceId: row.sourceId, code: row.code, name: row.name });
          created += 1;
          continue;
        }
        const changedFields = (Object.keys(row) as Array<keyof TplusSupplierCanonicalRow>).filter((field) => existing[field] !== row[field]);
        if (!changedFields.length) { unchanged += 1; continue; }
        const before = Object.fromEntries(changedFields.map((field) => [field, existing[field]]));
        Object.assign(existing, row);
        existing.version += 1;
        existing.updatedBy = actor.userId ?? actor.username;
        await manager.save(SupplyChainSupplier, existing);
        await this.audit(manager, actor, existing.id, "supplier-list.imported.updated", before, {
          sourceDatabase: row.sourceDatabase, sourceId: row.sourceId, changedFields,
          values: Object.fromEntries(changedFields.map((field) => [field, row[field]]))
        });
        updated += 1;
      }
      const result: ImportResult = { total: rows.length, created, updated, unchanged, repeated: false };
      await this.audit(manager, actor, null, "supplier-list.import.completed", null, {
        ...result, sourceDatabases: [...new Set(rows.map((row) => row.sourceDatabase))]
      });
      await manager.save(IdempotencyRecord, {
        key: storageKey, requestHash, responseJson: result, createdBy: actor.userId,
        updatedBy: actor.userId ?? actor.username, version: 1
      });
      return result;
    });
  }

  private normalize(value: unknown, rowNumber: number): TplusSupplierCanonicalRow {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`第 ${rowNumber} 行不是有效对象`);
    const row = value as Record<string, unknown>;
    const sourceDatabase = this.required(row.sourceDatabase, "来源数据库", rowNumber, nullableLimits.sourceDatabase);
    if (!accountNames[sourceDatabase]) throw new BadRequestException(`第 ${rowNumber} 行来源数据库不受支持`);
    const sourceAccountName = this.required(row.sourceAccountName, "来源账套", rowNumber, nullableLimits.sourceAccountName);
    if (sourceAccountName !== accountNames[sourceDatabase]) throw new BadRequestException(`第 ${rowNumber} 行来源数据库与账套名称不匹配`);
    const partnerType = Number(row.partnerType);
    if (![226, 228].includes(partnerType)) throw new BadRequestException(`第 ${rowNumber} 行不是 T+ 供应商类型`);
    const sourceUpdatedAt = this.optional(row.sourceUpdatedAt, "T+更新时间", rowNumber, nullableLimits.sourceUpdatedAt);
    if (sourceUpdatedAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(sourceUpdatedAt)) throw new BadRequestException(`第 ${rowNumber} 行 T+ 更新时间格式无效`);
    return {
      sourceSystem: "TPLUS", sourceDatabase, sourceAccountName,
      sourceId: this.required(row.sourceId, "来源主键", rowNumber, nullableLimits.sourceId),
      code: this.required(row.code, "供应商编码", rowNumber, nullableLimits.code),
      name: this.required(row.name, "供应商名称", rowNumber, nullableLimits.name),
      abbreviation: this.optional(row.abbreviation, "供应商简称", rowNumber, nullableLimits.abbreviation),
      shorthand: this.optional(row.shorthand, "助记码", rowNumber, nullableLimits.shorthand),
      categoryCode: this.optional(row.categoryCode, "分类编码", rowNumber, nullableLimits.categoryCode),
      categoryName: this.optional(row.categoryName, "供应商分类", rowNumber, nullableLimits.categoryName),
      partnerType: partnerType as 226 | 228, partnerTypeLabel: partnerType === 226 ? "供应商" : "客户及供应商",
      representative: this.optional(row.representative, "法人代表", rowNumber, nullableLimits.representative),
      contact: this.optional(row.contact, "联系人", rowNumber, nullableLimits.contact),
      mobilePhone: this.optional(row.mobilePhone, "手机", rowNumber, nullableLimits.mobilePhone),
      telephone: this.optional(row.telephone, "电话", rowNumber, nullableLimits.telephone),
      fax: this.optional(row.fax, "传真", rowNumber, nullableLimits.fax),
      email: this.optional(row.email, "邮箱", rowNumber, nullableLimits.email),
      address: this.optional(row.address, "地址", rowNumber, nullableLimits.address),
      enabled: this.boolean(row.enabled, rowNumber), sourceUpdatedAt
    };
  }

  private required(value: unknown, label: string, row: number, max: number) {
    const normalized = String(value ?? "").trim();
    if (!normalized) throw new BadRequestException(`第 ${row} 行${label}不能为空`);
    if (max && normalized.length > max) throw new BadRequestException(`第 ${row} 行${label}超过 ${max} 个字符`);
    return normalized;
  }

  private optional(value: unknown, label: string, row: number, max: number) {
    const normalized = String(value ?? "").trim();
    if (!normalized) return null;
    if (max && normalized.length > max) throw new BadRequestException(`第 ${row} 行${label}超过 ${max} 个字符`);
    return normalized;
  }

  private boolean(value: unknown, row: number) {
    if (typeof value === "boolean") return value;
    if ([0, 1].includes(Number(value))) return Number(value) === 1;
    throw new BadRequestException(`第 ${row} 行状态必须是布尔值`);
  }

  private audit(manager: EntityManager, actor: SupplyChainActor, recordId: string | null, action: string, beforeJson: unknown, afterJson: unknown) {
    return manager.save(AuditLog, {
      actorId: actor.userId, actorName: actor.username, resource: "supplier-list", recordId, action,
      beforeJson, afterJson, requestId: actor.requestId, source: actor.source ?? "import"
    });
  }
}
