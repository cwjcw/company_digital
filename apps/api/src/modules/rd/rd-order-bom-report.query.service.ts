import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { rdOrderBomDetailColumns, rdOrderBomDivisionColumns, rdOrderBomOrderColumns, rdOrderBomReportFields, rdOrderBomReportResource } from '@kdos/contracts';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import { TableFilterRegistry, type TableFilterActor, type TableFilterSource, type TablePrintRowQuery } from '../../common/filtering/table-filter.registry';
import { parseFilterGroup, type ParsedFilterGroup } from '../../common/filtering/filter.contract';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { RdOrderBomReader } from '../../integrations/e10/rd-order-bom.reader';
import { matchE10Bom, orderBomStatus, waitingDays, type E10BomBundle } from './rd-order-bom-report.calculator';

type Allocation = { id: string; tenantId: string; divisionId: string | null; divisionName: string | null; orderNumber: string; itemCode: string; itemName: string | null; orderDate: string | null; customerDueDate: string | null };
type ReportRow = Record<string, unknown> & { id: string; divisionId: string | null; orderNumber?: string; itemCode?: string; bomStatus?: string; bomWaitingDays?: number | null; currentWaitingDays?: number | null; matchIssue?: string | null };
const viewColumns = { detail: rdOrderBomDetailColumns, orders: rdOrderBomOrderColumns, divisions: rdOrderBomDivisionColumns } as const;
const allocationColumns = { id: 'id', createdBy: 'created_by', divisionId: 'division_id', orderNumber: 'order_number', itemCode: 'item_code', itemName: 'item_name', orderDate: 'order_date', customerDueDate: 'customer_due_date' };
const shanghaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const stableId = (key: string) => {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const text = hex.join(''); return `${text.slice(0,8)}-${text.slice(8,12)}-${text.slice(12,16)}-${text.slice(16,20)}-${text.slice(20)}`;
};
const textDateTime = (value: string | null) => value ? `${value.slice(0,10)} 00:00:00` : null;

function valuesOf(rule: any): unknown[] { return Array.isArray(rule.values) ? rule.values : rule.value == null ? [] : [rule.value]; }
function testRule(row: ReportRow, rule: any): boolean {
  const key = String(rule.field ?? ''), value = row[key], operator = String(rule.operator ?? '').toLowerCase();
  const empty = value == null || value === '';
  const numeric = ['bomWaitingDays','currentWaitingDays','requiredBomItemCount','existingBomItemCount','missingBomItemCount','completionRate','orderCount','averageBomWaitingDays'].includes(key);
  const compare = (left: unknown, right: unknown) => numeric ? Number(left) - Number(right) : String(left ?? '').slice(0,10).localeCompare(String(right ?? '').slice(0,10));
  if (operator === 'is_empty') return empty;
  if (operator === 'is_not_empty') return !empty;
  if (operator === 'in' || operator === 'not_in') { const hit = valuesOf(rule).map(String).includes(String(value ?? '')); return operator === 'in' ? hit : !hit; }
  if (operator === 'between') return !empty && compare(value,rule.min) >= 0 && compare(value,rule.max) <= 0;
  if (operator === 'dynamic') throw new BadRequestException('BOM报表日期筛选不支持动态范围，请指定明确日期');
  const expected = String(rule.value ?? ''), actual = String(value ?? '');
  switch (operator) {
    case 'eq': return actual === expected || actual.slice(0,10) === expected.slice(0,10);
    case 'neq': return actual !== expected && actual.slice(0,10) !== expected.slice(0,10);
    case 'contains': return actual.toLowerCase().includes(expected.toLowerCase());
    case 'not_contains': return !actual.toLowerCase().includes(expected.toLowerCase());
    case 'starts_with': return actual.toLowerCase().startsWith(expected.toLowerCase());
    case 'gt': return compare(value,rule.value) > 0;
    case 'gte': return compare(value,rule.value) >= 0;
    case 'lt': return compare(value,rule.value) < 0;
    case 'lte': return compare(value,rule.value) <= 0;
    default: throw new BadRequestException(`BOM报表不支持筛选操作：${operator}`);
  }
}
function testGroup(row: ReportRow, group: ParsedFilterGroup): boolean {
  const tests = [...group.rules.map(rule => testRule(row, rule)), ...(group.groups ?? []).map(child => testGroup(row, child))];
  return !tests.length || (group.logic === 'OR' ? tests.some(Boolean) : tests.every(Boolean));
}
function viewFields(view: keyof typeof viewColumns) {
  const names = new Set(viewColumns[view].map(([key]) => key));
  return rdOrderBomReportFields.filter(field => names.has(field.key as never));
}
function readable(actor: TableFilterActor, key: string) {
  if (actor.hasFieldPermission) return actor.hasFieldPermission(rdOrderBomReportResource, key, 'read');
  return actor.isSystemAdmin === true || actor.permissions.includes('*') || actor.moduleAdminCodes?.includes('rd') === true || actor.permissions.includes(`${rdOrderBomReportResource}:*:read`) || actor.permissions.includes(`${rdOrderBomReportResource}:${key}:read`);
}

