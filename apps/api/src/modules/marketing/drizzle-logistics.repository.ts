import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { KdosDatabaseClient } from '@kdos/database';
import { KDOS_DATABASE } from '../organization-directory/kdos-database.provider';
import type { LogisticsRepository, LogisticsSession } from './logistics.repository';
@Injectable()
export class DrizzleLogisticsRepository implements LogisticsRepository {
  constructor(@Inject(KDOS_DATABASE) private readonly database: KdosDatabaseClient) {}
  async query(sql: string, params: unknown[]) {
    return this.transaction(String(params[0]), s => s.query(sql, params));
  }
  async transaction<T>(code: string, work: (session: LogisticsSession, tenantId: string) => Promise<T>): Promise<T> {
    const c = await this.database.pool.connect();
    try {
      await c.query('BEGIN');
      const tenant = (await c.query('SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true', [code])).rows[0];
      if (!tenant) throw new NotFoundException('租户不存在或已停用');
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant.id]);
      const result = await work({ query: async (sql, params) => (await c.query(sql, params)).rows,
        audit: async (actor, action, id, before, after) => {
          await c.query(`INSERT INTO audit.audit_logs(tenant_id,user_id,action,resource_type,resource_id,before,after,source,request_id,ip,created_by,updated_by)
          VALUES($1,$2,$3,'logistics-ledger',$4,$5,$6,'WEB',$7,$8,$2,$2)`, [tenant.id, actor.userId, action, id, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId ?? 'logistics', actor.ip ?? null]);
        }
      }, tenant.id);
      await c.query('COMMIT'); return result;
    } catch (e) {
      await c.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') throw new ConflictException('物流单号或文件已存在，请刷新后检查；未覆盖任何记录');
      throw e;
    } finally { c.release(); }
  }
}
