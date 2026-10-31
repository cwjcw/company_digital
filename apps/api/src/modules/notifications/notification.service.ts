import { OrderAllocationDeliveryService } from "./order-allocation.delivery.service";
import { ConflictException, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import {
  EQUIPMENT_RESPONSIBLE_RECIPIENT_RULE,
  FIXED_USERS_RECIPIENT_RULE,
  notificationEventDefinition
} from "./notification-event.registry";
import type {
  NotificationActor,
  NotificationClaim,
  NotificationDeliveryResult,
  NotificationEnqueueResult,
  NotificationEventDefinition,
  NotificationEventInput,
  NotificationOutboxInput,
  NotificationRuleInput,
  NotificationRecipientTarget,
  NotificationFileDelivery,
  NotificationGroupEventComponent
} from "./notification.types";
import { decryptGroupWebhook } from "./group-webhook.crypto";

const MAX_ERROR_LENGTH = 4000;
const DEFAULT_LOCK_TIMEOUT_SECONDS = 300;

type NotificationRuleRow = Record<string, unknown> & {
  id: string;
  resource?: string;
  recipient_rule?: string;
  config?: Record<string, unknown>;
};

@Injectable()
export class NotificationService {
  private financeFiles?: NotificationFileDelivery;
  constructor(private readonly dataSource: DataSource, @Optional() private readonly allocationDelivery?: OrderAllocationDeliveryService) {}

  registerFinanceFiles(handler: NotificationFileDelivery) { this.financeFiles = handler; }
  async financeAttachment(tenantId: string, outboxId: string, attachmentId: string, workerId: string) {
    this.requireJobIdentity(tenantId, outboxId, workerId);
    if (!this.financeFiles) throw new ConflictException("财务附件服务未配置");
    return this.financeFiles.attachment(tenantId, outboxId, attachmentId, workerId);
  }
  configuredRecipientUsers(manager: EntityManager, tenantId: string, targets: NotificationRecipientTarget[]) {
    return this.resolveConfiguredRecipients(manager, targets, tenantId);
  }

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

  /** A trusted internal producer submits one event and ordered text/image components; no webhook is accepted from callers. */
  async enqueueGroupEvent(tenantId: string, input: { eventType: string; dedupKey: string; components: NotificationGroupEventComponent[]; createdBy?: string | null }) {
    this.requireTenant(tenantId);
    const event = notificationEventDefinition(input.eventType);
    if (!event || event.defaultChannel !== "WECHAT_GROUP_WEBHOOK") throw new ConflictException("通知事件未注册群机器人渠道");
    this.requireText(input.dedupKey, "dedupKey", 255);
    if (!Array.isArray(input.components) || input.components.length < 1 || input.components.length > 3 || !["text", "markdown"].includes(input.components[0]?.type)) throw new ConflictException("日报组件顺序无效，必须先发送文字");
    const totalImageBytes = input.components.reduce((sum, component) => sum + (component.type === "image" ? Buffer.from(component.base64, "base64").length : 0), 0);
    if (totalImageBytes > 6 * 1024 * 1024) throw new ConflictException("日报图片总大小不能超过6MB");
    for (const component of input.components) {
      if (component.type === "image") {
        const bytes = Buffer.from(component.base64, "base64");
        if (!component.filename || component.filename.length > 255 || component.mimeType !== "image/png" || bytes.length < 8 || bytes.length > 4 * 1024 * 1024 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new ConflictException("设备日报只接受有效PNG图片（单张不超过4MB）");
      } else if (!component.content.trim() || Buffer.byteLength(component.content, "utf8") > 12000) throw new ConflictException("日报文字内容无效或超长");
    }
    return this.withManager(tenantId, undefined, async manager => {
      const [row] = await manager.query(`INSERT INTO notification_outbox(tenant_id,event_type,channel,dedup_key,payload,created_by,updated_by)
        VALUES($1,$2,'WECHAT_GROUP_WEBHOOK',$3,'{}'::jsonb,$4::uuid,$4::uuid)
        ON CONFLICT(tenant_id,dedup_key) DO NOTHING RETURNING *`, [tenantId, input.eventType, input.dedupKey, input.createdBy ?? null]);
      if (!row) {
        const [existing] = await manager.query("SELECT * FROM notification_outbox WHERE tenant_id=$1 AND dedup_key=$2", [tenantId, input.dedupKey]);
        return { row: existing, created: false };
      }
      for (let index = 0; index < input.components.length; index += 1) {
        const component = input.components[index];
        if (component.type === "image") {
          const bytes = Buffer.from(component.base64, "base64");
          await manager.query(`INSERT INTO notification_event_components(tenant_id,notification_outbox_id,sequence,component_type,filename,mime_type,content,sha256)
            VALUES($1,$2::uuid,$3,'image',$4,'image/png',$5,$6)`, [tenantId, row.id, index + 1, component.filename, bytes, createHash("sha256").update(bytes).digest("hex")]);
        } else await manager.query(`INSERT INTO notification_event_components(tenant_id,notification_outbox_id,sequence,component_type,content_text)
          VALUES($1,$2::uuid,$3,$4,$5)`, [tenantId, row.id, index + 1, component.type, component.content]);
      }
      return { row, created: true };
    });
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
        if (outbox.event_type === "notification.group_webhook.test") {
          const directClaims=await this.prepareDirectGroupWebhookTest(manager, tenantId, outbox);
          claims.push(...directClaims);
          if (!directClaims.length) await this.quarantine(manager, tenantId, outbox, workerId, "GROUP_WEBHOOK_TEST_TARGET_MISSING", "群机器人测试目标不可用");
          continue;
        }
        const eventDefinition = notificationEventDefinition(String(outbox.event_type ?? ""));
        if (!eventDefinition) {
          await this.quarantine(manager, tenantId, outbox, workerId, "UNREGISTERED_NOTIFICATION_EVENT", "通知事件未在 Notification Event Registry 注册");
          continue;
        }
        const rule = await this.resolveRule(manager, tenantId, outbox);
        if (rule && rule.resource !== eventDefinition.resourceCode) {
          await this.quarantine(manager, tenantId, outbox, workerId, "NOTIFICATION_EVENT_RESOURCE_MISMATCH", "通知规则资源与注册事件资源不一致");
          continue;
        }
        const recipientRule = String(rule?.recipient_rule ?? "");
        if (rule && !eventDefinition.allowedRecipientRules.includes(recipientRule)) {
          await this.quarantine(manager, tenantId, outbox, workerId, "UNSUPPORTED_RECIPIENT_RULE", "通知事件不允许使用该接收人规则");
          continue;
        }
        const groupClaims = eventDefinition.defaultChannel === "WECHAT_GROUP_WEBHOOK"
          ? await this.prepareGroupWebhookClaims(manager, tenantId, outbox)
          : [];
        if (!rule && !groupClaims.length) {
          await this.quarantine(manager, tenantId, outbox, workerId, "NO_MATCHING_RULE", "没有匹配的启用通知规则或消息路由");
          continue;
        }
        if (rule && eventDefinition.eventType === "mps.order_allocation.batch_changed") {
          if (!this.allocationDelivery) throw new ConflictException("订单分配通知投递器未配置");
          await manager.query("SAVEPOINT allocation_delivery");
          try { claims.push(...await this.allocationDelivery.prepare(manager,tenantId,outbox,workerId)); }
          catch { await manager.query("ROLLBACK TO SAVEPOINT allocation_delivery"); await this.quarantine(manager,tenantId,outbox,workerId,"ALLOCATION_DELIVERY_PREPARATION_FAILED","订单分配通知快照或附件准备失败，请复核并重试"); }
          await manager.query("RELEASE SAVEPOINT allocation_delivery");
          continue;
        }
        const payload = this.objectPayload(outbox.payload);
        const users = rule ? await this.resolveRecipients(manager, tenantId, rule, eventDefinition, payload) : [];
        if (rule && eventDefinition.eventType === "finance.monthly.daily_summary" && payload.financeReportFormat === 1) {
          await manager.query("SAVEPOINT finance_file_delivery");
          try {
            if (!this.financeFiles) throw new ConflictException("财务附件服务未配置");
            claims.push(...await this.financeFiles.prepare(manager, tenantId, outbox, workerId, users, value => this.renderContent(rule, eventDefinition, value)));
          } catch {
            await manager.query("ROLLBACK TO SAVEPOINT finance_file_delivery");
            await this.quarantine(manager, tenantId, outbox, workerId, "FINANCE_MONTHLY_ATTACHMENT_FAILED", "财务月度附件准备失败，请查看规则、接收人导出权限并重试");
          }
          await manager.query("RELEASE SAVEPOINT finance_file_delivery");
          continue;
        }
        const deliveryRecipients = await this.prepareRecipientDeliveries(manager, tenantId, outbox, users);
        await manager.query(`
          UPDATE notification_outbox SET notification_rule_id=COALESCE($3::uuid,notification_rule_id),updated_at=now(),version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND status='PROCESSING' AND locked_by=$4`, [tenantId, outbox.id, rule?.id ?? null, workerId]);
        if (!deliveryRecipients.length && !groupClaims.length) {
          await this.completeWithoutDelivery(manager, tenantId, outbox, workerId);
          continue;
        }
        if (deliveryRecipients.length && rule) claims.push({ notificationId: String(outbox.id), messageType: eventDefinition.eventType === "finance.monthly.daily_summary" ? "text" : eventDefinition.messageType, content: this.renderContent(rule, eventDefinition, payload), recipients: deliveryRecipients });
        claims.push(...groupClaims);
      }
      return claims;
    });
  }

  async groupImageAttachment(tenantId: string, outboxId: string, componentId: string, workerId: string) {
    this.requireJobIdentity(tenantId, outboxId, workerId);
    return this.withManager(tenantId, undefined, async manager => {
      const [row] = await manager.query(`SELECT c.filename,c.mime_type,c.content FROM notification_event_components c
        JOIN notification_outbox o ON o.tenant_id=c.tenant_id AND o.id=c.notification_outbox_id
        JOIN notification_delivery_logs d ON d.tenant_id=o.tenant_id AND d.notification_outbox_id=o.id
          AND d.target_type='WECHAT_GROUP_WEBHOOK' AND d.status IN ('PENDING','PROCESSING')
        WHERE c.tenant_id=$1 AND o.id=$2::uuid AND c.id=$3::uuid AND c.component_type='image'
          AND o.status='PROCESSING' AND o.locked_by=$4`, [tenantId, outboxId, componentId, workerId]);
      if (!row) throw new ConflictException("群机器人图片不存在或投递租约已失效");
      return { filename: row.filename, mimeType: row.mime_type, content: row.content as Buffer };
    });
  }

  async markDeliverySuccess(tenantId: string, outboxId: string, workerId: string, result: NotificationDeliveryResult) {
    this.requireJobIdentity(tenantId, outboxId, workerId); this.requireText(result.deliveryId, "deliveryId", 64);
    return this.withManager(tenantId, undefined, async (manager) => {
      const rows = this.rowsOf(await manager.query(`
        UPDATE notification_delivery_logs AS delivery SET
          status='SENT',response_code=$5,response_json=NULL,error_message=NULL,
          errcode=$5,errmsg=$6,provider_message_id=$7,delivered_at=now()
        FROM notification_outbox AS outbox
        WHERE delivery.tenant_id=$1 AND delivery.notification_outbox_id=outbox.id
          AND outbox.tenant_id=$1 AND outbox.id=$2::uuid AND outbox.status='PROCESSING' AND outbox.locked_by=$3
          AND delivery.id=$4::uuid
          AND delivery.status IN ('PENDING','PROCESSING')
        RETURNING outbox.*`, [tenantId, outboxId, workerId, result.deliveryId, result.errcode ?? null, result.errmsg ?? null, result.providerMessageId ?? null]));
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
        WHERE delivery.tenant_id=$1 AND delivery.notification_outbox_id=outbox.id
          AND outbox.tenant_id=$1 AND outbox.id=$2::uuid AND outbox.status='PROCESSING' AND outbox.locked_by=$3
         AND delivery.id=$4::uuid
         AND delivery.status IN ('PENDING','PROCESSING')
        RETURNING outbox.*`, [tenantId, outboxId, workerId, result.deliveryId, result.errcode ?? null, error, result.errcode ?? null, result.errmsg ?? error, result.providerMessageId ?? null]));
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
      ? await manager.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND id=$2::uuid AND (enabled=true OR $3::boolean)", [tenantId, outbox.notification_rule_id, outbox.event_type === "mps.order_allocation.batch_changed" && (outbox.payload as Record<string,unknown>)?.deliveryMode === "TEST"])
      : await manager.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND event_type=$2 AND channel=$3 AND enabled=true ORDER BY updated_at DESC,id DESC LIMIT 1", [tenantId, outbox.event_type, outbox.channel]);
    return (rows ?? [])[0] ?? null;
  }

  private async prepareGroupWebhookClaims(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>): Promise<NotificationClaim[]> {
    const targets = (await manager.query(`SELECT w.id,w.group_name,w.webhook_ciphertext FROM notification_routes r
      JOIN notification_route_targets t ON t.tenant_id=r.tenant_id AND t.route_id=r.id AND t.enabled=true
      JOIN notification_group_webhooks w ON w.tenant_id=t.tenant_id AND w.id=t.target_id AND w.enabled=true
      WHERE r.tenant_id=$1 AND r.event_type=$2 AND r.enabled=true ORDER BY w.group_name,w.id`, [tenantId, outbox.event_type]) ?? []) as Array<Record<string, unknown>>;
    if (!targets.length) return [];
    const components = await manager.query(`SELECT id,sequence,component_type,content_text,filename FROM notification_event_components
      WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid ORDER BY sequence,id`, [tenantId, outbox.id]) as Array<Record<string, unknown>>;
    if (!components.length) throw new ConflictException("群消息没有内容组件");
    const claims: NotificationClaim[] = [];
    for (const component of components) {
      const componentKey = `group_${String(component.component_type)}`;
      const recipients: NotificationClaim["recipients"] = [];
      for (const target of targets) {
        const [previous] = await manager.query(`SELECT id,attempt,status FROM notification_delivery_logs
          WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND target_type='WECHAT_GROUP_WEBHOOK' AND target_id=$3::uuid AND component=$4
          ORDER BY attempt DESC,id DESC LIMIT 1`, [tenantId, outbox.id, target.id, componentKey]);
        if (previous?.status === "SENT" || previous?.status === "SKIPPED") continue;
        const webhookUrl = decryptGroupWebhook(String(target.webhook_ciphertext));
        let delivery = previous;
        if (!delivery || !["PENDING", "PROCESSING"].includes(String(delivery.status))) {
          [delivery] = await manager.query(`INSERT INTO notification_delivery_logs(tenant_id,notification_outbox_id,attempt,status,component,target_type,target_id,target_name)
            VALUES($1,$2::uuid,$3,'PENDING',$4,'WECHAT_GROUP_WEBHOOK',$5::uuid,$6) RETURNING id,attempt,status`, [tenantId, outbox.id, Number(previous?.attempt ?? 0) + 1, componentKey, target.id, target.group_name]);
        }
        recipients.push({ deliveryId: String(delivery.id), userId: "", displayName: String(target.group_name), targetType: "WECHAT_GROUP_WEBHOOK", targetId: String(target.id), targetName: String(target.group_name), webhookUrl });
      }
      if (!recipients.length) continue;
      const messageType = (String(component.component_type) === "image" ? "group_image" : `group_${String(component.component_type)}`) as NotificationClaim["messageType"];
      claims.push({ notificationId: String(outbox.id), messageType, content: String(component.content_text ?? ""), recipients,
        ...(component.component_type === "image" ? { attachment: { id: String(component.id), filename: String(component.filename), mimeType: "image/png", downloadPath: `/internal/notifications/${outbox.id}/group-attachments/${component.id}` } } : {}) });
    }
    return claims;
  }

  private async prepareDirectGroupWebhookTest(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>): Promise<NotificationClaim[]> {
    const payload = this.objectPayload(outbox.payload);
    const [target] = await manager.query("SELECT id,group_name,webhook_ciphertext FROM notification_group_webhooks WHERE tenant_id=$1 AND id=$2::uuid AND enabled=true", [tenantId, payload.groupWebhookId]);
    if (!target) return [];
    const [previous] = await manager.query(`SELECT id,attempt,status FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid
      AND target_type='WECHAT_GROUP_WEBHOOK' AND target_id=$3::uuid AND component='test_text' ORDER BY attempt DESC,id DESC LIMIT 1`, [tenantId, outbox.id, target.id]);
    if (previous?.status === "SENT") return [];
    let delivery = previous;
    if (!delivery || !["PENDING", "PROCESSING"].includes(String(delivery.status))) {
      [delivery] = await manager.query(`INSERT INTO notification_delivery_logs(tenant_id,notification_outbox_id,attempt,status,component,target_type,target_id,target_name)
        VALUES($1,$2::uuid,$3,'PENDING','test_text','WECHAT_GROUP_WEBHOOK',$4::uuid,$5) RETURNING id,status`, [tenantId, outbox.id, Number(previous?.attempt ?? 0) + 1, target.id, target.group_name]);
    }
    return [{ notificationId: String(outbox.id), messageType: "group_text", content: String(payload.content ?? "【KDOS测试消息】企业微信群机器人连接正常。"), recipients: [{
      deliveryId: String(delivery.id), userId: "", displayName: String(target.group_name), targetType: "WECHAT_GROUP_WEBHOOK", targetId: String(target.id), targetName: String(target.group_name), webhookUrl: decryptGroupWebhook(String(target.webhook_ciphertext))
    }] }];
  }

  private async resolveRecipients(manager: EntityManager, tenantId: string, rule: NotificationRuleRow, eventDefinition: NotificationEventDefinition, payload: Record<string, unknown>) {
    const recipientRule = String(rule.recipient_rule ?? "");
    if (!eventDefinition.allowedRecipientRules.includes(recipientRule)) throw new ConflictException("通知事件不允许使用该接收人规则");
    if (recipientRule === EQUIPMENT_RESPONSIBLE_RECIPIENT_RULE) return this.resolveEquipmentResponsible(manager, tenantId, payload);
    if (recipientRule === FIXED_USERS_RECIPIENT_RULE) return this.resolveConfiguredRecipients(manager, this.recipientTargets(rule.config), tenantId);
    throw new ConflictException("通知接收人解析器未实现");
  }

  private async resolveEquipmentResponsible(manager: EntityManager, tenantId: string, payload: Record<string, unknown>) {
    const equipmentId = this.requiredPayloadText(payload.equipmentId, "equipmentId");
    return manager.query(`
      SELECT DISTINCT u.id "userId",COALESCE(NULLIF(u.display_name,''),u.username) "displayName",u.wechat_user_id "wechatUserId",u.enabled "enabled"
      FROM equipment_responsibles er JOIN users u ON u.id=er.user_id
      WHERE er.tenant_id=$1 AND er.equipment_id=$2::uuid
      ORDER BY u.id`, [tenantId, equipmentId]) as Promise<Array<Record<string, unknown>>>;
  }

  /**
   * 管理端只读校验，复用正式接收人解析；不入队、不创建投递记录。
   * 兼容目录中的组织/角色为共享对象，最终成员仍限定当前租户。
   */
  async previewConfiguredRecipients(manager: EntityManager, tenantId: string, targets: NotificationRecipientTarget[]) {
    const users = await this.resolveConfiguredRecipients(manager, targets, tenantId);
    return {
      total: users.length,
      deliverable: users.filter((user) => user.enabled === true && String(user.wechatUserId ?? "").trim()).length,
      disabled: users.filter((user) => user.enabled !== true).length,
      missingWechatId: users.filter((user) => user.enabled === true && !String(user.wechatUserId ?? "").trim()).length
    };
  }

  /**
   * 按角色授权页的动态语义解析组织、角色和员工：
   * - 组织按稳定 organizationUnitId 解析当前节点或完整子树；
   * - 角色包含直接角色成员和角色授权组织范围内的当前成员；
   * - 最终只返回去重后的 users.id，名称仅作为展示字段。
   */
  private async resolveConfiguredRecipients(manager: EntityManager, targets: NotificationRecipientTarget[], tenantId: string) {
    if (!targets.length) return [];
    const userIds = targets.filter((target) => target.type === "USER").map((target) => target.userId);
    const roleIds = targets.filter((target) => target.type === "ROLE").map((target) => target.roleId);
    const organizationTargets = targets.filter((target): target is Extract<NotificationRecipientTarget, { type: "ORGANIZATION" }> => target.type === "ORGANIZATION");
    if (!roleIds.length && !organizationTargets.length) {
      return manager.query(`SELECT u.id "userId",COALESCE(NULLIF(u.display_name,''),u.username) "displayName",u.wechat_user_id "wechatUserId",u.enabled "enabled"
        FROM users u WHERE u.id=ANY($1::uuid[]) AND u.tenant_id=$2 ORDER BY u.id`, [userIds, tenantId]) as Promise<Array<Record<string, unknown>>>;
    }
    const organizations = await manager.query("SELECT id,parent_id,name,enabled FROM organization_units WHERE enabled=true ORDER BY id") as Array<Record<string, unknown>>;
    const byId = new Map(organizations.map((unit) => [String(unit.id), unit]));
    const pathOf = (id: string) => {
      const path: string[] = []; const seen = new Set<string>(); let current = byId.get(id);
      while (current && !seen.has(String(current.id))) { seen.add(String(current.id)); path.unshift(String(current.name)); current = current.parent_id ? byId.get(String(current.parent_id)) : undefined; }
      return path;
    };
    const unitPaths = (unitIds: string[], includeDescendants: boolean) => unitIds.flatMap((unitId) => {
      const selectedPath = pathOf(unitId); if (!selectedPath.length) return [];
      return organizations.filter((unit) => {
        const candidatePath = pathOf(String(unit.id));
        return candidatePath.length === selectedPath.length && candidatePath.every((part, index) => part === selectedPath[index]) || includeDescendants && candidatePath.length > selectedPath.length && selectedPath.every((part, index) => part === candidatePath[index]);
      }).map((unit) => pathOf(String(unit.id)));
    });
    const explicitOrganizationPaths = organizationTargets.flatMap((target) => unitPaths([target.organizationUnitId], target.includeDescendants));
    const roleOrganizationRows = roleIds.length ? await manager.query("SELECT organization_unit_id FROM role_organization_scopes WHERE role_id=ANY($1::uuid[])", [roleIds]) as Array<{ organization_unit_id: string }> : [];
    const roleOrganizationPaths = unitPaths(roleOrganizationRows.map((row) => String(row.organization_unit_id)), true);
    const paths = [...new Map([...explicitOrganizationPaths, ...roleOrganizationPaths].map((path) => [path.join("\u001f"), path])).values()];
    const params: unknown[] = [userIds, roleIds, tenantId];
    const predicates = ["u.id=ANY($1::uuid[])", "EXISTS (SELECT 1 FROM user_roles direct_role WHERE direct_role.user_id=u.id AND direct_role.role_id=ANY($2::uuid[]))"];
    for (const path of paths) { params.push(JSON.stringify([path])); predicates.push(`u.department_paths @> $${params.length}::jsonb`); }
    return manager.query(`SELECT DISTINCT u.id "userId",COALESCE(NULLIF(u.display_name,''),u.username) "displayName",u.wechat_user_id "wechatUserId",u.enabled "enabled"
      FROM users u WHERE u.tenant_id=$3 AND (${predicates.join(" OR ")}) ORDER BY u.id`, params) as Promise<Array<Record<string, unknown>>>;
  }

  private recipientTargets(config: Record<string, unknown> | undefined): NotificationRecipientTarget[] {
    const configured = config?.recipientTargets;
    if (Array.isArray(configured)) return configured as NotificationRecipientTarget[];
    const legacy = config?.recipientUserIds;
    return Array.isArray(legacy) ? legacy.map((userId) => ({ type: "USER", userId: String(userId) })) : [];
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
      if (user.enabled === false) {
        if (previous?.status !== "SKIPPED") await this.insertRecipientLog(manager, tenantId, outbox, userId, wechatUserId || null, Number(previous?.attempt ?? 0) + 1, "SKIPPED", "SKIPPED_DISABLED", "该用户当前处于禁用状态");
        continue;
      }
      if (!wechatUserId) {
        if (previous?.status !== "SKIPPED") await this.insertRecipientLog(manager, tenantId, outbox, userId, null, Number(previous?.attempt ?? 0) + 1, "SKIPPED", "SKIPPED_MISSING_WECHAT_ID", "接收人未配置企业微信 UserId");
        continue;
      }
      if (previous?.status === "SENT") continue;
      if (previous?.status === "PENDING" || previous?.status === "PROCESSING") {
        result.push({ deliveryId: String(previous.id), userId, displayName: String(user.displayName ?? userId), wechatUserId });
        continue;
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
    const states = await manager.query("SELECT status,component,count(*)::int count FROM (SELECT DISTINCT ON (COALESCE(target_type,'USER'),COALESCE(target_id::text,recipient_user_id::text),component) status,component FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid ORDER BY COALESCE(target_type,'USER'),COALESCE(target_id::text,recipient_user_id::text),component,attempt DESC,id DESC) latest GROUP BY status,component", [tenantId, outboxId]) as Array<{ status: string; component?: string; count: number }>;
    const hasActive = states.some((state) => ["PENDING", "PROCESSING"].includes(state.status) && state.count > 0);
    const hasRetry = states.some((state) => state.component !== "routing" && ["RETRY_PENDING", "FAILED"].includes(state.status) && state.count > 0);
    const hasRoutingError = states.some(state => state.component === "routing" && state.status === "FAILED");
    const status = hasActive ? "PROCESSING" : hasRetry || hasRoutingError ? "FAILED" : "SENT";
    const retryAt = status === "FAILED" && hasRetry ? "now()+LEAST(GREATEST(attempts,1),30)*interval '1 minute'" : "NULL";
    const rows = this.rowsOf(await manager.query(`UPDATE notification_outbox SET status=$4::varchar,failed_at=CASE WHEN $4::varchar='FAILED' THEN now() ELSE failed_at END,
      sent_at=CASE WHEN $4::varchar='SENT' THEN now() ELSE sent_at END,next_retry_at=${retryAt},
      locked_at=CASE WHEN $4::varchar='PROCESSING' THEN now() ELSE NULL END,locked_by=CASE WHEN $4::varchar='PROCESSING' THEN locked_by ELSE NULL END,
      last_error=CASE WHEN $4::varchar='FAILED' THEN COALESCE(last_error,'企业微信投递失败') ELSE NULL END,updated_at=now(),version=version+1
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
  private renderContent(rule: NotificationRuleRow, eventDefinition: NotificationEventDefinition, payload: Record<string, unknown>) {
    const config = rule.config ?? {};
    const legacyFinanceText = eventDefinition.eventType === "finance.monthly.daily_summary" && config.messageType === "text";
    if (config.messageType != null && config.messageType !== eventDefinition.messageType && !legacyFinanceText) throw new ConflictException("当前 Dispatcher 只支持文本通知");
    const template = typeof config.template === "string" && config.template.trim() ? config.template : eventDefinition.defaultTemplate;
    return template.replace(/\{\{?([A-Za-z][A-Za-z0-9_]*)\}\}?/g, (_match, key: string) => String(payload[key] ?? "—"));
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