@Injectable()
export class RdOrderBomReportQueryService {
  constructor(private readonly dataSource: DataSource, private readonly registry: TableFilterRegistry, private readonly e10: RdOrderBomReader) {}

  onModuleInit() {
    const source: TableFilterSource = {
      code: rdOrderBomReportResource, table: 'mps_order_allocations', columns: allocationColumns, fields: rdOrderBomReportFields,
      searchColumns: ['orderNumber', 'itemCode', 'itemName'],
      authorize: actor => {
        const allowed = actor.isSystemAdmin || actor.permissions.includes('*') || actor.moduleAdminCodes?.includes('rd')
          || actor.permissions.includes(`${rdOrderBomReportResource}:*:read`) || actor.permissions.includes(`${rdOrderBomReportResource}:*:export`);
        if (!allowed) throw new ForbiddenException('当前权限组没有订单BOM报表查看权限');
      },
      buildScope: (actor, params, action = 'read') => this.scope(actor, params, action),
      exportVariant: context => {
        const view = this.view(context.view);
        const fields = viewFields(view);
        const columns = Object.fromEntries(fields.map(field => [field.key, allocationColumns[field.key as keyof typeof allocationColumns] ?? field.key]));
        return { fields, columns };
      },
      listRows: query => this.listRows(query),
      printRows: query => this.listRows(query)
    };
    this.registry.register(source);
  }

