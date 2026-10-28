import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { logisticsFields, logisticsFeeKeys, logisticsResource } from '@kdos/contracts';
import { TableFilterRegistry, type TableFilterActor } from '../../common/filtering/table-filter.registry';
import { LOGISTICS_REPOSITORY, type LogisticsRepository } from './logistics.repository';
import { logisticsAuthorize, logisticsColumns, logisticsScope } from './logistics.policy';
import { LogisticsDirectoryQueryService } from './logistics-directory.query.service';
@Injectable()
export class LogisticsFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry, @Inject(LOGISTICS_REPOSITORY) private readonly repository: LogisticsRepository, private readonly directory: LogisticsDirectoryQueryService) {}
  onModuleInit() {
    const groupCache = new WeakMap<object, Promise<Map<string, string>>>();
    const groups = (rows: Array<Record<string, unknown>>, actor?: TableFilterActor) => {
      let promise = groupCache.get(rows);
      if (!promise) {
        promise = this.repository.query(`SELECT id,shipment_id FROM marketing.logistics_details WHERE tenant_id=(SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true) AND id=ANY($2::uuid[])`, [actor!.tenantId, rows.map(r => r.id)]).then(result => new Map(result.map(r => [r.id, r.shipment_id])));
        groupCache.set(rows, promise);
      }
      return promise;
    };
    this.registry.register({
      code: logisticsResource, table: 'marketing.logistics_ledger_rows', tenantColumn: null,
      columns: { id: 'id', version: 'version', ...logisticsColumns }, fields: logisticsFields,
      authorize: logisticsAuthorize, buildScope: logisticsScope, runQuery: (sql, p) => this.repository.query(sql, p),
      defaultSort: { field: 'logisticsNumber', order: 'asc', stableColumns: ['shipment_id', 'id'] },
      searchColumns: ['logisticsNumber', 'styleNumber', 'itemName', 'containerNumber', 'customerCode', 'orderNumber', 'orderNumbers'],
      exportFilename: () => 'marketing_logistics_ledger.xlsx', exportNullAsBlank: true, exportExactNumbers: true,
      // One container fee per output, even if several styles/orders match a query.
      printResolvers: {
        customerCode: async rows => new Map(rows.map(r => [String(r.id), r.customerCode ?? ""])),
        ...Object.fromEntries([...logisticsFeeKeys, 'totalFee'].map(key => [key, async (rows: Array<Record<string, unknown>>, a?: TableFilterActor) => {
          const mapping = await groups(rows, a); const seen = new Set<string>();
          return new Map(rows.map(row => { const id = String(row.id); const group = mapping.get(id)!; const value = seen.has(group) ? '' : row[key]; seen.add(group); return [id, value]; }));
        }])),
        ownerUserId: async (rows, a) => {
          const users = new Map((await this.directory.members(a!.tenantId, true)).map(u => [u.id, `${u.displayName} (${u.username})`]));
          return new Map(rows.map(r => [String(r.id), r.ownerUserId ? users.get(String(r.ownerUserId)) ?? '用户已停用或移除' : '']));
        }
      },
      memberCandidates: async (term, limit, actor) => (await this.directory.members(actor!.tenantId, true))
        .filter(u => !term || u.displayName.includes(term) || u.username.includes(term)).slice(0, limit)
        .map(u => ({ value: u.id, label: `${u.displayName} (${u.username})` }))
    });
  }
}
