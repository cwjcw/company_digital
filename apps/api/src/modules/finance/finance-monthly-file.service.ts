import { ConflictException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { financeMonthlyFields } from '@kdos/contracts';
import { AuthService } from '../../auth';
import { TableFilterRegistry, type TableFilterActor } from '../../common/filtering/table-filter.registry';
import { TablePrintService } from '../../common/printing/table-print.service';
import { NotificationService } from '../notifications/notification.service';
import type { NotificationClaim, NotificationFileDelivery, NotificationRecipientTarget } from '../notifications/notification.types';
import { FinanceMonthlyNotificationService, FINANCE_MONTHLY_SUMMARY_EVENT } from './finance-monthly-notification.service';

const RESOURCE = 'finance-e10-monthly';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
type Manifest = { version: number; recipients: string[]; access: Record<string, string> };

export function financeMonthlyFilename(yearMonth: string) {
  if (yearMonth.length !== 7 || !/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(yearMonth) || Number(yearMonth.slice(0, 4)) < 2025) throw new ConflictException('财务附件发生月份无效');
  return `${yearMonth.slice(0, 4)}年${Number(yearMonth.slice(5))}月接单统计-生管.xlsx`;
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export function financeAccessFingerprint(actor: TableFilterActor) {
  return createHash('sha256').update(JSON.stringify(canonical({ tenantId: actor.tenantId, userId: actor.userId, permissions: [...actor.permissions].sort(),
    system: actor.isSystemAdmin === true, modules: [...(actor.moduleAdminCodes ?? [])].sort(), scopes: [...(actor.tableDataScopes ?? [])].sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b)))) }))).digest('hex');
}

/** Finance-only report delivery. PMC routing/workbooks and its download endpoint remain separate. */
@Injectable()
export class FinanceMonthlyFileService implements OnModuleInit, NotificationFileDelivery {
  constructor(private readonly db: DataSource, private readonly registry: TableFilterRegistry,
    private readonly notifications: NotificationService, private readonly monthly: FinanceMonthlyNotificationService,
    private readonly modules: ModuleRef) {}

  onModuleInit() { this.notifications.registerFinanceFiles(this); }

  private async actor(manager: EntityManager, tenantId: string, userId: string): Promise<TableFilterActor> {
    const [member] = await manager.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled=true', [tenantId, userId]);
    if (!member) throw new ForbiddenException('财务附件接收员工已禁用或不属于当前租户');
    // Reuse the same live IAM resolution as AuthGuard; never mint an elevated export identity.
    const claims = await this.modules.get(AuthService, { strict: false }).claimsForEnabledUser(userId);
    return { ...claims, tenantId, userId, tableDataScopes: claims.tableDataScopes.filter(scope => typeof scope.resource === 'string' && typeof scope.scope === 'string') as TableFilterActor['tableDataScopes'] };
  }

