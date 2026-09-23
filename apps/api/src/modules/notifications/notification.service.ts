import { ConflictException, Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import type {
  NotificationActor,
  NotificationClaim,
  NotificationDeliveryResult,
  NotificationEnqueueResult,
  NotificationEventInput,
  NotificationOutboxInput,
  NotificationRuleInput
} from "./notification.types";

const MAX_ERROR_LENGTH = 4000;
const DEFAULT_LOCK_TIMEOUT_SECONDS = 300;
const EQUIPMENT_RESOURCE = "equipment-status-report";
const EQUIPMENT_FAULT_RECIPIENT_RULE = "EQUIPMENT_RESPONSIBLE";
const EQUIPMENT_FAULT_TEMPLATE = "【设备故障提醒】\n\n事业部：{divisionName}\n设备编号：{equipmentCode}\n设备名称：{equipmentName}\n\n故障时间：{oldFaultMinutes}分钟 → {newFaultMinutes}分钟\n故障原因：{faultReason}\n\n填报人：{actorName}\n时间：{occurredAt}\n\n请及时处理。";

type NotificationRuleRow = Record<string, unknown> & {
  id: string;
  resource?: string;
  recipient_rule?: string;
  config?: Record<string, unknown>;
};

@Injectable()
export class NotificationService {
  constructor(private readonly dataSource: DataSource) {}

  async upsertRule(tenantId: string, input: NotificationRuleInput, actor: NotificationActor, manager?: EntityManager) {
    this.requireTenant(tenantId);
    this.requireText(input.ruleKey, "ruleKey", 128);
    this.requireText(input.name, "name", 255);
    this.requireText(input.eventType, "eventType", 128);
    this.requireText(input.channel, "channel", 64);
    const resource = input.resource ?? "notification";
    const recipientRule = input.recipientRule ?? "NONE";
    this.requireText(resource, "resource", 128);
    this.requireText(recipientRule, "recipientRule", 128);
    return this.withManager(tenantId, manager, async (scoped) => {
      const rows = await scoped.query(`
        INSERT INTO notification_rules(tenant_id,rule_key,name,event_type,channel,resource,recipient_rule,enabled,config,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::uuid,$10::uuid)
        ON CONFLICT(tenant_id,rule_key) DO UPDATE SET
          name=EXCLUDED.name,event_type=EXCLUDED.event_type,channel=EXCLUDED.channel,
          resource=EXCLUDED.resource,recipient_rule=EXCLUDED.recipient_rule,
          enabled=EXCLUDED.enabled,config=EXCLUDED.config,updated_by=EXCLUDED.updated_by,
          updated_at=now(),version=notification_rules.version+1
        RETURNING *`,
      [tenantId, input.ruleKey, input.name, input.eventType, input.channel, resource, recipientRule,
        input.enabled ?? true, JSON.stringify(input.config ?? {}), actor.userId]);
      return rows[0];
    });
  }

  /** 入队可接收业务写事务的 EntityManager，使业务行和通知事件能够同事务提交。 */
  async enqueue(tenantId: string, input: NotificationOutboxInput, manager?: EntityManager): Promise<NotificationEnqueueResult> {
    this.requireTenant(tenantId);
    if (input.ruleId) this.requireText(input.ruleId, "ruleId", 64);
    this.requireText(input.eventType, "eventType", 128);
    this.requireText(input.channel, "channel", 64);
    this.requireText(input.dedupKey, "dedupKey", 255);
    return this.withManager(tenantId, manager, async (scoped) => {
      const inserted = await scoped.query(`
        INSERT INTO notification_outbox(
          tenant_id,notification_rule_id,event_type,channel,dedup_key,payload,created_by,updated_by
        ) VALUES($1,$2::uuid,$3,$4,$5,$6::jsonb,$7::uuid,$7::uuid)
        ON CONFLICT(tenant_id,dedup_key) DO NOTHING
        RETURNING *`,
      [tenantId, input.ruleId ?? null, input.eventType, input.channel, input.dedupKey, JSON.stringify(input.payload), input.createdBy ?? null]);
      if (inserted[0]) return { row: inserted[0], created: true };
      const existing = await scoped.query("SELECT * FROM notification_outbox WHERE tenant_id=$1 AND dedup_key=$2", [tenantId, input.dedupKey]);
      return { row: existing[0], created: false };
    });
  }

  /** 写入不解析接收人的领域事件；后续规则/Dispatcher 可在消费阶段完成路由。 */
  async enqueueEvent(tenantId: string, input: NotificationEventInput, manager?: EntityManager) {
    return this.enqueue(tenantId, {
      ruleId: input.ruleId ?? null, eventType: input.eventType, channel: input.channel ?? "UNASSIGNED",
      dedupKey: input.dedupKey, payload: input.payload, createdBy: input.createdBy
    }, manager);
  }

  /** 使用数据库行锁领取任务；锁超时的 PROCESSING 行可被后续 worker 恢复。 */
  async claim(tenantId: string, workerId: string, limit = 20, lockTimeoutSeconds = DEFAULT_LOCK_TIMEOUT_SECONDS) {
    this.requireTenant(tenantId); this.requireText(workerId, "workerId", 255);
    return this.withManager(tenantId, undefined, async (manager) => this.rowsOf(await manager.query(this.claimSql(), [tenantId, workerId, this.normalizeLimit(limit), this.normalizeTimeout(lockTimeoutSeconds)])));
  }

  /** Dispatcher 专用领取：规则匹配、接收人解析和 delivery attempt 创建均在 API 内完成。 */
  async claimForDispatcher(tenantId: string, workerId: string, limit = 10, lockTimeoutSeconds = DEFAULT_LOCK_TIMEOUT_SECONDS): Promise<NotificationClaim[]> {
    this.requireTenant(tenantId); this.requireText(workerId, "workerId", 255);
    return this.withManager(tenantId, undefined, async (manager) => {
      const rows = this.rowsOf(await manager.query(this.claimSql(), [tenantId, workerId, this.normalizeLimit(limit), this.normalizeTimeout(lockTimeoutSeconds)]));
      const claims: NotificationClaim[] = [];
      for (const outbox of rows as Array<Record<string, unknown>>) {
        const rule = await this.resolveRule(manager, tenantId, outbox);
        if (!rule) {
          await this.quarantine(manager, tenantId, outbox, workerId, "NO_MATCHING_RULE", "没有匹配的启用通知规则");
          continue;
        }
        if (rule.resource !== EQUIPMENT_RESOURCE || rule.recipient_rule !== EQUIPMENT_FAULT_RECIPIENT_RULE) {
          await this.quarantine(manager, tenantId, outbox, workerId, "UNSUPPORTED_RECIPIENT_RULE", "通知规则的资源或接收人规则不受当前 Dispatcher 支持");
          continue;
        }
        const payload = this.objectPayload(outbox.payload);
        const equipmentId = this.requiredPayloadText(payload.equipmentId, "equipmentId");
        const users = await manager.query(`
          SELECT DISTINCT u.id "userId",COALESCE(NULLIF(u.display_name,''),u.username) "displayName",u.wechat_user_id "wechatUserId"
          FROM equipment_responsibles er JOIN users u ON u.id=er.user_id
          WHERE er.tenant_id=$1 AND er.equipment_id=$2::uuid AND u.enabled=true
          ORDER BY u.id`, [tenantId, equipmentId]) as Array<Record<string, unknown>>;
        const deliveryRecipients = await this.prepareRecipientDeliveries(manager, tenantId, outbox, users);
        await manager.query(`
          UPDATE notification_outbox SET notification_rule_id=$3::uuid,updated_at=now(),version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND status='PROCESSING' AND locked_by=$4`, [tenantId, outbox.id, rule.id, workerId]);
        if (!deliveryRecipients.length) {
          await this.completeWithoutDelivery(manager, tenantId, outbox, workerId);
          continue;
        }
        claims.push({ notificationId: String(outbox.id), messageType: "text", content: this.renderContent(rule, payload), recipients: deliveryRecipients });
      }
      return claims;
    });
  }

  async markDeliverySuccess(tenantId: string, outboxId: string, workerId: string, result: NotificationDeliveryResult) {
    this.requireJobIdentity(tenantId, outboxId, workerId); this.requireText(result.deliveryId, "deliveryId", 64);
    return this.withManager(tenantId, undefined, async (manager) => {
      const rows = this.rowsOf(await manager.query(`
        UPDATE notification_delivery_logs AS delivery SET
          status='SENT',response_code=$5,response_json=NULL,error_message=NULL,
          errcode=$6,errmsg=$7,provider_message_id=$8,delivered_at=now()
        FROM notification_outbox AS outbox
        WHERE delivery.id=$2::uuid AND delivery.tenant_id=$1 AND delivery.notification_outbox_id=outbox.id
          AND outbox.tenant_id=$1 AND outbox.id=$3::uuid AND outbox.status='PROCESSING' AND outbox.locked_by=$4
          AND delivery.status IN ('PENDING','PROCESSING')
        RETURNING outbox.*`, [tenantId, result.deliveryId, outboxId, workerId, result.errcode ?? null, result.errcode ?? null, result.errmsg ?? null, result.providerMessageId ?? null]));
      if (!rows[0]) throw new ConflictException("通知投递不存在、已被其他 worker 处理或状态已变化");
      return this.reconcileOutbox(manager, tenantId, outboxId, workerId);
    });
  }

  async markDeliveryFailure(tenantId: string, outboxId: string, workerId: string, result: NotificationDeliveryResult) {
    this.requireJobIdentity(tenantId, outboxId, workerId); this.requireText(result.deliveryId, "deliveryId", 64);
    const error = String(result.errmsg ?? "企业微信投递失败").slice(0, MAX_ERROR_LENGTH);
    return this.withManager(tenantId, undefined, async (manager) => {
      const rows = this.rowsOf(await manager.query(`
        UPDATE notification_delivery_logs AS delivery SET
          status='RETRY_PENDING',response_code=$5,response_json=NULL,error_message=$6,
          errcode=$7,errmsg=$8,provider_message_id=$9
        FROM notification_outbox AS outbox
        WHERE delivery.id=$2::uuid AND delivery.tenant_id=$1 AND delivery.notification_outbox_id=outbox.id
          AND outbox.tenant_id=$1 AND outbox.id=$3::uuid AND outbox.status='PROCESSING' AND outbox.locked_by=$4
          AND delivery.status IN ('PENDING','PROCESSING')
        RETURNING outbox.*`, [tenantId, result.deliveryId, outboxId, workerId, result.errcode ?? null, error, result.errcode ?? null, result.errmsg ?? error, result.providerMessageId ?? null]));
      if (!rows[0]) throw new ConflictException("通知投递不存在、已被其他 worker 处理或状态已变化");
      return this.reconcileOutbox(manager, tenantId, outboxId, workerId);
    });
  }

  async markSent(tenantId: string, outboxId: string, workerId: string, response?: { code?: string; body?: unknown }) {
    this.requireJobIdentity(tenantId, outboxId, workerId); return this.finish(tenantId, outboxId, workerId, "SENT", response);
  }

  async markFailed(tenantId: string, outboxId: string, workerId: string, error: string, nextRetryAt?: Date | null) {
    this.requireJobIdentity(tenantId, outboxId, workerId); this.requireText(error, "error", MAX_ERROR_LENGTH);
    return this.withManager(tenantId, undefined, async (manager) => {
      const rows = this.rowsOf(await manager.query(`
        UPDATE notification_outbox SET status='FAILED',failed_at=now(),last_error=$4,
          next_retry_at=COALESCE($5::timestamptz,now()+LEAST(GREATEST(attempts,1),30)*interval '1 minute'),
          locked_at=NULL,locked_by=NULL,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND status='PROCESSING' AND locked_by=$3 RETURNING *`, [tenantId, outboxId, workerId, error.slice(0, MAX_ERROR_LENGTH), nextRetryAt ?? null]));
      const row = rows[0];
      if (!row) throw new ConflictException("通知任务不存在、已被其他 worker 处理或状态已变化");
      await this.insertDeliveryLog(manager, tenantId, row, "FAILED", { error: String(row.last_error ?? error) }); return row;
    });
  }

  private claimSql() {
    return `UPDATE notification_outbox AS outbox SET status='PROCESSING',attempts=outbox.attempts+1,next_retry_at=NULL,
      locked_at=now(),locked_by=$2,failed_at=NULL,updated_at=now(),version=outbox.version+1
      WHERE outbox.id IN (SELECT candidate.id FROM notification_outbox AS candidate
        WHERE candidate.tenant_id=$1 AND ((candidate.status='PENDING' AND (candidate.next_retry_at IS NULL OR candidate.next_retry_at<=now()))
          OR (candidate.status='FAILED' AND candidate.next_retry_at IS NOT NULL AND candidate.next_retry_at<=now())
          OR (candidate.status='PROCESSING' AND candidate.locked_at<=now()-($4 * interval '1 second')))
        ORDER BY candidate.created_at,candidate.id FOR UPDATE SKIP LOCKED LIMIT $3)
      RETURNING outbox.id AS id,outbox.tenant_id AS tenant_id,outbox.notification_rule_id AS notification_rule_id,
        outbox.event_type AS event_type,outbox.channel AS channel,outbox.dedup_key AS dedup_key,outbox.payload AS payload,
        outbox.status AS status,outbox.attempts AS attempts,outbox.next_retry_at AS next_retry_at,
        outbox.locked_at AS locked_at,outbox.locked_by AS locked_by,outbox.created_at AS created_at,outbox.version AS version`;
  }

  private async resolveRule(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>): Promise<NotificationRuleRow | null> {
    const rows = outbox.notification_rule_id
      ? await manager.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND id=$2::uuid AND enabled=true", [tenantId, outbox.notification_rule_id])
      : await manager.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND event_type=$2 AND channel=$3 AND enabled=true ORDER BY updated_at DESC,id DESC LIMIT 1", [tenantId, outbox.event_type, outbox.channel]);
    return rows[0] ?? null;
  }

  private async prepareRecipientDeliveries(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>, users: Array<Record<string, unknown>>) {
    const userIds = users.map((user) => String(user.userId));
    const existing = userIds.length ? await manager.query(`SELECT DISTINCT ON (recipient_user_id) id,recipient_user_id,attempt,status
      FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND recipient_user_id=ANY($3::uuid[])
      ORDER BY recipient_user_id,attempt DESC,id DESC`, [tenantId, outbox.id, userIds]) : [];
    const latest = new Map((existing as Array<Record<string, unknown>>).map((row) => [String(row.recipient_user_id), row]));
    const result: Array<{ deliveryId: string; userId: string; displayName: string; wechatUserId: string }> = [];
    for (const user of users) {
      const userId = String(user.userId); const previous = latest.get(userId); const wechatUserId = String(user.wechatUserId ?? "").trim();
      if (!wechatUserId) {
        if (previous?.status !== "SKIPPED") await this.insertRecipientLog(manager, tenantId, outbox, userId, null, Number(previous?.attempt ?? 0) + 1, "SKIPPED", "SKIPPED_MISSING_WECHAT_ID", "责任人未配置企业微信用户 ID");
        continue;
      }
      if (previous?.status === "SENT" || previous?.status === "SKIPPED") continue;
      if (previous?.status === "PENDING" || previous?.status === "PROCESSING") {
        result.push({ deliveryId: String(previous.id), userId, displayName: String(user.displayName ?? userId), wechatUserId }); continue;
      }
      const row = await this.insertRecipientLog(manager, tenantId, outbox, userId, wechatUserId, Number(previous?.attempt ?? 0) + 1, "PENDING");
      result.push({ deliveryId: String(row.id), userId, displayName: String(user.displayName ?? userId), wechatUserId });
    }
    return result;
  }

  private async insertRecipientLog(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>, userId: string | null, wechatUserId: string | null, attempt: number, status: "PENDING" | "SKIPPED", errcode?: string, errmsg?: string) {
    const rows = await manager.query(`INSERT INTO notification_delivery_logs(
      tenant_id,notification_outbox_id,recipient_user_id,wechat_user_id,attempt,status,errcode,errmsg,error_message,delivered_at)
      VALUES($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,CASE WHEN $6::varchar='SKIPPED' THEN now() ELSE NULL END) RETURNING *`,
    [tenantId, outbox.id, userId, wechatUserId, Math.max(attempt, 1), status, errcode ?? null, errmsg ?? null, errmsg ?? null]);
    return rows[0];
  }

  private async quarantine(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>, workerId: string, code: string, message: string) {
    await manager.query(`UPDATE notification_outbox SET status='FAILED',failed_at=now(),next_retry_at=NULL,last_error=$4,
      locked_at=NULL,locked_by=NULL,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND status='PROCESSING' AND locked_by=$3`, [tenantId, outbox.id, workerId, code]);
    await this.insertRecipientLog(manager, tenantId, outbox, null, null, Number(outbox.attempts ?? 1), "SKIPPED", code, message);
  }

  private async completeWithoutDelivery(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>, workerId: string) {
    await manager.query(`UPDATE notification_outbox SET status='SENT',sent_at=now(),next_retry_at=NULL,last_error=NULL,
      locked_at=NULL,locked_by=NULL,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND status='PROCESSING' AND locked_by=$3`, [tenantId, outbox.id, workerId]);
  }

  private async reconcileOutbox(manager: EntityManager, tenantId: string, outboxId: string, workerId: string) {
    const states = await manager.query("SELECT status,count(*)::int count FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid GROUP BY status", [tenantId, outboxId]) as Array<{ status: string; count: number }>;
    const hasActive = states.some((state) => ["PENDING", "PROCESSING"].includes(state.status) && state.count > 0);
    const hasRetry = states.some((state) => ["RETRY_PENDING", "FAILED"].includes(state.status) && state.count > 0);
    const status = hasActive ? "PROCESSING" : hasRetry ? "FAILED" : "SENT";
    const retryAt = status === "FAILED" ? "now()+LEAST(GREATEST(attempts,1),30)*interval '1 minute'" : "NULL";
    const rows = this.rowsOf(await manager.query(`UPDATE notification_outbox SET status=$4,failed_at=CASE WHEN $4='FAILED' THEN now() ELSE failed_at END,
      sent_at=CASE WHEN $4='SENT' THEN now() ELSE sent_at END,next_retry_at=${retryAt},
      locked_at=CASE WHEN $4='PROCESSING' THEN locked_at ELSE NULL END,locked_by=CASE WHEN $4='PROCESSING' THEN locked_by ELSE NULL END,
      last_error=CASE WHEN $4='FAILED' THEN COALESCE(last_error,'企业微信投递失败') ELSE NULL END,updated_at=now(),version=version+1
      WHERE tenant_id=$1 AND id=$2::uuid AND status='PROCESSING' AND locked_by=$3 RETURNING *`, [tenantId, outboxId, workerId, status]));
    if (!rows[0]) throw new ConflictException("通知任务不存在、已被其他 worker 处理或状态已变化"); return rows[0];
  }

  private async finish(tenantId: string, outboxId: string, workerId: string, status: "SENT", response?: { code?: string; body?: unknown }) {
    return this.withManager(tenantId, undefined, async (manager) => {
      const rows = this.rowsOf(await manager.query(`UPDATE notification_outbox SET status='SENT',sent_at=now(),next_retry_at=NULL,last_error=NULL,
        locked_at=NULL,locked_by=NULL,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND status='PROCESSING' AND locked_by=$3 RETURNING *`, [tenantId, outboxId, workerId]));
      const row = rows[0]; if (!row) throw new ConflictException("通知任务不存在、已被其他 worker 处理或状态已变化");
      await this.insertDeliveryLog(manager, tenantId, row, status, response); return row;
    });
  }

  private async insertDeliveryLog(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>, status: "SENT" | "FAILED", response?: { code?: string; body?: unknown; error?: string }) {
    await manager.query(`INSERT INTO notification_delivery_logs(tenant_id,notification_outbox_id,attempt,status,response_code,response_json,error_message,delivered_at)
      VALUES($1,$2::uuid,$3,$4,$5,$6::jsonb,$7,CASE WHEN $4='SENT' THEN now() ELSE NULL END)`, [tenantId, outbox.id, outbox.attempts, status, response?.code ?? null, response?.body == null ? null : JSON.stringify(response.body), response?.error ?? null]);
  }

  private objectPayload(payload: unknown): Record<string, unknown> {
    const value = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConflictException("通知 payload 无效"); return value as Record<string, unknown>;
  }
  private requiredPayloadText(value: unknown, name: string) { const text = String(value ?? "").trim(); if (!text) throw new ConflictException(`通知 payload 缺少 ${name}`); return text; }
  private renderContent(rule: NotificationRuleRow, payload: Record<string, unknown>) {
    const config = rule.config ?? {};
    if (config.messageType != null && config.messageType !== "text") throw new ConflictException("当前 Dispatcher 只支持文本通知");
    const template = typeof config.template === "string" && config.template.trim() ? config.template : EQUIPMENT_FAULT_TEMPLATE;
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, key: string) => String(payload[key] ?? "—"));
  }
  private async withManager<T>(tenantId: string, manager: EntityManager | undefined, work: (scoped: EntityManager) => Promise<T>) {
    if (manager) { await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]); return work(manager); }
    return this.dataSource.transaction(async (scoped) => { await scoped.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]); return work(scoped); });
  }
  private rowsOf(result: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === "number") return result[0] as Array<Record<string, unknown>>;
    return (result ?? []) as Array<Record<string, unknown>>;
  }
  private normalizeLimit(limit: number) { return Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20; }
  private normalizeTimeout(timeout: number) { return Number.isInteger(timeout) ? Math.max(timeout, 1) : DEFAULT_LOCK_TIMEOUT_SECONDS; }
  private requireTenant(tenantId: string) { this.requireText(tenantId, "tenantId", 64); }
  private requireJobIdentity(tenantId: string, outboxId: string, workerId: string) { this.requireTenant(tenantId); this.requireText(outboxId, "outboxId", 64); this.requireText(workerId, "workerId", 255); }
  private requireText(value: string, name: string, maxLength: number) { if (!String(value ?? "").trim() || String(value).length > maxLength) throw new ConflictException(`${name} 无效`); }
}
