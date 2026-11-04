import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { tableResourceRegistry } from "@kdos/contracts";
import {
  EQUIPMENT_RESPONSIBLE_RECIPIENT_RULE,
  FIXED_USERS_RECIPIENT_RULE,
  ORDER_ALLOCATION_DYNAMIC_RECIPIENT_RULE,
  notificationEventDefinition,
  notificationEventDefinitions
} from "./notification-event.registry";
import { NotificationService } from "./notification.service";
import type { NotificationEventDefinition, NotificationRecipientTarget } from "./notification.types";
import { encryptGroupWebhook, validateGroupWebhook } from "./group-webhook.crypto";

export type NotificationAdminActor = {
  tenantId: string;
  userId: string | null;
  name: string;
  username: string;
  requestId: string;
  isSystemAdmin: boolean;
  moduleAdminCodes: string[];
  permissions?: string[];
};

const RECIPIENT = EQUIPMENT_RESPONSIBLE_RECIPIENT_RULE;
const FIXED_RECIPIENT = FIXED_USERS_RECIPIENT_RULE;
const RECIPIENT_LABELS = { [ORDER_ALLOCATION_DYNAMIC_RECIPIENT_RULE]: "承接事业部＋订单业务员", [RECIPIENT]: "设备责任人", [FIXED_RECIPIENT]: "组织架构 / 角色 / 员工" } as const;
const resourceLabel = (code: string) => tableResourceRegistry.find((resource) => resource.code === code)?.label ?? code;
const resourceModule = (code: string) => tableResourceRegistry.find((resource) => resource.code === code)?.module ?? "—";

@Injectable()
export class NotificationAdminService {
  constructor(private readonly dataSource: DataSource, private readonly notifications: NotificationService) {}

  availableEvents(actor: NotificationAdminActor) {
    this.assertAnyAccess(actor);
    return notificationEventDefinitions().filter((event) => this.canManageResource(actor, event.resourceCode)).map((event) => ({
      eventType: event.eventType,
      label: event.label,
      condition: event.conditionDescription,
      resource: event.resourceCode,
      moduleCode: event.moduleCode,
      groupRouteSupported: event.defaultChannel === "WECHAT_GROUP_WEBHOOK" || event.allowGroupRoute === true,
      recipientRules: event.allowedRecipientRules,
      variables: event.templateVariables.map(({ key }) => key),
      module: resourceModule(event.resourceCode), resourceLabel: resourceLabel(event.resourceCode), channel: event.defaultChannel,
      channelLabel: "企业微信工作通知", recipientLabels: RECIPIENT_LABELS,
      templateVariables: event.templateVariables
    }));
  }

  availableGroupRouteEvents(actor: NotificationAdminActor) {
    return this.availableEvents(actor).filter(event => event.groupRouteSupported);
  }

  templateVariables(actor: NotificationAdminActor, eventType: string) {
    const event = this.event(eventType); this.assertResourceAccess(actor, event.resourceCode);
    return event.templateVariables;
  }

  async recipientUsers(actor: NotificationAdminActor) {
    this.assertAnyAccess(actor);
    return this.dataSource.query(`SELECT id,COALESCE(NULLIF(display_name,''),username) "displayName",username,enabled
      FROM users WHERE enabled=true AND tenant_id=$1 ORDER BY "displayName",username`, [actor.tenantId]);
  }

  /** 复用角色授权的三个稳定对象来源，名称只用于展示，不进入规则配置。 */
  async recipientOptions(actor: NotificationAdminActor) {
    this.assertAnyAccess(actor);
    const [organizations, roles, users] = await Promise.all([
      this.dataSource.query(`SELECT id,name,parent_id "parentId",level,enabled,sort_order "sortOrder"
        FROM organization_units WHERE enabled=true ORDER BY level,sort_order,name,id`),
      this.dataSource.query(`SELECT r.id,r.name,r.role_group_id "roleGroupId",g.name "roleGroupName"
        FROM roles r LEFT JOIN role_groups g ON g.id=r.role_group_id
        WHERE r.name <> '系统管理员' AND r.permission_group_resource IS NULL ORDER BY g.name NULLS FIRST,r.name,r.id`),
      this.dataSource.query(`SELECT u.id,COALESCE(NULLIF(u.display_name,''),u.username) "displayName",u.username,u.employee_no "employeeNo",u.enabled,
        u.department_paths "departmentPaths",COALESCE(jsonb_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL),'[]'::jsonb) "roleIds"
        FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id
        WHERE u.enabled=true AND u.tenant_id=$1 GROUP BY u.id ORDER BY "displayName",u.username`, [actor.tenantId])
    ]);
    const byId = new Map((organizations as Array<Record<string, unknown>>).map((unit) => [String(unit.id), unit]));
    const pathOf = (id: string) => {
      const path: string[] = []; const seen = new Set<string>(); let current = byId.get(id);
      while (current && !seen.has(String(current.id))) { seen.add(String(current.id)); path.unshift(String(current.name)); current = current.parentId ? byId.get(String(current.parentId)) : undefined; }
      return path;
    };
    return {
      organizations: (organizations as Array<Record<string, unknown>>).map((unit) => {
        const path = pathOf(String(unit.id)); return { ...unit, path, pathLabel: path.join(" / ") };
      }),
      roles,
      users
    };
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
    this.assertAnyAccess(actor);
    const [row] = await this.dataSource.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND id=$2::uuid", [actor.tenantId, id]);
    if (!row) throw new NotFoundException("消息规则不存在");
    this.assertResourceAccess(actor, String(row.resource));
    return this.ruleView(row);
  }

  async recipientPreview(actor: NotificationAdminActor, id: string) {
    const rule = await this.detail(actor, id);
    if (rule.recipientRule !== FIXED_RECIPIENT) throw new BadRequestException("该规则使用业务动态接收人，请进入对应业务配置查看");
    return this.write(actor, (manager) => this.notifications.previewConfiguredRecipients(manager, actor.tenantId, this.normalizeRecipientTargets(rule.recipientTargets, rule.recipientUserIds)));
  }

  async create(actor: NotificationAdminActor, body: Record<string, unknown>) {
    const input = this.validRule(body);
    this.assertResourceAccess(actor, input.resource);
    if (input.eventType === "mps.order_allocation.batch_changed") throw new ConflictException("订单分配专属规则已自动初始化，请编辑已有规则或进入PMC订单分配通知配置");
    const ruleKey = String(body.ruleKey ?? `notification:${input.eventType}:${randomUUID()}`).trim();
    if (!ruleKey || ruleKey.length > 128) throw new BadRequestException("规则编码无效");
    return this.write(actor, async (manager) => {
      await this.validateRecipientTargets(manager, actor.tenantId, input.recipientTargets);
      await this.validateEnabledRecipients(manager, actor, input);
      const rows = await manager.query(`INSERT INTO notification_rules(tenant_id,rule_key,name,event_type,channel,module_code,resource,recipient_rule,enabled,config,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::uuid,$11::uuid) RETURNING *`,
      [actor.tenantId, ruleKey, input.name, input.eventType, input.event.defaultChannel, input.event.moduleCode, input.resource, input.recipientRule, input.enabled, JSON.stringify(input.config), actor.userId]);
      const row = rows[0]; await this.audit(manager, actor, row.id, "notification_rule.created", null, row); return this.ruleView(row);
    });
  }