  async prepare(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>, workerId: string,
    users: Array<Record<string, unknown>>, render: (payload: Record<string, unknown>) => string): Promise<NotificationClaim[]> {
    let payload = outbox.payload as Record<string, unknown>;
    const month = String(payload.yearMonth ?? ''); const filename = financeMonthlyFilename(month);
    let manifest = payload.financeFileManifest as Manifest | undefined;
    if (manifest && (manifest.version !== 1 || !Array.isArray(manifest.recipients) || !manifest.access || typeof manifest.access !== 'object')) throw new ConflictException('财务附件快照格式无效');
    const errors = new Set<string>();
    const actors = new Map<string, TableFilterActor>();
    const selected = manifest ? users.filter(user => manifest!.recipients.includes(String(user.userId))) : users;
    for (const user of selected) {
      const id = String(user.userId);
      if (user.enabled !== true || !String(user.wechatUserId ?? '').trim()) {
        await this.skip(manager, tenantId, outbox, id, user.enabled !== true ? 'SKIPPED_DISABLED' : 'SKIPPED_MISSING_WECHAT_ID'); continue;
      }
      try { actors.set(id, await this.actor(manager, tenantId, id)); }
      catch { errors.add(id); }
    }
    if (!manifest) {
      const prepared = await this.db.transaction('REPEATABLE READ', async read => {
        await read.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        await read.query('SET LOCAL enable_mergejoin = off'); await read.query('SET LOCAL enable_nestloop = off'); await read.query('SET LOCAL jit = off');
        // One period snapshot serves all pages and recipients; no second amount algorithm.
        const table = 'finance_notification_' + randomBytes(8).toString('hex');
        await read.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM finance_e10_order_monthly_movements WHERE tenant_id=$1 AND year_month=$2`, [tenantId, month]);
        const summary = await this.monthly.summary(read, tenantId, new Date(), month);
        const source = this.registry.get(RESOURCE); const scoped = new TableFilterRegistry();
        scoped.register({ ...source, table, buildScope: async (actor, values) => `(${await source.buildScope(actor, values, 'read')}) AND (${await source.buildScope(actor, values, 'export')})`, runQuery: (sql, values) => {
          if (values[0] !== tenantId) throw new ForbiddenException('附件查询租户无效'); return read.query(sql, values);
        } });
        const exporter = new TablePrintService(scoped, this.db);
        const files: Array<{ userId: string; content: Buffer; fingerprint: string }> = [];
        for (const [userId, actor] of actors) {
          try {
            const content = await exporter.exportXlsx(RESOURCE, { context: { monthFrom: month, monthTo: month }, columnKeys: financeMonthlyFields.map(field => field.key) }, actor);
            if (content.length > MAX_FILE_BYTES) throw new ConflictException('财务附件超过企业微信20MB限制');
            files.push({ userId, content, fingerprint: financeAccessFingerprint(actor) });
          } catch (error) { if (!(error instanceof ForbiddenException)) throw error; errors.add(userId); }
        }
        return { summary, files };
      });
      manifest = { version: 1, recipients: selected.map(user => String(user.userId)), access: {} };
      for (const file of prepared.files) {
        await manager.query(`INSERT INTO notification_attachments(tenant_id,notification_outbox_id,recipient_user_id,filename,part,content,sha256)
          VALUES($1,$2::uuid,$3::uuid,$4,1,$5,$6)`, [tenantId, outbox.id, file.userId, filename, file.content, createHash('sha256').update(file.content).digest('hex')]);
        manifest.access[file.userId] = file.fingerprint;
      }
      payload = { ...payload, ...prepared.summary, financeFileManifest: manifest };
      await manager.query('UPDATE notification_outbox SET payload=$3::jsonb WHERE tenant_id=$1 AND id=$2::uuid', [tenantId, outbox.id, JSON.stringify(payload)]);
    }
    const claims: NotificationClaim[] = [];
    for (const user of selected) {
      const id = String(user.userId); const actor = actors.get(id);
      if (!actor) continue;
      if (errors.has(id) || manifest.access[id] !== financeAccessFingerprint(actor)) { errors.add(id); continue; }
      const [file] = await manager.query('SELECT id,filename,sha256 FROM notification_attachments WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND recipient_user_id=$3::uuid AND part=1', [tenantId, outbox.id, id]);
      if (!file || file.filename !== filename) throw new ConflictException('财务附件快照不完整');
      for (const component of ['text', 'file:1']) {
        const [previous] = await manager.query('SELECT * FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND recipient_user_id=$3::uuid AND component=$4 ORDER BY attempt DESC,id DESC LIMIT 1', [tenantId, outbox.id, id, component]);
        if (previous?.status === 'SENT') continue;
        let delivery = previous;
        if (delivery && ['PENDING', 'PROCESSING'].includes(delivery.status) && delivery.wechat_user_id !== user.wechatUserId) throw new ForbiddenException('接收人的企业微信身份已变化，请复核旧投递');
        if (!delivery || !['PENDING', 'PROCESSING'].includes(delivery.status)) [delivery] = await manager.query(`INSERT INTO notification_delivery_logs(tenant_id,notification_outbox_id,recipient_user_id,wechat_user_id,attempt,status,component,attachment_id)
          VALUES($1,$2::uuid,$3::uuid,$4,$5,'PENDING',$6,$7::uuid) RETURNING *`, [tenantId, outbox.id, id, user.wechatUserId, Number(previous?.attempt ?? 0) + 1, component, component === 'text' ? null : file.id]);
        claims.push({ notificationId: String(outbox.id), messageType: component === 'text' ? 'text' : 'file', content: render(payload),
          ...(component === 'text' ? {} : { attachment: { id: file.id, filename: file.filename, downloadPath: `/internal/notifications/${outbox.id}/finance-attachments/${file.id}` } }),
          recipients: [{ deliveryId: delivery.id, userId: id, displayName: String(user.displayName), wechatUserId: String(user.wechatUserId) }] });
      }
    }
    if (selected.length) await manager.query(`UPDATE notification_delivery_logs SET status='SKIPPED',errcode='FINANCE_RECIPIENT_RESOLVED',errmsg='接收对象配置已调整'
      WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND component='routing' AND status='FAILED'
      AND errcode='FINANCE_MONTHLY_EXPORT_FORBIDDEN' AND (recipient_user_id IS NULL OR NOT(recipient_user_id=ANY($3::uuid[])))`, [tenantId, outbox.id, [...errors]]);
    for (const id of errors) await this.routingError(manager, tenantId, outbox, id);
    if (!selected.length) await this.routingError(manager, tenantId, outbox, null);
    if (!claims.length) await manager.query(`UPDATE notification_outbox SET status=$4::varchar,locked_by=NULL,locked_at=NULL,next_retry_at=NULL,last_error=$5,
      sent_at=CASE WHEN $4::varchar='SENT' THEN now() ELSE sent_at END,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND locked_by=$3`,
    [tenantId, outbox.id, workerId, errors.size || !selected.length ? 'FAILED' : 'SENT', errors.size || !selected.length ? '财务附件接收人无有效读取/导出权限，或权限已变化，请复核' : null]);
    return claims;
  }

  private async skip(manager: EntityManager, tenant: string, outbox: Record<string, unknown>, userId: string, code: string) {
    const [existing] = await manager.query("SELECT id FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND recipient_user_id=$3::uuid AND component='text' AND status='SKIPPED'", [tenant, outbox.id, userId]);
    if (!existing) await manager.query(`INSERT INTO notification_delivery_logs(tenant_id,notification_outbox_id,recipient_user_id,attempt,status,component,errcode,errmsg)
      VALUES($1,$2::uuid,$3::uuid,$4,'SKIPPED','text',$5::varchar,$5::varchar)`, [tenant, outbox.id, userId, outbox.attempts, code]);
  }
  private async routingError(manager: EntityManager, tenant: string, outbox: Record<string, unknown>, userId: string | null) {
    const [existing] = await manager.query("SELECT id FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND recipient_user_id IS NOT DISTINCT FROM $3::uuid AND component='routing' AND status='FAILED'", [tenant, outbox.id, userId]);
    if (!existing) await manager.query(`INSERT INTO notification_delivery_logs(tenant_id,notification_outbox_id,recipient_user_id,attempt,status,component,errcode,errmsg,error_message)
      VALUES($1,$2::uuid,$3::uuid,$4,'FAILED','routing','FINANCE_MONTHLY_EXPORT_FORBIDDEN',$5,$5)`, [tenant, outbox.id, userId, outbox.attempts, '财务附件接收人无有效读取/导出权限，或权限已变化，请复核']);
  }

  async attachment(tenantId: string, outboxId: string, attachmentId: string, workerId: string) {
    return this.db.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const [row] = await manager.query(`SELECT a.*,b.payload,r.config FROM notification_attachments a
        JOIN notification_outbox b ON b.tenant_id=a.tenant_id AND b.id=a.notification_outbox_id
        JOIN notification_rules r ON r.tenant_id=b.tenant_id AND r.id=b.notification_rule_id
        WHERE a.tenant_id=$1 AND b.id=$2::uuid AND a.id=$3::uuid AND b.status='PROCESSING' AND b.locked_by=$4
          AND b.event_type=$5 AND r.enabled=true`, [tenantId, outboxId, attachmentId, workerId, FINANCE_MONTHLY_SUMMARY_EVENT]);
      if (!row) throw new ForbiddenException('财务附件租户、规则或领取租约无效');
      const targets: NotificationRecipientTarget[] = row.config.recipientTargets ?? (row.config.recipientUserIds ?? []).map((userId: string) => ({ type: 'USER', userId }));
      const current = await this.notifications.configuredRecipientUsers(manager, tenantId, targets);
      const member = current.find(user => user.userId === row.recipient_user_id && user.enabled === true && String(user.wechatUserId ?? '').trim());
      if (!member) throw new ForbiddenException('财务附件接收人已失效');
      const [pending] = await manager.query(`SELECT id FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid
        AND attachment_id=$3::uuid AND recipient_user_id=$4::uuid AND wechat_user_id=$5 AND status IN ('PENDING','PROCESSING')`, [tenantId, outboxId, attachmentId, row.recipient_user_id, member.wechatUserId]);
      if (!pending) throw new ForbiddenException('财务附件投递或企业微信身份已失效');
      const actor = await this.actor(manager, tenantId, row.recipient_user_id);
      const manifest = row.payload.financeFileManifest as Manifest;
      if (manifest?.access?.[row.recipient_user_id] !== financeAccessFingerprint(actor)) throw new ForbiddenException('接收人的导出权限已变化，禁止投递旧附件');
      const content = Buffer.from(row.content);
      if (createHash('sha256').update(content).digest('hex') !== row.sha256) throw new ConflictException('财务附件校验失败');
      return { filename: row.filename as string, content };
    });
  }
}
