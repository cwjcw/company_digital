import { Injectable, Logger } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { NotificationService } from "../notifications/notification.service";

const PUBLIC_BASE_URL = String(process.env.KDOS_PUBLIC_BASE_URL ?? "https://knplan.cuixiaoyuan.cn").replace(/\/$/, "");

function truncateUtf8(value: string, maxBytes: number) {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character, "utf8") > maxBytes) break;
    result += character;
  }
  return result;
}

@Injectable()
export class MasterPlanExceptionNotificationService {
  private readonly logger = new Logger(MasterPlanExceptionNotificationService.name);
  constructor(private readonly dataSource: DataSource, private readonly notifications: NotificationService) {}

  private async safelyEnqueue(manager: EntityManager, tenantId: string, key: string, work: () => Promise<unknown>) {
    const savepoint = `mps_notify_${key.replace(/[^a-z0-9_]/gi, "_").slice(0, 40)}`;
    await manager.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await work();
      await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
      this.logger.warn(`主计划异常通知未入队（${tenantId}/${key}）；业务事务已继续，工作日汇总仍会重新统计未解决异常`);
      return null;
    }
  }

  private async safelyRead<T>(manager: EntityManager, tenantId: string, key: string, work: () => Promise<T>): Promise<T | null> {
    const savepoint = `mps_read_${key.replace(/[^a-z0-9_]/gi, "_").slice(0, 40)}`;
    await manager.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await work();
      await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch {
      await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
      this.logger.warn(`主计划异常通知数据读取失败（${tenantId}/${key}）；业务事务已继续`);
      return null;
    }
  }

  private async routeReady(manager: EntityManager, tenantId: string, eventType: string) {
    const rows = await this.safelyRead(manager, tenantId, `route_${eventType}`, () => manager.query(`SELECT 1 FROM notification_routes r
      JOIN notification_route_targets t ON t.tenant_id=r.tenant_id AND t.route_id=r.id AND t.enabled=true
      JOIN notification_group_webhooks w ON w.tenant_id=t.tenant_id AND w.id=t.target_id AND w.enabled=true AND w.webhook_ciphertext IS NOT NULL
      WHERE r.tenant_id=$1 AND r.event_type=$2 AND r.enabled=true LIMIT 1`, [tenantId, eventType]));
    return Boolean(rows?.[0]);
  }

  async enqueueBusinessException(manager: EntityManager, tenantId: string, exception: Record<string, unknown>) {
    if (!await this.routeReady(manager, tenantId, "mps.sync_exception.immediate")) return { created: false, routeMissing: true };
    const rows = await this.safelyRead(manager, tenantId, `business_${String(exception.version)}`, () => manager.query(`SELECT
      coalesce(a.order_number,m.order_number,b.order_number,split_part($4,'/',1),'—') order_number,
      coalesce(a.item_code,m.item_code,b.item_code,split_part($4,'/',2),'—') item_code,
      coalesce(a.item_name,m.item_name,b.item_name) item_name,
      a.allocated_quantity,m.required_quantity monthly_quantity,b.planned_quantity base_quantity,
      org.name division
      FROM (SELECT $1::varchar tenant_id,$2::uuid record_id,$3::varchar resource) e
      LEFT JOIN mps_order_allocations a ON a.tenant_id=e.tenant_id AND a.id=e.record_id
      LEFT JOIN mps_monthly_plans m ON m.tenant_id=e.tenant_id AND (m.id=e.record_id OR a.monthly_plan_id=m.id)
      LEFT JOIN mps_base_plans b ON b.tenant_id=e.tenant_id AND (b.id=e.record_id OR b.monthly_plan_id=m.id)
      LEFT JOIN organization_units org ON org.id=coalesce(a.division_id,m.division_id,b.division_id)
      LIMIT 1`, [tenantId, exception.record_id ?? null, exception.resource ?? null, exception.business_key ?? null]));
    if (!rows) return { created: false, dataUnavailable: true };
    const facts = rows[0];
    const clean = (value: unknown) => String(value ?? "—").replace(/[\r\n]+/g, " ").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[内部编号]").replace(/(token|password|secret|webhook)\s*[:=]\s*\S+/gi, "$1=[已隐藏]").slice(0, 300);
    const content = [
      "## 【KDOS主计划同步异常】",
      `- 异常类型：${clean(exception.exception_type)}`,
      `- 承接事业部：${clean(facts?.division)}`,
      `- 订单号：${clean(facts?.order_number)}`,
      `- 品项编码：${clean(facts?.item_code)}${facts?.item_name ? `（${clean(facts.item_name)}）` : ""}`,
      `- 分配数量：${facts?.allocated_quantity == null ? "—" : String(facts.allocated_quantity)}`,
      `- 月度计划数量：${facts?.monthly_quantity == null ? "—" : String(facts.monthly_quantity)}`,
      `- 基础计划数量：${facts?.base_quantity == null ? "—" : String(facts.base_quantity)}`,
      `- 冲突原因：${clean(exception.message)}`,
      `- 发生时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`,
      "- 当前状态：待人工处理",
      `- 异常明细：${PUBLIC_BASE_URL}/master-plan-reports`
    ].join("\n");
    const key = String(exception.exception_key ?? "unknown");
    return this.safelyEnqueue(manager, tenantId, `business_${String(exception.version)}`, () => this.notifications.enqueueGroupEvent(tenantId, {
      eventType: "mps.sync_exception.immediate", dedupKey: `mps-exception:${key}:${Number(exception.version ?? 0)}`,
      components: [{ type: "markdown", content }], createdBy: typeof exception.created_by === "string" ? exception.created_by : null
    }, manager));
  }

  async enqueueDemandConflict(manager: EntityManager, tenantId: string, exception: Record<string, unknown>, state: {
    allocations: Array<Record<string, unknown>>;
    monthly?: Record<string, unknown> | null;
    bases: Array<Record<string, unknown>>;
    reasons: string[];
  }) {
    if (!await this.routeReady(manager, tenantId, "mps.sync_exception.immediate")) return { created: false, routeMissing: true };
    const allocation = state.allocations[0] ?? {};
    const divisionRows = await this.safelyRead(manager, tenantId, `division_${String(exception.version)}`, () => manager.query("SELECT name FROM organization_units WHERE id=$1::uuid", [allocation.division_id]));
    const division = divisionRows?.[0];
    const orderNumber = String(allocation.order_number ?? exception.business_key ?? "—");
    const itemCode = String(allocation.item_code ?? "—");
    const clean = (value: unknown) => String(value ?? "—").replace(/[\r\n]+/g, " ").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[内部编号]").replace(/(token|password|secret|webhook)\s*[:=]\s*\S+/gi, "$1=[已隐藏]").slice(0, 500);
    const quantity = (value: unknown) => value == null ? "—" : String(value);
    const date = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    const content = [
      "## 【KDOS主计划同步异常】",
      `- 异常类型：${clean(exception.exception_type)}`,
      `- 承接事业部：${clean(division?.name)}`,
      `- 订单号：${clean(orderNumber)}`,
      `- 品项编码：${clean(itemCode)}${allocation.item_name ? `（${clean(allocation.item_name)}）` : ""}`,
      `- 分配数量：${quantity(allocation.allocated_quantity)}`,
      `- 月度计划数量：${quantity(state.monthly?.required_quantity)}`,
      `- 基础计划数量：${quantity(state.bases.reduce((sum, row) => sum + Number(row.planned_quantity ?? 0), 0))}`,
      `- 冲突原因：${clean(state.reasons.join("；"))}`,
      `- 发生时间：${date}`,
      "- 当前状态：待人工处理",
      `- 异常明细：${PUBLIC_BASE_URL}/master-plan-reports`
    ].join("\n");
    return this.safelyEnqueue(manager, tenantId, `exception_${String(exception.version)}`, () => this.notifications.enqueueGroupEvent(tenantId, {
      eventType: "mps.sync_exception.immediate",
      dedupKey: `mps-exception:${String(exception.exception_key)}:${String(exception.version)}`,
      components: [{ type: "markdown", content }]
    }, manager));
  }

  async enqueueOutboxRetryLimit(manager: EntityManager, tenantId: string, event: Record<string, unknown>) {
    if (!await this.routeReady(manager, tenantId, "mps.sync_exception.immediate")) return { created: false, routeMissing: true };
    const rows = await this.safelyRead(manager, tenantId, `outbox_${String(event.id)}`, () => manager.query(`SELECT
      coalesce(a.order_number,scope->'allocationKey'->>'orderNumber',scope#>>'{allocation,orderNumber}',split_part(o.business_key,'/',1),'—') order_number,
      coalesce(a.item_code,scope->'allocationKey'->>'itemCode',scope#>>'{allocation,itemCode}',split_part(o.business_key,'/',2),'—') item_code,
      a.item_name,a.allocated_quantity,org.name division,
      (SELECT m.required_quantity FROM mps_monthly_plans m WHERE m.tenant_id=o.tenant_id AND
        (m.id=a.monthly_plan_id OR (m.order_number=coalesce(a.order_number,scope->'allocationKey'->>'orderNumber',scope#>>'{allocation,orderNumber}') AND m.item_code=coalesce(a.item_code,scope->'allocationKey'->>'itemCode',scope#>>'{allocation,itemCode}'))) ORDER BY m.updated_at DESC LIMIT 1) monthly_quantity,
      (SELECT sum(b.planned_quantity) FROM mps_base_plans b WHERE b.tenant_id=o.tenant_id AND
        (b.monthly_plan_id=a.monthly_plan_id OR (b.order_number=coalesce(a.order_number,scope->'allocationKey'->>'orderNumber',scope#>>'{allocation,orderNumber}') AND b.item_code=coalesce(a.item_code,scope->'allocationKey'->>'itemCode',scope#>>'{allocation,itemCode}')))) base_quantity
      FROM (SELECT $2::varchar business_key,$3::uuid record_id,$4::jsonb scope,$1::varchar tenant_id) o
      LEFT JOIN mps_order_allocations a ON a.tenant_id=o.tenant_id AND (a.id=o.record_id OR
        (a.order_number=coalesce(o.scope->'allocationKey'->>'orderNumber',o.scope#>>'{allocation,orderNumber}') AND a.item_code=coalesce(o.scope->'allocationKey'->>'itemCode',o.scope#>>'{allocation,itemCode}')))
      LEFT JOIN organization_units org ON org.id=a.division_id LIMIT 1`,
      [tenantId, event.business_key ?? null, event.record_id ?? null, event.scope_json ? JSON.stringify(event.scope_json) : null]));
    if (!rows) return { created: false, dataUnavailable: true };
    const facts = rows[0];
    const clean = (value: unknown) => String(value ?? "—").replace(/[\r\n]+/g, " ").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[内部编号]").replace(/(token|password|secret|webhook)\s*[:=]\s*\S+/gi, "$1=[已隐藏]").slice(0, 300);
    const content = [
      "## 【KDOS主计划同步异常】",
      "- 异常类型：MPS_OUTBOX_RETRY_EXHAUSTED",
      `- 承接事业部：${clean(facts?.division)}`,
      `- 订单号：${clean(facts?.order_number)}`,
      `- 品项编码：${clean(facts?.item_code)}${facts?.item_name ? `（${clean(facts.item_name)}）` : ""}`,
      `- 分配数量：${facts?.allocated_quantity == null ? "—" : String(facts.allocated_quantity)}`,
      `- 月度计划数量：${facts?.monthly_quantity == null ? "—" : String(facts.monthly_quantity)}`,
      `- 基础计划数量：${facts?.base_quantity == null ? "—" : String(facts.base_quantity)}`,
      "- 冲突原因：主计划同步已达到10次自动重试上限，系统保留失败任务并等待人工处理。",
      `- 发生时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`,
      "- 当前状态：自动重试耗尽，待人工处理",
      `- 异常明细：${PUBLIC_BASE_URL}/master-plan-reports`
    ].join("\n");
    const version = Number(event.version ?? 0);
    return this.safelyEnqueue(manager, tenantId, `outbox_${String(event.id)}`, () => this.notifications.enqueueGroupEvent(tenantId, {
      eventType: "mps.sync_exception.immediate",
      dedupKey: `mps-outbox-retry:${String(event.id)}:${version}`,
      components: [{ type: "markdown", content }],
      createdBy: typeof event.actor_id === "string" ? event.actor_id : null
    }, manager));
  }

  async queueSummary(manager: EntityManager, tenantId: string, kind: "initial" | "daily", today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })) {
    if (!await this.routeReady(manager, tenantId, "mps.sync_exception.daily_summary")) return { created: false, routeMissing: true };
    const summary = await this.summary(manager, tenantId, today);
    const { total, createdToday, resolvedToday, byDivision, priority, samples } = summary;
    const content = [
      `## 【KDOS主计划同步异常${kind === "initial" ? "历史汇总" : "工作日汇总"}】`,
      `- 当前未解决异常：${total}`,
      `- 今日新增：${createdToday}`,
      `- 今日自动解决：${resolvedToday}`,
      `- 影响计划正常同步的重点异常：${priority}`,
      `- 已达到自动重试上限且尚未解决的同步任务：${summary.retryExhausted}`,
      "- 各事业部未解决数量：",
      ...byDivision.map(row => `  - ${row.name}：${row.count}`),
      ...(samples.length ? ["- 重点异常示例：", ...samples.slice(0, 5).map(row => `  - ${row.division}｜${row.orderNumber}｜${row.itemCode}｜${String(row.message).slice(0, 80)}`)] : []),
      `- 异常明细：${PUBLIC_BASE_URL}/master-plan-reports`,
      `- 汇总时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`
    ].join("\n");
    const dateKey = kind === "initial" ? "first-baseline" : today;
    return this.notifications.enqueueGroupEvent(tenantId, {
      eventType: "mps.sync_exception.daily_summary",
      dedupKey: `mps-exception-summary:${kind}:${dateKey}`,
      components: [{ type: "markdown", content: truncateUtf8(content, 3500) }]
    }, manager);
  }

  async queueSummaryJob(tenantId: string, kind: "initial" | "daily") {
    return this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      return this.queueSummary(manager, tenantId, kind);
    });
  }

  async summary(manager: EntityManager, tenantId: string, today: string) {
    const [counts] = await manager.query(`SELECT
      count(*) FILTER (WHERE active)::int AS total,
      count(*) FILTER (WHERE created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Shanghai'))::int AS created_today,
      count(*) FILTER (WHERE resolved_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Shanghai'))::int AS resolved_today,
      count(*) FILTER (WHERE active AND (severity='ERROR' OR exception_type='DEMAND_CONSISTENCY_BLOCKED'))::int AS priority,
      (SELECT count(*)::int FROM mps_reconciliation_outbox o WHERE o.tenant_id=$1 AND o.resource LIKE 'mps-%' AND o.status='FAILED'
        AND o.superseded_by IS NULL AND (o.attempts>=10 OR o.next_attempt_at='infinity'::timestamptz)) AS retry_exhausted
      FROM mps_data_exceptions WHERE tenant_id=$1`, [tenantId, today]);
    const byDivision: Array<{ name: string; count: number }> = await manager.query(`SELECT coalesce(org.division,org.name,'未指定事业部') name,count(*)::int count
      FROM mps_data_exceptions e LEFT JOIN mps_order_allocations a ON a.tenant_id=e.tenant_id AND a.id=e.record_id
      LEFT JOIN organization_units org ON org.id=a.division_id
      WHERE e.tenant_id=$1 AND e.active=true GROUP BY coalesce(org.division,org.name,'未指定事业部') ORDER BY count DESC,name`, [tenantId]);
    const samples: Array<{ division: string; orderNumber: string; itemCode: string; message: string }> = await manager.query(`SELECT coalesce(org.division,org.name,'未指定事业部') division,coalesce(a.order_number,e.business_key) "orderNumber",
      coalesce(a.item_code,'—') "itemCode",left(regexp_replace(regexp_replace(e.message,E'[\\n\\r]+',' ','g'),'[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}','[内部编号]','g'),180) message
      FROM mps_data_exceptions e LEFT JOIN mps_order_allocations a ON a.tenant_id=e.tenant_id AND a.id=e.record_id
      LEFT JOIN organization_units org ON org.id=a.division_id
      WHERE e.tenant_id=$1 AND e.active=true AND (e.severity='ERROR' OR e.exception_type='DEMAND_CONSISTENCY_BLOCKED') ORDER BY e.updated_at DESC,e.id LIMIT 8`, [tenantId]);
    const safeSamples = samples.map(row => ({ ...row, message: String(row.message ?? "").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[内部编号]").replace(/(token|password|secret|webhook)\s*[:=]\s*\S+/gi, "$1=[已隐藏]") }));
    return { total: Number(counts.total), createdToday: Number(counts.created_today), resolvedToday: Number(counts.resolved_today), priority: Number(counts.priority), retryExhausted: Number(counts.retry_exhausted), byDivision, samples: safeSamples };
  }
}
