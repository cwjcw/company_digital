import { Inject, Injectable } from '@nestjs/common';
import { logisticsFeeKeys, logisticsResource } from '@kdos/contracts';
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { LOGISTICS_REPOSITORY, type LogisticsRepository } from './logistics.repository';
import { logisticsField, type LogisticsActor } from './logistics.policy';
/** Small table total, always at shipment grain, using the registered scope and platform compiler. */
@Injectable()
export class LogisticsQueryService {
  constructor(@Inject(LOGISTICS_REPOSITORY) private readonly repository: LogisticsRepository, private readonly registry: TableFilterRegistry) {}
  async summary(query: { search?: string; filterGroup?: unknown }, actor: LogisticsActor) {
    const source = this.registry.get(logisticsResource); source.authorize?.(actor);
    const p: unknown[] = [actor.tenantId], clauses = [await source.buildScope(actor, p)];
    const expressions = Object.fromEntries(Object.entries(source.columns).map(([key, column]) => [key, `record.${column}`]));
    clauses.push(new SqlFilterCompiler(source.fields, expressions, key => logisticsField(actor, key)).compile(query.filterGroup, p));
    if (query.search?.trim()) {
      const columns = (source.searchColumns ?? []).filter(k => logisticsField(actor, k)).map(k => expressions[k]); p.push(`%${query.search.trim()}%`);
      clauses.push(columns.length ? `(${columns.map(c => `COALESCE(${c}::text,'') ILIKE $${p.length}`).join(' OR ')})` : '1=0');
    }
    const keys = [...logisticsFeeKeys, 'totalFee'].filter(k => logisticsField(actor, k));
    const [result] = await this.repository.query(`WITH selected AS(SELECT DISTINCT record.shipment_id${keys.map(k => `,${expressions[k]}`).join('')} FROM ${source.table} record WHERE ${clauses.join(' AND ')}) SELECT count(*)::int containers${keys.map(k => `,sum(${source.columns[k]})::text AS "${k}"`).join('')} FROM selected`, p);
    return { containers: result!.containers, fees: Object.fromEntries(keys.map(k => [k, result![k] ?? null])) };
  }
}
