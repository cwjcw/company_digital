import { ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { columnsFor, MASTER_PLAN_RESOURCE_MAP } from "./master-plan.config";
import { hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MASTER_PLAN_SYSTEM_USER_ID } from "./master-plan.sync.service";

const WORK_ORDER_RESOURCE = "mps-three-day-work-orders";
const WEEKLY_RESOURCE = "mps-weekly-plans";

/** 来源字段（source-owned）：只能由“从周计划同步”维护，任何普通写入都必须被拒绝。 */
export const WORK_ORDER_SOURCE_FIELDS = [
  "divisionId", "customerCode", "orderNumber", "orderDate", "modelAge", "itemCode", "itemName",
  "imageRefs", "requiredQuantity", "blankCompletionDate", "packagingCompletionDate", "manufacturingMethod"
] as const;
/** 人工字段（user-owned）：只由用户维护，重复同步绝不覆盖。 */
export const WORK_ORDER_USER_FIELDS = ["productionStartDate", "productionEndDate", "remark", "processingRemark"] as const;

export type WorkOrderSyncResult = { scanned: number; created: number; updated: number; unchanged: number; skipped: number };

/**
 * KN-MPS-WO-001：3天生产工单同步（**仅用户主动触发**，不注册任何 scheduler / mps_sync_configs 任务）。
 *
 * 身份与所有权：
 * - 唯一同步身份是 `weekly_plan_id`（tenant + weeklyPlanId），绝不使用 orderNumber+itemCode(+deliveryNumber) 定位；
 * - 同步只覆盖 source-owned 字段；productionStartDate/productionEndDate/remark/processingRemark 属人工字段，永不被覆盖；
 * - 来源集合 = 当前用户数据范围内的全部事业部周计划；不做“来源不存在就删除工单”的动作。
 */
@Injectable()
export class MasterPlanWorkOrderService {
  constructor(private readonly dataSource: DataSource, private readonly queries: MasterPlanQueryService) {}

  /** 同步接口权限：需要 3天生产工单 维护权限 + 事业部周计划 查看权限（并受周计划数据范围约束）。 */
  private assertSyncAllowed(actor: MasterPlanActor) {
    if (!hasMasterPlanPermission(actor, WORK_ORDER_RESOURCE, "update")) throw new ForbiddenException("当前权限组没有 3天生产工单 维护权限");
    if (!hasMasterPlanPermission(actor, WEEKLY_RESOURCE, "read")) throw new ForbiddenException("当前权限组没有事业部周计划查看权限");
  }

  async syncFromWeekly(actor: MasterPlanActor): Promise<WorkOrderSyncResult> {
    this.assertSyncAllowed(actor);
    const source = await this.queries.weeklyWorkOrderSource(actor);
    const columns = columnsFor(MASTER_PLAN_RESOURCE_MAP.get(WORK_ORDER_RESOURCE)!);
    const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;

    /* 只同步满足目标表 NOT NULL/CHECK 约束的来源行；不满足的行计入 skipped 并保留在来源侧（不写入假数据）。 */
    const syncable: Array<Record<string, unknown>> = [];
    let skipped = 0;
    for (const row of source) {
      const orderNumber = String(row.order_number ?? "").trim();
      const itemCode = String(row.item_code ?? "").trim();
      if (!row.weekly_plan_id || !row.division_id || !orderNumber || !itemCode) { skipped += 1; continue; }
      syncable.push(row);
    }

    const result = await this.dataSource.transaction(async (manager: EntityManager) => {
      const existingRows = await manager.query(
        `SELECT weekly_plan_id, ${WORK_ORDER_SOURCE_FIELDS.map((field) => columns[field]).join(", ")} FROM mps_three_day_work_orders WHERE tenant_id=$1`,
        [actor.tenantId]
      ) as Array<Record<string, unknown>>;
      const beforeByWeekly = new Map(existingRows.map((row) => [String(row.weekly_plan_id), row]));

      let created = 0; let updated = 0;
      const createdRows: Array<Record<string, unknown>> = [];
      const updatedRows: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }> = [];
      for (const batch of chunk(syncable, 200)) {
        const params: unknown[] = [actor.tenantId, actorId, actorId];
        const tuples = batch.map((row) => {
          const values = [
            row.weekly_plan_id, row.division_id, row.customer_code ?? null, row.order_number, row.order_date ?? null, row.model_age ?? null,
            row.item_code, row.item_name ?? null, JSON.stringify(row.image_refs ?? []), row.planned_quantity ?? 0,
            row.blank_completion_date ?? null, row.packaging_completion_date ?? null, row.manufacturing_method ?? null
          ];
          params.push(...values);
          const base = params.length - values.length + 1;
          return `($1,$${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8}::jsonb,$${base + 9},$${base + 10},$${base + 11},$${base + 12},$2,$3)`;
        });
        /* ON CONFLICT 只更新来源字段，且仅当来源字段确有变化时才更新（无变化不涨 version、不动 updated_at）。 */
        const changed = await manager.query(`
          INSERT INTO mps_three_day_work_orders(tenant_id,weekly_plan_id,division_id,customer_code,order_number,order_date,model_age,item_code,item_name,image_refs,required_quantity,blank_completion_date,packaging_completion_date,manufacturing_method,created_by,updated_by)
          VALUES ${tuples.join(",")}
          ON CONFLICT ON CONSTRAINT uq_mps_three_day_work_order DO UPDATE SET
            division_id=excluded.division_id,customer_code=excluded.customer_code,order_number=excluded.order_number,order_date=excluded.order_date,
            model_age=excluded.model_age,item_code=excluded.item_code,item_name=excluded.item_name,image_refs=excluded.image_refs,
            required_quantity=excluded.required_quantity,blank_completion_date=excluded.blank_completion_date,
            packaging_completion_date=excluded.packaging_completion_date,manufacturing_method=excluded.manufacturing_method,
            updated_at=now(),updated_by=excluded.updated_by,version=mps_three_day_work_orders.version+1
          WHERE (mps_three_day_work_orders.division_id,mps_three_day_work_orders.customer_code,mps_three_day_work_orders.order_number,mps_three_day_work_orders.order_date,
                 mps_three_day_work_orders.model_age,mps_three_day_work_orders.item_code,mps_three_day_work_orders.item_name,mps_three_day_work_orders.image_refs,
                 mps_three_day_work_orders.required_quantity,mps_three_day_work_orders.blank_completion_date,mps_three_day_work_orders.packaging_completion_date,
                 mps_three_day_work_orders.manufacturing_method)
            IS DISTINCT FROM
                (excluded.division_id,excluded.customer_code,excluded.order_number,excluded.order_date,
                 excluded.model_age,excluded.item_code,excluded.item_name,excluded.image_refs,
                 excluded.required_quantity,excluded.blank_completion_date,excluded.packaging_completion_date,
                 excluded.manufacturing_method)
          RETURNING *, (xmax = 0) AS inserted`, params) as Array<Record<string, unknown>>;
        for (const row of changed) {
          if (row.inserted === true) { created += 1; createdRows.push(row); }
          else { updated += 1; updatedRows.push({ before: beforeByWeekly.get(String(row.weekly_plan_id)) ?? {}, after: row }); }
        }
      }

      /* 审计：真正的写入按当前项目规则保存必要 before/after；同步动作本身也留一条汇总审计。 */
      await this.audit(manager, actor, createdRows.map((row) => ({ recordId: row.id, before: null, after: row })), "created");
      await this.audit(manager, actor, updatedRows.map((row) => ({ recordId: row.after.id, before: row.before, after: row.after })), "updated");
      const unchanged = syncable.length - created - updated;
      await manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1::uuid,$2,$3,NULL,$4,NULL,$5::jsonb,$6,$7,$1::uuid,$1::uuid)`,
        [actorId, actor.username, WORK_ORDER_RESOURCE, `${WORK_ORDER_RESOURCE}.sync_from_weekly`,
          JSON.stringify({ source: "weekly", scanned: source.length, created, updated, unchanged, skipped }), actor.requestId, actor.source]);
      return { scanned: source.length, created, updated, unchanged, skipped } satisfies WorkOrderSyncResult;
    });
    return result;
  }

  /** 逐条审计（按批次写入），before/after 只保留与业务相关的列。 */
  private async audit(manager: EntityManager, actor: MasterPlanActor, rows: Array<{ recordId: unknown; before: unknown; after: unknown }>, action: string) {
    if (!rows.length) return;
    const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
    for (const batch of chunk(rows, 200)) {
      /* 基础参数 $1..$6：actor/name/resource/action/request/source；每行追加 recordId、before、after。 */
      const params: unknown[] = [actorId, actor.username, WORK_ORDER_RESOURCE, `${WORK_ORDER_RESOURCE}.sync_${action}`, actor.requestId, actor.source];
      const tuples = batch.map((row) => {
        params.push(String(row.recordId), JSON.stringify(row.before ?? null), JSON.stringify(row.after ?? null));
        const base = params.length - 2;
        return `($1::uuid,$2,$3,$${base},$4,$${base + 1}::jsonb,$${base + 2}::jsonb,$5,$6,$1::uuid,$1::uuid)`;
      });
      await manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES ${tuples.join(",")}`, params);
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}
