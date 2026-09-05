import { Inject, Injectable } from "@nestjs/common";
import type { KdosDatabaseClient } from "@kdos/database";
import type { PlanningRiskSummary } from "@kdos/contracts";
import type { PoolClient } from "pg";
import { PlanningConflictError, PlanningNotFoundError, PlanningStateError, PlanningValidationError } from "./planning.errors";
import type { PlanSearchInput, PlanningRepository } from "./planning.repository";
import type {
  CreatePlanItemInput, PlanItemPatch, PlanItemRecord, PlanItemView, PlanPeriodRecord,
  PlanningActor, PlanVersionRecord, ProcessProgressRecord
} from "./planning.types";

export const KDOS_DATABASE = Symbol("KDOS_DATABASE");
const dateText = (value: unknown): string | null => value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

const period = (row: any): PlanPeriodRecord => ({
  id: row.id, tenantId: row.tenant_id, year: row.year, month: row.month, status: row.status,
  currentVersionId: row.current_version_id, createdAt: row.created_at, updatedAt: row.updated_at
});
const version = (row: any): PlanVersionRecord => ({
  id: row.id, tenantId: row.tenant_id, periodId: row.period_id, versionNumber: row.version_number,
  name: row.name, status: row.status, basedOnVersionId: row.based_on_version_id,
  publishedAt: row.published_at, lockedAt: row.locked_at, createdAt: row.created_at, updatedAt: row.updated_at
});
const item = (row: any): PlanItemRecord => ({
  id: row.id, tenantId: row.tenant_id, planVersionId: row.plan_version_id,
  salesOrderLineId: row.sales_order_line_id, orderNumber: row.order_number, itemNumber: row.item_number,
  customerCode: row.customer_code, customerName: row.customer_name, itemName: row.item_name,
  specification: row.specification, orderQuantity: String(row.order_quantity),
  productionQuantity: String(row.production_quantity), historicalInboundQuantity: String(row.historical_inbound_quantity),
  currentInboundQuantity: String(row.current_inbound_quantity), unitPrice: String(row.unit_price),
  deliveryDate: dateText(row.delivery_date), responsibleOrgId: row.responsible_org_id, ownerUserId: row.owner_user_id,
  priority: row.priority, sequence: row.sequence, status: row.status, exception: row.exception,
  remark: row.remark, imageRefs: row.image_refs ?? [], legacyData: row.legacy_data ?? {},
  version: row.version, createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at
});
const progress = (row: any): ProcessProgressRecord => ({
  id: row.id, planItemId: row.plan_item_id, processDefinitionId: row.process_definition_id,
  processCode: row.process_code, processName: row.process_name,
  requiredDays: row.required_days == null ? null : String(row.required_days), plannedDate: dateText(row.planned_date),
  actualDate: dateText(row.actual_date), plannedQuantity: row.planned_quantity == null ? null : String(row.planned_quantity),
  completedQuantity: row.completed_quantity == null ? null : String(row.completed_quantity),
  status: row.status, exception: row.exception, version: row.version
});

