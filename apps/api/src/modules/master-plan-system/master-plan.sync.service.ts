import { ConflictException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { outsourcingStatus, processStatus, reverseSchedule, shanghaiToday } from "./master-plan.domain";
import { hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

type RunType = "SCHEDULED" | "MANUAL" | "EVENT" | "RECONCILIATION";
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
        const count = await this.execute(syncKey, tenantId, userId, userId ?? username);
        await this.dataSource.query(`UPDATE mps_sync_logs SET status='SUCCESS',completed_at=now(),sync_count=$3,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, idempotencyKey, count, userId ?? username]);
        await this.dataSource.query(`UPDATE mps_sync_configs SET status='SUCCESS',last_success_at=now(),last_sync_count=$3,error_message=NULL,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey, count, userId ?? username]);
        return { syncKey, repeated: false, count, status: "SUCCESS" };
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
        await this.dataSource.query(`UPDATE mps_sync_logs SET status='FAILED',completed_at=now(),error_message=$3,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, idempotencyKey, message, userId ?? username]);
        await this.dataSource.query(`UPDATE mps_sync_configs SET status='FAILED',last_failure_at=now(),error_message=$3,updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND sync_key=$2`, [tenantId, syncKey, message, userId ?? username]);
        await this.upsertException(tenantId, `sync:${syncKey}`, "mps-sync-configs", null, syncKey, "SYNC_FAILURE", "ERROR", `同步失败：${message}`, userId, userId ?? username);
        throw error;
      }
    } finally { this.running.delete(runningKey); }
  }

  private execute(syncKey: string, tenantId: string, userId: string | null, updatedBy: string) {
    const jobs: Record<string, () => Promise<number>> = {
      "erp-orders": () => this.projectOrders(tenantId, userId, updatedBy),
      "plan-projections": () => this.projectPlans(tenantId, userId, updatedBy),
      "shipping-to-base": () => this.shippingToBase(tenantId, userId, updatedBy),
      "base-to-weekly": () => this.baseToWeekly(tenantId, userId, updatedBy),
      "inbound-allocation": () => this.allocateInbound(tenantId, updatedBy),
      "execution-rollup": () => this.executionRollup(tenantId, updatedBy)
    };
    const job = jobs[syncKey]; if (!job) throw new ConflictException("未知同步任务"); return job();
  }

  private async projectOrders(tenantId: string, userId: string | null, updatedBy: string) {
    const rows = await this.dataSource.query(`
      INSERT INTO mps_erp_order_lines(tenant_id,source_system,source_database,source_account_name,source_key,salesperson_name,customer_code,
        order_number,order_type,order_date,customer_due_date,preproduction_review_date,expected_shipping_date,item_code,item_name,unit,
        order_quantity,tax_included_unit_price,tax_included_amount,order_status,source_active,source_updated_at,created_by,updated_by)
      SELECT $1,COALESCE(source_system,'SYSTEM'),COALESCE(source_database,'KDOS'),source_database,COALESCE(source_key,id::text),employee_name,customer_code,
        order_number,document_name,COALESCE(order_date,document_date),planned_delivery_date,review_due_date,planned_delivery_date,item_number,item_name,unit_name,
        greatest(COALESCE(business_quantity,quantity,0),0),COALESCE(rmb_price,price),rmb_tax_included_amount,close_status,true,updated_at,$2::uuid,$3
      FROM sales_orders WHERE btrim(COALESCE(order_number,''))<>'' AND btrim(COALESCE(item_number,''))<>''
      ON CONFLICT(tenant_id,source_system,source_database,source_key) DO UPDATE SET
        salesperson_name=excluded.salesperson_name,customer_code=excluded.customer_code,order_number=excluded.order_number,order_type=excluded.order_type,
        order_date=excluded.order_date,customer_due_date=excluded.customer_due_date,preproduction_review_date=excluded.preproduction_review_date,
        expected_shipping_date=excluded.expected_shipping_date,item_code=excluded.item_code,item_name=excluded.item_name,unit=excluded.unit,
        order_quantity=excluded.order_quantity,tax_included_unit_price=excluded.tax_included_unit_price,tax_included_amount=excluded.tax_included_amount,
        order_status=excluded.order_status,source_active=true,source_updated_at=excluded.source_updated_at,updated_at=now(),updated_by=$3,version=mps_erp_order_lines.version+1
      WHERE (mps_erp_order_lines.salesperson_name,mps_erp_order_lines.customer_code,mps_erp_order_lines.order_number,mps_erp_order_lines.item_code,mps_erp_order_lines.order_quantity,mps_erp_order_lines.source_updated_at)
        IS DISTINCT FROM (excluded.salesperson_name,excluded.customer_code,excluded.order_number,excluded.item_code,excluded.order_quantity,excluded.source_updated_at)
      RETURNING id`, [tenantId, userId, updatedBy]);
    return rows.length;
  }

  private projectPlans(tenantId: string, userId: string | null, updatedBy: string) {
    return this.dataSource.transaction(async (manager) => {
      const allocations = await manager.query(`
        INSERT INTO mps_order_allocations(tenant_id,order_number,item_code,salesperson_name,customer_code,order_date,expected_shipping_date,item_name,unit,order_quantity,allocated_quantity,tax_included_unit_price,tax_included_amount,order_status,created_by,updated_by)
        SELECT tenant_id,order_number,item_code,max(salesperson_name),max(customer_code),min(order_date),max(expected_shipping_date),max(item_name),max(unit),sum(greatest(order_quantity,0)),sum(greatest(order_quantity,0)),max(tax_included_unit_price),sum(COALESCE(tax_included_amount,0)),max(order_status),$2::uuid,$3
        FROM mps_erp_order_lines WHERE tenant_id=$1 AND source_active=true GROUP BY tenant_id,order_number,item_code
        ON CONFLICT(tenant_id,order_number,item_code) DO UPDATE SET salesperson_name=excluded.salesperson_name,customer_code=excluded.customer_code,
          order_date=excluded.order_date,expected_shipping_date=excluded.expected_shipping_date,item_name=excluded.item_name,unit=excluded.unit,
          order_quantity=excluded.order_quantity,allocated_quantity=excluded.allocated_quantity,tax_included_unit_price=excluded.tax_included_unit_price,tax_included_amount=excluded.tax_included_amount,
          order_status=excluded.order_status,updated_at=now(),updated_by=$3,version=mps_order_allocations.version+1
        WHERE (mps_order_allocations.salesperson_name,mps_order_allocations.customer_code,mps_order_allocations.order_date,mps_order_allocations.expected_shipping_date,mps_order_allocations.item_name,mps_order_allocations.unit,mps_order_allocations.order_quantity,mps_order_allocations.allocated_quantity,mps_order_allocations.tax_included_unit_price,mps_order_allocations.tax_included_amount,mps_order_allocations.order_status)
          IS DISTINCT FROM (excluded.salesperson_name,excluded.customer_code,excluded.order_date,excluded.expected_shipping_date,excluded.item_name,excluded.unit,excluded.order_quantity,excluded.allocated_quantity,excluded.tax_included_unit_price,excluded.tax_included_amount,excluded.order_status)
        RETURNING id`, [tenantId, userId, updatedBy]);
      const monthly = await manager.query(`
        INSERT INTO mps_monthly_plans(tenant_id,order_number,item_code,division_id,customer_code,customer_name,order_date,customer_due_date,preproduction_review_date,latest_customer_due_date,item_name,required_quantity,created_by,updated_by)
        SELECT a.tenant_id,a.order_number,a.item_code,a.division_id,a.customer_code,max(e.customer_name),a.order_date,max(e.customer_due_date),max(e.preproduction_review_date),max(COALESCE(a.expected_shipping_date,e.customer_due_date)),a.item_name,a.allocated_quantity,$2::uuid,$3
        FROM mps_order_allocations a LEFT JOIN mps_erp_order_lines e ON e.tenant_id=a.tenant_id AND e.order_number=a.order_number AND e.item_code=a.item_code AND e.source_active=true
        WHERE a.tenant_id=$1 GROUP BY a.tenant_id,a.order_number,a.item_code,a.division_id,a.customer_code,a.order_date,a.expected_shipping_date,a.item_name,a.allocated_quantity
        ON CONFLICT(tenant_id,order_number,item_code) DO UPDATE SET division_id=excluded.division_id,customer_code=excluded.customer_code,customer_name=excluded.customer_name,order_date=excluded.order_date,
          customer_due_date=excluded.customer_due_date,preproduction_review_date=excluded.preproduction_review_date,latest_customer_due_date=excluded.latest_customer_due_date,item_name=excluded.item_name,required_quantity=excluded.required_quantity,
          updated_at=now(),updated_by=$3,version=mps_monthly_plans.version+1
        WHERE (mps_monthly_plans.division_id,mps_monthly_plans.customer_code,mps_monthly_plans.customer_name,mps_monthly_plans.order_date,mps_monthly_plans.customer_due_date,mps_monthly_plans.preproduction_review_date,mps_monthly_plans.latest_customer_due_date,mps_monthly_plans.item_name,mps_monthly_plans.required_quantity)
          IS DISTINCT FROM (excluded.division_id,excluded.customer_code,excluded.customer_name,excluded.order_date,excluded.customer_due_date,excluded.preproduction_review_date,excluded.latest_customer_due_date,excluded.item_name,excluded.required_quantity)
        RETURNING id`, [tenantId, userId, updatedBy]);
      const inbound = await manager.query(`
        WITH totals AS (SELECT sales_order_number order_number,inventory_code item_code,sum(COALESCE(received_quantity,0)) quantity FROM finished_goods_inbound WHERE sales_order_number IS NOT NULL GROUP BY sales_order_number,inventory_code)
        UPDATE mps_monthly_plans p SET cumulative_inbound_quantity=COALESCE(t.quantity,0),pending_quantity=greatest(p.required_quantity-COALESCE(t.quantity,0),0),
          completion_rate=CASE WHEN p.required_quantity<=0 THEN 0 ELSE round(least(COALESCE(t.quantity,0)/p.required_quantity,1),4) END,
          updated_at=now(),updated_by=$2,version=p.version+1 FROM totals t WHERE p.tenant_id=$1 AND p.order_number=t.order_number AND p.item_code=t.item_code
          AND (p.cumulative_inbound_quantity,p.pending_quantity,p.completion_rate) IS DISTINCT FROM (COALESCE(t.quantity,0),greatest(p.required_quantity-COALESCE(t.quantity,0),0),CASE WHEN p.required_quantity<=0 THEN 0 ELSE round(least(COALESCE(t.quantity,0)/p.required_quantity,1),4) END)
        RETURNING p.id`, [tenantId, updatedBy]);
      await manager.query(`UPDATE mps_monthly_plans p SET cumulative_inbound_quantity=0,pending_quantity=greatest(p.required_quantity,0),completion_rate=0,updated_at=now(),updated_by=$2,version=p.version+1 WHERE p.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM finished_goods_inbound i WHERE i.sales_order_number=p.order_number AND i.inventory_code=p.item_code) AND (p.cumulative_inbound_quantity,p.pending_quantity,p.completion_rate) IS DISTINCT FROM (0,greatest(p.required_quantity,0),0)`, [tenantId, updatedBy]);
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
      return this.changedCount(allocations) + this.changedCount(monthly) + this.changedCount(inbound) + this.changedCount(groups);
    });
  }

  private async shippingToBase(tenantId: string, userId: string | null, updatedBy: string) {
    const rows = await this.dataSource.query(`
      INSERT INTO mps_base_plans(tenant_id,shipping_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,planned_quantity,model_age,image_refs,product_attribute,surface_nature,manufacturing_method,created_by,updated_by)
      SELECT s.tenant_id,s.id,s.division_id,s.customer_code,s.order_number,s.item_code,s.item_name,s.delivery_number,s.order_date,s.latest_customer_due_date,s.planned_quantity,s.model_age,COALESCE(m.image_refs,'[]'::jsonb),m.product_attribute,m.surface_nature,m.manufacturing_method,$2::uuid,$3
      FROM mps_shipping_plans s LEFT JOIN mps_monthly_plans m ON m.tenant_id=s.tenant_id AND m.order_number=s.order_number AND m.item_code=s.item_code WHERE s.tenant_id=$1
      ON CONFLICT(tenant_id,shipping_plan_id) DO UPDATE SET division_id=excluded.division_id,customer_code=excluded.customer_code,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,order_date=excluded.order_date,latest_customer_due_date=excluded.latest_customer_due_date,planned_quantity=excluded.planned_quantity,model_age=excluded.model_age,image_refs=excluded.image_refs,product_attribute=excluded.product_attribute,surface_nature=excluded.surface_nature,manufacturing_method=excluded.manufacturing_method,updated_at=now(),updated_by=$3,version=mps_base_plans.version+1
      WHERE (mps_base_plans.division_id,mps_base_plans.customer_code,mps_base_plans.order_number,mps_base_plans.item_code,mps_base_plans.item_name,mps_base_plans.delivery_number,mps_base_plans.order_date,mps_base_plans.latest_customer_due_date,mps_base_plans.planned_quantity,mps_base_plans.model_age,mps_base_plans.image_refs,mps_base_plans.product_attribute,mps_base_plans.surface_nature,mps_base_plans.manufacturing_method)
        IS DISTINCT FROM (excluded.division_id,excluded.customer_code,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number,excluded.order_date,excluded.latest_customer_due_date,excluded.planned_quantity,excluded.model_age,excluded.image_refs,excluded.product_attribute,excluded.surface_nature,excluded.manufacturing_method)
      RETURNING id`, [tenantId, userId, updatedBy]);
    await this.refreshBaseAdmission(tenantId, updatedBy);
    return rows.length;
  }

  private baseToWeekly(tenantId: string, userId: string | null, updatedBy: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.refreshBaseAdmission(tenantId, updatedBy, manager);
      const rows = await manager.query(`
        INSERT INTO mps_weekly_plans(tenant_id,base_plan_id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,latest_review_due_date,model_age,image_refs,product_attribute,surface_nature,planned_quantity,pending_quantity,manufacturing_method,planned_page_count,order_exception_info,inspection_required,inspection_quantity,remark,order_week_count,created_by,updated_by)
        SELECT tenant_id,id,division_id,customer_code,order_number,item_code,item_name,delivery_number,order_date,latest_customer_due_date,latest_review_due_date,model_age,image_refs,product_attribute,surface_nature,planned_quantity,planned_quantity,manufacturing_method,NULL,NULL,false,NULL,NULL,CASE WHEN order_date IS NULL THEN NULL ELSE greatest(0,floor((CURRENT_DATE-order_date)/7.0))::integer END,$2::uuid,$3
        FROM mps_base_plans WHERE tenant_id=$1 AND admission_status IN ('READY','SYNCED')
        ON CONFLICT(tenant_id,base_plan_id) DO UPDATE SET division_id=excluded.division_id,customer_code=excluded.customer_code,order_number=excluded.order_number,item_code=excluded.item_code,item_name=excluded.item_name,delivery_number=excluded.delivery_number,order_date=excluded.order_date,latest_customer_due_date=excluded.latest_customer_due_date,latest_review_due_date=excluded.latest_review_due_date,model_age=excluded.model_age,image_refs=excluded.image_refs,product_attribute=excluded.product_attribute,surface_nature=excluded.surface_nature,planned_quantity=excluded.planned_quantity,manufacturing_method=excluded.manufacturing_method,updated_at=now(),updated_by=$3,version=mps_weekly_plans.version+1
        WHERE (mps_weekly_plans.division_id,mps_weekly_plans.customer_code,mps_weekly_plans.order_number,mps_weekly_plans.item_code,mps_weekly_plans.item_name,mps_weekly_plans.delivery_number,mps_weekly_plans.order_date,mps_weekly_plans.latest_customer_due_date,mps_weekly_plans.latest_review_due_date,mps_weekly_plans.model_age,mps_weekly_plans.image_refs,mps_weekly_plans.product_attribute,mps_weekly_plans.surface_nature,mps_weekly_plans.planned_quantity,mps_weekly_plans.manufacturing_method)
          IS DISTINCT FROM (excluded.division_id,excluded.customer_code,excluded.order_number,excluded.item_code,excluded.item_name,excluded.delivery_number,excluded.order_date,excluded.latest_customer_due_date,excluded.latest_review_due_date,excluded.model_age,excluded.image_refs,excluded.product_attribute,excluded.surface_nature,excluded.planned_quantity,excluded.manufacturing_method)
        RETURNING id`, [tenantId, userId, updatedBy]);
      await manager.query(`UPDATE mps_base_plans b SET admission_status='SYNCED',updated_at=now(),updated_by=$2,version=version+1 WHERE tenant_id=$1 AND admission_status='READY' AND EXISTS(SELECT 1 FROM mps_weekly_plans w WHERE w.tenant_id=b.tenant_id AND w.base_plan_id=b.id)`, [tenantId, updatedBy]);
      const weeklyRows = await manager.query(`SELECT w.*,c.technical_days,c.cutting_days,c.machining_days,c.bending_days,c.spot_welding_days,c.welding_days,c.woodworking_days,c.grinding_days,c.surface_treatment_days,c.packaging_days FROM mps_weekly_plans w LEFT JOIN mps_process_cycles c ON c.tenant_id=w.tenant_id AND c.item_code=w.item_code WHERE w.tenant_id=$1`, [tenantId]);
      for (const weekly of weeklyRows) await this.ensureExecutionRows(manager, weekly, tenantId, userId, updatedBy);
      return rows.length;
    });
  }

  private async ensureExecutionRows(manager: EntityManager, weekly: any, tenantId: string, userId: string | null, updatedBy: string) {
    const reviewDueDate = this.dateOnly(weekly.latest_review_due_date);
    const schedules = reviewDueDate ? reverseSchedule(reviewDueDate, {
      cuttingDays: this.nullableNumber(weekly.cutting_days), machiningDays: this.nullableNumber(weekly.machining_days), bendingDays: this.nullableNumber(weekly.bending_days),
      spotWeldingDays: this.nullableNumber(weekly.spot_welding_days), weldingDays: this.nullableNumber(weekly.welding_days), woodworkingDays: this.nullableNumber(weekly.woodworking_days),
      grindingDays: this.nullableNumber(weekly.grinding_days), surfaceTreatmentDays: this.nullableNumber(weekly.surface_treatment_days), packagingDays: this.nullableNumber(weekly.packaging_days)
    }) : [];
    for (const schedule of schedules) await manager.query(`INSERT INTO mps_weekly_process_plans(tenant_id,weekly_plan_id,process_code,process_name,sequence,cycle_days,due_date,exception_text,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10) ON CONFLICT(tenant_id,weekly_plan_id,process_code) DO UPDATE SET process_name=excluded.process_name,sequence=excluded.sequence,cycle_days=excluded.cycle_days,due_date=excluded.due_date,exception_text=excluded.exception_text,updated_at=now(),updated_by=$10,version=mps_weekly_process_plans.version+1 WHERE (mps_weekly_process_plans.process_name,mps_weekly_process_plans.sequence,mps_weekly_process_plans.cycle_days,mps_weekly_process_plans.due_date,mps_weekly_process_plans.exception_text) IS DISTINCT FROM (excluded.process_name,excluded.sequence,excluded.cycle_days,excluded.due_date,excluded.exception_text)`, [tenantId, weekly.id, schedule.code, schedule.name, schedule.sequence, schedule.cycleDays, schedule.dueDate, schedule.cycleDays == null ? "未维护工序周期" : null, userId, updatedBy]);
    const technicalDays = this.nullableNumber(weekly.technical_days);
    const drawingDueDate = technicalDays == null || !reviewDueDate ? null : new Date(Date.parse(`${reviewDueDate}T00:00:00Z`) - technicalDays * 86_400_000).toISOString().slice(0, 10);
    await manager.query(`UPDATE mps_weekly_plans SET technical_cycle_days=$3,drawing_due_date=$4,updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND id=$2 AND (technical_cycle_days,drawing_due_date) IS DISTINCT FROM ($3,$4)`, [tenantId, weekly.id, technicalDays, drawingDueDate, updatedBy]);
    await manager.query(`INSERT INTO mps_technical_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,drawing_due_date,exception_text,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10) ON CONFLICT(tenant_id,order_number,item_code,delivery_number) DO UPDATE SET drawing_due_date=excluded.drawing_due_date,exception_text=excluded.exception_text,updated_at=now(),updated_by=$10,version=mps_technical_reports.version+1 WHERE (mps_technical_reports.drawing_due_date,mps_technical_reports.exception_text) IS DISTINCT FROM (excluded.drawing_due_date,excluded.exception_text)`, [tenantId, weekly.id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, drawingDueDate, technicalDays == null ? "未维护技术周期" : null, userId, updatedBy]);
    for (const material of ["五金", "木作"]) await manager.query(`INSERT INTO mps_material_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,material_name,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9) ON CONFLICT(tenant_id,order_number,item_code,delivery_number,material_name) DO NOTHING`, [tenantId, weekly.id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, material, userId, updatedBy]);
    if (["中心外购", "外协", "自制+外协"].includes(weekly.manufacturing_method)) await manager.query(`INSERT INTO mps_outsourcing_reports(tenant_id,weekly_plan_id,order_number,item_code,item_name,delivery_number,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7::uuid,$8) ON CONFLICT(tenant_id,weekly_plan_id) DO NOTHING`, [tenantId, weekly.id, weekly.order_number, weekly.item_code, weekly.item_name, weekly.delivery_number, userId, updatedBy]);
  }

  private async allocateInbound(tenantId: string, updatedBy: string) {
    const changed = await this.dataSource.query(`
      WITH inbound_totals AS (
        SELECT sales_order_number order_number,inventory_code item_code,sum(greatest(COALESCE(received_quantity,0),0)) quantity
        FROM finished_goods_inbound WHERE sales_order_number IS NOT NULL
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
      const processes = await manager.query(`SELECT p.id,p.weekly_plan_id,p.process_code,p.due_date,w.planned_quantity,COALESCE(sum(r.production_quantity),0) reported FROM mps_weekly_process_plans p JOIN mps_weekly_plans w ON w.id=p.weekly_plan_id AND w.tenant_id=p.tenant_id LEFT JOIN mps_process_reports r ON r.tenant_id=p.tenant_id AND r.weekly_plan_id=p.weekly_plan_id AND r.process_code=p.process_code WHERE p.tenant_id=$1 GROUP BY p.id,p.weekly_plan_id,p.process_code,p.due_date,w.planned_quantity`, [tenantId]);
      for (const row of processes) { const status = processStatus(row.planned_quantity, row.reported, this.dateOnly(row.due_date), today); const changed = await manager.query(`UPDATE mps_weekly_process_plans SET reported_quantity=$3,status=$4,updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND id=$2 AND (reported_quantity,status) IS DISTINCT FROM ($3,$4) RETURNING id`, [tenantId, row.id, row.reported, status, updatedBy]); count += changed.length; }
      const outsource = await manager.query(`SELECT id,purchase_order_number,actual_inbound_date,outsourcing_due_date FROM mps_outsourcing_reports WHERE tenant_id=$1`, [tenantId]);
      for (const row of outsource) { const status = outsourcingStatus({ purchaseOrderNumber: row.purchase_order_number, actualInboundDate: this.dateOnly(row.actual_inbound_date), dueDate: this.dateOnly(row.outsourcing_due_date), today }); const changed = await manager.query(`UPDATE mps_outsourcing_reports SET status=$3,received=($4::date IS NOT NULL),updated_at=now(),updated_by=$5,version=version+1 WHERE tenant_id=$1 AND id=$2 AND (status,received) IS DISTINCT FROM ($3,($4::date IS NOT NULL)) RETURNING id`, [tenantId, row.id, status, row.actual_inbound_date, updatedBy]); count += changed.length; }
      // 技术状态由技术人员在技术报工表维护；对账不得根据附件反向覆盖人工状态。
    });
    return count;
  }

  private async refreshBaseAdmission(tenantId: string, updatedBy: string, manager: EntityManager = this.dataSource.manager) {
    const [setting] = await manager.query(`SELECT value_json FROM mps_system_settings WHERE tenant_id=$1 AND setting_key='base_plan_require_sketch'`, [tenantId]);
    const requireSketch = setting?.value_json === true;
    await manager.query(`UPDATE mps_base_plans SET admission_status=CASE WHEN latest_review_due_date IS NOT NULL AND btrim(COALESCE(product_attribute,''))<>'' AND btrim(COALESCE(surface_nature,''))<>'' AND btrim(COALESCE(manufacturing_method,''))<>'' AND (NOT $2 OR jsonb_array_length(image_refs)>0) THEN CASE WHEN admission_status='SYNCED' THEN 'SYNCED' ELSE 'READY' END ELSE 'INCOMPLETE' END, admission_message=concat_ws('；',CASE WHEN latest_review_due_date IS NULL THEN '缺少最迟评审交期' END,CASE WHEN btrim(COALESCE(product_attribute,''))='' THEN '缺少产品属性' END,CASE WHEN btrim(COALESCE(surface_nature,''))='' THEN '缺少表面性质' END,CASE WHEN btrim(COALESCE(manufacturing_method,''))='' THEN '缺少生产方式' END,CASE WHEN $2 AND jsonb_array_length(image_refs)=0 THEN '缺少简图' END),updated_at=now(),updated_by=$3,version=version+1 WHERE tenant_id=$1`, [tenantId, requireSketch, updatedBy]);
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
  private changedCount(result: unknown[]) { return Array.isArray(result[0]) ? result[0].length : result.length; }
  private dateOnly(value: unknown) {
    if (value == null || value === "") return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
}
