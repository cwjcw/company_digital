import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { tableResourceRegistry } from "@kdos/contracts";
import { NotificationService } from "./notification.service";

export type NotificationAdminActor = {
  tenantId: string;
  userId: string | null;
  name: string;
  username: string;
  requestId: string;
  isSystemAdmin: boolean;
  moduleAdminCodes: string[];
};

export const NOTIFICATION_TEST_MODE_MESSAGE = "当前处于企业微信测试模式，实际企业微信消息仅发送给崔玮杰。";
const CHANNEL = "WECHAT_WORK";
const RECIPIENT = "EQUIPMENT_RESPONSIBLE";
const EVENT = {
  eventType: "equipment.status.fault_changed",
  label: "设备故障变化",
  condition: "faultMinutes 从旧值变化为新值且新值大于 0",
  resource: "equipment-status-report",
  moduleCode: "planning",
  recipientRules: [RECIPIENT],
  variables: [
    "equipmentId", "equipmentCode", "equipmentName", "divisionId", "divisionName",
    "oldFaultMinutes", "newFaultMinutes", "faultReason", "actorUserId", "actorName", "occurredAt"
  ]
} as const;
const EVENTS = [EVENT];
const resourceLabel = (code: string) => tableResourceRegistry.find((resource) => resource.code === code)?.label ?? code;

@Injectable()
export class NotificationAdminService {
  constructor(private readonly dataSource: DataSource, private readonly notifications: NotificationService) {}

  availableEvents(actor: NotificationAdminActor) {
    this.assertAnyAccess(actor);
    return EVENTS.filter((event) => this.canManageResource(actor, event.resource)).map((event) => ({
      ...event, module: "PMC中心", resourceLabel: resourceLabel(event.resource), channel: CHANNEL,
      channelLabel: "企业微信工作通知", recipientLabels: { [RECIPIENT]: "设备责任人" },
      templateVariables: event.variables.map((key) => ({ key, label: this.variableLabel(key) }))
    }));
  }

  templateVariables(actor: NotificationAdminActor, eventType: string) {
    const event = this.event(eventType); this.assertResourceAccess(actor, event.resource);
    return event.variables.map((key) => ({ key, label: this.variableLabel(key) }));
  }

  async listRules(actor: NotificationAdminActor, query: Record<string, unknown> = {}) {
    this.assertAnyAccess(actor);
    const values: unknown[] = [actor.tenantId];
    const where = ["r.tenant_id=$1"];
    this.scopeWhere(actor, where, values, "r");
    for (const [column, input] of [["module_code", query.module], ["resource", query.resource], ["event_type", query.eventType]] as Array<[string, unknown]>) {
      const text = String(input ?? "").trim(); if (!text) continue; values.push(text); where.push(`r.${column}=$${values.length}`);
    }
    if (query.status === "enabled" || query.status === "disabled") { values.push(query.status === "enabled"); where.push(`r.enabled=$${values.length}`); }
    const rows = await this.dataSource.query(`
      SELECT r.*, COALESCE(last_log.latest_send_at,NULL) latest_send_at
      FROM notification_rules r
      LEFT JOIN LATERAL (
        SELECT max(l.created_at) latest_send_at FROM notification_delivery_logs l
        JOIN notification_outbox o ON o.tenant_id=l.tenant_id AND o.id=l.notification_outbox_id
        WHERE l.tenant_id=r.tenant_id AND o.notification_rule_id=r.id
      ) last_log ON true
      WHERE ${where.join(" AND ")} ORDER BY r.updated_at DESC,r.id DESC`, values);
    return rows.map((row: Record<string, unknown>) => this.ruleView(row));
  }

  async detail(actor: NotificationAdminActor, id: string) {
    const [row] = await this.dataSource.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND id=$2::uuid", [actor.tenantId, id]);
    if (!row) throw new NotFoundException("消息规则不存在");
    this.assertResourceAccess(actor, String(row.resource));
    return this.ruleView(row);
  }

