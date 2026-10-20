import { ForbiddenException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { NotificationService } from '../notifications/notification.service';
import { notificationEventDefinition } from '../notifications/notification-event.registry';
import { FinanceRepository } from './finance.repository';
import { financeAdmin, type FinanceActor } from './finance.types';

export const FINANCE_MONTHLY_SUMMARY_EVENT = 'finance.monthly.daily_summary';
export const FINANCE_MONTHLY_SUMMARY_RULE = 'finance-monthly-daily-summary';

const shanghaiTime = (date: Date) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).format(date);
const money = (value: string) => new Decimal(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Scheduled Application Command; uses the same effective monthly relation as the web and Excel. */
@Injectable()
export class FinanceMonthlyNotificationService {
  constructor(private readonly repository: FinanceRepository, private readonly notifications: NotificationService) {}

  async initialize(actor: FinanceActor) {
    this.authorize(actor);
    return this.repository.transaction(actor.tenantId, async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`finance-monthly-rule:${actor.tenantId}`]);
      const [existing] = await manager.query('SELECT id FROM notification_rules WHERE tenant_id=$1 AND rule_key=$2', [actor.tenantId, FINANCE_MONTHLY_SUMMARY_RULE]);
      if (existing) return { status: 'SUCCESS', created: false };
      const [row] = await manager.query(`INSERT INTO notification_rules
        (tenant_id,rule_key,name,event_type,channel,module_code,resource,recipient_rule,enabled,config,created_by,updated_by)
        VALUES($1,$2,'财务月度数据每日汇总',$3,'WECHAT_WORK','finance','finance-e10-monthly','FIXED_USERS',false,
          $5::jsonb,$4::uuid,$4::uuid) RETURNING id`,
      [actor.tenantId, FINANCE_MONTHLY_SUMMARY_RULE, FINANCE_MONTHLY_SUMMARY_EVENT, actor.userId,
        JSON.stringify({ messageType: 'text', recipientTargets: [], template: notificationEventDefinition(FINANCE_MONTHLY_SUMMARY_EVENT)!.defaultTemplate })]);
      await manager.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,'notification_rules',$4,'notification_rule.created',$5::jsonb,$6,'api',$2::uuid,$2::uuid)`,
      [actor.tenantId, actor.userId, actor.username, row.id, JSON.stringify({ eventType: FINANCE_MONTHLY_SUMMARY_EVENT, enabled: false, recipientTargets: [] }), actor.requestId]);
      return { status: 'SUCCESS', created: true };
    });
  }

  async preview(actor: FinanceActor, now = new Date()) {
    this.authorize(actor);
    return this.repository.transaction(actor.tenantId, manager => this.summary(manager, actor.tenantId, now));
  }

  async dispatch(actor: FinanceActor, now = new Date()) {
    this.authorize(actor);
    const localTime = shanghaiTime(now), day = localTime.slice(0, 10);
    if (localTime.slice(11, 16) < '08:30') return { status: 'SUCCESS', skipped: 'BEFORE_SCHEDULE', enqueued: 0 };
    return this.repository.transaction(actor.tenantId, async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`finance-monthly-summary:${actor.tenantId}:${day}`]);
      const rules = await manager.query(`SELECT id FROM notification_rules WHERE tenant_id=$1 AND event_type=$2
        AND resource='finance-e10-monthly' AND module_code='finance' AND channel='WECHAT_WORK'
        AND recipient_rule='FIXED_USERS' AND enabled ORDER BY id`, [actor.tenantId, FINANCE_MONTHLY_SUMMARY_EVENT]);
      if (!rules.length) return { status: 'SUCCESS', skipped: 'NO_ENABLED_RULE', enqueued: 0 };
      const payload = await this.summary(manager, actor.tenantId, now);
      let enqueued = 0;
      for (const rule of rules) {
        const result = await this.notifications.enqueueEvent(actor.tenantId, {
          eventType: FINANCE_MONTHLY_SUMMARY_EVENT, channel: 'WECHAT_WORK', ruleId: rule.id,
          dedupKey: `finance-monthly-summary:${rule.id}:${day}`, payload, createdBy: actor.userId
        }, manager);
        if (result.created) enqueued++;
      }
      return { status: 'SUCCESS', enqueued };
    });
  }

  private async summary(manager: EntityManager, tenant: string, now: Date) {
    const localTime = shanghaiTime(now), yearMonth = localTime.slice(0, 7);
    // Match the monthly UI's tenant-local plan without changing the global database configuration.
    await manager.query('SET LOCAL enable_mergejoin = off');
    await manager.query('SET LOCAL enable_nestloop = off');
    const [row] = await manager.query(`WITH selected AS MATERIALIZED (
        SELECT order_total,department_category FROM finance_e10_monthly WHERE tenant_id=$1 AND year_month=$2
      ) SELECT count(*)::integer order_count,coalesce(sum(order_total),0)::text order_total,
       (SELECT coalesce(jsonb_agg(d ORDER BY d.department),'[]'::jsonb) FROM (
         SELECT coalesce(department_category,'待分类') department,count(*)::integer orders,sum(order_total)::text amount
         FROM selected GROUP BY department_category) d) departments,
       (SELECT max(completed_at) FROM finance_e10_runs WHERE tenant_id=$1 AND status='SUCCESS') last_read_at
      FROM selected`, [tenant, yearMonth]);
    return {
      yearMonth, orderCount: String(row.order_count), orderTotal: money(row.order_total),
      departmentSummary: row.departments.length ? row.departments.map((d: { department: string; orders: number; amount: string }) => `${d.department}：${d.orders}单 / ${money(d.amount)}元`).join('\n') : '暂无有效订单',
      occurredAt: localTime, lastReadAt: row.last_read_at ? shanghaiTime(new Date(row.last_read_at)) : '尚无成功读取'
    };
  }

  private authorize(actor: FinanceActor) {
    if (!actor.tenantId || !financeAdmin(actor)) throw new ForbiddenException('仅财务模块或系统管理员可以运行月度汇总');
  }
}
