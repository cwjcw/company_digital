import { ConflictException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { outsourcingStatus, processStatus, reverseSchedule, shanghaiToday } from "./master-plan.domain";
import { fieldsFor, MASTER_PLAN_RESOURCE_MAP, weeklyAdmissionSql, type MasterPlanResource } from "./master-plan.config";
import {
  MASTER_PLAN_ERP_ADMISSION, SNAPSHOT_BUSINESS_KEY_BINDING, erpAccountWhitelistSql, erpOrderAdmissibleStatusSql, erpOrderDateAdmissionSql,
  erpSourceIdentitySql, snapshotSourceSystemSql
} from "./master-plan.erp-admission";
import { hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

type RunType = "SCHEDULED" | "MANUAL" | "EVENT" | "RECONCILIATION";
/** 同步结果：`count` 继续写入 mps_sync_logs.sync_count，`metrics` 写入同表 metrics（KN-MPS-LIVE-002 可观测性）。 */
type SyncOutcome = { count: number; metrics?: Record<string, number> };
export const MASTER_PLAN_SYSTEM_USER_ID = "0199e000-0000-7000-8000-000000000001";

@Injectable()
export class MasterPlanSyncService {
  private readonly logger = new Logger(MasterPlanSyncService.name);
  private readonly running = new Set<string>();
  constructor(private readonly dataSource: DataSource) {}

  async manual(syncKey: string, actor: MasterPlanActor) {
    if (!hasMasterPlanPermission(actor, "mps-sync-configs", "update")) throw new ForbiddenException("当前权限组没有手工同步权限");
    return this.run(actor.tenantId, syncKey, "MANUAL", actor.userId, actor.username, `manual:${actor.requestId}:${syncKey}`);
  }

  @Interval(60_000)
  async runDue() {
    const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
    try {
      const configs = await this.dataSource.query(`SELECT sync_key FROM mps_sync_configs WHERE tenant_id=$1 AND enabled=true AND status<>'RUNNING' AND (last_started_at IS NULL OR last_started_at + interval_minutes * interval '1 minute' <= now()) ORDER BY sync_key`, [tenantId]);
      for (const config of configs) await this.run(tenantId, config.sync_key, "SCHEDULED", MASTER_PLAN_SYSTEM_USER_ID, "KDOS系统任务", `scheduled:${config.sync_key}:${new Date().toISOString().slice(0, 16)}`);
      await this.processOutbox();
    } catch (error) { this.logger.error(`主计划定时同步检查失败: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async processOutbox() {
    const events = await this.dataSource.transaction(async (manager) => {
      const result = await manager.query(`UPDATE mps_reconciliation_outbox SET status='RUNNING',attempts=attempts+1,updated_at=now(),version=version+1
      WHERE id IN (
        SELECT id FROM mps_reconciliation_outbox
        WHERE status IN ('PENDING','FAILED') AND next_attempt_at<=now()
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20
      ) RETURNING *`);
      return Array.isArray(result[0]) ? result[0] : result;
    });
    for (const event of events) {
      try {
        await this.run(event.tenant_id, event.sync_key, "EVENT", event.actor_id, event.actor_name, event.idempotency_key);
        await this.dataSource.query(`UPDATE mps_reconciliation_outbox SET status='SUCCESS',completed_at=now(),last_error=NULL,updated_at=now(),updated_by=$2::uuid,version=version+1 WHERE id=$1`, [event.id, event.actor_id]);
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
        /* 同一同步键正在运行时只是暂时让位，不是业务失败：保持 PENDING 稍后重试，避免把并发让位显示成“生成失败”。 */
        if (error instanceof ConflictException && message === "该同步任务正在运行") {
          await this.dataSource.query(`UPDATE mps_reconciliation_outbox SET status='PENDING',last_error=NULL,next_attempt_at=now() + interval '5 seconds',updated_at=now(),updated_by=$2::uuid,version=version+1 WHERE id=$1`, [event.id, event.actor_id]);
          continue;
        }
        await this.dataSource.query(`UPDATE mps_reconciliation_outbox SET status='FAILED',last_error=$2,next_attempt_at=now() + least(attempts,30) * interval '1 minute',updated_at=now(),updated_by=$3::uuid,version=version+1 WHERE id=$1`, [event.id, message, event.actor_id]);
      }
    }
    return events.length;
  }

  async run(tenantId: string, syncKey: string, runType: RunType, userId: string | null, username: string, idempotencyKey = `${runType.toLowerCase()}:${syncKey}:${randomUUID()}`) {
    const runningKey = `${tenantId}:${syncKey}`;
    if (this.running.has(runningKey)) throw new ConflictException("该同步任务正在运行");
    this.running.add(runningKey);
    try {
      const [config] = await this.dataSource.query(`SELECT id,enabled FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey]);
      if (!config) throw new ConflictException("同步配置不存在");
      if (!config.enabled && runType !== "MANUAL") return { syncKey, skipped: true, count: 0 };
      const previous = await this.dataSource.query(`SELECT status,sync_count,error_message FROM mps_sync_logs WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, idempotencyKey]);
      if (previous[0]) return { syncKey, repeated: true, count: Number(previous[0].sync_count), status: previous[0].status };
      await this.dataSource.query(`INSERT INTO mps_sync_logs(tenant_id,sync_config_id,sync_key,run_type,status,started_at,idempotency_key,created_by,updated_by) VALUES($1,$2,$3,$4,'RUNNING',now(),$5,$6::uuid,$7)`, [tenantId, config.id, syncKey, runType, idempotencyKey, userId, userId ?? username]);
      await this.dataSource.query(`UPDATE mps_sync_configs SET status='RUNNING',last_started_at=now(),error_message=NULL,updated_at=now(),updated_by=$3,version=version+1 WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey, userId ?? username]);
      try {
        const outcome = await this.execute(syncKey, tenantId, userId, userId ?? username);
        const count = outcome.count;
        await this.dataSource.query(`UPDATE mps_sync_logs SET status='SUCCESS',completed_at=now(),sync_count=$3,metrics=$5::jsonb,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND idempotency_key=$2`,
          [tenantId, idempotencyKey, count, userId ?? username, outcome.metrics ? JSON.stringify(outcome.metrics) : null]);
        await this.dataSource.query(`UPDATE mps_sync_configs SET status='SUCCESS',last_success_at=now(),last_sync_count=$3,error_message=NULL,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey, count, userId ?? username]);
        return { syncKey, repeated: false, count, metrics: outcome.metrics ?? null, status: "SUCCESS" };
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
        await this.dataSource.query(`UPDATE mps_sync_logs SET status='FAILED',completed_at=now(),error_message=$3,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, idempotencyKey, message, userId ?? username]);
        await this.dataSource.query(`UPDATE mps_sync_configs SET status='FAILED',last_failure_at=now(),error_message=$3,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey, message, userId ?? username]);
        await this.upsertException(tenantId, `sync:${syncKey}`, "mps-sync-configs", null, syncKey, "SYNC_FAILURE", "ERROR", `同步失败：${message}`, userId, userId ?? username);
        throw error;
      }
    } finally { this.running.delete(runningKey); }
  }

  private async execute(syncKey: string, tenantId: string, userId: string | null, updatedBy: string): Promise<SyncOutcome> {
    const jobs: Record<string, () => Promise<number | SyncOutcome>> = {
      "erp-orders": () => this.projectOrders(tenantId, userId, updatedBy),
      "plan-projections": () => this.projectPlans(tenantId, userId, updatedBy),
      "shipping-to-base": () => this.shippingToBase(tenantId, userId, updatedBy),
      "base-to-weekly": () => this.baseToWeekly(tenantId, userId, updatedBy),
      "inbound-allocation": () => this.allocateInbound(tenantId, updatedBy),
      "execution-rollup": () => this.executionRollup(tenantId, updatedBy)
    };
    const job = jobs[syncKey]; if (!job) throw new ConflictException("未知同步任务");
    const result = await job();
    return typeof result === "number" ? { count: result } : result;
  }

  /**
   * KN-MPS-LIVE-002：主计划 ERP 订单准入（唯一入口）。
   *
   * 与 LIVE-001 审计到的旧行为（`SELECT … FROM sales_orders` 全量投影）不同，本实现强制：
   * 1) 账套白名单：只允许科加 `UFTData418971_000003`，其他账套一律 `blocked_by_source_database`；
   * 2) 业务准入水位：`order_date >= 2026-09-17` **只约束新来源身份**，不是 created_at / updated_at；
   * 3) 状态门槛：已关闭 / 已完成 / 已作废不得作为新订单准入；
   * 4) cutover watermark（`mps_sync_configs.watermark_at`，可空）：只约束新来源身份；
   * 5) 来源身份判定：自身来源身份或别名已存在 → UPDATE 原记录；不存在 → 走新单准入；
   * 6) 快照业务键抑制：新来源身份若与历史快照 `order_number+item_code` 相同 → 绝不 INSERT 第二条，
   *    改为写入 `mps_order_line_source_aliases` 绑定，此后 ERP 修改直接更新这条原记录；
   * 7) 关闭语义：只更新来源状态字段（`source_active`/`order_status`/…），绝不删除已产生的计划链数据。
   *
   * 增量变化仍然完全依赖 ERP 最后更新时间（`sales_orders.updated_at` ← `LastModifiedDate`）与稳定来源主键。
   */
  private async projectOrders(tenantId: string, userId: string | null, updatedBy: string): Promise<SyncOutcome> {
    const ss = (alias: string) => erpSourceIdentitySql(alias).sourceSystem;
    const sd = (alias: string) => erpSourceIdentitySql(alias).sourceDatabase;
    const sk = (alias: string) => erpSourceIdentitySql(alias).sourceKey;
    const [config] = await this.dataSource.query(`SELECT watermark_at FROM mps_sync_configs WHERE tenant_id=$1 AND sync_key='erp-orders'`, [tenantId]);
    const watermark = config?.watermark_at ?? null;
    /** ERP-owned 字段的唯一投影表达式：来源身份 + 业务字段 + 状态 + 最后更新时间。 */
    const payload = (alias: string) => `${ss(alias)} AS source_system,${sd(alias)} AS source_database,${alias}.source_database AS source_account_name,
      ${sk(alias)} AS source_key,${alias}.employee_name AS salesperson_name,${alias}.customer_code AS customer_code,
      ${alias}.order_number AS order_number,${alias}.document_name AS order_type,coalesce(${alias}.order_date,${alias}.document_date) AS order_date,
      ${alias}.planned_delivery_date AS customer_due_date,${alias}.review_due_date AS preproduction_review_date,
      ${alias}.planned_delivery_date AS expected_shipping_date,${alias}.item_number AS item_code,${alias}.item_name AS item_name,
      ${alias}.unit_name AS unit,greatest(coalesce(${alias}.business_quantity,${alias}.quantity,0),0) AS order_quantity,
      coalesce(${alias}.rmb_price,${alias}.price) AS tax_included_unit_price,${alias}.rmb_tax_included_amount AS tax_included_amount,
      ${alias}.close_status AS order_status,(${erpOrderAdmissibleStatusSql(alias)}) AS source_active,${alias}.updated_at AS source_updated_at`;
    const ownedColumns = ["salesperson_name","customer_code","order_type","order_date","customer_due_date","preproduction_review_date",
      "expected_shipping_date","item_name","unit","order_quantity","tax_included_unit_price","tax_included_amount","order_status","source_active","source_updated_at"];
    const distinctGuard = (target: string, source: string) =>
      `(${ownedColumns.map((column) => `${target}.${column}`).join(",")}) IS DISTINCT FROM (${ownedColumns.map((column) => `${source}.${column}`).join(",")})`;

    return this.dataSource.transaction(async (manager) => {
      /* 1) 来源身份绑定：ERP 新来源身份与历史快照业务键相同 → 只建立别名，绝不新增第二条业务记录。 */
      const bound = await manager.query(`
        INSERT INTO mps_order_line_source_aliases(tenant_id,mps_order_line_id,source_system,source_database,source_key,bound_at,bound_reason,created_by,updated_by)
        SELECT $1,snap.id,${ss("o")},${sd("o")},${sk("o")},now(),$4,$2::uuid,$3
        FROM sales_orders o
        JOIN LATERAL (
          SELECT t.id FROM mps_erp_order_lines t
          WHERE t.tenant_id=$1 AND t.order_number=o.order_number AND t.item_code=o.item_number
            AND t.source_system IN (${snapshotSourceSystemSql()})
          ORDER BY t.created_at,t.id LIMIT 1
        ) snap ON true
        WHERE ${erpAccountWhitelistSql("o")}
          AND btrim(coalesce(o.order_number,''))<>'' AND btrim(coalesce(o.item_number,''))<>''
          AND NOT EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=${ss("o")} AND t.source_database=${sd("o")} AND t.source_key=${sk("o")})
          AND NOT EXISTS (SELECT 1 FROM mps_order_line_source_aliases a WHERE a.tenant_id=$1 AND a.source_system=${ss("o")} AND a.source_database=${sd("o")} AND a.source_key=${sk("o")})
        ON CONFLICT(tenant_id,source_system,source_database,source_key) DO NOTHING
        RETURNING id`, [tenantId, userId, updatedBy, SNAPSHOT_BUSINESS_KEY_BINDING]);

      /*
       * 2) 通过别名更新原记录：只回写「绑定之后确实发生内容变化」的 ERP 数据。
       *
       * KN-MPS-LIVE-003-01（用户确认方案一）：首次 alias 绑定 ≠ ERP 修改。
       * 判定变化的唯一依据是 canonical ERP 来源的内容更新时间（`sales_orders.updated_at`，
       * 它在 staging 内容哈希变化时才推进），而不是目标表自身的 `mps_erp_order_lines.updated_at`：
       *   canonical updated_at <= alias.bound_at → 不 UPDATE（保护 1169 初始化基线）
       *   canonical updated_at >  alias.bound_at → UPDATE 原记录（ERP-owned 字段以最新 ERP 为准）
       * 身份字段（订单号/品号）始终不在此语句中更新，以保护既有计划链业务键。
       */
      const aliasUpdated = await manager.query(`
        UPDATE mps_erp_order_lines t SET
          salesperson_name=p.salesperson_name,customer_code=p.customer_code,order_type=p.order_type,order_date=p.order_date,
          customer_due_date=p.customer_due_date,preproduction_review_date=p.preproduction_review_date,
          expected_shipping_date=p.expected_shipping_date,item_name=p.item_name,unit=p.unit,order_quantity=p.order_quantity,
          tax_included_unit_price=p.tax_included_unit_price,tax_included_amount=p.tax_included_amount,order_status=p.order_status,
          source_active=p.source_active,source_updated_at=p.source_updated_at,updated_at=now(),updated_by=$2,version=t.version+1
        FROM (
          SELECT DISTINCT ON (a.mps_order_line_id) a.mps_order_line_id,a.bound_at,${payload("o")}
          FROM sales_orders o
          JOIN mps_order_line_source_aliases a ON a.tenant_id=$1 AND a.source_system=${ss("o")} AND a.source_database=${sd("o")} AND a.source_key=${sk("o")}
          WHERE ${erpAccountWhitelistSql("o")}
          /* 同一初始化行可能绑定多条 ERP 明细：优先取「绑定之后确实变化过」的那条，再取最新修改时间。 */
          ORDER BY a.mps_order_line_id,(o.updated_at > a.bound_at) DESC,o.updated_at DESC NULLS LAST,o.id DESC
        ) p
        WHERE t.tenant_id=$1 AND t.id=p.mps_order_line_id AND p.source_system IS NOT NULL
          AND p.source_updated_at IS NOT NULL AND p.source_updated_at > p.bound_at
          AND ${distinctGuard("t", "p")}
        RETURNING t.id`, [tenantId, updatedBy]);

      /* 3) 自有来源身份的 upsert：已准入记录的修改照常更新；新来源身份必须先通过账套/水位/状态门槛。 */
      const written = await manager.query(`
        INSERT INTO mps_erp_order_lines(tenant_id,source_system,source_database,source_account_name,source_key,salesperson_name,customer_code,
          order_number,order_type,order_date,customer_due_date,preproduction_review_date,expected_shipping_date,item_code,item_name,unit,
          order_quantity,tax_included_unit_price,tax_included_amount,order_status,source_active,source_updated_at,created_by,updated_by)
        SELECT $1,p.*,$2::uuid,$3 FROM (
          SELECT ${payload("o")} FROM sales_orders o
          WHERE ${erpAccountWhitelistSql("o")}
            AND btrim(coalesce(o.order_number,''))<>'' AND btrim(coalesce(o.item_number,''))<>''
            AND NOT EXISTS (SELECT 1 FROM mps_order_line_source_aliases a WHERE a.tenant_id=$1 AND a.source_system=${ss("o")} AND a.source_database=${sd("o")} AND a.source_key=${sk("o")})
            AND (
              EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=${ss("o")} AND t.source_database=${sd("o")} AND t.source_key=${sk("o")})
              OR (${erpOrderDateAdmissionSql("o")} AND ${erpOrderAdmissibleStatusSql("o")}${watermark ? " AND o.updated_at > $4::timestamptz" : ""})
            )
        ) p
        ON CONFLICT(tenant_id,source_system,source_database,source_key) DO UPDATE SET
          salesperson_name=excluded.salesperson_name,customer_code=excluded.customer_code,order_type=excluded.order_type,
          order_date=excluded.order_date,customer_due_date=excluded.customer_due_date,preproduction_review_date=excluded.preproduction_review_date,
          expected_shipping_date=excluded.expected_shipping_date,item_name=excluded.item_name,unit=excluded.unit,
          order_quantity=excluded.order_quantity,tax_included_unit_price=excluded.tax_included_unit_price,tax_included_amount=excluded.tax_included_amount,
          order_status=excluded.order_status,source_active=excluded.source_active,source_updated_at=excluded.source_updated_at,
          updated_at=now(),updated_by=$3,version=mps_erp_order_lines.version+1
        WHERE ${distinctGuard("mps_erp_order_lines", "excluded")}
        RETURNING id,(xmax=0) AS inserted`, watermark ? [tenantId, userId, updatedBy, watermark] : [tenantId, userId, updatedBy]);

      /* 4) 计数：与准入谓词同源，供同步日志/验收报告使用（不做第二套判定逻辑）。 */
      const [counts] = await manager.query(`
        WITH src AS (
          SELECT ${ss("o")} AS source_system,${sd("o")} AS source_database,${sk("o")} AS source_key,o.order_number,o.item_number,o.order_date,o.close_status,o.updated_at
          FROM sales_orders o WHERE btrim(coalesce(o.order_number,''))<>'' AND btrim(coalesce(o.item_number,''))<>''
        ), classified AS (
          SELECT s.*,${erpAccountWhitelistSql("s")} AS account_allowed,(${erpOrderDateAdmissionSql("s")}) AS order_date_allowed,
            (${erpOrderAdmissibleStatusSql("s")}) AS status_allowed,${watermark ? "s.updated_at > $2::timestamptz" : "true"} AS watermark_allowed,
            EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=s.source_system AND t.source_database=s.source_database AND t.source_key=s.source_key) AS identity_known,
            EXISTS (SELECT 1 FROM mps_order_line_source_aliases a WHERE a.tenant_id=$1 AND a.source_system=s.source_system AND a.source_database=s.source_database AND a.source_key=s.source_key) AS alias_known
          FROM src s
        )
        SELECT count(*)::integer AS scanned,
          count(*) FILTER (WHERE account_allowed AND (identity_known OR alias_known OR (order_date_allowed AND status_allowed AND watermark_allowed)))::integer AS eligible,
          count(*) FILTER (WHERE NOT account_allowed)::integer AS blocked_by_source_database,
          count(*) FILTER (WHERE account_allowed AND NOT identity_known AND NOT alias_known AND NOT order_date_allowed)::integer AS blocked_by_order_date,
          count(*) FILTER (WHERE account_allowed AND NOT identity_known AND NOT alias_known AND order_date_allowed AND NOT status_allowed)::integer AS blocked_by_status,
          count(*) FILTER (WHERE account_allowed AND NOT identity_known AND NOT alias_known AND order_date_allowed AND status_allowed AND NOT watermark_allowed)::integer AS blocked_by_watermark
        FROM classified`, watermark ? [tenantId, watermark] : [tenantId]);

      /*
       * 计数必须用 changedCount() 归一化：TypeORM 对 UPDATE/DELETE 返回 [rows, affectedCount]，
       * 对 INSERT ... RETURNING 直接返回 rows；直接取 .length 会把「0 行更新」误报成 2（KN-MPS-LIVE-003-01 修复的计数缺陷）。
       */
      const inserted = written.filter((row: { inserted: boolean }) => row.inserted).length;
      const upserted = this.changedCount(written) - inserted;
      const updated = this.changedCount(aliasUpdated) + upserted;
      const eligible = Number(counts?.eligible ?? 0);
      const metrics = {
        scanned: Number(counts?.scanned ?? 0), eligible, inserted, updated,
        unchanged: Math.max(eligible - inserted - updated, 0),
        duplicate_suppressed: this.changedCount(bound), alias_bound: this.changedCount(bound),
        blocked_by_source_database: Number(counts?.blocked_by_source_database ?? 0),
        blocked_by_order_date: Number(counts?.blocked_by_order_date ?? 0),
        blocked_by_status: Number(counts?.blocked_by_status ?? 0),
        blocked_by_watermark: Number(counts?.blocked_by_watermark ?? 0)
      };
      return { count: inserted + updated, metrics };
    });
  }

  /**
   * KN-MPS-LIVE-002：集团/月度计划对账。
   *
   * 三处口径修正（均由 LIVE-001 审计暴露）：
   * 1) 订单分配的事业部**必须由客户→事业部映射派生**，不再依赖 `division_id` 列默认值（否则未映射订单会被静默归入事业四部）；
   * 2) 没有客户事业部映射的订单**禁止继续投影到月计划**，只保留在 ERP 订单层并产生 MISSING_ALLOCATION_DIVISION 数据异常；
   * 3) 累计入库/欠数/完成率只统计科加账套 `UFTData418971_000003`，不再跨账套加总。
   */
  private projectPlans(tenantId: string, userId: string | null, updatedBy: string): Promise<SyncOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const allocations = await manager.query(`
        INSERT INTO mps_order_allocations(tenant_id,order_number,item_code,salesperson_name,customer_code,order_date,expected_shipping_date,item_name,unit,order_quantity,allocated_quantity,tax_included_unit_price,tax_included_amount,order_status,division_id,created_by,updated_by)
        SELECT e.tenant_id,e.order_number,e.item_code,max(e.salesperson_name),max(e.customer_code),min(e.order_date),max(e.expected_shipping_date),max(e.item_name),max(e.unit),
          sum(greatest(e.order_quantity,0)),sum(greatest(e.order_quantity,0)),max(e.tax_included_unit_price),sum(COALESCE(e.tax_included_amount,0)),max(e.order_status),
          /* 客户→事业部映射在 (tenant_id,customer_code) 上唯一，因此组内至多一行；PostgreSQL 没有 max(uuid) 聚合，这里用确定性取值。 */
          (array_agg(map.primary_division_id))[1],$2::uuid,$3
        FROM mps_erp_order_lines e
        LEFT JOIN mps_customer_division_mappings map ON map.tenant_id=e.tenant_id AND map.customer_code=e.customer_code AND map.enabled=true
        WHERE e.tenant_id=$1 AND e.source_active=true GROUP BY e.tenant_id,e.order_number,e.item_code
        ON CONFLICT(tenant_id,order_number,item_code) DO UPDATE SET salesperson_name=excluded.salesperson_name,customer_code=excluded.customer_code,
          order_date=excluded.order_date,expected_shipping_date=excluded.expected_shipping_date,item_name=excluded.item_name,unit=excluded.unit,
          order_quantity=excluded.order_quantity,allocated_quantity=excluded.allocated_quantity,tax_included_unit_price=excluded.tax_included_unit_price,tax_included_amount=excluded.tax_included_amount,
          order_status=excluded.order_status,division_id=excluded.division_id,updated_at=now(),updated_by=$3,version=mps_order_allocations.version+1
        WHERE (mps_order_allocations.salesperson_name,mps_order_allocations.customer_code,mps_order_allocations.order_date,mps_order_allocations.expected_shipping_date,mps_order_allocations.item_name,mps_order_allocations.unit,mps_order_allocations.order_quantity,mps_order_allocations.allocated_quantity,mps_order_allocations.tax_included_unit_price,mps_order_allocations.tax_included_amount,mps_order_allocations.order_status,mps_order_allocations.division_id)
          IS DISTINCT FROM (excluded.salesperson_name,excluded.customer_code,excluded.order_date,excluded.expected_shipping_date,excluded.item_name,excluded.unit,excluded.order_quantity,excluded.allocated_quantity,excluded.tax_included_unit_price,excluded.tax_included_amount,excluded.order_status,excluded.division_id)
        RETURNING id`, [tenantId, userId, updatedBy]);
      const monthly = await manager.query(`
        INSERT INTO mps_monthly_plans(tenant_id,order_number,item_code,division_id,customer_code,customer_name,order_date,customer_due_date,preproduction_review_date,latest_customer_due_date,item_name,required_quantity,created_by,updated_by)
        SELECT a.tenant_id,a.order_number,a.item_code,a.division_id,a.customer_code,max(e.customer_name),a.order_date,max(e.customer_due_date),max(e.preproduction_review_date),max(COALESCE(a.expected_shipping_date,e.customer_due_date)),a.item_name,a.allocated_quantity,$2::uuid,$3
        FROM mps_order_allocations a LEFT JOIN mps_erp_order_lines e ON e.tenant_id=a.tenant_id AND e.order_number=a.order_number AND e.item_code=a.item_code AND e.source_active=true
        WHERE a.tenant_id=$1 AND a.division_id IS NOT NULL GROUP BY a.tenant_id,a.order_number,a.item_code,a.division_id,a.customer_code,a.order_date,a.expected_shipping_date,a.item_name,a.allocated_quantity
        ON CONFLICT(tenant_id,order_number,item_code) DO UPDATE SET division_id=excluded.division_id,customer_code=excluded.customer_code,customer_name=excluded.customer_name,order_date=excluded.order_date,
          customer_due_date=excluded.customer_due_date,preproduction_review_date=excluded.preproduction_review_date,latest_customer_due_date=excluded.latest_customer_due_date,item_name=excluded.item_name,required_quantity=excluded.required_quantity,
          updated_at=now(),updated_by=$3,version=mps_monthly_plans.version+1
        WHERE (mps_monthly_plans.division_id,mps_monthly_plans.customer_code,mps_monthly_plans.customer_name,mps_monthly_plans.order_date,mps_monthly_plans.customer_due_date,mps_monthly_plans.preproduction_review_date,mps_monthly_plans.latest_customer_due_date,mps_monthly_plans.item_name,mps_monthly_plans.required_quantity)
          IS DISTINCT FROM (excluded.division_id,excluded.customer_code,excluded.customer_name,excluded.order_date,excluded.customer_due_date,excluded.preproduction_review_date,excluded.latest_customer_due_date,excluded.item_name,excluded.required_quantity)
        RETURNING id`, [tenantId, userId, updatedBy]);
      const inbound = await manager.query(`
        WITH totals AS (SELECT sales_order_number order_number,inventory_code item_code,sum(COALESCE(received_quantity,0)) quantity FROM finished_goods_inbound
          WHERE sales_order_number IS NOT NULL AND source_database='${MASTER_PLAN_ERP_ADMISSION.sourceDatabase}'
          GROUP BY sales_order_number,inventory_code)
        UPDATE mps_monthly_plans p SET cumulative_inbound_quantity=COALESCE(t.quantity,0),pending_quantity=greatest(p.required_quantity-COALESCE(t.quantity,0),0),
          completion_rate=CASE WHEN p.required_quantity<=0 THEN 0 ELSE round(least(COALESCE(t.quantity,0)/p.required_quantity,1),4) END,
          updated_at=now(),updated_by=$2,version=p.version+1 FROM totals t WHERE p.tenant_id=$1 AND p.order_number=t.order_number AND p.item_code=t.item_code
          AND (p.cumulative_inbound_quantity,p.pending_quantity,p.completion_rate) IS DISTINCT FROM (COALESCE(t.quantity,0),greatest(p.required_quantity-COALESCE(t.quantity,0),0),CASE WHEN p.required_quantity<=0 THEN 0 ELSE round(least(COALESCE(t.quantity,0)/p.required_quantity,1),4) END)
        RETURNING p.id`, [tenantId, updatedBy]);
      await manager.query(`UPDATE mps_monthly_plans p SET cumulative_inbound_quantity=0,pending_quantity=greatest(p.required_quantity,0),completion_rate=0,updated_at=now(),updated_by=$2,version=p.version+1
        WHERE p.tenant_id=$1 AND EXISTS(SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=p.tenant_id AND a.order_number=p.order_number AND a.item_code=p.item_code)
        AND NOT EXISTS(SELECT 1 FROM finished_goods_inbound i WHERE i.sales_order_number=p.order_number AND i.inventory_code=p.item_code AND i.source_database='${MASTER_PLAN_ERP_ADMISSION.sourceDatabase}')
        AND (p.cumulative_inbound_quantity,p.pending_quantity,p.completion_rate) IS DISTINCT FROM (0,greatest(p.required_quantity,0),0)`, [tenantId, updatedBy]);
      const groups = await manager.query(`
        WITH source_orders AS (
          SELECT tenant_id,order_number,
            string_agg(DISTINCT COALESCE(source_account_name,source_database),',') source_accounts,
            max(order_type) order_type,max(customer_code) customer_code,max(customer_name) customer_name,
            min(order_date) order_date,max(customer_due_date) customer_due_date,
            max(preproduction_review_date) preproduction_review_date,
            sum(COALESCE(tax_included_amount,0)) order_amount
          FROM mps_erp_order_lines
          WHERE tenant_id=$1 AND source_active=true
          GROUP BY tenant_id,order_number
        ), item_totals AS (
          SELECT tenant_id,order_number,sum(required_quantity) required_quantity,
            sum(least(cumulative_inbound_quantity,required_quantity)) completed_quantity,
            sum(greatest(required_quantity-cumulative_inbound_quantity,0)) pending_quantity,
            avg(CASE WHEN required_quantity<=0 THEN 0 ELSE least(cumulative_inbound_quantity/required_quantity,1) END) completion_rate
          FROM mps_monthly_plans
          WHERE tenant_id=$1
          GROUP BY tenant_id,order_number
        )
        INSERT INTO mps_group_plans(tenant_id,order_number,source_accounts,order_type,customer_code,customer_name,order_date,customer_due_date,preproduction_review_date,order_amount,required_quantity,primary_division_id,completed_quantity,pending_quantity,completion_rate,created_by,updated_by)
        SELECT s.tenant_id,s.order_number,s.source_accounts,s.order_type,s.customer_code,s.customer_name,s.order_date,s.customer_due_date,s.preproduction_review_date,s.order_amount,i.required_quantity,map.primary_division_id,i.completed_quantity,i.pending_quantity,i.completion_rate,$2::uuid,$3
        FROM source_orders s JOIN item_totals i ON i.tenant_id=s.tenant_id AND i.order_number=s.order_number
        LEFT JOIN mps_customer_division_mappings map ON map.tenant_id=s.tenant_id AND map.customer_code=s.customer_code AND map.enabled=true
        ON CONFLICT(tenant_id,order_number) DO UPDATE SET source_accounts=excluded.source_accounts,order_type=excluded.order_type,customer_code=excluded.customer_code,customer_name=excluded.customer_name,order_date=excluded.order_date,customer_due_date=excluded.customer_due_date,preproduction_review_date=excluded.preproduction_review_date,order_amount=excluded.order_amount,required_quantity=excluded.required_quantity,primary_division_id=excluded.primary_division_id,completed_quantity=excluded.completed_quantity,pending_quantity=excluded.pending_quantity,completion_rate=excluded.completion_rate,updated_at=now(),updated_by=$3,version=mps_group_plans.version+1
        WHERE (mps_group_plans.source_accounts,mps_group_plans.order_type,mps_group_plans.customer_code,mps_group_plans.customer_name,mps_group_plans.order_date,mps_group_plans.customer_due_date,mps_group_plans.preproduction_review_date,mps_group_plans.order_amount,mps_group_plans.required_quantity,mps_group_plans.primary_division_id,mps_group_plans.completed_quantity,mps_group_plans.pending_quantity,mps_group_plans.completion_rate)
          IS DISTINCT FROM (excluded.source_accounts,excluded.order_type,excluded.customer_code,excluded.customer_name,excluded.order_date,excluded.customer_due_date,excluded.preproduction_review_date,excluded.order_amount,excluded.required_quantity,excluded.primary_division_id,excluded.completed_quantity,excluded.pending_quantity,excluded.completion_rate)
        RETURNING id`, [tenantId, userId, updatedBy]);
      await this.refreshExceptions(manager, tenantId, userId, updatedBy);
      const [unmapped] = await manager.query(`SELECT
        (SELECT count(*)::integer FROM mps_order_allocations a WHERE a.tenant_id=$1 AND a.division_id IS NULL) AS blocked_by_missing_customer_mapping,
        (SELECT count(*)::integer FROM mps_order_allocations a WHERE a.tenant_id=$1 AND a.division_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM mps_customer_division_mappings m WHERE m.tenant_id=a.tenant_id AND m.customer_code=a.customer_code AND m.enabled=true AND m.primary_division_id=a.division_id)) AS division_defaulted`, [tenantId]);
      return {
        count: this.changedCount(allocations) + this.changedCount(monthly) + this.changedCount(inbound) + this.changedCount(groups),
        metrics: {
          allocations: this.changedCount(allocations), monthly_plans: this.changedCount(monthly), group_plans: this.changedCount(groups),
          inbound_recalculated: this.changedCount(inbound),
          blocked_by_missing_customer_mapping: Number(unmapped?.blocked_by_missing_customer_mapping ?? 0),
          division_defaulted: Number(unmapped?.division_defaulted ?? 0)
        }
      };
    });
  }

  private async shippingToBase(tenantId: string, userId: string | null, updatedBy: string) {
    const basePlan = MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!;
    const dictionaryColumn = (field: string, column: string, source: string, existing: string) =>
      this.dictionaryCopySql(basePlan, field, column, source, existing);
    const rows = await this.dataSource.query(`
      INSERT INTO mps_base_plans(tenant_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,planned_quantity,model_age,image_refs,product_attribute,surface_nature,manufacturing_method,created_by,updated_by)
      SELECT s.tenant_id,s.id,s.division_id,s.customer_code,s.order_number,s.item_code,s.item_name,s.delivery_number,s.order_date,s.latest_customer_due_date,s.planned_quantity,
        ${dictionaryColumn("modelAge", "model_age", "s.model_age", "existing.model_age")},
        COALESCE(m.image_refs,'[]'::jsonb),
        ${dictionaryColumn("productAttribute", "product_attribute", "m.product_attribute", "existing.product_attribute")},
        ${dictionaryColumn("surfaceNature", "surface_nature", "m.surface_nature", "existing.surface_nature")},
        ${dictionaryColumn("manufacturingMethod", "manufacturing_method", "m.manufacturing_method", "existing.manufacturing_method")},
        $2::uuid,$3
      FROM mps_shipping_plans s
      LEFT JOIN mps_monthly_plans m ON m.tenant_id=s.tenant_id AND m.order_number=s.order_number AND m.item_code=s.item_code
      LEFT JOIN mps_base_plans existing ON existing.tenant_id=s.tenant_id AND existing.order_number=s.order_number AND existing.item_code=s.item_code AND existing.delivery_number=s.delivery_number
      WHERE s.tenant_id=$1
      ON CONFLICT(tenant_id,order_number,item_code,delivery_number) DO UPDATE SET shipping_plan_id=excluded.shipping_plan_id,division_id=excluded.division_id,customer_code=excluded.customer_code,item_name=excluded.item_name,order_date=excluded.order_date,latest_customer_due_date=excluded.latest_customer_due_date,planned_quantity=excluded.planned_quantity,model_age=excluded.model_age,image_refs=excluded.image_refs,product_attribute=excluded.product_attribute,surface_nature=excluded.surface_nature,manufacturing_method=excluded.manufacturing_method,updated_at=now(),updated_by=$3,version=mps_base_plans.version+1
      WHERE (mps_base_plans.shipping_plan_id,mps_base_plans.division_id,mps_base_plans.customer_code,mps_base_plans.item_name,mps_base_plans.order_date,mps_base_plans.latest_customer_due_date,mps_base_plans.planned_quantity,mps_base_plans.model_age,mps_base_plans.image_refs,mps_base_plans.product_attribute,mps_base_plans.surface_nature,mps_base_plans.manufacturing_method)
        IS DISTINCT FROM (excluded.shipping_plan_id,excluded.division_id,excluded.customer_code,excluded.item_name,excluded.order_date,excluded.latest_customer_due_date,excluded.planned_quantity,excluded.model_age,excluded.image_refs,excluded.product_attribute,excluded.surface_nature,excluded.manufacturing_method)
      RETURNING id`, [tenantId, userId, updatedBy]);
    return rows.length;
  }

  private baseToWeekly(tenantId: string, userId: string | null, updatedBy: string) {
    const basePlan = MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!;
    const admission = weeklyAdmissionSql(basePlan, "base");
    const dictionaryColumn = (field: string, column: string) =>
      this.dictionaryCopySql(basePlan, field, column, `base.${column}`, `weekly.${column}`);
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(`
        INSERT INTO mps_weekly_plans(tenant_id,base_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,latest_review_due_date,model_age,image_refs,product_attribute,surface_nature,planned_quantity,pending_quantity,manufacturing_method,order_exception_info,inspection_required,inspection_quantity,remark,order_week_count,created_by,updated_by)
        SELECT base.tenant_id,base.id,base.division_id,base.customer_code,base.order_number,base.item_code,base.item_name,base.delivery_number,base.order_date,base.latest_customer_due_date,base.latest_review_due_date,
          ${dictionaryColumn("modelAge", "model_age")},base.image_refs,
          ${dictionaryColumn("productAttribute", "product_attribute")},
          ${dictionaryColumn("surfaceNature", "surface_nature")},
          base.planned_quantity,base.planned_quantity,
          ${dictionaryColumn("manufacturingMethod", "manufacturing_method")},
          NULL,false,NULL,NULL,CASE WHEN base.order_date IS NULL THEN NULL ELSE greatest(0,floor((CURRENT_DATE-base.order_date)/7.0))::integer END,$2::uuid,$3
        FROM mps_base_plans base
        LEFT JOIN mps_weekly_plans weekly ON weekly.tenant_id=base.tenant_id AND weekly.base_plan_id=base.id
        WHERE base.tenant_id=$1 AND ${admission}
        ON CONFLICT ON CONSTRAINT uq_mps_weekly_base DO UPDATE SET division_id=excluded.division_id,customer_code=excluded.customer_code,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,order_date=excluded.order_date,latest_customer_due_date=excluded.latest_customer_due_date,latest_review_due_date=excluded.latest_review_due_date,model_age=excluded.model_age,image_refs=excluded.image_refs,product_attribute=excluded.product_attribute,surface_nature=excluded.surface_nature,planned_quantity=excluded.planned_quantity,manufacturing_method=excluded.manufacturing_method,updated_at=now(),updated_by=$3,version=mps_weekly_plans.version+1
        WHERE (mps_weekly_plans.division_id,mps_weekly_plans.customer_code,mps_weekly_plans.order_number,mps_weekly_plans.item_code,mps_weekly_plans.item_name,mps_weekly_plans.delivery_number,mps_weekly_plans.order_date,mps_weekly_plans.latest_customer_due_date,mps_weekly_plans.latest_review_due_date,mps_weekly_plans.model_age,mps_weekly_plans.image_refs,mps_weekly_plans.product_attribute,mps_weekly_plans.surface_nature,mps_weekly_plans.planned_quantity,mps_weekly_plans.manufacturing_method)
          IS DISTINCT FROM (excluded.division_id,excluded.customer_code,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number,excluded.order_date,excluded.latest_customer_due_date,excluded.latest_review_due_date,excluded.model_age,excluded.image_refs,excluded.product_attribute,excluded.surface_nature,excluded.planned_quantity,excluded.manufacturing_method)
        RETURNING id`, [tenantId, userId, updatedBy]);
      /* KN-MPS-SYNC-001：执行副作用的范围必须与主投影共用同一份 admission。
         只允许处理「关联 base 当前满足 weeklyAdmissionSql」的 weekly；禁止像旧实现那样按 tenant 全表扫描，
         否则未准入的历史 weekly 会被意外改动（execution_enabled、工序周期、技术/主材/外协占位、报工快照）。
         这里刻意不复用 INSERT ... RETURNING：工序周期/规则变化时 weekly 主字段可能无变化（RETURNING=0），
         但 admitted weekly 仍需要按最新 process cycle 重算执行计划，因此范围取「全部当前 admitted weekly」。 */
      const weeklyRows = await manager.query(`SELECT w.*,c.technical_days,c.cutting_days,c.machining_days,c.bending_days,c.spot_welding_days,c.welding_days,c.woodworking_days,c.grinding_days,c.blank_days,c.surface_treatment_days,c.packaging_days FROM mps_weekly_plans w JOIN mps_base_plans base ON base.tenant_id=w.tenant_id AND base.id=w.base_plan_id LEFT JOIN mps_process_cycles c ON c.tenant_id=w.tenant_id AND c.item_code=w.item_code WHERE w.tenant_id=$1 AND ${admission}`, [tenantId]);
      for (const weekly of weeklyRows) await this.ensureExecutionRows(manager, weekly, tenantId, userId, updatedBy);
      return this.changedCount(rows);
    });
  }

  private async ensureExecutionRows(manager: EntityManager, weekly: any, tenantId: string, userId: string | null, updatedBy: string) {
    const reviewDueDate = this.dateOnly(weekly.latest_review_due_date);
    const schedules = reviewDueDate ? reverseSchedule(reviewDueDate, {
      cuttingDays: this.nullableNumber(weekly.cutting_days), machiningDays: this.nullableNumber(weekly.machining_days), bendingDays: this.nullableNumber(weekly.bending_days),
      spotWeldingDays: this.nullableNumber(weekly.spot_welding_days), weldingDays: this.nullableNumber(weekly.welding_days), woodworkingDays: this.nullableNumber(weekly.woodworking_days),
      grindingDays: this.nullableNumber(weekly.grinding_days), blankDays: this.nullableNumber(weekly.blank_days),
      surfaceTreatmentDays: this.nullableNumber(weekly.surface_treatment_days), packagingDays: this.nullableNumber(weekly.packaging_days)
    }) : [];
    const processEnabled = ["自制", "自制+外协"].includes(weekly.manufacturing_method);
    /* KN-MPS-UI-001：工序任务上的提示文本只是「计划提示」，不是生产异常；它绝不参与周/月计划统一异常汇总。 */
    if (processEnabled) for (const schedule of schedules) await manager.query(`INSERT INTO mps_weekly_process_plans(tenant_id,weekly_plan_id,process_code,process_name,sequence,cycle_days,due_date,exception_text,execution_enabled,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9::uuid,$10) ON CONFLICT(tenant_id,weekly_plan_id,process_code) DO UPDATE SET process_name=excluded.process_name,sequence=excluded.sequence,cycle_days=excluded.cycle_days,due_date=excluded.due_date,execution_enabled=true,updated_at=now(),updated_by=$10,version=mps_weekly_process_plans.version+1 WHERE (mps_weekly_process_plans.process_name,mps_weekly_process_plans.sequence,mps_weekly_process_plans.cycle_days,mps_weekly_process_plans.due_date,mps_weekly_process_plans.execution_enabled) IS DISTINCT FROM (excluded.process_name,excluded.sequence,excluded.cycle_days,excluded.due_date,true)`, [tenantId, weekly.id, schedule.code, schedule.name, schedule.sequence, schedule.cycleDays, schedule.dueDate, schedule.cycleDays == null ? "未维护工序周期" : null, userId, updatedBy]);
    if (!processEnabled) await manager.query(`UPDATE mps_weekly_process_plans SET execution_enabled=false,updated_at=now(),updated_by=$3,version=version+1 WHERE tenant_id=$1 AND weekly_plan_id=$2 AND execution_enabled=true`, [tenantId, weekly.id, updatedBy]);
    const technicalDays = this.nullableNumber(weekly.technical_days);
    const drawingDueDate = technicalDays == null || !reviewDueDate ? null : new Date(Date.parse(`${reviewDueDate}T00:00:00Z`) - technicalDays * 86_400_000).toISOString().slice(0, 10);
    await manager.query(`UPDATE mps_weekly_plans SET technical_cycle_days=$3,drawing_due_date=$4,updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND id=$2 AND (technical_cycle_days,drawing_due_date) IS DISTINCT FROM ($3,$4)`, [tenantId, weekly.id, technicalDays, drawingDueDate, updatedBy]);
    /* KN-MPS-UI-001：技术报工表的 exception_text 是人工异常事实，系统绝不自动写入“未维护技术周期”等提示；
       技术周期缺失属于计划配置问题（进 mps_data_exceptions / 状态），不得伪造生产异常。 */
    await manager.query(`INSERT INTO mps_technical_reports(tenant_id,weekly_plan_id,division_id,order_number,item_code,item_name,delivery_number,drawing_due_date,exception_text,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9::uuid,$10) ON CONFLICT(tenant_id,weekly_plan_id) DO UPDATE SET division_id=excluded.division_id,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,updated_at=now(),updated_by=$10,version=mps_technical_reports.version+1 WHERE (mps_technical_reports.division_id,mps_technical_reports.order_number,mps_technical_reports.item_code,mps_technical_reports.item_name,mps_technical_reports.delivery_number) IS DISTINCT FROM (excluded.division_id,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number)`, [tenantId, weekly.id, weekly.division_id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, drawingDueDate, userId, updatedBy]);
    for (const material of ["五金", "木作"]) await manager.query(`INSERT INTO mps_material_reports(tenant_id,weekly_plan_id,division_id,order_number,item_code,item_name,delivery_number,material_name,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10) ON CONFLICT(tenant_id,weekly_plan_id,material_name) DO UPDATE SET division_id=excluded.division_id,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,updated_at=now(),updated_by=$10,version=mps_material_reports.version+1 WHERE (mps_material_reports.division_id,mps_material_reports.order_number,mps_material_reports.item_code,mps_material_reports.item_name,mps_material_reports.delivery_number) IS DISTINCT FROM (excluded.division_id,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number)`, [tenantId, weekly.id, weekly.division_id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, material, userId, updatedBy]);
    const outsourcingEnabled = ["中心外购", "外协", "自制+外协"].includes(weekly.manufacturing_method);
    if (outsourcingEnabled) await manager.query(`INSERT INTO mps_outsourcing_reports(tenant_id,weekly_plan_id,division_id,order_number,item_code,item_name,delivery_number,execution_enabled,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8::uuid,$9) ON CONFLICT(tenant_id,weekly_plan_id) DO UPDATE SET division_id=excluded.division_id,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,execution_enabled=true,updated_at=now(),updated_by=$9,version=mps_outsourcing_reports.version+1 WHERE (mps_outsourcing_reports.division_id,mps_outsourcing_reports.order_number,mps_outsourcing_reports.item_code,mps_outsourcing_reports.item_name,mps_outsourcing_reports.delivery_number,mps_outsourcing_reports.execution_enabled) IS DISTINCT FROM (excluded.division_id,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number,true)`, [tenantId, weekly.id, weekly.division_id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, userId, updatedBy]);
    if (!outsourcingEnabled) await manager.query(`UPDATE mps_outsourcing_reports SET execution_enabled=false,updated_at=now(),updated_by=$3,version=version+1 WHERE tenant_id=$1 AND weekly_plan_id=$2 AND execution_enabled=true`, [tenantId, weekly.id, updatedBy]);
    await manager.query(`UPDATE mps_process_reports SET division_id=$3,order_number=$4,item_code=$5,item_name=$6,delivery_number=$7,planned_quantity=$8,updated_at=now(),updated_by=$9,version=version+1 WHERE tenant_id=$1 AND weekly_plan_id=$2 AND (division_id,order_number,item_code,item_name,delivery_number,planned_quantity) IS DISTINCT FROM ($3,$4,$5,$6,$7,$8)`, [tenantId, weekly.id, weekly.division_id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, weekly.planned_quantity, updatedBy]);
  }

  private async allocateInbound(tenantId: string, updatedBy: string) {
    /* KN-MPS-LIVE-002：入库分摊只统计科加账套，禁止把其它账套入库加进事业四部。 */
    const changed = await this.dataSource.query(`
      WITH inbound_totals AS (
        SELECT sales_order_number order_number,inventory_code item_code,sum(greatest(COALESCE(received_quantity,0),0)) quantity
        FROM finished_goods_inbound WHERE sales_order_number IS NOT NULL AND source_database='${MASTER_PLAN_ERP_ADMISSION.sourceDatabase}'
        GROUP BY sales_order_number,inventory_code
      ), ordered AS (
        SELECT w.id,w.planned_quantity,COALESCE(t.quantity,0) inbound_quantity,
          COALESCE(sum(w.planned_quantity) OVER (
            PARTITION BY w.order_number,w.item_code
            ORDER BY w.latest_customer_due_date NULLS LAST,w.delivery_number,w.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),0) prior_planned
        FROM mps_weekly_plans w
        LEFT JOIN inbound_totals t ON t.order_number=w.order_number AND t.item_code=w.item_code
        WHERE w.tenant_id=$1
      ), allocations AS (
        SELECT id,greatest(least(inbound_quantity-prior_planned,planned_quantity),0) allocated_quantity
        FROM ordered
      )
      UPDATE mps_weekly_plans w SET allocated_inbound_quantity=a.allocated_quantity,
        pending_quantity=greatest(w.planned_quantity-a.allocated_quantity,0),updated_at=now(),updated_by=$2,version=w.version+1
      FROM allocations a WHERE w.tenant_id=$1 AND w.id=a.id
        AND (w.allocated_inbound_quantity,w.pending_quantity) IS DISTINCT FROM
          (a.allocated_quantity,greatest(w.planned_quantity-a.allocated_quantity,0))
      RETURNING w.id`, [tenantId, updatedBy]);
    return this.changedCount(changed);
  }

  private async executionRollup(tenantId: string, updatedBy: string) {
    const today = shanghaiToday(); let count = 0;
    await this.dataSource.transaction(async (manager) => {
      const processes = await manager.query(`SELECT p.id,p.weekly_plan_id,p.process_code,p.due_date,p.report_date,w.planned_quantity,COALESCE(sum(r.production_quantity),0) cumulative_reported,COALESCE(sum(r.production_quantity) FILTER (WHERE r.production_date=p.report_date),0) daily_reported FROM mps_weekly_process_plans p JOIN mps_weekly_plans w ON w.id=p.weekly_plan_id AND w.tenant_id=p.tenant_id LEFT JOIN mps_process_reports r ON r.tenant_id=p.tenant_id AND r.weekly_plan_id=p.weekly_plan_id AND r.process_code=p.process_code WHERE p.tenant_id=$1 GROUP BY p.id,p.weekly_plan_id,p.process_code,p.due_date,p.report_date,w.planned_quantity`, [tenantId]);
      for (const row of processes) { const status = processStatus(row.planned_quantity, row.cumulative_reported, this.dateOnly(row.due_date), today); const changed = await manager.query(`UPDATE mps_weekly_process_plans SET daily_reported_quantity=$3,status=$4,updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND id=$2 AND (daily_reported_quantity,status) IS DISTINCT FROM ($3,$4) RETURNING id`, [tenantId, row.id, row.daily_reported, status, updatedBy]); count += changed.length; }
      const outsource = await manager.query(`SELECT id,purchase_order_number,actual_inbound_date,outsourcing_due_date FROM mps_outsourcing_reports WHERE tenant_id=$1`, [tenantId]);
      for (const row of outsource) { const status = outsourcingStatus({ purchaseOrderNumber: row.purchase_order_number, actualInboundDate: this.dateOnly(row.actual_inbound_date), dueDate: this.dateOnly(row.outsourcing_due_date), today }); const changed = await manager.query(`UPDATE mps_outsourcing_reports SET status=$3,received=($4::date IS NOT NULL),updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND id=$2 AND (status,received) IS DISTINCT FROM ($3,($4::date IS NOT NULL)) RETURNING id`, [tenantId, row.id, status, row.actual_inbound_date, updatedBy]); count += changed.length; }
      // 技术状态由技术人员在技术报工表维护；对账不得根据附件反向覆盖人工状态。
    });
    return count;
  }

  private async refreshExceptions(manager: EntityManager, tenantId: string, userId: string | null, updatedBy: string) {
    await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$2,version=version+1 WHERE tenant_id=$1 AND active=true AND exception_type IN ('MISSING_PRIMARY_DIVISION','MISSING_ALLOCATION_DIVISION','NON_POSITIVE_DEMAND','INBOUND_EXCEEDS_DEMAND')`, [tenantId, updatedBy]);
    await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
    SELECT $1,exception_key,resource,record_id,business_key,exception_type,severity,message,true,$2::uuid,$3 FROM (SELECT DISTINCT ON (exception_key) * FROM (
      SELECT 'customer:'||customer_code exception_key,'mps-group-plans' resource,NULL::uuid record_id,customer_code business_key,'MISSING_PRIMARY_DIVISION' exception_type,'ERROR' severity,'客户未配置主责事业部' message FROM mps_group_plans WHERE tenant_id=$1 AND primary_division_id IS NULL
      UNION ALL SELECT 'allocation:'||order_number||':'||item_code,'mps-order-allocations',id,order_number||'/'||item_code,'MISSING_ALLOCATION_DIVISION','ERROR','订单品项未分配承接事业部' FROM mps_order_allocations WHERE tenant_id=$1 AND division_id IS NULL
      UNION ALL SELECT 'demand:'||order_number||':'||item_code,'mps-monthly-plans',id,order_number||'/'||item_code,'NON_POSITIVE_DEMAND','ERROR','订单需求数量必须大于0' FROM mps_monthly_plans WHERE tenant_id=$1 AND required_quantity<=0
      UNION ALL SELECT 'over-inbound:'||order_number||':'||item_code,'mps-monthly-plans',id,order_number||'/'||item_code,'INBOUND_EXCEEDS_DEMAND','WARNING','累计入库数量超过订单需求数量' FROM mps_monthly_plans WHERE tenant_id=$1 AND cumulative_inbound_quantity>required_quantity
    ) exceptions_raw ORDER BY exception_key) exceptions ON CONFLICT(tenant_id,exception_key) DO UPDATE SET resource=excluded.resource,record_id=excluded.record_id,business_key=excluded.business_key,exception_type=excluded.exception_type,severity=excluded.severity,message=excluded.message,active=true,resolved_at=NULL,updated_at=now(),updated_by=$3,version=mps_data_exceptions.version+1`, [tenantId, userId, updatedBy]);
  }

  private upsertException(tenantId: string, key: string, resource: string, recordId: string | null, businessKey: string, type: string, severity: string, message: string, userId: string | null, updatedBy: string, manager: EntityManager = this.dataSource.manager) {
    return manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by) VALUES($1,$2,$3,$4::uuid,$5,$6,$7,$8,true,$9::uuid,$10) ON CONFLICT(tenant_id,exception_key) DO UPDATE SET resource=excluded.resource,record_id=excluded.record_id,business_key=excluded.business_key,exception_type=excluded.exception_type,severity=excluded.severity,message=excluded.message,active=true,resolved_at=NULL,updated_at=now(),updated_by=$10,version=mps_data_exceptions.version+1`, [tenantId, key, resource, recordId, businessKey, type, severity, message, userId, updatedBy]);
  }

  private nullableNumber(value: unknown) { return value == null ? null : Number(value); }

  /**
   * 同步复制字典字段时同样只能写当前 field options 中的真实 value：
   * 来源为空 → NULL（保持既有可清空语义）；来源为合法 value → 复制；来源是历史非法值 → 保留目标表当前值，绝不向下游扩散。
   * 允许值统一来自 fieldsFor(resource) 的 options，不新增第二份字典。
   */
  private dictionaryCopySql(resource: MasterPlanResource, field: string, column: string, source: string, existing: string) {
    const options = fieldsFor(resource).find((entry) => entry.key === field)?.options ?? [];
    if (!options.length) return source;
    const allowed = options.map((option) => `'${String(option.value).replace(/'/g, "''")}'`).join(",");
    return `CASE WHEN ${source} IS NULL OR btrim(${source}::text)='' THEN NULL WHEN ${source}::text IN (${allowed}) THEN ${source}::text ELSE ${existing} END AS ${column}`;
  }

  private changedCount(result: unknown[]) { return Array.isArray(result[0]) ? result[0].length : result.length; }
  private dateOnly(value: unknown) {
    if (value == null || value === "") return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
}