  async create(actor: NotificationAdminActor, body: Record<string, unknown>) {
    const input = this.validRule(body);
    this.assertResourceAccess(actor, input.resource);
    const ruleKey = String(body.ruleKey ?? `notification:${input.eventType}:${randomUUID()}`).trim();
    if (!ruleKey || ruleKey.length > 128) throw new BadRequestException("规则编码无效");
    return this.write(actor, async (manager) => {
      const rows = await manager.query(`INSERT INTO notification_rules(tenant_id,rule_key,name,event_type,channel,module_code,resource,recipient_rule,enabled,config,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::uuid,$11::uuid) RETURNING *`,
      [actor.tenantId, ruleKey, input.name, input.eventType, CHANNEL, EVENT.moduleCode, input.resource, RECIPIENT, input.enabled, JSON.stringify(input.config), actor.userId]);
      const row = rows[0]; await this.audit(manager, actor, row.id, "notification_rule.created", null, row); return this.ruleView(row);
    });
  }

  async update(actor: NotificationAdminActor, id: string, body: Record<string, unknown>) {
    return this.write(actor, async (manager) => {
      const [current] = await manager.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [actor.tenantId, id]);
      if (!current) throw new NotFoundException("消息规则不存在");
      this.assertResourceAccess(actor, String(current.resource));
      if (body.expectedVersion != null && Number(body.expectedVersion) !== Number(current.version)) throw new ConflictException("规则已被其他用户修改，请刷新后重试");
      const input = this.validRule({ ...current, ...body, resource: body.resource ?? current.resource, eventType: body.eventType ?? current.event_type, name: body.name ?? current.name, enabled: body.enabled ?? current.enabled, template: body.template ?? current.config?.template });
      this.assertResourceAccess(actor, input.resource);
      const rows = await manager.query(`UPDATE notification_rules SET name=$3,event_type=$4,module_code=$5,resource=$6,recipient_rule=$7,enabled=$8,config=$9::jsonb,updated_by=$10::uuid,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$11 RETURNING *`,
      [actor.tenantId, id, input.name, input.eventType, EVENT.moduleCode, input.resource, RECIPIENT, input.enabled, JSON.stringify(input.config), actor.userId, Number(current.version)]);
      const row = this.rowsOf(rows)[0]; if (!row) throw new ConflictException("规则已被其他用户修改，请刷新后重试");
      await this.audit(manager, actor, id, "notification_rule.updated", current, row); return this.ruleView(row);
    });
  }

  async toggle(actor: NotificationAdminActor, id: string, enabled: boolean, expectedVersion?: number) {
    return this.update(actor, id, { enabled, expectedVersion });
  }

  async logs(actor: NotificationAdminActor, query: Record<string, unknown>, failures = false) {
    this.assertAnyAccess(actor);
    const values: unknown[] = [actor.tenantId]; const where = ["l.tenant_id=$1"];
    this.scopeWhere(actor, where, values, "r");
    if (failures) where.push("(l.status='SKIPPED' OR l.status IN ('FAILED','RETRY_PENDING'))");
    for (const [column, input] of [["r.id", query.ruleId], ["r.resource", query.resource], ["l.status", query.status]] as Array<[string, unknown]>) {
      const text = String(input ?? "").trim(); if (!text) continue; values.push(text); where.push(`${column}=$${values.length}`);
    }
    const recipient = String(query.recipient ?? "").trim(); if (recipient) { values.push(`%${recipient}%`); where.push("(COALESCE(l.wechat_user_id,'') ILIKE $" + values.length + " OR COALESCE(l.recipient_user_id::text,'') ILIKE $" + values.length + ")"); }
    const from = String(query.from ?? "").trim(); if (from) { values.push(from); where.push(`l.created_at >= $${values.length}::timestamptz`); }
    const to = String(query.to ?? "").trim(); if (to) { values.push(to); where.push(`l.created_at < ($${values.length}::date + interval '1 day')`); }
    const rows = await this.dataSource.query(`SELECT l.id,l.created_at,l.attempt,l.status,l.recipient_user_id,l.wechat_user_id,l.errcode,l.errmsg,l.error_message,l.provider_message_id,
      COALESCE(NULLIF(u.display_name,''),u.username,l.recipient_user_id::text) actual_recipient,
      r.id rule_id,r.name rule_name,r.module_code,r.resource,r.event_type,o.id outbox_id,o.payload,o.status outbox_status
      FROM notification_delivery_logs l JOIN notification_outbox o ON o.tenant_id=l.tenant_id AND o.id=l.notification_outbox_id
      LEFT JOIN notification_rules r ON r.tenant_id=o.tenant_id AND r.id=o.notification_rule_id
      LEFT JOIN users u ON u.id=l.recipient_user_id
      WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC LIMIT 500`, values);
    return rows.map((row: Record<string, unknown>) => this.logView(row));
  }

  async retry(actor: NotificationAdminActor, outboxId: string) {
    return this.write(actor, async (manager) => {
      const [row] = await manager.query(`SELECT o.*,r.resource FROM notification_outbox o LEFT JOIN notification_rules r ON r.tenant_id=o.tenant_id AND r.id=o.notification_rule_id WHERE o.tenant_id=$1 AND o.id=$2::uuid`, [actor.tenantId, outboxId]);
      if (!row) throw new NotFoundException("通知任务不存在"); this.assertResourceAccess(actor, String(row.resource ?? EVENT.resource));
      const skipped = await manager.query("SELECT errcode,errmsg FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND status='SKIPPED'", [actor.tenantId, outboxId]);
      if (skipped.some((entry: Record<string, unknown>) => ["SKIPPED_MISSING_WECHAT_ID", "SKIPPED_DISABLED"].includes(String(entry.errcode)))) throw new ConflictException("缺少企业微信 UserId 或用户处于禁用状态，不能重试");
      const updated = this.rowsOf(await manager.query("UPDATE notification_outbox SET status='PENDING',next_retry_at=now(),last_error=NULL,failed_at=NULL,locked_at=NULL,locked_by=NULL,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND status='FAILED' RETURNING *", [actor.tenantId, outboxId]))[0];
      if (!updated) throw new ConflictException("只有 FAILED/RETRY_PENDING 通知可以重试");
      await this.audit(manager, actor, outboxId, "notification.retry_requested", row, updated); return { id: outboxId, status: "PENDING" };
    });
  }

  async testSend(actor: NotificationAdminActor, id: string, body: Record<string, unknown>) {
    const rule = await this.detail(actor, id); const event = this.event(String(rule.eventType));
    const payload = body.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new BadRequestException("测试发送需要提供事件 payload");
    const allowed = new Set<string>(event.variables); for (const key of Object.keys(payload as Record<string, unknown>)) if (!allowed.has(key)) throw new BadRequestException(`测试 payload 包含未授权变量：${key}`);
    const result = await this.notifications.enqueueEvent(actor.tenantId, { eventType: event.eventType, channel: CHANNEL, dedupKey: `test:${id}:${randomUUID()}`, payload: payload as Record<string, unknown>, createdBy: actor.userId });
    await this.dataSource.query("INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by) VALUES($1::uuid,$2,'notification_rules',$3::uuid,'notification.test_requested',$4::jsonb,$5,'web',$1::uuid,$1::uuid)", [actor.userId, actor.name, id, JSON.stringify({ testMode: true, outboxId: result.row.id }), actor.requestId]);
    return { ...result, testMode: true, message: NOTIFICATION_TEST_MODE_MESSAGE };
  }

  private validRule(body: Record<string, unknown>) {
    const eventType = String(body.eventType ?? "").trim(); const event = this.event(eventType);
    const name = String(body.name ?? "").trim(); if (!name || name.length > 255) throw new BadRequestException("请输入规则名称");
    const resource = String(body.resource ?? event.resource).trim(); if (resource !== event.resource) throw new BadRequestException("资源与通知事件不匹配");
    const template = String(body.template ?? (body.config as Record<string, unknown> | undefined)?.template ?? "").trim();
    const configTemplate = template ? this.normalizeTemplate(template, event.variables) : undefined;
    return { name, eventType, resource, enabled: body.enabled !== false, config: { messageType: "text", ...((body.config as Record<string, unknown> | undefined) ?? {}), ...(configTemplate ? { template: configTemplate } : {}) } };
  }

  private normalizeTemplate(template: string, variables: readonly string[]) {
    if (template.length > 4000) throw new BadRequestException("消息模板不能超过 4000 个字符");
    const allowed = new Set<string>(variables); return template.replace(/\{\{?([A-Za-z][A-Za-z0-9_]*)\}\}?/g, (whole, key: string) => {
      if (!allowed.has(key)) throw new BadRequestException(`消息模板包含未授权变量：${key}`); return `{${key}}`;
    });
  }

  private event(eventType: string) { const event = EVENTS.find((candidate) => candidate.eventType === eventType); if (!event) throw new BadRequestException("当前数据表暂未注册可用的实时通知事件。"); return event; }
  private canManageResource(actor: NotificationAdminActor, resource: string) { const entry = tableResourceRegistry.find((item) => item.code === resource); return Boolean(entry && (actor.isSystemAdmin || actor.moduleAdminCodes.includes(entry.moduleCode))); }
  private assertResourceAccess(actor: NotificationAdminActor, resource: string) { if (!this.canManageResource(actor, resource)) throw new ForbiddenException("当前管理员无权管理该模块的消息规则"); }
  private assertAnyAccess(actor: NotificationAdminActor) { if (!actor.isSystemAdmin && !actor.moduleAdminCodes.length) throw new ForbiddenException("仅系统管理员或模块管理员可以访问消息中心"); }
  private scopeWhere(actor: NotificationAdminActor, where: string[], values: unknown[], alias: string) { if (!actor.isSystemAdmin) { values.push(actor.moduleAdminCodes); where.push(`${alias}.module_code = ANY($${values.length}::varchar[])`); } }
  private variableLabel(key: string) { return ({ equipmentId: "设备 ID", equipmentCode: "设备编号", equipmentName: "设备名称", divisionId: "事业部 ID", divisionName: "事业部", oldFaultMinutes: "原故障时长", newFaultMinutes: "新故障时长", faultReason: "故障原因", actorUserId: "填报人 ID", actorName: "填报人", occurredAt: "发生时间" } as Record<string, string>)[key] ?? key; }
  private ruleView(row: Record<string, unknown>) { return { id: row.id, ruleKey: row.rule_key, name: row.name, eventType: row.event_type, channel: row.channel, channelLabel: "企业微信工作通知", moduleCode: row.module_code, module: "PMC中心", resource: row.resource, resourceLabel: resourceLabel(String(row.resource)), recipientRule: row.recipient_rule, recipientLabel: "设备责任人", condition: EVENT.condition, enabled: row.enabled, config: row.config, latestSendAt: row.latest_send_at ?? null, version: row.version }; }
  private logView(row: Record<string, unknown>) { const status = row.status === "SKIPPED" ? String(row.errcode ?? "SKIPPED") : row.status; return { id: row.id, sendTime: row.created_at, ruleId: row.rule_id, ruleName: row.rule_name ?? "—", module: "PMC中心", resource: row.resource ?? EVENT.resource, eventType: row.event_type, originalRecipient: "设备责任人", actualRecipient: row.actual_recipient ?? row.recipient_user_id ?? "—", wechatUserId: row.wechat_user_id ?? "—", status, retryCount: row.attempt, providerMessageId: row.provider_message_id ?? null, failureReason: row.error_message ?? row.errmsg ?? null, outboxId: row.outbox_id }; }
  private async write<T>(actor: NotificationAdminActor, work: (manager: EntityManager) => Promise<T>) { return this.dataSource.transaction(async (manager) => { await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]); return work(manager); }); }
  private async audit(manager: EntityManager, actor: NotificationAdminActor, recordId: string, action: string, before: unknown, after: unknown) { await manager.query("INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by) VALUES($1::uuid,$2,'notification_rules',$3::uuid,$4,$5::jsonb,$6::jsonb,$7,'web',$1::uuid,$1::uuid)", [actor.userId, actor.name, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId]); }
  private rowsOf(result: unknown): Array<Record<string, unknown>> { return Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === "number" ? result[0] as Array<Record<string, unknown>> : result as Array<Record<string, unknown>>; }
}