  private scope(actor: TableFilterActor, params: unknown[], action: string) {
    if (actor.isSystemAdmin || actor.permissions.includes('*') || actor.moduleAdminCodes?.includes('rd')) return '1=1';
    return buildDataScopeClause({ resource: rdOrderBomReportResource, action, columns: allocationColumns, actor, params });
  }
  private view(value: unknown): keyof typeof viewColumns {
    const view = String(value ?? 'detail');
    if (view !== 'detail' && view !== 'orders' && view !== 'divisions') throw new BadRequestException('BOM报表视图无效');
    return view;
  }
  private async listRows(query: TablePrintRowQuery) {
    const view = this.view(query.context.view), fields = viewFields(view);
    const invalidFilter = (group: ParsedFilterGroup) => {
      for (const rule of group.rules) {
        const key = String(rule.field ?? '');
        if (!fields.some(field => field.key === key)) throw new BadRequestException(`字段 ${key} 不属于当前BOM报表视图`);
        if (!readable(query.actor, key)) throw new ForbiddenException(`当前权限组不能按该字段筛选：${key}`);
      }
      for (const child of group.groups ?? []) invalidFilter(child);
    };
    const filter = parseFilterGroup(query.filterGroup); invalidFilter(filter);
    const params: unknown[] = [query.actor.tenantId];
    const scope = this.scope(query.actor, params, 'read');
    const exportScope = query.action === 'export' ? this.scope(query.actor, params, 'export') : null;
    const where = [`record.tenant_id=$1`, `record.archived_at IS NULL`, `record.order_status='已审核'`, `(${scope})`, ...(exportScope ? [`(${exportScope})`] : [])];
    if (query.ids && view === 'detail') { params.push(query.ids); where.push(`record.id=ANY($${params.length}::uuid[])`); }
    if (query.search) {
      const searchable = (view === 'detail' ? ['orderNumber', 'itemCode', 'itemName'] : view === 'orders' ? ['orderNumber'] : ['divisionId'])
        .filter(key => readable(query.actor, key));
      if (!searchable.length) where.push('1=0');
      else {
        params.push(`%${query.search}%`);
        where.push(`(${searchable.map(key => key === 'divisionId' && view === 'divisions'
          ? `COALESCE(unit.name,'') ILIKE $${params.length}`
          : `COALESCE(record.${allocationColumns[key as keyof typeof allocationColumns]}::text,'') ILIKE $${params.length}`).join(' OR ')})`);
      }
    }
    // Validate the public filter contract with the shared compiler. This report
    // applies the resulting typed filters after joining the read-only E10 snapshot,
    // so OR groups containing BOM status retain their correct semantics.
    if (filter.rules.length || filter.groups?.length) {
      const bindings = Object.fromEntries(fields.map(field => [field.key, `report_rows.${field.key}`]));
      new SqlFilterCompiler(fields, bindings, key => readable(query.actor, key), column => column).compile(filter, []);
    }
    const allocations = await this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [query.actor.tenantId]);
      return manager.query(`SELECT record.id::text id,record.tenant_id "tenantId",record.division_id::text "divisionId",unit.name "divisionName",
        record.order_number "orderNumber",record.item_code "itemCode",record.item_name "itemName",
        record.order_date::text "orderDate",record.customer_due_date::text "customerDueDate"
        FROM mps_order_allocations record LEFT JOIN organization_units unit ON unit.id=record.division_id
        WHERE ${where.join(' AND ')} ORDER BY record.order_date DESC NULLS LAST,record.order_number,record.item_code,record.id LIMIT 20001`, params);
    }) as Allocation[];
    if (allocations.length > 20000) throw new BadRequestException('当前BOM报表记录较多，请先按日期、事业部或订单筛选后查询');
    const snapshot: E10BomBundle = await this.e10.read(allocations.map(row => row.itemCode));
    const today = shanghaiToday();
    const details: ReportRow[] = allocations.map(row => {
      const matched = matchE10Bom(row.itemCode, snapshot, today);
      const waits = waitingDays(row.orderDate, matched.approvalDate, today, matched.status);
      const orderDay = row.orderDate?.slice(0,10) ?? null;
      const dueDay = row.customerDueDate?.slice(0,10) ?? null;
      return { id: row.id, divisionId: row.divisionId, divisionName: row.divisionName ?? '待匹配', orderNumber: row.orderNumber,
        itemCode: row.itemCode, itemName: row.itemName, orderDate: textDateTime(orderDay), customerDueDate: textDateTime(dueDay),
        bomStatus: matched.status, bomApprovalDate: matched.approvalDate, bomWaitingDays: waits.bom,
        currentWaitingDays: waits.current, matchIssue: matched.matchIssue ?? (!orderDay ? '订单分配表下单日期为空或无效' : null) };
    });
    const rows = view === 'detail' ? details : view === 'orders' ? this.aggregateOrders(details) : this.aggregateDivisions(details);
    const requestedIds = query.ids ? new Set(query.ids) : null;
    const authorizedRows = rows.filter(row => {
      if (requestedIds && !requestedIds.has(row.id)) return false;
      const searchKeys = view === 'detail' ? ['orderNumber','itemCode','itemName'] : view === 'orders' ? ['orderNumber'] : ['divisionName'];
      if (query.search && !searchKeys.some(key => readable(query.actor, key === 'divisionName' ? 'divisionId' : key) && String(row[key] ?? '').toLowerCase().includes(query.search.toLowerCase()))) return false;
      return testGroup(row, filter);
    });
    const sortKey = String(query.sortField ?? '');
    if (sortKey) {
      if (!fields.some(field => field.key === sortKey)) throw new BadRequestException('排序字段无效');
      if (!readable(query.actor, sortKey)) throw new ForbiddenException('当前权限组不能按该字段排序');
    }
    const [sortField, sortOrder] = sortKey ? [sortKey, String(query.sortOrder).toLowerCase() === 'desc' ? -1 : 1] : ['orderNumber', 1];
    authorizedRows.sort((a,b) => {
      const av = a[sortField], bv = b[sortField]; if (av == null) return bv == null ? 0 : 1; if (bv == null) return -1;
      const cmp = String(av).localeCompare(String(bv), 'zh-CN', { numeric: true }); return cmp * sortOrder;
    });
    const total = authorizedRows.length, page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(1000, Math.max(1, Number(query.pageSize) || 100));
    const selected = new Set(query.fieldKeys.filter(key => fields.some(field => field.key === key) && readable(query.actor,key)));
    const pageRows = authorizedRows.slice((page-1)*pageSize, page*pageSize).map(row => Object.fromEntries([
      ['id',row.id], ...Object.entries(row).filter(([key]) => selected.has(key)).map(([key,value]) => [key,key === 'divisionId' ? row.divisionName : value]),
      ...(view === 'detail' && readable(query.actor, 'matchIssue') ? [['matchIssue', row.matchIssue]] : [])
    ]));
    return { rows: pageRows, total, page, pageSize };
  }
  private aggregateOrders(details: ReportRow[]): ReportRow[] {
    const groups = new Map<string, ReportRow[]>();
    for (const row of details) { const key = JSON.stringify([row.divisionId, row.orderNumber]); const items = groups.get(key) ?? []; items.push(row); groups.set(key, items); }
    return [...groups.entries()].map(([key, entries]) => {
      const unique = new Map<string, ReportRow>();
      for (const row of entries) unique.set(String(row.itemCode), row);
      const items = [...unique.values()], required = items.filter(row => row.bomStatus !== 'NOT_REQUIRED'), existing = required.filter(row => row.bomStatus === 'HAS_BOM').length;
      const noBom = required.filter(row => row.bomStatus === 'NO_BOM').length;
      const states = items.map(row => ({ bomStatus: String(row.bomStatus) }));
      const orderDates = [...new Set(entries.map(row => row.orderDate).filter((value): value is string => typeof value === 'string'))];
      return { id: stableId(`${entries[0].tenantId}\u001f${key}`), divisionId: entries[0].divisionId, divisionName: entries[0].divisionName, orderNumber: entries[0].orderNumber,
        orderDate: orderDates.length === 1 ? orderDates[0] : null, requiredBomItemCount: required.length, existingBomItemCount: existing, missingBomItemCount: noBom,
        completionRate: required.length ? Number((existing / required.length * 100).toFixed(2)) : null, orderBomStatus: orderBomStatus(states) };
    });
  }
  private aggregateDivisions(details: ReportRow[]): ReportRow[] {
    const grouped = new Map<string, ReportRow[]>();
    for (const row of details) { const key = row.divisionId ?? '__UNMATCHED__'; const list = grouped.get(key) ?? []; list.push(row); grouped.set(key,list); }
    return [...grouped.entries()].map(([key, entries]) => {
      const unique = new Map<string, ReportRow>();
      for (const row of entries) unique.set(JSON.stringify([row.orderNumber,row.itemCode]),row);
      const rows = [...unique.values()], required = rows.filter(row => row.bomStatus !== 'NOT_REQUIRED'), existing = required.filter(row => row.bomStatus === 'HAS_BOM').length;
      const waits = required.filter(row => row.bomStatus === 'HAS_BOM' && row.bomWaitingDays != null).map(row => Number(row.bomWaitingDays));
      const orderKeys = new Set(rows.map(row => row.orderNumber));
      return { id: stableId(`${entries[0].tenantId}\u001f${key}`), divisionId: key === '__UNMATCHED__' ? null : entries[0].divisionId, divisionName: entries[0].divisionName,
        orderCount: orderKeys.size, requiredBomItemCount: required.length, existingBomItemCount: existing,
        missingBomItemCount: required.filter(row => row.bomStatus === 'NO_BOM').length,
        completionRate: required.length ? Number((existing / required.length * 100).toFixed(2)) : null,
        averageBomWaitingDays: waits.length ? Number((waits.reduce((sum,value) => sum+value,0)/waits.length).toFixed(2)) : null };
    });
  }
}
