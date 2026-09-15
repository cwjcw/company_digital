import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { KdosDatabaseClient } from "@kdos/database";
import type { PoolClient } from "pg";
import { KDOS_DATABASE } from "../organization-directory/kdos-database.provider";
import type { MarketingRepository } from "./marketing.repository";
import type { DivisionReviewConfirmResult, DivisionReviewConfirmRow, MappingDepartmentDirectorySyncResult, MappingDepartmentDirectorySyncTarget, MappingImportSummary, MarketingActor, OrderScheduleInput, ResolvedBusinessCustomerMappingInput, RollingPlanSyncFailure, RollingPlanSyncResult, RollingPlanSyncRow } from "./marketing.types";

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
      const result = await client.query(`SELECT mapping.id,mapping.department,mapping.section,mapping.department_id AS "departmentId",mapping.customer_code AS "customerCode",
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
          schedule.department,schedule.section,schedule.department_id AS "departmentId",schedule.salesperson_user_ids AS "salespersonUserIds",
          schedule.item_number AS "itemNumber",schedule.item_name AS "itemName",schedule.customer_due_date AS "customerDueDate",
          schedule.order_total_quantity AS "orderTotalQuantity",schedule.production_unit AS "productionUnit",
          schedule.completion_ratio AS "completionRatio",schedule.status,schedule.source_plan_item_id AS "sourcePlanItemId",schedule.last_synced_at AS "lastSyncedAt",
          schedule.version,schedule.created_by AS "createdBy",schedule.created_at AS "createdAt",schedule.updated_by AS "updatedBy",schedule.updated_at AS "updatedAt"
        FROM marketing.order_schedules schedule
        WHERE schedule.tenant_id=$1 AND ($2='' OR concat_ws(' ',schedule.customer_code,schedule.order_number,schedule.item_number,schedule.item_name,schedule.production_unit) ILIKE '%' || $2 || '%')
        ORDER BY customer_due_date NULLS LAST,order_number,item_number`, [tenantId, value]);
      return result.rows;
    });
  }

  async listDivisionOrderReviews(tenantId: string, search = "") {
    return this.transaction(tenantId, async (client) => {
      const value = search.trim();
      const result = await client.query(`SELECT review.id,review.source_order_schedule_id AS "sourceOrderScheduleId",
          review.customer_code AS "customerCode",review.department,review.section,review.department_id AS "departmentId",
          review.salesperson_user_ids AS "salespersonUserIds",review.order_number AS "orderNumber",review.item_number AS "itemNumber",
          review.item_name AS "itemName",review.customer_due_date AS "customerDueDate",review.division_review_due_date AS "divisionReviewDueDate",
          review.delivery_confirmed_at AS "deliveryConfirmedAt",review.delivery_confirmed_by AS "deliveryConfirmedBy",
          review.order_total_quantity AS "orderTotalQuantity",
          review.production_unit AS "productionUnit",review.completion_ratio AS "completionRatio",review.status,review.version,
          review.created_by AS "createdBy",review.created_at AS "createdAt",review.updated_by AS "updatedBy",review.updated_at AS "updatedAt"
        FROM planning.division_order_reviews review
        WHERE review.tenant_id=$1 AND ($2='' OR concat_ws(' ',review.customer_code,review.department,review.section,review.order_number,
          review.item_number,review.item_name,review.production_unit,review.status) ILIKE '%' || $2 || '%')
        ORDER BY review.customer_due_date NULLS LAST,review.order_number,review.item_number`, [tenantId, value]);
      return result.rows;
    });
  }

  async findDivisionOrderReviewsByIds(tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    return this.transaction(tenantId, async (client) => {
      const result = await client.query(`SELECT review.id,review.source_order_schedule_id AS "sourceOrderScheduleId",
          review.customer_code AS "customerCode",review.department,review.section,review.department_id AS "departmentId",
          review.salesperson_user_ids AS "salespersonUserIds",review.order_number AS "orderNumber",review.item_number AS "itemNumber",
          review.item_name AS "itemName",review.customer_due_date AS "customerDueDate",review.division_review_due_date AS "divisionReviewDueDate",
          review.delivery_confirmed_at AS "deliveryConfirmedAt",review.delivery_confirmed_by AS "deliveryConfirmedBy",
          review.order_total_quantity AS "orderTotalQuantity",review.production_unit AS "productionUnit",review.completion_ratio AS "completionRatio",
          review.status,review.version,review.created_by AS "createdBy",review.updated_by AS "updatedBy"
        FROM planning.division_order_reviews review WHERE review.tenant_id=$1 AND review.id=ANY($2::uuid[])`, [tenantId, ids]);
      return result.rows;
    });
  }

  async findSchedulesByIds(tenantId: string, ids: string[]) {
    return this.transaction(tenantId, async (client) => {
      const result = await client.query(`SELECT schedule.id,schedule.customer_code AS "customerCode",schedule.order_number AS "orderNumber",
          schedule.department,schedule.section,schedule.department_id AS "departmentId",schedule.salesperson_user_ids AS "salespersonUserIds",
          schedule.item_number AS "itemNumber",schedule.item_name AS "itemName",schedule.customer_due_date AS "customerDueDate",
          schedule.order_total_quantity AS "orderTotalQuantity",schedule.production_unit AS "productionUnit",
          schedule.completion_ratio AS "completionRatio",schedule.version,schedule.created_by AS "createdBy"
        FROM marketing.order_schedules schedule
        WHERE schedule.tenant_id=$1 AND schedule.id=ANY($2::uuid[])`, [tenantId, ids]);
      return result.rows;
    });
  }

  async findRollingPlanItemsByBusinessKeys(tenantId: string, keys: Array<{ orderNumber: string; itemNumber: string }>) {
    if (!keys.length) return [];
    return this.transaction(tenantId, async (client) => {
      const result = await client.query(`SELECT item.id,item.order_number AS "orderNumber",item.item_number AS "itemNumber",
          item.customer_name AS customer,item.delivery_date AS "customerDueDate",item.production_quantity AS "productionQuantity",
          item.responsible_org_id AS "responsibleOrgId",item.created_by AS "createdBy",item.updated_by AS "updatedBy",item.version
        FROM planning.rolling_plan_items item
        WHERE item.tenant_id=$1 AND (item.order_number,item.item_number) IN (
          SELECT value->>'orderNumber',value->>'itemNumber' FROM jsonb_array_elements($2::jsonb) value
        )`, [tenantId, JSON.stringify(keys)]);
      return result.rows;
    });
  }

  async saveMapping(tenantId: string, id: string | null, input: ResolvedBusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor) {
    try {
      return await this.transaction(tenantId, async (client) => {
        if (!id) {
          const result = await client.query(`INSERT INTO marketing.business_customer_mappings
            (tenant_id,department,section,department_id,customer_code,salesperson_user_ids,created_by,updated_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`, [tenantId, input.department, input.section, input.departmentId, input.customerCode, input.salespersonUserIds, actor.userId]);
          await this.audit(client, tenantId, actor, "marketing.mapping.created", "BusinessCustomerMapping", result.rows[0].id, null, result.rows[0]);
          return result.rows[0];
        }
        const current = await client.query("SELECT * FROM marketing.business_customer_mappings WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, id]);
        if (!current.rowCount) throw new NotFoundException("业务与客户对应关系不存在");
        if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException({ message: "记录已被其他用户修改", currentVersion: current.rows[0].version });
        const result = await client.query(`UPDATE marketing.business_customer_mappings SET
            department=$3,section=$4,department_id=$5,customer_code=$6,salesperson_user_ids=$7,version=version+1,updated_at=now(),updated_by=$8
          WHERE tenant_id=$1 AND id=$2 RETURNING *`, [tenantId, id, input.department, input.section, input.departmentId, input.customerCode, input.salespersonUserIds, actor.userId]);
        await this.audit(client, tenantId, actor, "marketing.mapping.updated", "BusinessCustomerMapping", id, current.rows[0], result.rows[0]);
        return result.rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException(`客户 ${input.customerCode} 已存在，每个客户只能有一行`);
      throw error;
    }
  }

  async replaceMappings(tenantId: string, rows: ResolvedBusinessCustomerMappingInput[], fileName: string, fileHash: string, summary: MappingImportSummary, actor: MarketingActor) {
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
          (tenant_id,department,section,department_id,customer_code,salesperson_user_ids,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$7)
          RETURNING id,department,section,department_id AS "departmentId",customer_code AS "customerCode",salesperson_user_ids AS "salespersonUserIds",version`,
        [tenantId, row.department, row.section, row.departmentId, row.customerCode, row.salespersonUserIds, actor.userId]);
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

  async clearSchedules(tenantId: string, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      const before = await client.query("SELECT * FROM marketing.order_schedules WHERE tenant_id=$1 FOR UPDATE", [tenantId]);
      await client.query("DELETE FROM marketing.order_schedules WHERE tenant_id=$1", [tenantId]);
      await this.audit(client, tenantId, actor, "marketing.schedule.cleared", "OrderSchedule", null, before.rows, { deleted: before.rowCount });
      return { deleted: before.rowCount ?? 0 };
    });
  }

  async importSchedules(tenantId: string, rows: import("./marketing.types").ScheduleImportRow[], hash: string, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      const key = `order-schedule:${hash}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId + key]);
      const previous = await client.query("SELECT result FROM integration.import_jobs WHERE tenant_id=$1 AND idempotency_key=$2", [tenantId, key]);
      if (previous.rowCount) return { ...previous.rows[0].result, repeated: true };
      for (const entry of rows) {
        const input = entry.input;
        const current = await client.query("SELECT * FROM marketing.order_schedules WHERE tenant_id=$1 AND order_number=$2 AND item_number=$3 FOR UPDATE", [tenantId, input.orderNumber, input.itemNumber]);
        const before = current.rows[0];
        if ((before?.id ?? null) !== entry.id || (before ? Number(before.version) : null) !== entry.expectedVersion) throw new ConflictException(`第 ${entry.row} 行数据已变化，请重新上传预览`);
        const values = [tenantId, input.customerCode, input.orderNumber, input.itemNumber, input.itemName, input.customerDueDate ?? null, input.orderTotalQuantity, input.productionUnit ?? null, input.completionRatio, input.status ?? "NORMAL", actor.userId];
        let saved;
        if (before) {
          saved = await client.query(`UPDATE marketing.order_schedules SET customer_code=$2,item_name=$5,customer_due_date=$6,order_total_quantity=$7,production_unit=$8,completion_ratio=$9,status=$10,updated_by=$11,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND order_number=$3 AND item_number=$4 RETURNING *`, values);
        } else {
          saved = await client.query(`INSERT INTO marketing.order_schedules(tenant_id,customer_code,order_number,item_number,item_name,customer_due_date,order_total_quantity,production_unit,completion_ratio,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) ON CONFLICT(tenant_id,order_number,item_number) DO NOTHING RETURNING *`, values);
          if (!saved.rowCount) throw new ConflictException(`第 ${entry.row} 行已被其他用户新增，请重新上传预览`);
        }
        await this.audit(client, tenantId, actor, "marketing.schedule.imported", "OrderSchedule", saved.rows[0].id, before ?? null, saved.rows[0]);
      }
      const result = { imported: rows.length, repeated: false };
      await client.query(`INSERT INTO integration.import_jobs(tenant_id,type,idempotency_key,file_name,file_hash,status,result,confirmed_at,created_by,updated_by) VALUES($1,'ORDER_SCHEDULE',$2,'订单排期.xlsx',$3,'CONFIRMED',$4,now(),$5,$5)`, [tenantId, key, hash, JSON.stringify(result), actor.userId]);
      return result;
    });
  }

  async saveSchedule(tenantId: string, id: string | null, input: OrderScheduleInput, expectedVersion: number | null, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      if (!id) {
        const result = await client.query(`INSERT INTO marketing.order_schedules
          (tenant_id,customer_code,order_number,item_number,item_name,customer_due_date,order_total_quantity,production_unit,completion_ratio,status,source_plan_item_id,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`, [tenantId, input.customerCode, input.orderNumber, input.itemNumber, input.itemName, input.customerDueDate ?? null, input.orderTotalQuantity, input.productionUnit ?? null, input.completionRatio, input.status ?? "NORMAL", input.sourcePlanItemId ?? null, actor.userId]);
        await this.audit(client, tenantId, actor, "marketing.schedule.created", "OrderSchedule", result.rows[0].id, null, result.rows[0]);
        return result.rows[0];
      }
      const current = await client.query("SELECT * FROM marketing.order_schedules WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, id]);
      if (!current.rowCount) throw new NotFoundException("订单排期不存在");
      if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException({ message: "记录已被其他用户修改", currentVersion: current.rows[0].version });
      const result = await client.query(`UPDATE marketing.order_schedules SET customer_code=$3,order_number=$4,item_number=$5,
          item_name=$6,customer_due_date=$7,order_total_quantity=$8,production_unit=$9,completion_ratio=$10,status=$11,source_plan_item_id=$12,
          version=version+1,updated_at=now(),updated_by=$13 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tenantId, id, input.customerCode, input.orderNumber, input.itemNumber, input.itemName, input.customerDueDate ?? null, input.orderTotalQuantity, input.productionUnit ?? null, input.completionRatio, input.status ?? "NORMAL", input.sourcePlanItemId ?? null, actor.userId]);
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
          WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *`, [tenantId, row.id, row.expectedVersion, customerDueDate, actor.userId]);
        if (!result.rowCount) throw new ConflictException("所选排期已被其他用户修改，请刷新后重试");
        updated += 1;
      }
      await this.audit(client, tenantId, actor, "marketing.schedule.due_date_batch_updated", "OrderSchedule", null, null, { ids: rows.map((row) => row.id), customerDueDate, updated });
      return { updated };
    });
  }

  async batchDeleteSchedules(tenantId: string, rows: Array<{ id: string; expectedVersion: number }>, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      for (const row of rows) {
        const current = await client.query("SELECT * FROM marketing.order_schedules WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, row.id]);
        if (!current.rowCount) throw new NotFoundException("所选排期不存在");
        if (Number(current.rows[0].version) !== row.expectedVersion) throw new ConflictException({ message: "所选排期已被其他用户修改，请刷新后重试", id: row.id, currentVersion: current.rows[0].version });
        await client.query("DELETE FROM marketing.order_schedules WHERE tenant_id=$1 AND id=$2", [tenantId, row.id]);
        await this.audit(client, tenantId, actor, "marketing.schedule.deleted", "OrderSchedule", row.id, current.rows[0], null);
      }
      const result = { deleted: rows.length };
      await this.audit(client, tenantId, actor, "marketing.schedule.batch_deleted", "OrderSchedule", null, null, { ids: rows.map((row) => row.id), ...result });
      return result;
    });
  }

  async syncSchedulesToRollingPlan(tenantId: string, rows: RollingPlanSyncRow[], selected: number, validationFailures: RollingPlanSyncFailure[], idempotencyKey: string, actor: MarketingActor): Promise<RollingPlanSyncResult> {
    return this.transaction(tenantId, async (client) => {
      const key = `rolling-plan-table:${idempotencyKey}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId + key]);
      const previous = await client.query("SELECT result FROM integration.import_jobs WHERE tenant_id=$1 AND idempotency_key=$2", [tenantId, key]);
      if (previous.rowCount) return { ...(previous.rows[0].result as RollingPlanSyncResult), repeated: true };
      let matched = 0; let created = 0; let updated = 0; let unchanged = 0;
      const failed = [...validationFailures];
      const touched = new Set<string>();
      for (const requested of rows) {
        const sourceResult = await client.query(`SELECT id,customer_code,order_number,item_number,customer_due_date,order_total_quantity,production_unit,version
          FROM marketing.order_schedules WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, requested.id]);
        const source = sourceResult.rows[0];
        if (!source || Number(source.version) !== requested.expectedVersion) {
          failed.push({ id: requested.id, orderNumber: String(source?.order_number ?? ""), itemNumber: String(source?.item_number ?? ""), reason: source ? "同步时记录已被其他用户修改" : "同步时记录已不存在" });
          continue;
        }
        const businessKey = JSON.stringify([source.order_number, source.item_number]);
        const current = await client.query(`SELECT * FROM planning.rolling_plan_items
          WHERE tenant_id=$1 AND order_number=$2 AND item_number=$3 FOR UPDATE`, [tenantId, source.order_number, source.item_number]);
        const before = current.rows[0];
        touched.add(businessKey);
        if (!before) {
          const sequence = Number((await client.query("SELECT coalesce(max(sequence),0)+10 AS value FROM planning.rolling_plan_items WHERE tenant_id=$1", [tenantId])).rows[0].value);
          const saved = await client.query(`INSERT INTO planning.rolling_plan_items
            (tenant_id,source_order_schedule_id,order_number,item_number,customer_name,order_quantity,production_quantity,delivery_date,responsible_org_id,sequence,created_by,updated_by)
            VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$10) RETURNING *`, [tenantId, source.id, source.order_number, source.item_number, source.customer_code, source.order_total_quantity, source.customer_due_date, requested.responsibleOrgId, sequence, actor.userId]);
          await this.audit(client, tenantId, actor, "planning.rolling_plan.created_from_order_schedule", "RollingPlanItem", saved.rows[0].id, null, saved.rows[0]);
          created += 1;
          continue;
        }
        matched += 1;
        const changed = before.source_order_schedule_id !== source.id || before.customer_name !== source.customer_code
          || String(before.order_quantity) !== String(source.order_total_quantity) || String(before.production_quantity) !== String(source.order_total_quantity)
          || String(before.delivery_date ?? "") !== String(source.customer_due_date ?? "") || before.responsible_org_id !== requested.responsibleOrgId;
        if (!changed) { unchanged += 1; continue; }
        const saved = await client.query(`UPDATE planning.rolling_plan_items SET source_order_schedule_id=$4,customer_name=$5,
            order_quantity=$6,production_quantity=$6,delivery_date=$7,responsible_org_id=$8,version=version+1,updated_at=now(),updated_by=$9
          WHERE tenant_id=$1 AND order_number=$2 AND item_number=$3 RETURNING *`, [tenantId, source.order_number, source.item_number, source.id, source.customer_code, source.order_total_quantity, source.customer_due_date, requested.responsibleOrgId, actor.userId]);
        await this.audit(client, tenantId, actor, "planning.rolling_plan.updated_from_order_schedule", "RollingPlanItem", saved.rows[0].id, before, saved.rows[0]);
        updated += 1;
      }
      const targetCount = Number((await client.query("SELECT count(*)::integer AS count FROM planning.rolling_plan_items WHERE tenant_id=$1", [tenantId])).rows[0].count);
      const result: RollingPlanSyncResult = { selected, eligible: rows.length, matched, created, updated, unchanged, retained: Math.max(targetCount - touched.size, 0), failed, repeated: false };
      await client.query(`INSERT INTO integration.import_jobs(tenant_id,type,idempotency_key,status,result,confirmed_at,created_by,updated_by)
        VALUES($1,'ROLLING_PLAN_TABLE_SYNC',$2,'CONFIRMED',$3,now(),$4,$4)`, [tenantId, key, JSON.stringify(result), actor.userId]);
      await this.audit(client, tenantId, actor, "planning.rolling_plan.synced_from_order_schedule", "RollingPlanItem", null, null, { ...result, matchKey: ["orderNumber", "itemNumber"], mappedFields: ["customer", "orderNumber", "itemNumber", "customerDueDate", "responsibleOrgId", "productionQuantity"] });
      return result;
    });
  }

  async updateDivisionReviewDueDate(tenantId: string, id: string, divisionReviewDueDate: string | null, expectedVersion: number, actor: MarketingActor) {
    return this.transaction(tenantId, async (client) => {
      const current = await client.query("SELECT * FROM planning.division_order_reviews WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, id]);
      if (!current.rowCount) throw new NotFoundException("事业部订单评审不存在");
      if (Number(current.rows[0].version) !== expectedVersion) throw new ConflictException({ message: "记录已被其他用户修改，请刷新后重试", currentVersion: current.rows[0].version });
      const saved = await client.query(`UPDATE planning.division_order_reviews SET
          division_review_due_date=$3,delivery_confirmed_at=NULL,delivery_confirmed_by=NULL,
          version=version+1,updated_at=now(),updated_by=$4
        WHERE tenant_id=$1 AND id=$2 RETURNING *`, [tenantId, id, divisionReviewDueDate, actor.userId]);
      await this.audit(client, tenantId, actor, "planning.division_order_review.due_date_updated", "DivisionOrderReview", id, current.rows[0], saved.rows[0]);
      return saved.rows[0];
    });
  }

  async confirmDivisionOrderReviews(tenantId: string, rows: DivisionReviewConfirmRow[], selected: number, validationFailures: RollingPlanSyncFailure[], idempotencyKey: string, actor: MarketingActor): Promise<DivisionReviewConfirmResult> {
    return this.transaction(tenantId, async (client) => {
      const key = `division-order-review-confirm:${idempotencyKey}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId + key]);
      const previous = await client.query("SELECT result FROM integration.import_jobs WHERE tenant_id=$1 AND idempotency_key=$2", [tenantId, key]);
      if (previous.rowCount) return { ...(previous.rows[0].result as DivisionReviewConfirmResult), repeated: true };

      let matched = 0; let created = 0; let updated = 0; let unchanged = 0; let confirmed = 0;
      const failed = [...validationFailures];
      const touched = new Set<string>();
      for (const requested of rows) {
        const sourceResult = await client.query(`SELECT * FROM planning.division_order_reviews
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, requested.id]);
        const source = sourceResult.rows[0];
        if (!source || Number(source.version) !== requested.expectedVersion) {
          failed.push({ id: requested.id, orderNumber: String(source?.order_number ?? ""), itemNumber: String(source?.item_number ?? ""), reason: source ? "确认时记录已被其他用户修改，请刷新后重试" : "确认时记录已不存在" });
          continue;
        }
        if (source.status === "VOID") {
          failed.push({ id: requested.id, orderNumber: source.order_number, itemNumber: source.item_number, reason: "作废订单不能确认交期" });
          continue;
        }
        if (!source.division_review_due_date) {
          failed.push({ id: requested.id, orderNumber: source.order_number, itemNumber: source.item_number, reason: "请先填写事业部评审交期" });
          continue;
        }
        const reviewDueDate = source.division_review_due_date instanceof Date
          ? source.division_review_due_date.toISOString().slice(0, 10)
          : String(source.division_review_due_date).slice(0, 10);

        const businessKey = JSON.stringify([source.order_number, source.item_number]);
        const current = await client.query(`SELECT * FROM planning.rolling_plan_items
          WHERE tenant_id=$1 AND order_number=$2 AND item_number=$3 FOR UPDATE`, [tenantId, source.order_number, source.item_number]);
        const before = current.rows[0];
        if (!before) {
          if (!requested.responsibleOrgId) {
            failed.push({ id: requested.id, orderNumber: source.order_number, itemNumber: source.item_number, reason: "生产单位无法映射事业部" });
            continue;
          }
          touched.add(businessKey);
          const sequence = Number((await client.query("SELECT coalesce(max(sequence),0)+10 AS value FROM planning.rolling_plan_items WHERE tenant_id=$1", [tenantId])).rows[0].value);
          const legacyData = { itemName: source.item_name, reviewDueDate };
          const saved = await client.query(`INSERT INTO planning.rolling_plan_items
            (tenant_id,source_order_schedule_id,order_number,item_number,customer_name,order_quantity,production_quantity,
             delivery_date,responsible_org_id,sequence,legacy_data,created_by,updated_by)
            VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10::jsonb,$11,$11) RETURNING *`, [
            tenantId, source.source_order_schedule_id, source.order_number, source.item_number, source.customer_code,
            source.order_total_quantity, source.customer_due_date, requested.responsibleOrgId, sequence, JSON.stringify(legacyData), actor.userId
          ]);
          await this.audit(client, tenantId, actor, "planning.rolling_plan.created_from_division_review", "RollingPlanItem", saved.rows[0].id, null, saved.rows[0]);
          created += 1;
        } else {
          touched.add(businessKey);
          matched += 1;
          const saved = await client.query(`UPDATE planning.rolling_plan_items SET
              production_quantity=$4,delivery_date=$5,
              legacy_data=coalesce(legacy_data,'{}'::jsonb)||jsonb_build_object('reviewDueDate',$6::text),
              version=version+1,updated_at=now(),updated_by=$7
            WHERE tenant_id=$1 AND order_number=$2 AND item_number=$3
              AND ROW(production_quantity,delivery_date,legacy_data->>'reviewDueDate')
                IS DISTINCT FROM ROW($4::numeric,$5::date,$6::text)
            RETURNING *`, [tenantId, source.order_number, source.item_number, source.order_total_quantity, source.customer_due_date, reviewDueDate, actor.userId]);
          if (saved.rowCount) {
            await this.audit(client, tenantId, actor, "planning.rolling_plan.updated_from_division_review", "RollingPlanItem", saved.rows[0].id, before, saved.rows[0]);
            updated += 1;
          } else unchanged += 1;
        }

        const confirmation = await client.query(`UPDATE planning.division_order_reviews SET
            delivery_confirmed_at=now(),delivery_confirmed_by=$4,version=version+1,updated_at=now(),updated_by=$4
          WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *`, [tenantId, requested.id, requested.expectedVersion, actor.userId]);
        await this.audit(client, tenantId, actor, "planning.division_order_review.delivery_confirmed", "DivisionOrderReview", requested.id, source, confirmation.rows[0]);
        confirmed += 1;
      }

      const targetCount = Number((await client.query("SELECT count(*)::integer AS count FROM planning.rolling_plan_items WHERE tenant_id=$1", [tenantId])).rows[0].count);
      const result: DivisionReviewConfirmResult = {
        selected, eligible: rows.length, matched, created, updated, unchanged, confirmed,
        retained: Math.max(targetCount - touched.size, 0), failed, repeated: false
      };
      await client.query(`INSERT INTO integration.import_jobs(tenant_id,type,idempotency_key,status,result,confirmed_at,created_by,updated_by)
        VALUES($1,'DIVISION_ORDER_REVIEW_CONFIRM',$2,'CONFIRMED',$3,now(),$4,$4)`, [tenantId, key, JSON.stringify(result), actor.userId]);
      await this.audit(client, tenantId, actor, "planning.rolling_plan.confirmed_from_division_review", "RollingPlanItem", null, null, {
        ...result, matchKey: ["orderNumber", "itemNumber"],
        createMappedFields: ["customer", "responsibleOrgId", "orderNumber", "itemNumber", "itemName", "productionQuantity", "customerDueDate", "reviewDueDate"],
        updateMappedFields: ["productionQuantity", "customerDueDate", "reviewDueDate"]
      });
      return result;
    });
  }

  async syncMappingDepartmentsFromDirectory(tenantId: string, targets: MappingDepartmentDirectorySyncTarget[], skipped: MappingDepartmentDirectorySyncResult["skipped"], actor: MarketingActor): Promise<MappingDepartmentDirectorySyncResult> {
    return this.transaction(tenantId, async (client) => {
      const mappingChanges: Array<{ id: string; before: unknown; after: unknown }> = [];
      for (const target of targets) {
        const current = await client.query(`SELECT department,department_id AS "departmentId"
          FROM marketing.business_customer_mappings WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, target.id]);
        if (!current.rowCount) continue;
        if (current.rows[0].department === target.department && current.rows[0].departmentId === target.departmentId) continue;
        const result = await client.query(`UPDATE marketing.business_customer_mappings SET
            department=$3,department_id=$4,version=version+1,updated_at=now(),updated_by=$5
          WHERE tenant_id=$1 AND id=$2
          RETURNING id,
            jsonb_build_object('department',department,'departmentId',department_id) AS after`,
        [tenantId, target.id, target.department, target.departmentId, actor.userId]);
        if (result.rowCount) mappingChanges.push({
          id: target.id,
          before: current.rows[0],
          after: result.rows[0].after
        });
      }
      const summary: MappingDepartmentDirectorySyncResult = {
        sourceCustomers: targets.length + skipped.length,
        resolved: targets.length,
        mappingsUpdated: mappingChanges.length,
        skipped
      };
      await this.audit(client, tenantId, actor, "marketing.mapping.departments_synced_from_directory", "BusinessCustomerMapping", null, null, {
        source: "wechat-contact-directory", selectionRule: "first-enabled-salesperson-primary-department", ...summary, mappingChanges
      });
      return summary;
    });
  }
}
