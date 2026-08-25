import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { KdosDatabaseClient } from "@kdos/database";
import type { PoolClient } from "pg";
import { KDOS_DATABASE } from "../planning/drizzle-planning.repository";
import type { MarketingRepository } from "./marketing.repository";
import type { BusinessCustomerMappingInput, MappingImportSummary, MarketingActor, OrderScheduleInput } from "./marketing.types";

@Injectable()
export class DrizzleMarketingRepository implements MarketingRepository {
  constructor(@Inject(KDOS_DATABASE) private readonly database: KdosDatabaseClient) {}

  async tenantId(code: string) {
    const result = await this.database.pool.query("SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true", [code]);
    if (!result.rowCount) throw new NotFoundException(`租户 ${code} 不存在或已停用`);
    return String(result.rows[0].id);
  }

  private async transaction<T>(tenantId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async audit(client: PoolClient, tenantId: string, actor: MarketingActor, action: string, resourceType: string, resourceId: string | null, before: unknown, after: unknown) {
    await client.query(`INSERT INTO audit.audit_logs
      (tenant_id,user_id,action,resource_type,resource_id,before,after,source,request_id,ip,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,'WEB',$8,$9,$2,$2)`, [
      tenantId, actor.userId, action, resourceType, resourceId,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId, actor.ip ?? null
    ]);
  }

  async listMappings(tenantId: string) {
    return this.transaction(tenantId, async (client) => {
      const result = await client.query(`SELECT mapping.id,mapping.department,mapping.section,mapping.customer_code AS "customerCode",
          mapping.salesperson_user_ids AS "salespersonUserIds",mapping.version,
          mapping.created_by AS "createdBy",mapping.created_at AS "createdAt",mapping.updated_by AS "updatedBy",mapping.updated_at AS "updatedAt"
        FROM marketing.business_customer_mappings mapping
        WHERE mapping.tenant_id=$1
        ORDER BY department,section,customer_code`, [tenantId]);
      return result.rows;
    });
  }

  async listSchedules(tenantId: string, search = "") {
    return this.transaction(tenantId, async (client) => {
      const value = search.trim();
      const result = await client.query(`SELECT schedule.id,schedule.customer_code AS "customerCode",schedule.order_number AS "orderNumber",
          schedule.item_number AS "itemNumber",schedule.item_name AS "itemName",schedule.customer_due_date AS "customerDueDate",
          schedule.order_total_quantity AS "orderTotalQuantity",schedule.production_unit AS "productionUnit",
          schedule.completion_ratio AS "completionRatio",schedule.source_plan_item_id AS "sourcePlanItemId",schedule.last_synced_at AS "lastSyncedAt",
          schedule.version,schedule.created_by AS "createdBy",schedule.created_at AS "createdAt",schedule.updated_by AS "updatedBy",schedule.updated_at AS "updatedAt"
        FROM marketing.order_schedules schedule
        WHERE schedule.tenant_id=$1 AND ($2='' OR concat_ws(' ',schedule.customer_code,schedule.order_number,schedule.item_number,schedule.item_name,schedule.production_unit) ILIKE '%' || $2 || '%')
        ORDER BY customer_due_date NULLS LAST,order_number,item_number`, [tenantId, value]);
      return result.rows;
    });
  }

  async saveMapping(tenantId: string, id: string | null, input: BusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor) {
    try {
      return await this.transaction(tenantId, async (client) => {
        if (!id) {
          const result = await client.query(`INSERT INTO marketing.business_customer_mappings
            (tenant_id,department,section,customer_code,salesperson_user_ids,created_by,updated_by)
            VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`, [tenantId, input.department, input.section, input.customerCode, input.salespersonUserIds, actor.userId]);
          await this.audit(client, tenantId, actor, "marketing.mapping.created", "BusinessCustomerMapping", result.rows[0].id, null, result.rows[0]);
          return result.rows[0];
        }
        const current = await client.query("SELECT * FROM marketing.business_customer_mappings WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, id]);
        if (!current.rowCount) throw new NotFoundException("业务与客户对应关系不存在");
        if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException({ message: "记录已被其他用户修改", currentVersion: current.rows[0].version });
        const result = await client.query(`UPDATE marketing.business_customer_mappings SET
            department=$3,section=$4,customer_code=$5,salesperson_user_ids=$6,version=version+1,updated_at=now(),updated_by=$7
          WHERE tenant_id=$1 AND id=$2 RETURNING *`, [tenantId, id, input.department, input.section, input.customerCode, input.salespersonUserIds, actor.userId]);
        await this.audit(client, tenantId, actor, "marketing.mapping.updated", "BusinessCustomerMapping", id, current.rows[0], result.rows[0]);
        return result.rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException(`客户 ${input.customerCode} 已存在，每个客户只能有一行`);
      throw error;
    }
  }

  async replaceMappings(tenantId: string, rows: BusinessCustomerMappingInput[], fileName: string, fileHash: string, summary: MappingImportSummary, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      const idempotencyKey = `BUSINESS_CUSTOMER_MAPPING:${fileHash}`;
      const previous = await client.query("SELECT id,file_name,result FROM integration.import_jobs WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE", [tenantId, idempotencyKey]);
      if (previous.rowCount) {
        if (previous.rows[0].file_name !== fileName) {
          const corrected = await client.query("UPDATE integration.import_jobs SET file_name=$3,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *", [tenantId, previous.rows[0].id, fileName, actor.userId]);
          await this.audit(client, tenantId, actor, "marketing.mapping.import_filename_corrected", "ImportJob", previous.rows[0].id, previous.rows[0], corrected.rows[0]);
        }
        return { ...summary, ...(previous.rows[0].result ?? {}), imported: Number(previous.rows[0].result?.imported ?? rows.length), repeated: true };
      }
      const before = await client.query(`SELECT id,department,section,customer_code AS "customerCode",salesperson_user_ids AS "salespersonUserIds",version
        FROM marketing.business_customer_mappings WHERE tenant_id=$1 ORDER BY customer_code`, [tenantId]);
      await client.query("DELETE FROM marketing.business_customer_mappings WHERE tenant_id=$1", [tenantId]);
      const inserted = [];
      for (const row of rows) {
        const saved = await client.query(`INSERT INTO marketing.business_customer_mappings
          (tenant_id,department,section,customer_code,salesperson_user_ids,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$6)
          RETURNING id,department,section,customer_code AS "customerCode",salesperson_user_ids AS "salespersonUserIds",version`,
        [tenantId, row.department, row.section, row.customerCode, row.salespersonUserIds, actor.userId]);
        inserted.push(saved.rows[0]);
      }
      const result = { imported: rows.length, repeated: false, ...summary };
      await client.query(`INSERT INTO integration.import_jobs
        (tenant_id,type,idempotency_key,file_name,file_hash,status,result,confirmed_at,created_by,updated_by)
        VALUES($1,'BUSINESS_CUSTOMER_MAPPING',$2,$3,$4,'CONFIRMED',$5,now(),$6,$6) RETURNING id`,
      [tenantId, idempotencyKey, fileName, fileHash, JSON.stringify(result), actor.userId]);
      await this.audit(client, tenantId, actor, "marketing.mapping.imported", "BusinessCustomerMapping", null, before.rows, { rows: inserted, summary: result });
      return result;
    });
  }

  async deleteMapping(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor) {
    await this.transaction(tenantId, async (client) => {
      const current = await client.query("SELECT * FROM marketing.business_customer_mappings WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, id]);
      if (!current.rowCount) throw new NotFoundException("业务与客户对应关系不存在");
      if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException({ message: "记录已被其他用户修改", currentVersion: current.rows[0].version });
      await client.query("DELETE FROM marketing.business_customer_mappings WHERE tenant_id=$1 AND id=$2", [tenantId, id]);
      await this.audit(client, tenantId, actor, "marketing.mapping.deleted", "BusinessCustomerMapping", id, current.rows[0], null);
    });
  }

  async saveSchedule(tenantId: string, id: string | null, input: OrderScheduleInput, expectedVersion: number | null, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      if (!id) {
        const result = await client.query(`INSERT INTO marketing.order_schedules
          (tenant_id,customer_code,order_number,item_number,item_name,customer_due_date,order_total_quantity,production_unit,completion_ratio,source_plan_item_id,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`, [tenantId, input.customerCode, input.orderNumber, input.itemNumber, input.itemName, input.customerDueDate ?? null, input.orderTotalQuantity, input.productionUnit ?? null, input.completionRatio, input.sourcePlanItemId ?? null, actor.userId]);
        await this.audit(client, tenantId, actor, "marketing.schedule.created", "OrderSchedule", result.rows[0].id, null, result.rows[0]);
        return result.rows[0];
      }
      const current = await client.query("SELECT * FROM marketing.order_schedules WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, id]);
      if (!current.rowCount) throw new NotFoundException("订单排期不存在");
      if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException({ message: "记录已被其他用户修改", currentVersion: current.rows[0].version });
      const result = await client.query(`UPDATE marketing.order_schedules SET customer_code=$3,order_number=$4,item_number=$5,
          item_name=$6,customer_due_date=$7,order_total_quantity=$8,production_unit=$9,completion_ratio=$10,source_plan_item_id=$11,
          version=version+1,updated_at=now(),updated_by=$12 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tenantId, id, input.customerCode, input.orderNumber, input.itemNumber, input.itemName, input.customerDueDate ?? null, input.orderTotalQuantity, input.productionUnit ?? null, input.completionRatio, input.sourcePlanItemId ?? null, actor.userId]);
      await this.audit(client, tenantId, actor, "marketing.schedule.updated", "OrderSchedule", id, current.rows[0], result.rows[0]);
      return result.rows[0];
    });
  }

  async deleteSchedule(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor) {
    await this.transaction(tenantId, async (client) => {
      const current = await client.query("SELECT * FROM marketing.order_schedules WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, id]);
      if (!current.rowCount) throw new NotFoundException("订单排期不存在");
      if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException({ message: "记录已被其他用户修改", currentVersion: current.rows[0].version });
      await client.query("DELETE FROM marketing.order_schedules WHERE tenant_id=$1 AND id=$2", [tenantId, id]);
      await this.audit(client, tenantId, actor, "marketing.schedule.deleted", "OrderSchedule", id, current.rows[0], null);
    });
  }

  async batchUpdateDueDate(tenantId: string, rows: Array<{ id: string; expectedVersion: number }>, customerDueDate: string | null, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      let updated = 0;
      for (const row of rows) {
        const result = await client.query(`UPDATE marketing.order_schedules SET customer_due_date=$4,version=version+1,updated_at=now(),updated_by=$5
          WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING id`, [tenantId, row.id, row.expectedVersion, customerDueDate, actor.userId]);
        if (!result.rowCount) throw new ConflictException("所选排期已被其他用户修改，请刷新后重试");
        updated += 1;
      }
      await this.audit(client, tenantId, actor, "marketing.schedule.due_date_batch_updated", "OrderSchedule", null, null, { ids: rows.map((row) => row.id), customerDueDate, updated });
      return { updated };
    });
  }

  async syncSchedulesFromPlanning(tenantId: string, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      const result = await client.query(`WITH selected_versions AS (
          SELECT DISTINCT ON (period_id) id FROM planning.plan_versions
          WHERE tenant_id=$1 AND status IN ('DRAFT','PUBLISHED','LOCKED')
          ORDER BY period_id, CASE status WHEN 'DRAFT' THEN 0 WHEN 'PUBLISHED' THEN 1 ELSE 2 END, version_number DESC
        ), source AS (
          SELECT DISTINCT ON (item.order_number,item.item_number) item.*,
            COALESCE(org.name,item.legacy_data->>'division') AS production_unit_name,
            CASE WHEN item.order_quantity=0 THEN 0 ELSE LEAST(100,ROUND(((item.historical_inbound_quantity+item.current_inbound_quantity)/item.order_quantity*100)::numeric,4)) END AS completion
          FROM planning.plan_items item JOIN selected_versions selected ON selected.id=item.plan_version_id
          LEFT JOIN iam.organizations org ON org.tenant_id=item.tenant_id AND org.id=item.responsible_org_id
          WHERE item.tenant_id=$1 ORDER BY item.order_number,item.item_number,item.updated_at DESC
        )
        INSERT INTO marketing.order_schedules(tenant_id,customer_code,order_number,item_number,item_name,order_total_quantity,production_unit,completion_ratio,source_plan_item_id,last_synced_at,created_by,updated_by)
        SELECT $1,source.customer_code,source.order_number,source.item_number,source.item_name,source.order_quantity,source.production_unit_name,source.completion,source.id,now(),$2,$2 FROM source
        ON CONFLICT(tenant_id,order_number,item_number) DO UPDATE SET customer_code=EXCLUDED.customer_code,item_name=EXCLUDED.item_name,
          order_total_quantity=EXCLUDED.order_total_quantity,production_unit=EXCLUDED.production_unit,completion_ratio=EXCLUDED.completion_ratio,
          source_plan_item_id=EXCLUDED.source_plan_item_id,last_synced_at=now(),version=marketing.order_schedules.version+1,updated_at=now(),updated_by=$2
        RETURNING id`, [tenantId, actor.userId]);
      const synced = result.rowCount ?? 0;
      await this.audit(client, tenantId, actor, "marketing.schedule.synced_from_planning", "OrderSchedule", null, null, { synced });
      return { synced };
    });
  }
}
