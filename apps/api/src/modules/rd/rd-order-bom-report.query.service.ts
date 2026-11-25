import { allocationBomWaiting } from './rd-allocation-bom-state';
import { BadRequestException, ForbiddenException, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { rdOrderBomDetailColumns, rdOrderBomDivisionColumns, rdOrderBomOrderColumns, rdOrderBomReportFields, rdOrderBomReportResource } from '@kdos/contracts';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import { TableFilterRegistry, type TableFilterActor, type TableFilterSource, type TablePrintRowQuery, type TableFilterCandidateQuery } from '../../common/filtering/table-filter.registry';
import { parseFilterGroup, type ParsedFilterGroup } from '../../common/filtering/filter.contract';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { RdOrderBomReader } from '../../integrations/e10/rd-order-bom.reader';
import { UnifiedBomQueryService } from './unified-bom.query.service';
import { createBomMatcher, orderBomStatus, waitingDays, type E10BomBundle, type LocalBomHead } from './rd-order-bom-report.calculator';

type Allocation = { id: string; tenantId: string; divisionId: string | null; divisionName: string | null; orderNumber: string; itemCode: string; itemName: string | null; orderDate: string | null; expectedShippingDate: string | null; allocationDate?:string|null; initialBomStatus?:string|null; trackedBomStatus?:'Y'|'N'|null; lockedWaitingDays?:number|null };
type ReportRow = Record<string, unknown> & { id: string; tenantId?: string; divisionId: string | null; orderNumber?: string; itemCode?: string; bomStatus?: string | null; bomVerified?: boolean; bomWaitingDays?: number | null; currentWaitingDays?: number | null };
const viewColumns = { detail: rdOrderBomDetailColumns, orders: rdOrderBomOrderColumns, divisions: rdOrderBomDivisionColumns } as const;
const allocationColumns = { id: 'id', createdBy: 'created_by', divisionId: 'division_id', orderNumber: 'order_number', itemCode: 'item_code', itemName: 'item_name', orderDate: 'order_date', customerDueDate: 'expected_shipping_date' };
const dateKeys = new Set(['allocationDate','orderDate', 'customerDueDate', 'bomApprovalDate']);
const shanghaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const formatShanghaiDate = (date: Date) => {
  const parts = shanghaiDateFormatter.formatToParts(date);
  const part = (type: string) => parts.find(entry => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
function reportDateDisplay(field: { key: string }, value: unknown): string | undefined {
  if (field.key === 'initialBomStatus' && (value == null || value === '')) return '';
  if (!dateKeys.has(field.key)) return undefined;
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  // These report values are SQL DATE or E10 local wall-clock timestamps without
  // an offset. Preserve their business calendar day; convert only true instants.
  const localCalendarValue = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$)/);
  if (localCalendarValue) return localCalendarValue[1];
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) ? raw : formatShanghaiDate(instant);
}
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
  const numeric = ['bomWaitingDays','currentWaitingDays','itemCount','unmatchedBomItemCount','existingBomItemCount','missingBomItemCount','completionRate','orderCount','averageBomWaitingDays'].includes(key);
  const compare = (left: unknown, right: unknown) => numeric ? Number(left) - Number(right) : (dateKeys.has(key) ? String(left ?? '').slice(0,10) : String(left ?? '')).localeCompare(dateKeys.has(key) ? String(right ?? '').slice(0,10) : String(right ?? ''));
  if (operator === 'is_empty') return empty;
  if (operator === 'is_not_empty') return !empty;
  if (operator === 'in' || operator === 'not_in') { const hit = valuesOf(rule).map(String).includes(String(value ?? '')); return operator === 'in' ? hit : !hit; }
  if (operator === 'between') return !empty && compare(value,rule.min) >= 0 && compare(value,rule.max) <= 0;
  if (empty && ['gt','gte','lt','lte'].includes(operator)) return false;
  if (operator === 'dynamic') throw new BadRequestException('BOM报表日期筛选不支持动态范围，请指定明确日期');
  const expected = String(rule.value ?? ''), actual = String(value ?? '');
  switch (operator) {
    case 'eq': return actual === expected || (dateKeys.has(key) && actual.slice(0,10) === expected.slice(0,10));
    case 'neq': return actual !== expected && (!dateKeys.has(key) || actual.slice(0,10) !== expected.slice(0,10));
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
  private readonly logger = new Logger(RdOrderBomReportQueryService.name);
  constructor(private readonly dataSource: DataSource, private readonly registry: TableFilterRegistry, private readonly e10: RdOrderBomReader, @Optional() private readonly unified?: UnifiedBomQueryService) {}

  /** Current order-progress rule: exact E10 ITEM code plus any approved E10 BOM head. */
  async resolveBomStatuses(itemCodes: string[], tenantId: string): Promise<{ statuses: Map<string, "HAS_BOM" | "NO_BOM">; warning: string | null }> {
    const codes = [...new Set(itemCodes.map(value => String(value ?? "").trim()).filter(Boolean))];
    if (!codes.length) return { statuses: new Map(), warning: null };
    let snapshot: E10BomBundle;
    try {
      snapshot = await this.e10.read(codes, true);
    } catch (error) {
      this.logger.error(JSON.stringify({ event: "division_order_progress_bom_query_failed", tenantId, itemCount: codes.length, error: error instanceof Error ? error.message : String(error) }));
      return { statuses: new Map(codes.map(code => [code, "NO_BOM"] as const)), warning: "E10图纸状态查询失败，页面按N显示；已记录查询错误。" };
    }
    const itemIdsByCode = new Map<string, Set<string>>();
    for (const item of snapshot.items) {
      if (!codes.includes(item.item_code)) continue;
      const ids = itemIdsByCode.get(item.item_code) ?? new Set<string>();
      ids.add(item.item_id.trim().toLowerCase()); itemIdsByCode.set(item.item_code, ids);
    }
    const approvedIds = new Set(snapshot.boms.filter(bom => bom.approve_status?.trim().toUpperCase() === "Y").map(bom => bom.item_id.trim().toLowerCase()));
    const statuses = new Map(codes.map(code => [code, [...(itemIdsByCode.get(code) ?? [])].some(id => approvedIds.has(id)) ? "HAS_BOM" : "NO_BOM"] as const));
    const unmatched = codes.filter(code => !itemIdsByCode.has(code));
    const noBom = codes.filter(code => itemIdsByCode.has(code) && statuses.get(code) === "NO_BOM");
    if (noBom.length) this.logger.log(JSON.stringify({ event: "division_order_progress_bom_confirmed_no_bom", tenantId, count: noBom.length, itemCodes: noBom.slice(0, 20), sourceSnapshotAt: snapshot.sourceSnapshotAt }));
    if (unmatched.length) this.logger.warn(JSON.stringify({ event: "division_order_progress_bom_item_code_unmatched", tenantId, count: unmatched.length, itemCodes: unmatched.slice(0, 20), sourceSnapshotAt: snapshot.sourceSnapshotAt }));
    try {
      const [state] = await this.dataSource.transaction("REPEATABLE READ", async manager => {
        await manager.query("SET TRANSACTION READ ONLY");
        await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        return manager.query(`SELECT last_status "lastStatus",last_error_code "lastErrorCode",last_success_at "lastSuccessAt"
          FROM rd_bom_sync_state WHERE tenant_id=$1`, [tenantId]);
      });
      if (state?.lastStatus !== "SUCCESS" || state?.lastErrorCode) this.logger.warn(JSON.stringify({ event: "division_order_progress_bom_index_not_synced", tenantId, lastStatus: state?.lastStatus ?? null, lastErrorCode: state?.lastErrorCode ?? null, lastSuccessAt: state?.lastSuccessAt ?? null }));
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: "division_order_progress_bom_sync_state_check_failed", tenantId, error: error instanceof Error ? error.message : String(error) }));
    }
    return { statuses, warning: null };
  }

  onModuleInit() {
    const source: TableFilterSource = {
      code: rdOrderBomReportResource, table: 'mps_order_allocations', columns: Object.fromEntries(rdOrderBomReportFields.map(f=>[f.key,allocationColumns[f.key as keyof typeof allocationColumns]??f.key])), fields: rdOrderBomReportFields,
      runQuery: (sql, params) => this.dataSource.transaction(async manager => {
        await manager.query("SELECT set_config('app.tenant_id',$1,true)", [String(params[0])]);
        return manager.query(sql, params);
      }),
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
      printVariant: context => {
        const fields=viewFields(this.view(context.view));
        return {fields,columns:Object.fromEntries(fields.map(field=>[field.key,allocationColumns[field.key as keyof typeof allocationColumns]??field.key]))};
      },
      exportDisplayValue: reportDateDisplay,
      printDisplayValue: reportDateDisplay,
      // listRows already resolves the department display alias. Do not send
      // these names back through the generic UUID-based department resolver.
      printResolvers: { divisionId: async rows => new Map(rows.filter(row=>row.divisionId!=null).map(row=>[String(row.id),row.divisionId])) },
      listRows: query => this.listRows(query),
      candidateValues: query => this.candidateValues(query),
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
  private async candidateValues(query: TableFilterCandidateQuery) {
    const fields=viewFields(this.view(query.context.view));
    if (!fields.some(f=>f.key===query.fieldKey)) throw new BadRequestException('字段不属于当前BOM报表视图');
    if (!readable(query.actor,query.fieldKey)) throw new ForbiddenException('当前权限组不能按该字段筛选');
    const result=await this.listRows({actor:query.actor,context:query.context,search:query.tableSearch,filterGroup:query.filterGroup,
      fieldKeys:[query.fieldKey],page:1,pageSize:1000,action:'read'},query.fieldKey);
    const values=new Map<string,string>();
    for (const row of result.rows) {
      const raw=row.value,label=row.label;
      if (raw==null || raw==='' || !String(label??raw).toLowerCase().includes(query.search.toLowerCase())) continue;
      values.set(String(raw),String(label??raw));
    }
    const options=[...values.entries()].sort((a,b)=>a[1].localeCompare(b[1],'zh-CN')).map(([value,label])=>({value,label}));
    return {options:options.slice(0,query.limit),hasMore:options.length>query.limit};
  }
  private async listRows(query: TablePrintRowQuery, candidateField?: string) {
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
        record.order_date::text "orderDate",record.expected_shipping_date::text "expectedShippingDate",
        tracking.allocation_date::text "allocationDate",tracking.initial_bom_status "initialBomStatus",
        tracking.current_bom_status "trackedBomStatus",tracking.locked_waiting_days "lockedWaitingDays"
        FROM mps_order_allocations record LEFT JOIN organization_units unit ON unit.id=record.division_id
        LEFT JOIN rd_allocation_bom_state tracking ON tracking.tenant_id=record.tenant_id AND tracking.allocation_id=record.id
        WHERE ${where.join(' AND ')} ORDER BY record.order_date DESC NULLS LAST,record.order_number,record.item_code,record.id LIMIT 20001`, params);
    }) as Allocation[];
    if (allocations.length > 20000) throw new BadRequestException('当前BOM报表记录较多，请先按日期、事业部或订单筛选后查询');
    if (!allocations.length) return { rows: [], total: 0, page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(1000, Math.max(1, Number(query.pageSize) || 100)) };
    const unified = this.unified ? await this.unified.read(query.actor.tenantId,[...new Set(allocations.map(row=>row.itemCode))]) : {enabled:false as const};
    const index = unified.enabled ? {heads:[] as LocalBomHead[],warning:unified.warning} : await (async()=> {
    // ITEM existence is checked against E10 for current allocation item codes;
    // absence from the local BOM index can therefore safely mean NO_BOM only
    // when E10 confirmed that the ITEM exists.
    const snapshot: E10BomBundle = await this.e10.read(allocations.map(row => row.itemCode));
    const allocationCodes = new Set(allocations.map(row => row.itemCode));
    const itemIds = [...new Set(snapshot.items.filter(item => allocationCodes.has(item.item_code)).map(item => item.item_id))];
    const legacyIndex = await this.dataSource.transaction('REPEATABLE READ', async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [query.actor.tenantId]);
      const [state] = await manager.query(`SELECT active_generation::text "activeGeneration",last_success_at "lastSuccessAt",last_status "lastStatus",last_error_code "lastErrorCode" FROM rd_bom_sync_state WHERE tenant_id=$1`, [query.actor.tenantId]);
      if (!state?.activeGeneration || !state.lastSuccessAt) throw new ServiceUnavailableException('E10 BOM主档首次同步尚未完成，当前报表暂不可计算；请检查同步任务状态');
      const heads: LocalBomHead[] = itemIds.length ? await manager.query(`SELECT source_bom_id::text bom_id,item_id::text,item_code,version_times,approve_status,approve_date::text approved_at,create_date::text created_at,modified_date::text modified_at,last_modified_date::text "last_modified_at" FROM rd_bom_master_heads WHERE tenant_id=$1 AND generation_id=$2::uuid AND item_id=ANY($3::uuid[]) AND approve_status='Y'`, [query.actor.tenantId,state.activeGeneration,itemIds]) : [];
      const staleMs = Date.now() - new Date(state.lastSuccessAt).getTime();
      const stale = !Number.isFinite(staleMs) || staleMs > 36 * 60 * 60 * 1000;
      const warning = state.lastStatus !== 'SUCCESS' || stale
        ? `E10 BOM索引最近一次成功时间为${new Date(state.lastSuccessAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}；当前使用最近一次成功快照${state.lastErrorCode ? `（最近同步错误码：${state.lastErrorCode}）` : ''}。`
        : null;
      return { heads, warning };
    });
    return {...legacyIndex,snapshot};
    })();
    const today = shanghaiToday();
    const matchBom = unified.enabled ? unified.match : createBomMatcher((index as {snapshot:E10BomBundle}).snapshot,index.heads);
    const details: ReportRow[] = allocations.map(row => {
      const matched = matchBom(row.itemCode);
      const waits = waitingDays(row.orderDate, matched.approvalDate, today, matched.status);
      if ('bomVerified' in matched && !matched.bomVerified && matched.status==='NO_BOM') waits.current=null;
      const orderDay = row.orderDate?.slice(0,10) ?? null;
      return { id: row.id, divisionId: row.divisionId, divisionName: row.divisionName ?? '待匹配', orderNumber: row.orderNumber,
        itemCode: row.itemCode, itemName: row.itemName, allocationDate:row.allocationDate??null,initialBomStatus:row.initialBomStatus??null,orderDate: textDateTime(orderDay), customerDueDate: textDateTime(row.expectedShippingDate?.slice(0,10) ?? null),
        ...(unified.enabled ? { ...matched, sourceSyncStatus:unified.syncText } : {}),
        bomStatus: row.trackedBomStatus ?? (unified.enabled ? (matched.status==='HAS_BOM'?'Y':'N') : matched.status), bomApprovalDate: matched.approvalDate, bomWaitingDays: allocationBomWaiting({current_bom_status:row.trackedBomStatus??null,allocation_date:row.allocationDate??null,locked_waiting_days:row.lockedWaitingDays??null},today),
        currentWaitingDays: waits.current };
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
    if (candidateField) return {rows:authorizedRows.map(row=>({id:row.id,value:row[candidateField],label:candidateField==='divisionId'?row.divisionName:row[candidateField]})),total,page,pageSize};
    const selected = new Set(query.fieldKeys.filter(key => fields.some(field => field.key === key) && readable(query.actor,key)));
    const pageRows = authorizedRows.slice((page-1)*pageSize, page*pageSize).map(row => Object.fromEntries([
      ['id',row.id], ...Object.entries(row).filter(([key]) => selected.has(key)).map(([key,value]) => [key,key === 'divisionId' ? row.divisionName : value])
    ]));
    return { rows: pageRows, total, page, pageSize, syncWarning: readable(query.actor,'sourceSyncStatus') ? index.warning : null };
  }
  private aggregateOrders(details: ReportRow[]): ReportRow[] {
    const groups = new Map<string, ReportRow[]>();
    for (const row of details) { const key = JSON.stringify([row.divisionId, row.orderNumber]); const items = groups.get(key) ?? []; items.push(row); groups.set(key, items); }
    return [...groups.entries()].map(([key, entries]) => {
      const unique = new Map<string, ReportRow>();
      for (const row of entries) unique.set(String(row.itemCode), row);
      const items = [...unique.values()], existing = items.filter(row => (row.bomStatus === 'Y' || row.bomStatus === 'HAS_BOM')).length;
      const noBom = items.filter(row => (row.bomStatus === 'N' || row.bomStatus === 'NO_BOM')).length;
      const unmatched = items.filter(row => (row.bomStatus == null || (row.bomStatus==='N' && row.bomVerified===false))).length;
      const states = items.map(row => ({ bomStatus: row.bomStatus ?? null }));
      const orderDates = [...new Set(entries.map(row => row.orderDate).filter((value): value is string => typeof value === 'string'))];
      return { id: stableId(`${entries[0].tenantId}\u001f${key}`), divisionId: entries[0].divisionId, divisionName: entries[0].divisionName, orderNumber: entries[0].orderNumber,
        sourceSyncStatus:entries[0].sourceSyncStatus, orderDate: orderDates.length === 1 ? orderDates[0] : null, itemCount: items.length, existingBomItemCount: existing, missingBomItemCount: noBom, unmatchedBomItemCount: unmatched,
        completionRate: existing + noBom ? Number((existing / (existing + noBom) * 100).toFixed(2)) : null, orderBomStatus: orderBomStatus(states) };
    });
  }
  private aggregateDivisions(details: ReportRow[]): ReportRow[] {
    const grouped = new Map<string, ReportRow[]>();
    for (const row of details) { const key = row.divisionId ?? '__UNMATCHED__'; const list = grouped.get(key) ?? []; list.push(row); grouped.set(key,list); }
    return [...grouped.entries()].map(([key, entries]) => {
      const unique = new Map<string, ReportRow>();
      for (const row of entries) unique.set(JSON.stringify([row.orderNumber,row.itemCode]),row);
      const rows = [...unique.values()], existing = rows.filter(row => (row.bomStatus === 'Y' || row.bomStatus === 'HAS_BOM')).length;
      const waits = rows.filter(row => (row.bomStatus === 'Y' || row.bomStatus === 'HAS_BOM') && row.bomWaitingDays != null).map(row => Number(row.bomWaitingDays));
      const orderKeys = new Set(rows.map(row => row.orderNumber));
      return { id: stableId(`${entries[0].tenantId}\u001f${key}`), divisionId: key === '__UNMATCHED__' ? null : entries[0].divisionId, divisionName: entries[0].divisionName,
        sourceSyncStatus:entries[0].sourceSyncStatus, orderCount: orderKeys.size, itemCount: rows.length, existingBomItemCount: existing,
        missingBomItemCount: rows.filter(row => (row.bomStatus === 'N' || row.bomStatus === 'NO_BOM')).length,
        unmatchedBomItemCount: rows.filter(row => (row.bomStatus == null || (row.bomStatus==='N' && row.bomVerified===false))).length,
        completionRate: existing + rows.filter(row => (row.bomStatus === 'N' || row.bomStatus === 'NO_BOM')).length ? Number((existing / (existing + rows.filter(row => (row.bomStatus === 'N' || row.bomStatus === 'NO_BOM')).length) * 100).toFixed(2)) : null,
        averageBomWaitingDays: waits.length ? Number((waits.reduce((sum,value) => sum+value,0)/waits.length).toFixed(2)) : null };
    });
  }
}
