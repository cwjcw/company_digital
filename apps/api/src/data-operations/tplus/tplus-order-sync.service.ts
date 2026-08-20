import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { AuditLog, Order } from "../../entities";
import { currentModificationActor } from "../../modification-audit";

const earliestBeginDate = "2026-01-01";
const accountByDatabase = {
  UFTData741219_000012: { accountName: "凯南智能", division: "事业三部" },
  UFTData418971_000003: { accountName: "科加智能", division: "事业四部" }
} as const;

type SourceDatabase = keyof typeof accountByDatabase;

export type TplusOrderPayload = {
  sourceDatabase: string;
  customerCode?: string | null;
  salesperson?: string | null;
  orderNumber: string;
  orderDate: string;
  customerRequiredDate?: string | null;
  reviewDueDate?: string | null;
  orderAmount?: string | number | null;
  totalQuantity: string | number;
};

export type TplusOrderSnapshot = {
  beginDate: string;
  sourceDatabases: string[];
  orders: TplusOrderPayload[];
};

type SyncActor = { sub: string; username: string };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class TplusOrderSyncService {
  constructor(
    private readonly dataSource: DataSource
  ) {}

  private nullableText(value: unknown) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
  }

  private date(value: unknown, field: string, required = false) {
    if (value === null || value === undefined || value === "") {
      if (required) throw new BadRequestException(`${field}不能为空`);
      return null;
    }
    const normalized = String(value).slice(0, 10);
    const parsed = new Date(`${normalized}T00:00:00Z`);
    if (!datePattern.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
      throw new BadRequestException(`${field}日期格式无效：${String(value)}`);
    }
    return normalized;
  }

  private decimal(value: unknown, field: string, required = false) {
    if (value === null || value === undefined || value === "") {
      if (required) throw new BadRequestException(`${field}不能为空`);
      return null;
    }
    const number = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(number)) throw new BadRequestException(`${field}必须为数字`);
    return String(value).replace(/,/g, "");
  }

  private normalizeSnapshot(snapshot: TplusOrderSnapshot) {
    const beginDate = this.date(snapshot?.beginDate, "beginDate", true)!;
    if (beginDate < earliestBeginDate) throw new BadRequestException(`beginDate 不得早于 ${earliestBeginDate}`);
    const expectedDatabases = Object.keys(accountByDatabase).sort();
    const sourceDatabases = [...new Set(snapshot?.sourceDatabases ?? [])].sort();
    if (JSON.stringify(sourceDatabases) !== JSON.stringify(expectedDatabases)) {
      throw new BadRequestException(`sourceDatabases 必须完整包含：${expectedDatabases.join("、")}`);
    }
    if (!Array.isArray(snapshot?.orders) || !snapshot.orders.length) {
      throw new BadRequestException("源查询没有返回订单；为防止误停用现有数据，已拒绝空快照");
    }
    if (snapshot.orders.length > 50_000) throw new BadRequestException("单次同步最多允许 50000 条订单");

    const seen = new Set<string>();
    const rows = snapshot.orders.map((row, index) => {
      const database = String(row?.sourceDatabase ?? "") as SourceDatabase;
      const account = accountByDatabase[database];
      if (!account) throw new BadRequestException(`第 ${index + 1} 条订单的源数据库不受支持`);
      const orderNumber = String(row?.orderNumber ?? "").trim();
      if (!orderNumber) throw new BadRequestException(`第 ${index + 1} 条订单缺少订单号`);
      const key = `${database}\u0000${orderNumber}`;
      if (seen.has(key)) throw new BadRequestException(`快照中订单重复：${database}/${orderNumber}`);
      seen.add(key);
      const orderDate = this.date(row.orderDate, `第 ${index + 1} 条订单的下单日期`, true)!;
      if (orderDate < beginDate) throw new BadRequestException(`订单 ${orderNumber} 的下单日期早于 beginDate`);
      const totalQuantity = this.decimal(row.totalQuantity, `订单 ${orderNumber} 的总数量`, true)!;
      if (Number(totalQuantity) <= 0) throw new BadRequestException(`订单 ${orderNumber} 的总数量必须大于 0`);
      return {
        sourceDatabase: database,
        sourceAccountName: account.accountName,
        division: account.division,
        orderNumber,
        orderDate,
        customer: this.nullableText(row.customerCode),
        salesperson: this.nullableText(row.salesperson),
        customerDueDate: this.date(row.customerRequiredDate, `订单 ${orderNumber} 的客户要求交期`),
        reviewDueDate: this.date(row.reviewDueDate, `订单 ${orderNumber} 的产前评审交期`),
        orderAmount: this.decimal(row.orderAmount, `订单 ${orderNumber} 的金额`),
        sourceTotalQuantity: totalQuantity
      };
    });
    return { beginDate, sourceDatabases, rows };
  }

  async replaceSnapshot(snapshot: TplusOrderSnapshot, actor: SyncActor, requestId: string) {
    const normalized = this.normalizeSnapshot(snapshot);
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.find(Order, {
        where: { sourceSystem: "TPLUS", sourceDatabase: In(normalized.sourceDatabases) }
      });
      const byKey = new Map(existing.map((row) => [`${row.sourceDatabase}\u0000${row.orderNumber}`, row]));
      const receivedKeys = new Set(normalized.rows.map((row) => `${row.sourceDatabase}\u0000${row.orderNumber}`));
      let inserted = 0;
      let updated = 0;
      const toSave: Order[] = [];

      for (const row of normalized.rows) {
        const key = `${row.sourceDatabase}\u0000${row.orderNumber}`;
        const current = byKey.get(key);
        const values = {
          ...row, sourceSystem: "TPLUS", sourceActive: true,
          version: current ? current.version + 1 : 1
        };
        toSave.push(current ? Object.assign(current, values) : manager.create(Order, values));
        if (current) updated += 1; else inserted += 1;
      }

      const toDeactivate = existing.filter((row) => row.sourceActive
        && Boolean(row.orderDate && row.orderDate >= normalized.beginDate)
        && !receivedKeys.has(`${row.sourceDatabase}\u0000${row.orderNumber}`));
      for (const row of toDeactivate) {
        row.sourceActive = false;
        row.version += 1;
        toSave.push(row);
      }
      for (let index = 0; index < toSave.length; index += 500) await manager.save(toSave.slice(index, index + 500));

      const result = {
        received: normalized.rows.length, inserted, updated, deactivated: toDeactivate.length,
        beginDate: normalized.beginDate, sourceDatabases: normalized.sourceDatabases
      };
      await manager.save(AuditLog, {
        actorId: actor.sub, actorName: actor.username, resource: "tplus-sales-orders", recordId: null,
        action: "replace-snapshot", beforeJson: null, afterJson: result, requestId, source: "api",
        updatedBy: currentModificationActor()
      });
      return result;
    });
  }
}