function setNested(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part];
    cursor[part] = child && typeof child === "object" && !Array.isArray(child) ? child : {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

@Injectable()
export class DrizzlePlanningRepository implements PlanningRepository {
  constructor(@Inject(KDOS_DATABASE) private readonly database: KdosDatabaseClient) {}

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

  private async audit(client: PoolClient, tenantId: string, actor: PlanningActor, action: string, resourceType: string, resourceId: string | null, before: unknown, after: unknown, reason?: string) {
    await client.query(`INSERT INTO audit.audit_logs
      (tenant_id,user_id,action,resource_type,resource_id,before,after,reason,source,request_id,trace_id,ip,created_by,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$2,$2)`, [
      tenantId, actor.userId, action, resourceType, resourceId, before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after), reason ?? null, actor.source, actor.requestId, actor.traceId ?? null, actor.ip ?? null
    ]);
  }

  async tenantId(code: string) {
    const result = await this.database.pool.query("SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true", [code]);
    if (!result.rowCount) throw new PlanningNotFoundError(`租户 ${code} 不存在或已停用`);
    return result.rows[0].id as string;
  }

  private async versionsFor(periodIds: string[], tenantId: string) {
    if (!periodIds.length) return [] as PlanVersionRecord[];
    const result = await this.database.pool.query("SELECT * FROM planning.plan_versions WHERE tenant_id=$1 AND period_id=ANY($2::uuid[]) ORDER BY version_number DESC", [tenantId, periodIds]);
    return result.rows.map(version);
  }

  async listPeriods(tenantId: string) {
    const result = await this.database.pool.query("SELECT * FROM planning.plan_periods WHERE tenant_id=$1 ORDER BY year DESC, month DESC", [tenantId]);
    const versions = await this.versionsFor(result.rows.map((row) => row.id), tenantId);
    return result.rows.map((row) => ({ ...period(row), versions: versions.filter((entry) => entry.periodId === row.id) }));
  }

  async periodByMonth(tenantId: string, year: number, month: number) {
    const result = await this.database.pool.query("SELECT * FROM planning.plan_periods WHERE tenant_id=$1 AND year=$2 AND month=$3", [tenantId, year, month]);
    if (!result.rowCount) return null;
    const mapped = period(result.rows[0]);
    return { ...mapped, versions: await this.versionsFor([mapped.id], tenantId) };
  }

  async getPeriod(tenantId: string, periodId: string) {
    const result = await this.database.pool.query("SELECT * FROM planning.plan_periods WHERE tenant_id=$1 AND id=$2", [tenantId, periodId]);
    if (!result.rowCount) return null;
    const mapped = period(result.rows[0]);
    return { ...mapped, versions: await this.versionsFor([mapped.id], tenantId) };
  }

  async getVersion(tenantId: string, versionId: string) {
    const result = await this.database.pool.query("SELECT * FROM planning.plan_versions WHERE tenant_id=$1 AND id=$2", [tenantId, versionId]);
    return result.rowCount ? version(result.rows[0]) : null;
  }

  async createPeriod(tenantId: string, year: number, month: number, actor: PlanningActor) {
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new PlanningValidationError("计划年月无效");
    return this.transaction(tenantId, async (client) => {
      const result = await client.query(`INSERT INTO planning.plan_periods(tenant_id,year,month,created_by,updated_by)
        VALUES($1,$2,$3,$4,$4) ON CONFLICT(tenant_id,year,month) DO UPDATE SET updated_at=planning.plan_periods.updated_at RETURNING *`, [tenantId, year, month, actor.userId]);
      const mapped = period(result.rows[0]);
      await this.audit(client, tenantId, actor, "planning.period.created", "PlanPeriod", mapped.id, null, mapped);
      return mapped;
    });
  }

  async createVersion(tenantId: string, periodId: string, basedOnVersionId: string | null, actor: PlanningActor) {
    return this.transaction(tenantId, async (client) => {
      const lockedPeriod = await client.query("SELECT * FROM planning.plan_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, periodId]);
      if (!lockedPeriod.rowCount) throw new PlanningNotFoundError("计划周期不存在");
      const existingDraft = await client.query("SELECT id FROM planning.plan_versions WHERE tenant_id=$1 AND period_id=$2 AND status='DRAFT'", [tenantId, periodId]);
      if (existingDraft.rowCount) throw new PlanningConflictError("该月份已有草稿版本，请先使用现有草稿");
      const base = basedOnVersionId ?? lockedPeriod.rows[0].current_version_id ?? null;
      if (base) {
        const baseResult = await client.query("SELECT id FROM planning.plan_versions WHERE tenant_id=$1 AND period_id=$2 AND id=$3", [tenantId, periodId, base]);
        if (!baseResult.rowCount) throw new PlanningValidationError("基准版本不属于当前计划周期");
      }
      const nextResult = await client.query("SELECT coalesce(max(version_number),0)+1 AS value FROM planning.plan_versions WHERE period_id=$1", [periodId]);
      const next = Number(nextResult.rows[0].value);
      const inserted = await client.query(`INSERT INTO planning.plan_versions
        (tenant_id,period_id,version_number,name,status,based_on_version_id,created_by,updated_by)
        VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$6) RETURNING *`, [tenantId, periodId, next, `v${next}`, base, actor.userId]);
      const created = version(inserted.rows[0]);
      if (base) {
        await client.query(`INSERT INTO planning.plan_items
          (tenant_id,plan_version_id,sales_order_line_id,order_number,item_number,customer_code,customer_name,item_name,specification,
           order_quantity,production_quantity,historical_inbound_quantity,current_inbound_quantity,unit_price,delivery_date,
           responsible_org_id,owner_user_id,priority,sequence,status,exception,remark,image_refs,legacy_data,version,created_by,updated_by)
          SELECT tenant_id,$1,sales_order_line_id,order_number,item_number,customer_code,customer_name,item_name,specification,
           order_quantity,production_quantity,historical_inbound_quantity,current_inbound_quantity,unit_price,delivery_date,
           responsible_org_id,owner_user_id,priority,sequence,status,exception,remark,image_refs,legacy_data,1,$2,$2
          FROM planning.plan_items WHERE tenant_id=$3 AND plan_version_id=$4`, [created.id, actor.userId, tenantId, base]);
        await client.query(`INSERT INTO planning.process_progress
          (tenant_id,plan_item_id,process_definition_id,required_days,planned_date,actual_date,planned_quantity,completed_quantity,status,exception,version,created_by,updated_by)
          SELECT pp.tenant_id,new_item.id,pp.process_definition_id,pp.required_days,pp.planned_date,pp.actual_date,pp.planned_quantity,
            pp.completed_quantity,pp.status,pp.exception,1,$1,$1
          FROM planning.process_progress pp
          JOIN planning.plan_items old_item ON old_item.id=pp.plan_item_id AND old_item.plan_version_id=$2
          JOIN planning.plan_items new_item ON new_item.plan_version_id=$3 AND new_item.order_number=old_item.order_number AND new_item.item_number=old_item.item_number
          WHERE pp.tenant_id=$4`, [actor.userId, base, created.id, tenantId]);
      }
      await this.audit(client, tenantId, actor, "planning.version.created", "PlanVersion", created.id, null, created);
      return created;
    });
  }

  private async itemViews(rows: any[], tenantId: string) {
    if (!rows.length) return [];
    const progressResult = await this.database.pool.query(`SELECT pp.*,pd.code process_code,pd.name process_name
      FROM planning.process_progress pp JOIN planning.process_definitions pd ON pd.id=pp.process_definition_id
      WHERE pp.tenant_id=$1 AND pp.plan_item_id=ANY($2::uuid[]) ORDER BY pd.sequence`, [tenantId, rows.map((row) => row.id)]);
    const allProgress = progressResult.rows.map(progress);
    const progressByItem = new Map<string, ProcessProgressRecord[]>();
    for (const entry of allProgress) progressByItem.set(entry.planItemId, [...(progressByItem.get(entry.planItemId) ?? []), entry]);
    return rows.map((row): PlanItemView => {
      const mapped = item(row);
      const processes: Record<string, Record<string, unknown>> = {};
      for (const entry of progressByItem.get(mapped.id) ?? []) processes[entry.processCode] = {
        processName: entry.processName,
        requiredDays: entry.requiredDays, dueDate: entry.plannedDate, actualDate: entry.actualDate,
        plannedQuantity: entry.plannedQuantity, quantity: entry.completedQuantity, status: entry.status, exception: entry.exception,
        version: entry.version
      };
      return { ...mapped, processes };
    });
  }

  async searchItems(tenantId: string, input: PlanSearchInput) {
    const { values, where } = this.itemSearchWhere(tenantId, input);
    const sortColumns: Record<string, string> = {
      sequence: "sequence", planSequence: "sequence", responsibleOrgId: "responsible_org_id", customer: "customer_name",
      orderNumber: "order_number", itemNumber: "item_number", itemName: "item_name", specification: "specification",
      orderQuantity: "order_quantity", productionQuantity: "production_quantity", customerDueDate: "delivery_date",
      createdAt: "created_at", updatedAt: "updated_at"
    };
    const sortColumn = sortColumns[input.sortField ?? ""] ?? "priority";
    const sortOrder = input.sortOrder === "desc" ? "DESC" : "ASC";
    values.push(Math.min(Math.max(input.limit ?? 5000, 1), 10000), Math.max(input.offset ?? 0, 0));
    const result = await this.database.pool.query(`SELECT planning.plan_items.* FROM planning.plan_items WHERE ${where.join(" AND ")}
      ORDER BY ${sortColumn} ${sortOrder},sequence ASC,created_at ASC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return this.itemViews(result.rows, tenantId);
  }

  async countItems(tenantId: string, input: PlanSearchInput) {
    const { values, where } = this.itemSearchWhere(tenantId, input);
    const result = await this.database.pool.query(`SELECT count(*)::int total FROM planning.plan_items WHERE ${where.join(" AND ")}`, values);
    return Number(result.rows[0]?.total ?? 0);
  }

  private itemSearchWhere(tenantId: string, input: PlanSearchInput) {
    const values: unknown[] = [tenantId, input.versionId];
    const where = ["tenant_id=$1", "plan_version_id=$2"];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replaceAll("?", `$${values.length}`)); };
    if (input.orderNumber) add("order_number ILIKE '%' || ? || '%'", input.orderNumber);
    if (input.itemNumber) add("item_number ILIKE '%' || ? || '%'", input.itemNumber);
    if (input.status) add("status=?", input.status);
    if (input.ownerUserId) add("owner_user_id=?", input.ownerUserId);
    if (input.responsibleOrgId) add("responsible_org_id=?", input.responsibleOrgId);
    if (input.responsibleOrgIds) {
      if (!input.responsibleOrgIds.length) where.push("false");
      else add("responsible_org_id=ANY(?::uuid[])", input.responsibleOrgIds);
    }
    if (input.search?.trim()) add(`concat_ws(' ',order_number,item_number,customer_name,item_name,specification,status,legacy_data::text) ILIKE '%' || ? || '%'`, input.search.trim());
    const filterColumns: Record<string, string> = {
      sequence: "sequence::text", planSequence: "sequence::text", responsibleOrgId: "responsible_org_id::text",
      customer: "customer_name", orderNumber: "order_number", itemNumber: "item_number", itemName: "item_name",
      specification: "specification", orderQuantity: "order_quantity::text", productionQuantity: "production_quantity::text",
      customerDueDate: "delivery_date::text", historicalInboundQuantity: "historical_inbound_quantity::text",
      todayInboundQuantity: "current_inbound_quantity::text", planningStatus: "status", orderException: "exception", remark: "remark",
      createdBy: "created_by::text", createdAt: "created_at::text", updatedBy: "updated_by::text", updatedAt: "updated_at::text"
    };
    for (const [field, raw] of Object.entries(input.filters ?? {})) {
      const value = raw.trim();
      if (!value) continue;
      const column = filterColumns[field];
      if (column) add(`coalesce(${column},'') ILIKE '%' || ? || '%'`, value);
      else if (/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(field)) {
        values.push(field.split("."), value);
        where.push(`coalesce(legacy_data #>> $${values.length - 1}::text[],'') ILIKE '%' || $${values.length} || '%'`);
      }
    }
    return { values, where };
  }

  async getItem(tenantId: string, itemId: string) {
    const result = await this.database.pool.query(`SELECT planning.plan_items.* FROM planning.plan_items WHERE tenant_id=$1 AND id=$2`, [tenantId, itemId]);
    return result.rowCount ? (await this.itemViews(result.rows, tenantId))[0]! : null;
  }

  private async upsertImportedProcesses(client: PoolClient, tenantId: string, itemId: string, legacyData: Record<string, unknown> | undefined, actor: PlanningActor) {
    const processes = legacyData?.processes;
    if (!processes || typeof processes !== "object") return;
    const definitions = await client.query("SELECT id,code FROM planning.process_definitions WHERE tenant_id=$1 AND enabled=true", [tenantId]);
    const byCode = new Map(definitions.rows.map((row) => [String(row.code), String(row.id)]));
    for (const [code, raw] of Object.entries(processes as Record<string, unknown>)) {
      const definitionId = byCode.get(code); if (!definitionId || !raw || typeof raw !== "object") continue;
      const value = raw as Record<string, unknown>;
      await client.query(`INSERT INTO planning.process_progress
        (tenant_id,plan_item_id,process_definition_id,required_days,planned_date,actual_date,planned_quantity,completed_quantity,status,exception,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
        ON CONFLICT(plan_item_id,process_definition_id) DO UPDATE SET
          required_days=EXCLUDED.required_days,planned_date=EXCLUDED.planned_date,actual_date=EXCLUDED.actual_date,
          planned_quantity=EXCLUDED.planned_quantity,completed_quantity=EXCLUDED.completed_quantity,status=EXCLUDED.status,
          exception=EXCLUDED.exception,version=planning.process_progress.version+1,updated_at=now(),updated_by=$11`, [
        tenantId, itemId, definitionId, value.requiredDays ?? null, value.dueDate ?? null, value.actualDate ?? null,
        value.plannedQuantity ?? null, value.quantity ?? null, value.status ?? null, value.exception ?? null, actor.userId
      ]);
    }
  }

  async createItem(tenantId: string, versionId: string, input: CreatePlanItemInput, actor: PlanningActor) {
    if (!input.orderNumber?.trim() || !input.itemNumber?.trim()) throw new PlanningValidationError("订单号和品号不能为空");
    return this.transaction(tenantId, async (client) => {
      const versionResult = await client.query("SELECT * FROM planning.plan_versions WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, versionId]);
      if (!versionResult.rowCount) throw new PlanningNotFoundError("计划版本不存在");
      if (versionResult.rows[0].status !== "DRAFT") throw new PlanningStateError("只有 DRAFT 版本允许新增计划行");
      const sequenceResult = await client.query("SELECT coalesce(max(sequence),0)+10 value FROM planning.plan_items WHERE plan_version_id=$1", [versionId]);
      const result = await client.query(`INSERT INTO planning.plan_items
        (tenant_id,plan_version_id,order_number,item_number,item_name,customer_name,order_quantity,production_quantity,delivery_date,
         priority,sequence,responsible_org_id,owner_user_id,remark,legacy_data,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *`, [
        tenantId, versionId, input.orderNumber.trim(), input.itemNumber.trim(), input.itemName ?? null, input.customerName ?? null,
        String(input.orderQuantity ?? input.productionQuantity ?? 0), String(input.productionQuantity ?? input.orderQuantity ?? 0), input.deliveryDate ?? null,
        input.priority ?? 50, input.sequence ?? Number(sequenceResult.rows[0].value), input.responsibleOrgId ?? null, input.ownerUserId ?? null,
        input.remark ?? null, JSON.stringify(input.legacyData ?? {}), actor.userId
      ]);
      const created = item(result.rows[0]);
      await this.upsertImportedProcesses(client, tenantId, created.id, input.legacyData, actor);
      await this.audit(client, tenantId, actor, "planning.plan_item.created", "PlanItem", created.id, null, created);
      return created;
    });
  }

  async createImportPreview(tenantId: string, versionId: string, fileName: string, fileHash: string, rows: CreatePlanItemInput[], warnings: string[], actor: PlanningActor) {
    if (!rows.length) throw new PlanningValidationError("导入文件没有可用计划行");
    return this.transaction(tenantId, async (client) => {
      const planVersion = await client.query("SELECT status FROM planning.plan_versions WHERE tenant_id=$1 AND id=$2", [tenantId, versionId]);
      if (!planVersion.rowCount) throw new PlanningNotFoundError("计划版本不存在");
      if (planVersion.rows[0].status !== "DRAFT") throw new PlanningStateError("只有 DRAFT 版本允许导入");
      const idempotencyKey = `${versionId}:${fileHash}`;
      const preview = { versionId, rows, warnings };
      const result = await client.query(`INSERT INTO integration.import_jobs
        (tenant_id,type,idempotency_key,file_name,file_hash,status,preview,created_by,updated_by)
        VALUES($1,'PLANNING_EXCEL',$2,$3,$4,'PREVIEWED',$5,$6,$6)
        ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET file_name=EXCLUDED.file_name,preview=EXCLUDED.preview,
          status=CASE WHEN integration.import_jobs.status='CONFIRMED' THEN integration.import_jobs.status ELSE 'PREVIEWED' END,
          updated_at=now(),updated_by=EXCLUDED.updated_by RETURNING id,status,result`,
      [tenantId, idempotencyKey, fileName, fileHash, JSON.stringify(preview), actor.userId]);
      const job = result.rows[0];
      const storedResult = job.result ?? {};
      return { jobId: job.id as string, summary: { total: job.status === "CONFIRMED" ? Number(storedResult.created ?? 0) + Number(storedResult.updated ?? 0) : rows.length, warnings: warnings.length }, warnings };
    });
  }

  async confirmImport(tenantId: string, jobId: string, actor: PlanningActor) {
    return this.transaction(tenantId, async (client) => {
      const jobResult = await client.query("SELECT * FROM integration.import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, jobId]);
      if (!jobResult.rowCount) throw new PlanningNotFoundError("导入任务不存在");
      const job = jobResult.rows[0];
      if (job.status === "CONFIRMED") return { versionId: job.preview.versionId, created: Number(job.result.created), updated: Number(job.result.updated), repeated: true };
      if (job.status !== "PREVIEWED") throw new PlanningStateError(`导入任务状态 ${job.status} 不能确认`);
      const preview = job.preview as { versionId: string; rows: CreatePlanItemInput[] };
      const planVersion = await client.query("SELECT status,period_id FROM planning.plan_versions WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, preview.versionId]);
      if (!planVersion.rowCount) throw new PlanningNotFoundError("计划版本不存在");
      if (planVersion.rows[0].status !== "DRAFT") throw new PlanningStateError("只有 DRAFT 版本允许确认导入");
      let created = 0; let updated = 0;
      const sequenceResult = await client.query("SELECT coalesce(max(sequence),0) value FROM planning.plan_items WHERE plan_version_id=$1", [preview.versionId]);
      let nextSequence = Number(sequenceResult.rows[0].value);
      for (const row of preview.rows) {
        const existing = await client.query("SELECT id FROM planning.plan_items WHERE tenant_id=$1 AND plan_version_id=$2 AND order_number=$3 AND item_number=$4", [tenantId, preview.versionId, row.orderNumber, row.itemNumber]);
        nextSequence += 10;
        if (existing.rowCount) {
          await client.query(`UPDATE planning.plan_items SET item_name=coalesce($1,item_name),customer_name=coalesce($2,customer_name),
            order_quantity=$3,production_quantity=$4,historical_inbound_quantity=coalesce($5,historical_inbound_quantity),
            current_inbound_quantity=coalesce($6,current_inbound_quantity),unit_price=coalesce($7,unit_price),
            delivery_date=coalesce($8,delivery_date),priority=$9,responsible_org_id=coalesce($10,responsible_org_id),
            owner_user_id=coalesce($11,owner_user_id),exception=coalesce($12,exception),remark=coalesce($13,remark),
            legacy_data=legacy_data || $14::jsonb,version=version+1,updated_at=now(),updated_by=$15 WHERE id=$16`, [
            row.itemName ?? null, row.customerName ?? null, String(row.orderQuantity ?? row.productionQuantity ?? 0), String(row.productionQuantity ?? row.orderQuantity ?? 0),
            row.historicalInboundQuantity == null ? null : String(row.historicalInboundQuantity),
            row.currentInboundQuantity == null ? null : String(row.currentInboundQuantity),
            row.unitPrice == null ? null : String(row.unitPrice), row.deliveryDate ?? null, row.priority ?? 50,
            row.responsibleOrgId ?? null, row.ownerUserId ?? null, row.exception ?? null, row.remark ?? null,
            JSON.stringify(row.legacyData ?? {}), actor.userId, existing.rows[0].id
          ]);
          await this.upsertImportedProcesses(client, tenantId, String(existing.rows[0].id), row.legacyData, actor); updated++;
        } else {
          const inserted = await client.query(`INSERT INTO planning.plan_items
            (tenant_id,plan_version_id,order_number,item_number,item_name,customer_name,order_quantity,production_quantity,
             historical_inbound_quantity,current_inbound_quantity,unit_price,delivery_date,priority,sequence,responsible_org_id,
             owner_user_id,exception,remark,legacy_data,created_by,updated_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING id`, [
            tenantId, preview.versionId, row.orderNumber, row.itemNumber, row.itemName ?? null, row.customerName ?? null,
            String(row.orderQuantity ?? row.productionQuantity ?? 0), String(row.productionQuantity ?? row.orderQuantity ?? 0),
            String(row.historicalInboundQuantity ?? 0), String(row.currentInboundQuantity ?? 0), String(row.unitPrice ?? 0), row.deliveryDate ?? null,
            row.priority ?? 50, row.sequence ?? nextSequence, row.responsibleOrgId ?? null, row.ownerUserId ?? null,
            row.exception ?? null, row.remark ?? null, JSON.stringify(row.legacyData ?? {}), actor.userId
          ]);
          await this.upsertImportedProcesses(client, tenantId, String(inserted.rows[0].id), row.legacyData, actor); created++;
        }
      }
      const result = { created, updated };
      await client.query("UPDATE integration.import_jobs SET status='CONFIRMED',result=$1,confirmed_at=now(),updated_at=now(),updated_by=$2 WHERE id=$3", [JSON.stringify(result), actor.userId, jobId]);
      await this.audit(client, tenantId, actor, "planning.plan.imported", "PlanVersion", preview.versionId, null, result);
      return { versionId: preview.versionId, ...result, repeated: false };
    });
  }

  private async updateWithClient(client: PoolClient, tenantId: string, itemId: string, patch: PlanItemPatch, actor: PlanningActor) {
    const currentResult = await client.query(`SELECT i.*,v.status version_status,v.period_id FROM planning.plan_items i
      JOIN planning.plan_versions v ON v.id=i.plan_version_id WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE OF i`, [tenantId, itemId]);
    if (!currentResult.rowCount) throw new PlanningNotFoundError("计划行不存在");
    const current = currentResult.rows[0];
    if (current.version_status !== "DRAFT") throw new PlanningStateError("Published/Locked 版本只读，请基于正式版本创建新草稿");
    if (current.version !== patch.expectedVersion) throw new PlanningConflictError("计划行已被其他用户修改", item(current));
    const processMatch = /^processes\.([a-zA-Z0-9]+)\.(requiredDays|dueDate|actualDate|plannedQuantity|quantity|status|exception)$/.exec(patch.field);
    if (processMatch) {
      const processResult = await client.query("SELECT id FROM planning.process_definitions WHERE tenant_id=$1 AND code=$2 AND enabled=true", [tenantId, processMatch[1]]);
      if (!processResult.rowCount) throw new PlanningValidationError(`未知工序：${processMatch[1]}`);
      const columns: Record<string, string> = { requiredDays: "required_days", dueDate: "planned_date", actualDate: "actual_date", plannedQuantity: "planned_quantity", quantity: "completed_quantity", status: "status", exception: "exception" };
      const column = columns[processMatch[2]]!;
      await client.query(`INSERT INTO planning.process_progress(tenant_id,plan_item_id,process_definition_id,${column},created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(plan_item_id,process_definition_id) DO UPDATE SET ${column}=EXCLUDED.${column},version=planning.process_progress.version+1,updated_at=now(),updated_by=$5`,
      [tenantId, itemId, processResult.rows[0].id, patch.value === "" ? null : patch.value, actor.userId]);
    } else {
      const core: Record<string, string> = {
        priority: "priority", planSequence: "sequence", responsibleOrgId: "responsible_org_id", ownerUserId: "owner_user_id",
        productionQuantity: "production_quantity", historicalInboundQuantity: "historical_inbound_quantity",
        todayInboundQuantity: "current_inbound_quantity", unitPrice: "unit_price", customerDueDate: "delivery_date",
        deliveryDate: "delivery_date", customer: "customer_name", itemName: "item_name", remark: "remark", planningStatus: "status",
        orderException: "exception", imageRefs: "image_refs"
      };
      if (core[patch.field]) {
        const value = patch.field === "imageRefs" ? JSON.stringify(patch.value ?? []) : patch.value === "" ? null : patch.value;
        await client.query(`UPDATE planning.plan_items SET ${core[patch.field]}=$1 WHERE id=$2`, [value, itemId]);
      } else {
        const legacy = { ...(current.legacy_data ?? {}) };
        setNested(legacy, patch.field, patch.value === "" ? null : patch.value);
        await client.query("UPDATE planning.plan_items SET legacy_data=$1 WHERE id=$2", [JSON.stringify(legacy), itemId]);
      }
    }
    const updatedResult = await client.query("UPDATE planning.plan_items SET version=version+1,updated_at=now(),updated_by=$1 WHERE id=$2 RETURNING *", [actor.userId, itemId]);
    const updated = item(updatedResult.rows[0]);
    await client.query(`INSERT INTO planning.plan_changes(tenant_id,version_id,plan_item_id,change_type,before,after,source,created_by)
      VALUES($1,$2,$3,'FIELD_UPDATED',$4,$5,$6,$7)`, [tenantId, updated.planVersionId, itemId, JSON.stringify({ [patch.field]: (item(current) as any)[patch.field] }), JSON.stringify({ [patch.field]: patch.value }), actor.source, actor.userId]);
    await this.audit(client, tenantId, actor, "planning.plan_item.updated", "PlanItem", itemId, { field: patch.field, version: current.version }, { field: patch.field, value: patch.value, version: updated.version });
    return updated;
  }

  async updateItem(tenantId: string, itemId: string, patch: PlanItemPatch, actor: PlanningActor) {
    return this.transaction(tenantId, (client) => this.updateWithClient(client, tenantId, itemId, patch, actor));
  }

  async bulkUpdate(tenantId: string, versionId: string, patches: Array<{ id: string } & PlanItemPatch>, actor: PlanningActor) {
    if (patches.length > 1000) throw new PlanningValidationError("单次批量修改最多 1000 项");
    return this.transaction(tenantId, async (client) => {
      const versionResult = await client.query("SELECT status FROM planning.plan_versions WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, versionId]);
      if (!versionResult.rowCount) throw new PlanningNotFoundError("计划版本不存在");
      if (versionResult.rows[0].status !== "DRAFT") throw new PlanningStateError("只有 DRAFT 版本允许批量修改");
      const output: PlanItemRecord[] = [];
      for (const patch of patches) output.push(await this.updateWithClient(client, tenantId, patch.id, patch, actor));
      return output;
    });
  }

  async reorder(tenantId: string, versionId: string, itemIds: string[], actor: PlanningActor) {
    return this.transaction(tenantId, async (client) => {
      const state = await client.query("SELECT status,period_id FROM planning.plan_versions WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, versionId]);
      if (!state.rowCount) throw new PlanningNotFoundError("计划版本不存在");
      if (state.rows[0].status !== "DRAFT") throw new PlanningStateError("只有 DRAFT 版本允许调整顺序");
      const unique = [...new Set(itemIds)];
      const result: PlanItemRecord[] = [];
      for (const [index, id] of unique.entries()) {
        const updated = await client.query("UPDATE planning.plan_items SET sequence=$1,version=version+1,updated_at=now(),updated_by=$2 WHERE tenant_id=$3 AND plan_version_id=$4 AND id=$5 RETURNING *", [(index + 1) * 10, actor.userId, tenantId, versionId, id]);
        if (!updated.rowCount) throw new PlanningValidationError(`计划行 ${id} 不属于当前版本`);
        result.push(item(updated.rows[0]));
      }
      await this.audit(client, tenantId, actor, "planning.plan.reordered", "PlanVersion", versionId, null, { itemIds: unique });
      return result;
    });
  }

  async publishVersion(tenantId: string, periodId: string, versionId: string, actor: PlanningActor) {
    return this.transaction(tenantId, async (client) => {
      const state = await client.query("SELECT * FROM planning.plan_versions WHERE tenant_id=$1 AND period_id=$2 AND id=$3 FOR UPDATE", [tenantId, periodId, versionId]);
      if (!state.rowCount) throw new PlanningNotFoundError("计划版本不存在");
      if (state.rows[0].status !== "DRAFT") throw new PlanningStateError("只有 DRAFT 版本可以发布");
      const invalid = await client.query("SELECT count(*)::int total,count(*) FILTER(WHERE trim(order_number)='' OR trim(item_number)='' OR production_quantity<0)::int invalid FROM planning.plan_items WHERE plan_version_id=$1", [versionId]);
      if (!invalid.rows[0].total) throw new PlanningValidationError("空计划不能发布");
      if (invalid.rows[0].invalid) throw new PlanningValidationError("计划包含订单号/品号缺失或负生产数量");
      const items = await client.query("SELECT * FROM planning.plan_items WHERE tenant_id=$1 AND plan_version_id=$2 ORDER BY priority,sequence", [tenantId, versionId]);
      const progressRows = await client.query(`SELECT pp.*,pd.code process_code,pd.name process_name FROM planning.process_progress pp
        JOIN planning.process_definitions pd ON pd.id=pp.process_definition_id WHERE pp.tenant_id=$1 AND pp.plan_item_id IN (SELECT id FROM planning.plan_items WHERE plan_version_id=$2)`, [tenantId, versionId]);
      const numberResult = await client.query("SELECT coalesce(max(snapshot_number),0)+1 value FROM planning.plan_snapshots WHERE version_id=$1", [versionId]);
      const snapshotNumber = Number(numberResult.rows[0].value);
      const payload = { schemaVersion: 1, periodId, versionId, capturedAt: new Date().toISOString(), items: items.rows, processProgress: progressRows.rows };
      const snapshot = await client.query("INSERT INTO planning.plan_snapshots(tenant_id,version_id,snapshot_number,payload,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id", [tenantId, versionId, snapshotNumber, JSON.stringify(payload), actor.userId]);
      await client.query("UPDATE planning.plan_versions SET status='ARCHIVED',updated_at=now(),updated_by=$1 WHERE tenant_id=$2 AND period_id=$3 AND status='PUBLISHED'", [actor.userId, tenantId, periodId]);
      const published = await client.query("UPDATE planning.plan_versions SET status='PUBLISHED',published_at=now(),published_by=$1,updated_at=now(),updated_by=$1 WHERE id=$2 RETURNING *", [actor.userId, versionId]);
      await client.query("UPDATE planning.plan_periods SET current_version_id=$1,updated_at=now(),updated_by=$2 WHERE tenant_id=$3 AND id=$4", [versionId, actor.userId, tenantId, periodId]);
      await this.audit(client, tenantId, actor, "planning.plan.published", "PlanVersion", versionId, state.rows[0], published.rows[0]);
      return { version: version(published.rows[0]), snapshotId: snapshot.rows[0].id as string, snapshotNumber };
    });
  }

  async lockVersion(tenantId: string, periodId: string, versionId: string, reason: string, actor: PlanningActor) {
    if (!reason.trim()) throw new PlanningValidationError("锁定原因不能为空");
    return this.transitionLock(tenantId, periodId, versionId, "PUBLISHED", "LOCKED", reason, actor, "planning.plan.locked");
  }

  async unlockVersion(tenantId: string, periodId: string, versionId: string, reason: string, actor: PlanningActor) {
    if (!reason.trim()) throw new PlanningValidationError("解锁原因不能为空");
    return this.transitionLock(tenantId, periodId, versionId, "LOCKED", "PUBLISHED", reason, actor, "planning.plan.unlocked");
  }

  private transitionLock(tenantId: string, periodId: string, versionId: string, from: string, to: string, reason: string, actor: PlanningActor, action: string) {
    return this.transaction(tenantId, async (client) => {
      const current = await client.query("SELECT * FROM planning.plan_versions WHERE tenant_id=$1 AND period_id=$2 AND id=$3 FOR UPDATE", [tenantId, periodId, versionId]);
      if (!current.rowCount) throw new PlanningNotFoundError("计划版本不存在");
      if (current.rows[0].status !== from) throw new PlanningStateError(`只有 ${from} 版本可以执行此操作`);
      const lockValues = to === "LOCKED" ? "locked_at=now(),locked_by=$1,lock_reason=$2" : "locked_at=NULL,locked_by=NULL,lock_reason=$2";
      const updated = await client.query(`UPDATE planning.plan_versions SET status=$3,${lockValues},updated_at=now(),updated_by=$1 WHERE id=$4 RETURNING *`, [actor.userId, reason, to, versionId]);
      await this.audit(client, tenantId, actor, action, "PlanVersion", versionId, current.rows[0], updated.rows[0], reason);
      return version(updated.rows[0]);
    });
  }

  async listProcessProgress(tenantId: string, versionId: string) {
    const result = await this.database.pool.query(`SELECT pp.*,pd.code process_code,pd.name process_name FROM planning.process_progress pp
      JOIN planning.process_definitions pd ON pd.id=pp.process_definition_id
      JOIN planning.plan_items item ON item.id=pp.plan_item_id
      WHERE pp.tenant_id=$1 AND item.plan_version_id=$2 ORDER BY item.sequence,pd.sequence`, [tenantId, versionId]);
    return result.rows.map(progress);
  }

  async riskSummary(tenantId: string, versionId: string, dueWithinDays: number, today: string): Promise<PlanningRiskSummary> {
    const dueDate = new Date(`${today}T00:00:00Z`); dueDate.setUTCDate(dueDate.getUTCDate() + dueWithinDays);
    const dueEnd = dueDate.toISOString().slice(0, 10);
    const [items, processes] = await Promise.all([
      this.database.pool.query(`SELECT id,order_number,item_number,delivery_date,status,exception FROM planning.plan_items
        WHERE tenant_id=$1 AND plan_version_id=$2 AND (delivery_date IS NOT NULL OR nullif(exception,'') IS NOT NULL)`, [tenantId, versionId]),
      this.database.pool.query(`SELECT pp.plan_item_id,pd.code process_code,pp.planned_date,pp.status,pp.exception FROM planning.process_progress pp
        JOIN planning.process_definitions pd ON pd.id=pp.process_definition_id JOIN planning.plan_items item ON item.id=pp.plan_item_id
        WHERE pp.tenant_id=$1 AND item.plan_version_id=$2`, [tenantId, versionId])
    ]);
    const incomplete = (status: string | null) => !["COMPLETED", "完成", "已完成"].includes(status ?? "");
    const itemDates = items.rows.map((row) => ({ ...row, date: dateText(row.delivery_date) }));
    const processDates = processes.rows.map((row) => ({ ...row, date: dateText(row.planned_date) }));
    return {
      overdue: itemDates.filter((row) => row.date && row.date < today && incomplete(row.status)).map((row) => ({ id: row.id, orderNumber: row.order_number, itemNumber: row.item_number, deliveryDate: row.date! })),
      dueSoon: itemDates.filter((row) => row.date && row.date >= today && row.date <= dueEnd && incomplete(row.status)).map((row) => ({ id: row.id, orderNumber: row.order_number, itemNumber: row.item_number, deliveryDate: row.date! })),
      processOverdue: processDates.filter((row) => row.date && row.date < today && incomplete(row.status)).map((row) => ({ planItemId: row.plan_item_id, processCode: row.process_code, plannedDate: row.date! })),
      openExceptions: [
        ...items.rows.filter((row) => row.exception).map((row) => ({ planItemId: row.id, exception: row.exception })),
        ...processes.rows.filter((row) => row.exception).map((row) => ({ planItemId: row.plan_item_id, processCode: row.process_code, exception: row.exception }))
      ]
    };
  }
}