  async update(actor: NotificationAdminActor, id: string, body: Record<string, unknown>) {
    return this.write(actor, async (manager) => {
      const [current] = await manager.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [actor.tenantId, id]);
      if (!current) throw new NotFoundException("消息规则不存在");
      this.assertResourceAccess(actor, String(current.resource));
      if (body.expectedVersion != null && Number(body.expectedVersion) !== Number(current.version)) throw new ConflictException("规则已被其他用户修改，请刷新后重试");
      // 状态切换只写状态和审计版本，原配置（含模板和未知扩展项）原样保留。
      if (typeof body.enabled === "boolean" && Object.keys(body).every((key) => ["enabled", "expectedVersion"].includes(key))) {
        if (body.enabled && current.recipient_rule === FIXED_RECIPIENT) {
          const targets = this.normalizeRecipientTargets(current.config?.recipientTargets, current.config?.recipientUserIds);
          await this.validateRecipientTargets(manager, actor.tenantId, targets);
          await this.validateEnabledRecipients(manager, actor, { enabled: true, recipientRule: FIXED_RECIPIENT, recipientTargets: targets });
        }
        const [row] = this.rowsOf(await manager.query("UPDATE notification_rules SET enabled=$3,updated_by=$4::uuid,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 RETURNING *", [actor.tenantId, id, body.enabled, actor.userId, Number(current.version)]));
        if (!row) throw new ConflictException("规则已被其他用户修改，请刷新后重试");
        await this.audit(manager, actor, id, "notification_rule.updated", current, row);
        return this.ruleView(row);
      }
      const input = this.validRule({ ...current, ...body, resource: body.resource ?? current.resource, eventType: body.eventType ?? current.event_type, name: body.name ?? current.name, enabled: body.enabled ?? current.enabled, recipientRule: body.recipientRule ?? current.recipient_rule, config: body.config ?? current.config, template: body.template ?? current.config?.template });
      this.assertResourceAccess(actor, input.resource);
      if (input.eventType === "mps.order_allocation.batch_changed" && current.event_type !== input.eventType) throw new ConflictException("订单分配专属规则已自动初始化，请编辑已有规则");
      if (current.event_type === "mps.order_allocation.batch_changed" && input.eventType !== current.event_type) throw new BadRequestException("订单分配专属规则不能改为其他业务事件");
      await this.validateRecipientTargets(manager, actor.tenantId, input.recipientTargets);
      await this.validateEnabledRecipients(manager, actor, input);
      const rows = await manager.query(`UPDATE notification_rules SET name=$3,event_type=$4,module_code=$5,resource=$6,recipient_rule=$7,enabled=$8,config=$9::jsonb,updated_by=$10::uuid,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$11 RETURNING *`,
      [actor.tenantId, id, input.name, input.eventType, input.event.moduleCode, input.resource, input.recipientRule, input.enabled, JSON.stringify(input.config), actor.userId, Number(current.version)]);
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
    const recipient = String(query.recipient ?? "").trim(); if (recipient) { values.push(`%${recipient}%`); where.push("(COALESCE(l.wechat_user_id,'') ILIKE $" + values.length + " OR COALESCE(l.recipient_user_id::text,'') ILIKE $" + values.length + " OR COALESCE(l.target_name,'') ILIKE $" + values.length + ")"); }
    const from = String(query.from ?? "").trim(); if (from) { values.push(from); where.push(`l.created_at >= $${values.length}::timestamptz`); }
    const to = String(query.to ?? "").trim(); if (to) { values.push(to); where.push(`l.created_at < ($${values.length}::date + interval '1 day')`); }
    const rows = await this.dataSource.query(`SELECT l.id,l.created_at,l.attempt,l.component,a.filename,l.status,l.recipient_user_id,l.wechat_user_id,l.errcode,l.errmsg,l.error_message,l.provider_message_id,l.target_type,l.target_id,l.target_name,
      COALESCE(NULLIF(u.display_name,''),u.username,l.recipient_user_id::text) resolved_recipient,
      r.id rule_id,r.name rule_name,r.module_code,r.resource,r.event_type,r.recipient_rule,o.id outbox_id,o.payload,o.status outbox_status
      FROM notification_delivery_logs l JOIN notification_outbox o ON o.tenant_id=l.tenant_id AND o.id=l.notification_outbox_id
      LEFT JOIN notification_rules r ON r.tenant_id=o.tenant_id AND r.id=o.notification_rule_id
      LEFT JOIN notification_attachments a ON a.tenant_id=l.tenant_id AND a.id=l.attachment_id
      LEFT JOIN users u ON u.id=l.recipient_user_id
      WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC LIMIT 500`, values);
    return rows.map((row: Record<string, unknown>) => this.logView(row));
  }

  async retry(actor: NotificationAdminActor, outboxId: string) {
    return this.write(actor, async (manager) => {
      const [row] = await manager.query(`SELECT o.*,r.resource FROM notification_outbox o LEFT JOIN notification_rules r ON r.tenant_id=o.tenant_id AND r.id=o.notification_rule_id WHERE o.tenant_id=$1 AND o.id=$2::uuid`, [actor.tenantId, outboxId]);
      if (!row) throw new NotFoundException("通知任务不存在");
      const event = notificationEventDefinition(String(row.event_type ?? ""));
      if (row.channel === "WECHAT_GROUP_WEBHOOK") this.requirePermission(actor, "notification-route", "update");
      else this.assertResourceAccess(actor, String(row.resource ?? event?.resourceCode ?? ""));
      const skipped = await manager.query("SELECT errcode,errmsg FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND status='SKIPPED'", [actor.tenantId, outboxId]);
      if (skipped.some((entry: Record<string, unknown>) => ["SKIPPED_MISSING_WECHAT_ID", "SKIPPED_DISABLED"].includes(String(entry.errcode)))) throw new ConflictException("缺少企业微信 UserId 或用户处于禁用状态，不能重试");
      const updated = this.rowsOf(await manager.query("UPDATE notification_outbox SET payload=CASE WHEN event_type='mps.order_allocation.batch_changed' AND EXISTS(SELECT 1 FROM notification_delivery_logs d WHERE d.notification_outbox_id=notification_outbox.id AND d.tenant_id=notification_outbox.tenant_id AND d.component='routing' AND d.status='FAILED') THEN payload - 'routes' - 'routingErrors' ELSE payload END,status='PENDING',next_retry_at=now(),last_error=NULL,failed_at=NULL,locked_at=NULL,locked_by=NULL,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND status='FAILED' RETURNING *", [actor.tenantId, outboxId]))[0];
      if (!updated) throw new ConflictException("只有 FAILED/RETRY_PENDING 通知可以重试");
      await this.audit(manager, actor, outboxId, "notification.retry_requested", row, updated); return { id: outboxId, status: "PENDING" };
    });
  }

  async testSend(actor: NotificationAdminActor, id: string, body: Record<string, unknown>) {
    const rule = await this.detail(actor, id); const event = this.event(String(rule.eventType));
    if (event.eventType === "mps.order_allocation.batch_changed") throw new BadRequestException("请在PMC订单分配通知配置页面选择唯一接收人发送受控测试");
    const payload = body.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new BadRequestException("测试发送需要提供事件 payload");
    const allowed = new Set(event.templateVariables.map(({ key }) => key)); for (const key of Object.keys(payload as Record<string, unknown>)) if (!allowed.has(key)) throw new BadRequestException(`测试 payload 包含未授权变量：${key}`);
    const result = await this.notifications.enqueueEvent(actor.tenantId, { ruleId: id, eventType: event.eventType, channel: event.defaultChannel, dedupKey: `test:${id}:${randomUUID()}`, payload: payload as Record<string, unknown>, createdBy: actor.userId });
    await this.dataSource.query("INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by) VALUES($1::uuid,$2,'notification_rules',$3::uuid,'notification.test_requested',$4::jsonb,$5,'web',$1::uuid,$1::uuid)", [actor.userId, actor.name, id, JSON.stringify({ outboxId: result.row.id }), actor.requestId]);
    return { ...result, message: "已创建规则测试通知，将发送给当前规则实际接收人。" };
  }

  groupWebhookAccess(actor: NotificationAdminActor) {
    return Object.fromEntries(["read", "create", "update", "delete", "test"].map(action => [action, this.hasResourcePermission(actor, "notification-group-webhook", action)]));
  }

  routeAccess(actor: NotificationAdminActor) {
    return Object.fromEntries(["read", "create", "update", "delete"].map(action => [action, this.hasResourcePermission(actor, "notification-route", action)]));
  }

  recipientGroupAccess(actor: NotificationAdminActor) {
    return Object.fromEntries(["read", "create", "update", "delete"].map(action => [action, this.hasResourcePermission(actor, "notification-recipient-group", action)]));
  }

  async listRecipientGroups(actor: NotificationAdminActor) {
    this.requirePermission(actor, "notification-recipient-group", "read");
    return this.write(actor, async manager => {
      const rows = await manager.query(`SELECT g.id,g.name,g.category,g.purpose,g.description,g.enabled,g.version,g.created_at,g.updated_at,
          COALESCE(jsonb_agg(jsonb_build_object('id',w.id,'groupName',w.group_name,'robotName',w.robot_name,'enabled',w.enabled,'webhookConfigured',w.webhook_ciphertext IS NOT NULL) ORDER BY w.group_name,w.id)
            FILTER (WHERE w.id IS NOT NULL),'[]'::jsonb) members
        FROM notification_recipient_groups g LEFT JOIN notification_recipient_group_members m ON m.tenant_id=g.tenant_id AND m.recipient_group_id=g.id
        LEFT JOIN notification_group_webhooks w ON w.tenant_id=m.tenant_id AND w.id=m.target_id
        WHERE g.tenant_id=$1 GROUP BY g.id ORDER BY g.category NULLS LAST,g.name,g.id`, [actor.tenantId]);
      return rows.map((row: Record<string, unknown>) => this.recipientGroupView(row));
    });
  }

  async createRecipientGroup(actor: NotificationAdminActor, body: Record<string, unknown>) {
    this.requirePermission(actor, "notification-recipient-group", "create");
    const input = this.validRecipientGroup(body);
    return this.write(actor, async manager => {
      const [duplicate]=await manager.query("SELECT id FROM notification_recipient_groups WHERE tenant_id=$1 AND name=$2 LIMIT 1",[actor.tenantId,input.name]);
      if(duplicate)throw new ConflictException("当前租户已存在同名收件人组");
      await this.validateGroupMembers(manager, actor, input.memberIds);
      if (input.enabled && !input.memberIds.length) throw new BadRequestException("启用的收件人组至少需要一个群机器人");
      const [row] = await manager.query(`INSERT INTO notification_recipient_groups(tenant_id,name,category,purpose,description,enabled,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7::uuid,$7::uuid) RETURNING *`, [actor.tenantId,input.name,input.category,input.purpose,input.description,input.enabled,actor.userId]);
      for (const targetId of input.memberIds) await manager.query(`INSERT INTO notification_recipient_group_members(tenant_id,recipient_group_id,target_id,created_by) VALUES($1,$2::uuid,$3::uuid,$4::uuid)`, [actor.tenantId,row.id,targetId,actor.userId]);
      const after = { ...row, members: await this.groupMemberViews(manager, actor.tenantId, input.memberIds) };
      const view = this.recipientGroupView(after);
      await this.auditEntity(manager,actor,"notification-recipient-group",String(row.id),"notification_recipient_group.created",null,view);
      return view;
    });
  }

  async updateRecipientGroup(actor: NotificationAdminActor, id: string, body: Record<string, unknown>) {
    this.requirePermission(actor, "notification-recipient-group", "update");
    const input = this.validRecipientGroup(body);
    return this.write(actor, async manager => {
      const [current] = await manager.query("SELECT * FROM notification_recipient_groups WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [actor.tenantId,id]);
      if (!current) throw new NotFoundException("收件人组不存在");
      if (Number(current.version)!==Number(body.expectedVersion)) throw new ConflictException("收件人组已变化，请刷新后重试");
      const [duplicate]=await manager.query("SELECT id FROM notification_recipient_groups WHERE tenant_id=$1 AND name=$2 AND id<>$3::uuid LIMIT 1",[actor.tenantId,input.name,id]);
      if(duplicate)throw new ConflictException("当前租户已存在同名收件人组");
      const beforeMembers = await this.groupMemberViews(manager,actor.tenantId,(await manager.query("SELECT target_id id FROM notification_recipient_group_members WHERE tenant_id=$1 AND recipient_group_id=$2::uuid",[actor.tenantId,id])).map((member:Record<string,unknown>)=>String(member.id)));
      await this.validateGroupMembers(manager,actor,input.memberIds);
      if (input.enabled && !input.memberIds.length) throw new BadRequestException("启用的收件人组至少需要一个群机器人");
      const rows = this.rowsOf(await manager.query(`UPDATE notification_recipient_groups SET name=$3,category=$4,purpose=$5,description=$6,enabled=$7,updated_by=$8::uuid,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$9 RETURNING *`,[actor.tenantId,id,input.name,input.category,input.purpose,input.description,input.enabled,actor.userId,Number(current.version)]));
      const [row] = rows;
      if (!row) throw new ConflictException("收件人组已变化，请刷新后重试");
      await manager.query("DELETE FROM notification_recipient_group_members WHERE tenant_id=$1 AND recipient_group_id=$2::uuid",[actor.tenantId,id]);
      for (const targetId of input.memberIds) await manager.query(`INSERT INTO notification_recipient_group_members(tenant_id,recipient_group_id,target_id,created_by) VALUES($1,$2::uuid,$3::uuid,$4::uuid)`,[actor.tenantId,id,targetId,actor.userId]);
      const after = this.recipientGroupView({...row,members:await this.groupMemberViews(manager,actor.tenantId,input.memberIds)});
      await this.auditEntity(manager,actor,"notification-recipient-group",id,"notification_recipient_group.updated",{...this.recipientGroupView(current),members:beforeMembers},after);
      return after;
    });
  }

  async deleteRecipientGroup(actor: NotificationAdminActor, id: string, expectedVersion: number) {
    this.requirePermission(actor,"notification-recipient-group","delete");
    return this.write(actor,async manager=>{
      const [current]=await manager.query("SELECT * FROM notification_recipient_groups WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE",[actor.tenantId,id]);
      if(!current)throw new NotFoundException("收件人组不存在");
      if(Number(current.version)!==Number(expectedVersion))throw new ConflictException("收件人组已变化，请刷新后重试");
      const [reference]=await manager.query("SELECT 1 FROM notification_route_targets WHERE tenant_id=$1 AND target_type='RECIPIENT_GROUP' AND target_id=$2::uuid LIMIT 1",[actor.tenantId,id]);
      if(reference)throw new ConflictException("该收件人组已被消息路由使用，请先修改路由");
      const members=await this.groupMemberViews(manager,actor.tenantId,(await manager.query("SELECT target_id id FROM notification_recipient_group_members WHERE tenant_id=$1 AND recipient_group_id=$2::uuid",[actor.tenantId,id])).map((member:Record<string,unknown>)=>String(member.id)));
      await manager.query("DELETE FROM notification_recipient_groups WHERE tenant_id=$1 AND id=$2::uuid",[actor.tenantId,id]);
      await this.auditEntity(manager,actor,"notification-recipient-group",id,"notification_recipient_group.deleted",{...this.recipientGroupView(current),members},null);
      return {id,deleted:true};
    });
  }

  async listGroupWebhooks(actor: NotificationAdminActor) {
    this.requirePermission(actor, "notification-group-webhook", "read");
    const rows: Array<Record<string, unknown>> = await this.write(actor, manager => manager.query(`SELECT id,group_name,robot_name,channel_type,webhook_masked,
      webhook_ciphertext IS NOT NULL AS webhook_configured,module_code,responsible_user_id,
      enabled,remark,created_by,created_at,updated_by,updated_at,version FROM notification_group_webhooks WHERE tenant_id=$1 ORDER BY group_name,id`, [actor.tenantId]));
    return rows.map(row => this.groupWebhookView(row));
  }

  async createGroupWebhook(actor: NotificationAdminActor, body: Record<string, unknown>) {
    this.requirePermission(actor, "notification-group-webhook", "create");
    const groupName = this.requiredAdminText(body.groupName, "群名称", 128);
    const robotName = this.requiredAdminText(body.robotName, "机器人名称", 128);
    const moduleCode = this.requiredAdminText(body.moduleCode, "所属模块", 64);
    this.validateModuleCode(moduleCode);
    const webhook = validateGroupWebhook(body.webhook);
    return this.write(actor, async manager => {
      const responsibleUserId = await this.validateResponsibleUser(actor, body.responsibleUserId, manager);
      const [row] = await manager.query(`INSERT INTO notification_group_webhooks(tenant_id,group_name,robot_name,webhook_ciphertext,webhook_masked,module_code,responsible_user_id,enabled,remark,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7::uuid,$8,$9,$10::uuid,$10::uuid) RETURNING *`, [actor.tenantId, groupName, robotName, encryptGroupWebhook(webhook.plaintext), webhook.masked, moduleCode, responsibleUserId, body.enabled !== false, this.optionalAdminText(body.remark, 1000), actor.userId]);
      const view = this.groupWebhookView(row); await this.auditEntity(manager, actor, "notification-group-webhook", row.id, "notification_group_webhook.created", null, view); return view;
    });
  }

  async updateGroupWebhook(actor: NotificationAdminActor, id: string, body: Record<string, unknown>) {
    this.requirePermission(actor, "notification-group-webhook", "update");
    return this.write(actor, async manager => {
      const [current] = await manager.query("SELECT * FROM notification_group_webhooks WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [actor.tenantId, id]);
      if (!current) throw new NotFoundException("群机器人不存在");
      if (Number(current.version) !== Number(body.expectedVersion)) throw new ConflictException("群机器人配置已变化，请刷新后重试");
      const webhook = String(body.webhook ?? "").trim() ? validateGroupWebhook(body.webhook) : null;
      const row = (await manager.query(`UPDATE notification_group_webhooks SET group_name=$3,robot_name=$4,
        webhook_ciphertext=COALESCE($5,webhook_ciphertext),webhook_masked=COALESCE($6,webhook_masked),module_code=$7,
        responsible_user_id=$8::uuid,enabled=$9,remark=$10,updated_by=$11::uuid,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$12 RETURNING *`, [actor.tenantId, id,
        this.requiredAdminText(body.groupName ?? current.group_name, "群名称", 128), this.requiredAdminText(body.robotName ?? current.robot_name, "机器人名称", 128),
        webhook ? encryptGroupWebhook(webhook.plaintext) : null, webhook?.masked ?? null, this.validModuleCode(body.moduleCode ?? current.module_code),
        body.responsibleUserId === undefined ? current.responsible_user_id : await this.validateResponsibleUser(actor, body.responsibleUserId, manager),
        typeof body.enabled === "boolean" ? body.enabled : current.enabled, body.remark === undefined ? current.remark : this.optionalAdminText(body.remark, 1000), actor.userId, Number(current.version)]))[0];
      if (!row) throw new ConflictException("群机器人配置已变化，请刷新后重试");
      const before = this.groupWebhookView(current); const after = this.groupWebhookView(row);
      await this.auditEntity(manager, actor, "notification-group-webhook", id, "notification_group_webhook.updated", before, after); return after;
    });
  }

  async deleteGroupWebhook(actor: NotificationAdminActor, id: string, expectedVersion: number) {
    this.requirePermission(actor, "notification-group-webhook", "delete");
    return this.write(actor, async manager => {
      const [current] = await manager.query("SELECT * FROM notification_group_webhooks WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [actor.tenantId, id]);
      if (!current) throw new NotFoundException("群机器人不存在");
      if (Number(current.version) !== Number(expectedVersion)) throw new ConflictException("群机器人配置已变化，请刷新后重试");
      const [reference] = await manager.query(`SELECT 1 FROM notification_route_targets t WHERE t.tenant_id=$1 AND t.target_type='WECHAT_GROUP_WEBHOOK' AND t.target_id=$2::uuid
        UNION ALL SELECT 1 FROM notification_recipient_group_members m WHERE m.tenant_id=$1 AND m.target_id=$2::uuid LIMIT 1`, [actor.tenantId, id]);
      if (reference) throw new ConflictException("该群机器人已被消息路由或收件人组引用，请先解除关系。");
      await manager.query("DELETE FROM notification_group_webhooks WHERE tenant_id=$1 AND id=$2::uuid", [actor.tenantId, id]);
      await this.auditEntity(manager, actor, "notification-group-webhook", id, "notification_group_webhook.deleted", this.groupWebhookView(current), null);
      return { id, deleted: true };
    });
  }

  async testGroupWebhook(actor: NotificationAdminActor, id: string) {
    this.requirePermission(actor, "notification-group-webhook", "test");
    return this.write(actor, async manager => {
      const [target] = await manager.query("SELECT id,enabled,group_name FROM notification_group_webhooks WHERE tenant_id=$1 AND id=$2::uuid", [actor.tenantId, id]);
      if (!target) throw new NotFoundException("群机器人不存在");
      if (!target.enabled) throw new ConflictException("请先启用该群机器人再测试");
      if (!process.env.KDOS_NOTIFICATION_SECRET_KEY) throw new ConflictException("通知Webhook加密密钥未配置，无法测试发送");
      const content = `【KDOS测试消息】\n企业微信群机器人连接正常。\n发送时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`;
      const result = await this.notifications.enqueueEvent(actor.tenantId, { eventType: "notification.group_webhook.test", channel: "WECHAT_GROUP_WEBHOOK", dedupKey: `group-webhook-test:${id}:${randomUUID()}`, payload: { groupWebhookId: id, content }, createdBy: actor.userId }, manager);
      await this.auditEntity(manager, actor, "notification-group-webhook", id, "notification_group_webhook.test_requested", null, { outboxId: result.row.id });
      return { ...result, message: "测试消息已进入 Dispatcher 队列。" };
    });
  }

  async listRoutes(actor: NotificationAdminActor) {
    this.requirePermission(actor, "notification-route", "read");
    return this.write(actor, async manager => {
      const result: Array<Record<string, unknown>> = [];
      for (const event of notificationEventDefinitions().filter(item => this.canManageResource(actor, item.resourceCode))) {
        const [route] = await manager.query("SELECT id,name,enabled,remark,version FROM notification_routes WHERE tenant_id=$1 AND event_type=$2", [actor.tenantId, event.eventType]);
        const targets = route ? await manager.query(`SELECT t.target_id id,t.target_type type,
            CASE WHEN t.target_type='RECIPIENT_GROUP' THEN g.name ELSE w.group_name END name,
            CASE WHEN t.target_type='RECIPIENT_GROUP' THEN g.enabled ELSE w.enabled END target_enabled,t.enabled route_enabled
          FROM notification_route_targets t
          LEFT JOIN notification_group_webhooks w ON t.target_type='WECHAT_GROUP_WEBHOOK' AND w.tenant_id=t.tenant_id AND w.id=t.target_id
          LEFT JOIN notification_recipient_groups g ON t.target_type='RECIPIENT_GROUP' AND g.tenant_id=t.tenant_id AND g.id=t.target_id
          WHERE t.tenant_id=$1 AND t.route_id=$2::uuid ORDER BY type,name`, [actor.tenantId, route.id]) : [];
        result.push({ ...event, ...(route ? { id: route.id, name: route.name, enabled: route.enabled, remark: route.remark ?? "", version: route.version } : {}), targets });
      }
      return result;
    });
  }

  async saveRoute(actor: NotificationAdminActor, body: Record<string, unknown>) {
    const event = this.event(String(body.eventType ?? "")); this.assertResourceAccess(actor, event.resourceCode);
    if (event.defaultChannel !== "WECHAT_GROUP_WEBHOOK" && event.allowGroupRoute !== true) throw new BadRequestException("该通知事件未开放企业微信群机器人路由");
    const name = this.requiredAdminText(body.name ?? event.label, "路由名称", 255);
    const targets = this.normalizeRouteTargets(body);
    if (body.enabled === true && !targets.length) throw new BadRequestException("启用的消息路由至少需要一个接收目标");
    return this.write(actor, async manager => {
      const [existing] = await manager.query("SELECT id FROM notification_routes WHERE tenant_id=$1 AND event_type=$2", [actor.tenantId, event.eventType]);
      this.requirePermission(actor, "notification-route", existing ? "update" : "create");
      await this.validateRouteTargets(manager,actor,targets);
      let route: Record<string, unknown>;
      if (existing) {
        const [current] = await manager.query("SELECT * FROM notification_routes WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [actor.tenantId, existing.id]);
        if (Number(current.version) !== Number(body.expectedVersion)) throw new ConflictException("消息路由已变化，请刷新后重试");
        const oldTargets=await manager.query("SELECT target_type type,target_id id FROM notification_route_targets WHERE tenant_id=$1 AND route_id=$2::uuid",[actor.tenantId,existing.id]);
        const updatedRows = this.rowsOf(await manager.query(`UPDATE notification_routes SET name=$3,enabled=$4,remark=$5,updated_by=$6::uuid,updated_at=now(),version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND version=$7 RETURNING *`, [actor.tenantId, existing.id, name, body.enabled === true, this.optionalAdminText(body.remark, 1000), actor.userId, Number(current.version)]));
        [route] = updatedRows;
        if (!route) throw new ConflictException("消息路由已变化，请刷新后重试");
        await manager.query("DELETE FROM notification_route_targets WHERE tenant_id=$1 AND route_id=$2::uuid", [actor.tenantId, route.id]);
        await this.auditEntity(manager, actor, "notification-route", String(route.id), "notification_route.updated", { ...current,targets:oldTargets }, { ...route, targets });
      } else {
        [route] = await manager.query(`INSERT INTO notification_routes(tenant_id,event_type,name,enabled,remark,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6::uuid,$6::uuid) RETURNING *`, [actor.tenantId, event.eventType, name, body.enabled === true, this.optionalAdminText(body.remark, 1000), actor.userId]);
        await this.auditEntity(manager, actor, "notification-route", String(route.id), "notification_route.created", null, { ...route, targets });
      }
      for (const target of targets) await manager.query(`INSERT INTO notification_route_targets(tenant_id,route_id,target_id,target_type,webhook_target_id,recipient_group_id,created_by)
        VALUES($1,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid,$7::uuid)`, [actor.tenantId, route.id, target.id,target.type,target.type==="WECHAT_GROUP_WEBHOOK"?target.id:null,target.type==="RECIPIENT_GROUP"?target.id:null,actor.userId]);
      return { id: route.id, eventType: route.event_type, name: route.name, enabled: route.enabled, remark: route.remark ?? "", version: route.version, targets };
    });
  }

  async deleteRoute(actor: NotificationAdminActor, id: string, expectedVersion: number) {
    this.requirePermission(actor, "notification-route", "delete");
    return this.write(actor, async manager => {
      const [current] = await manager.query("SELECT * FROM notification_routes WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [actor.tenantId, id]);
      if (!current) throw new NotFoundException("消息路由不存在");
      this.assertResourceAccess(actor, String(notificationEventDefinition(String(current.event_type))?.resourceCode ?? ""));
      if (Number(current.version) !== Number(expectedVersion)) throw new ConflictException("消息路由已变化，请刷新后重试");
      await manager.query("DELETE FROM notification_route_targets WHERE tenant_id=$1 AND route_id=$2::uuid", [actor.tenantId, id]);
      await manager.query("DELETE FROM notification_routes WHERE tenant_id=$1 AND id=$2::uuid", [actor.tenantId, id]);
      await this.auditEntity(manager, actor, "notification-route", id, "notification_route.deleted", current, null);
      return { id, deleted: true };
    });
  }

  private groupWebhookView(row: Record<string, unknown>) {
    return { id: row.id, groupName: row.group_name, robotName: row.robot_name, channelType: row.channel_type, webhookMasked: row.webhook_masked, webhookConfigured: Boolean(row.webhook_configured ?? row.webhook_ciphertext), moduleCode: row.module_code, responsibleUserId: row.responsible_user_id ?? null, enabled: row.enabled, remark: row.remark ?? "", createdBy: row.created_by ?? null, createdAt: row.created_at, updatedBy: row.updated_by ?? null, updatedAt: row.updated_at, version: row.version };
  }

  private recipientGroupView(row: Record<string, unknown>) {
    const raw=row.members;
    const members=Array.isArray(raw)?raw:typeof raw==="string"?JSON.parse(raw):[];
    return {id:row.id,name:row.name,category:row.category??"",purpose:row.purpose??"",description:row.description??"",enabled:row.enabled,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,members};
  }

  private validRecipientGroup(body:Record<string,unknown>) {
    const name=this.requiredAdminText(body.name,"组名称",128);
    const optional=(value:unknown,label:string,max:number)=>{const text=String(value??"").trim();if(text.length>max)throw new BadRequestException(`${label}不能超过${max}个字符`);return text||null;};
    const raw=body.memberIds??[];if(!Array.isArray(raw))throw new BadRequestException("组成员配置无效");
    const memberIds=[...new Set(raw.map(value=>this.requiredAdminUuid(value,"群机器人ID")))];
    return {name,category:optional(body.category,"组织/业务分类",128),purpose:optional(body.purpose,"用途",255),description:optional(body.description,"描述",1000),enabled:body.enabled!==false,memberIds};
  }

  private normalizeRouteTargets(body:Record<string,unknown>) {
    const raw=Array.isArray(body.targets)?body.targets:Array.isArray(body.targetIds)?body.targetIds.map(id=>({type:"WECHAT_GROUP_WEBHOOK",id})):[];
    const targets=raw.map(value=>{
      if(!value||typeof value!=="object"||Array.isArray(value))throw new BadRequestException("消息路由接收目标无效");
      const item=value as Record<string,unknown>;const type=String(item.type??"").toUpperCase();
      if(type!=="WECHAT_GROUP_WEBHOOK"&&type!=="RECIPIENT_GROUP")throw new BadRequestException("消息路由只支持群机器人或收件人组");
      return {type,id:this.requiredAdminUuid(item.id,"接收目标ID")};
    });
    return [...new Map(targets.map(target=>[`${target.type}:${target.id}`,target])).values()];
  }

  private async validateGroupMembers(manager:EntityManager,actor:NotificationAdminActor,ids:string[]) {
    this.requirePermission(actor,"notification-group-webhook","read");
    if(!ids.length)return;
    const found=await manager.query("SELECT id FROM notification_group_webhooks WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[actor.tenantId,ids]);
    if(found.length!==ids.length)throw new BadRequestException("组成员不存在或不属于当前租户");
  }

  private async groupMemberViews(manager:EntityManager,tenantId:string,ids:string[]) {
    if(!ids.length)return [];
    const rows=await manager.query("SELECT id,group_name,robot_name,enabled,webhook_ciphertext IS NOT NULL webhook_configured FROM notification_group_webhooks WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenantId,ids]);
    const byId=new Map((rows as Array<Record<string,unknown>>).map(row=>[String(row.id),row]));
    return ids.flatMap(id=>{const row=byId.get(id);return row?[{id:row.id,groupName:row.group_name,robotName:row.robot_name,enabled:row.enabled,webhookConfigured:row.webhook_configured}]:[];});
  }

  private async validateRouteTargets(manager:EntityManager,actor:NotificationAdminActor,targets:Array<{type:string;id:string}>) {
    const groupIds=targets.filter(target=>target.type==="RECIPIENT_GROUP").map(target=>target.id);
    const webhookIds=targets.filter(target=>target.type==="WECHAT_GROUP_WEBHOOK").map(target=>target.id);
    if(groupIds.length){this.requirePermission(actor,"notification-recipient-group","read");const found=await manager.query("SELECT id FROM notification_recipient_groups WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[actor.tenantId,groupIds]);if(found.length!==groupIds.length)throw new BadRequestException("接收人组不存在或跨租户");}
    if(webhookIds.length){const found=await manager.query("SELECT id FROM notification_group_webhooks WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[actor.tenantId,webhookIds]);if(found.length!==webhookIds.length)throw new BadRequestException("接收群机器人不存在或跨租户");}
  }

  private requiredAdminText(value: unknown, label: string, max: number) { const result = String(value ?? "").trim(); if (!result || result.length > max) throw new BadRequestException(`${label}不能为空且不能超过${max}个字符`); return result; }
  private validModuleCode(value: unknown) { const code=this.requiredAdminText(value,"所属模块",64);this.validateModuleCode(code);return code; }
  private validateModuleCode(code: string) { if (!tableResourceRegistry.some(resource=>resource.moduleCode===code)) throw new BadRequestException("所属模块无效"); }
  private optionalAdminText(value: unknown, max: number) { const result = String(value ?? "").trim(); if (result.length > max) throw new BadRequestException(`备注不能超过${max}个字符`); return result || null; }
  private requiredAdminUuid(value: unknown, label: string) { const result = String(value ?? "").trim(); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new BadRequestException(`${label}无效`); return result; }
  private async validateResponsibleUser(actor: NotificationAdminActor, value: unknown, manager: EntityManager) { if (!value) return null; const id = this.requiredAdminUuid(value, "负责人"); const [user] = await manager.query("SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled=true", [actor.tenantId, id]); if (!user) throw new BadRequestException("负责人不存在、已禁用或不属于当前租户"); return id; }
  private hasResourcePermission(actor: NotificationAdminActor, resource: string, action: string) { const permissions=actor.permissions??[]; return actor.isSystemAdmin || permissions.includes("*") || permissions.includes(`${resource}:*:${action}`) || permissions.includes(`${resource}:${action}`); }
  private requirePermission(actor: NotificationAdminActor, resource: string, action: string) { if (!this.hasResourcePermission(actor, resource, action)) throw new ForbiddenException("当前用户没有此操作权限"); }
  private async auditEntity(manager: EntityManager, actor: NotificationAdminActor, resource: string, id: string, action: string, before: unknown, after: unknown) {
    await manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by,tenant_id)
      VALUES($1::uuid,$2,$3,$4::text,$5,$6::jsonb,$7::jsonb,$8,'web',$1::uuid,$1::uuid,$9)`,
      [actor.userId, actor.name, resource, id, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId, actor.tenantId]);
  }

  private validRule(body: Record<string, unknown>) {
    const eventType = String(body.eventType ?? "").trim(); const event = this.event(eventType);
    const name = String(body.name ?? "").trim(); if (!name || name.length > 255) throw new BadRequestException("请输入规则名称");
    const resource = String(body.resource ?? event.resourceCode).trim(); if (resource !== event.resourceCode) throw new BadRequestException("资源与通知事件不匹配");
    const template = String(body.template ?? (body.config as Record<string, unknown> | undefined)?.template ?? "").trim();
    const recipientRule = String(body.recipientRule ?? body.recipient_rule ?? RECIPIENT).trim();
    if (!event.allowedRecipientRules.includes(recipientRule)) throw new BadRequestException("当前事件不支持该接收人规则");
    const sourceConfig = { ...((body.config as Record<string, unknown> | undefined) ?? {}) };
    const rawTargets = body.recipientTargets ?? sourceConfig.recipientTargets;
    const rawIds = body.recipientUserIds ?? sourceConfig.recipientUserIds;
    if (recipientRule === FIXED_RECIPIENT) {
      const targets = this.normalizeRecipientTargets(rawTargets, rawIds);
      if (!targets.length && body.enabled !== false) this.noRecipients();
      sourceConfig.recipientTargets = targets;
      delete sourceConfig.recipientUserIds;
    } else { delete sourceConfig.recipientUserIds; delete sourceConfig.recipientTargets; }
    const configTemplate = template ? this.normalizeTemplate(template, event.templateVariables.map(({ key }) => key)) : undefined;
    const recipientTargets = recipientRule === FIXED_RECIPIENT ? this.normalizeRecipientTargets(rawTargets, rawIds) : [];
    return { name, eventType, event, resource, recipientRule, enabled: body.enabled !== false, recipientTargets, config: { ...sourceConfig, messageType: event.messageType, ...(recipientRule === FIXED_RECIPIENT ? { recipientTargets } : {}), ...(configTemplate ? { template: configTemplate } : {}) } };
  }

  private normalizeTemplate(template: string, variables: readonly string[]) {
    if (template.length > 4000) throw new BadRequestException("消息模板不能超过 4000 个字符");
    const allowed = new Set<string>(variables); return template.replace(/\{\{?([A-Za-z][A-Za-z0-9_]*)\}\}?/g, (whole, key: string) => {
      if (!allowed.has(key)) throw new BadRequestException(`消息模板包含未授权变量：${key}`); return `{${key}}`;
    });
  }

  private event(eventType: string): NotificationEventDefinition { const event = notificationEventDefinition(eventType); if (!event) throw new BadRequestException("当前数据表暂未注册可用的实时通知事件。"); return event; }
  private canManageResource(actor: NotificationAdminActor, resource: string) { const entry = tableResourceRegistry.find((item) => item.code === resource); return Boolean(entry && (actor.isSystemAdmin || actor.moduleAdminCodes.includes(entry.moduleCode))); }
  private assertResourceAccess(actor: NotificationAdminActor, resource: string) { if (!this.canManageResource(actor, resource)) throw new ForbiddenException("当前管理员无权管理该模块的消息规则"); }
  private assertAnyAccess(actor: NotificationAdminActor) { if (!actor.isSystemAdmin && !actor.moduleAdminCodes.length) throw new ForbiddenException("仅系统管理员或模块管理员可以访问消息中心"); }
  private scopeWhere(actor: NotificationAdminActor, where: string[], values: unknown[], alias: string) { if (!actor.isSystemAdmin) { values.push(actor.moduleAdminCodes); where.push(`${alias}.module_code = ANY($${values.length}::varchar[])`); } }
  private normalizeRecipientTargets(rawTargets: unknown, legacyUserIds: unknown): NotificationRecipientTarget[] {
    const uuid = (value: unknown, label: string) => {
      const id = String(value ?? "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException(`${label}必须使用有效 ID`);
      return id;
    };
    if (Array.isArray(rawTargets)) {
      const targets = rawTargets.map((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("接收对象配置无效");
        const target = raw as Record<string, unknown>; const type = String(target.type ?? "").toUpperCase();
        if (type === "ORGANIZATION") return { type, organizationUnitId: uuid(target.organizationUnitId, "组织架构 ID"), includeDescendants: target.includeDescendants === true } as NotificationRecipientTarget;
        if (type === "ROLE") return { type, roleId: uuid(target.roleId, "角色 ID") } as NotificationRecipientTarget;
        if (type === "USER") return { type, userId: uuid(target.userId, "员工 ID") } as NotificationRecipientTarget;
        throw new BadRequestException("接收对象必须来自组织架构、角色或员工");
      });
      return [...new Map(targets.map((target) => [this.recipientTargetKey(target), target])).values()];
    }
    if (Array.isArray(legacyUserIds)) {
      return legacyUserIds.map((userId) => {
        const id = String(userId ?? "").trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException("指定人员必须使用有效用户 ID");
        return { type: "USER", userId: id } as NotificationRecipientTarget;
      });
    }
    return [];
  }

  private recipientTargetKey(target: NotificationRecipientTarget) {
    return target.type === "ORGANIZATION" ? `${target.type}:${target.organizationUnitId}:${target.includeDescendants ? "DESCENDANTS" : "SELF"}` : `${target.type}:${target.type === "ROLE" ? target.roleId : target.userId}`;
  }

  private noRecipients(): never { throw new BadRequestException({ code: "NOTIFICATION_RECIPIENTS_REQUIRED", message: "未配置有效接收人，请先编辑接收对象；至少需要一名已启用且有企业微信 UserId 的员工" }); }

  private async validateEnabledRecipients(manager: EntityManager, actor: NotificationAdminActor, input: { enabled: boolean; recipientRule: string; recipientTargets: NotificationRecipientTarget[] }) {
    if (!input.enabled || input.recipientRule !== FIXED_RECIPIENT) return;
    if (!input.recipientTargets.length) this.noRecipients();
    const preview = await this.notifications.previewConfiguredRecipients(manager, actor.tenantId, input.recipientTargets);
    if (!preview.deliverable) this.noRecipients();
  }

  private async validateRecipientTargets(manager: EntityManager, tenantId: string, targets: NotificationRecipientTarget[]) {
    if (!targets.length) return;
    const organizationIds = targets.filter((target): target is Extract<NotificationRecipientTarget, { type: "ORGANIZATION" }> => target.type === "ORGANIZATION").map((target) => target.organizationUnitId);
    const roleIds = targets.filter((target): target is Extract<NotificationRecipientTarget, { type: "ROLE" }> => target.type === "ROLE").map((target) => target.roleId);
    const userIds = targets.filter((target): target is Extract<NotificationRecipientTarget, { type: "USER" }> => target.type === "USER").map((target) => target.userId);
    const rows = await manager.query(`SELECT 'ORGANIZATION' type,id FROM organization_units WHERE id=ANY($1::uuid[])
      UNION ALL SELECT 'ROLE' type,id FROM roles WHERE id=ANY($2::uuid[])
      UNION ALL SELECT 'USER' type,id FROM users WHERE id=ANY($3::uuid[]) AND tenant_id=$4`, [organizationIds, roleIds, userIds, tenantId]);
    const found = new Set((rows as Array<Record<string, unknown>>).map((row) => `${row.type}:${row.id}`));
    for (const target of targets) {
      const key = target.type === "ORGANIZATION" ? `ORGANIZATION:${target.organizationUnitId}` : target.type === "ROLE" ? `ROLE:${target.roleId}` : `USER:${target.userId}`;
      if (!found.has(key)) throw new BadRequestException("接收对象不存在或已被移除，请刷新后重新选择");
    }
  }

  private ruleView(row: Record<string, unknown>) {
    const recipientRule = String(row.recipient_rule ?? RECIPIENT);
    const config = (row.config as Record<string, unknown> | undefined) ?? {};
    const event = notificationEventDefinition(String(row.event_type ?? ""));
    const recipientTargets = Array.isArray(config.recipientTargets) ? config.recipientTargets : Array.isArray(config.recipientUserIds) ? config.recipientUserIds.map((userId) => ({ type: "USER", userId })) : [];
    return { id: row.id, ruleKey: row.rule_key, name: row.name, eventType: row.event_type, channel: row.channel, channelLabel: "企业微信工作通知", moduleCode: row.module_code, module: resourceModule(String(row.resource)), resource: row.resource, resourceLabel: resourceLabel(String(row.resource)), recipientRule, recipientLabel: RECIPIENT_LABELS[recipientRule as keyof typeof RECIPIENT_LABELS] ?? recipientRule, recipientTargets, recipientUserIds: recipientTargets.filter((target: any) => target.type === "USER").map((target: any) => target.userId), condition: event?.conditionDescription ?? "—", enabled: row.enabled, config: { ...config, recipientTargets }, latestSendAt: row.latest_send_at ?? null, version: row.version };
  }
  private logView(row: Record<string, unknown>) {
    const status = row.status === "SKIPPED" ? String(row.errcode ?? "SKIPPED") : row.status;
    const recipientRule = String(row.recipient_rule ?? RECIPIENT);
    const event = notificationEventDefinition(String(row.event_type ?? ""));
    return { batchId: (row.payload as Record<string,unknown>)?.batchId, component:row.component, attachmentFilename:row.filename, identities: ((row.payload as {routes?: Array<{userId:string;identities:string[]}>})?.routes??[]).find(route=>route.userId===row.recipient_user_id)?.identities??[], id: row.id, sendTime: row.created_at, ruleId: row.rule_id, ruleName: row.rule_name ?? "—", module: resourceModule(String(row.resource ?? event?.resourceCode ?? "")), resource: row.resource ?? event?.resourceCode ?? "—", eventType: row.event_type, recipientRule, recipientRuleLabel: row.target_type === "WECHAT_GROUP_WEBHOOK" ? "企业微信群机器人" : RECIPIENT_LABELS[recipientRule as keyof typeof RECIPIENT_LABELS] ?? recipientRule, resolvedRecipient: row.target_name ?? row.resolved_recipient ?? row.recipient_user_id ?? "—", wechatUserId: row.target_type === "WECHAT_GROUP_WEBHOOK" ? "—" : row.wechat_user_id ?? "—", status, retryCount: row.attempt, providerMessageId: row.provider_message_id ?? null, failureReason: row.error_message ?? row.errmsg ?? null, outboxId: row.outbox_id, targetType: row.target_type, targetId: row.target_id };
  }
  private async write<T>(actor: NotificationAdminActor, work: (manager: EntityManager) => Promise<T>) { return this.dataSource.transaction(async (manager) => { await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]); return work(manager); }); }
  private async audit(manager: EntityManager, actor: NotificationAdminActor, recordId: string, action: string, before: unknown, after: unknown) { await manager.query("INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by,tenant_id) VALUES($1::uuid,$2,'notification_rules',$3::uuid,$4,$5::jsonb,$6::jsonb,$7,'web',$1::uuid,$1::uuid,$8)", [actor.userId, actor.name, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId, actor.tenantId]); }
  private rowsOf(result: unknown): Array<Record<string, unknown>> { return Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === "number" ? result[0] as Array<Record<string, unknown>> : result as Array<Record<string, unknown>>; }
}
