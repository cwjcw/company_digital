import { useMemo, useState } from 'react';
import { Alert, Card, Tabs, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { tablePermissionFieldsFor } from '@kdos/contracts';
import { api, ApiError } from '../../api';
import { hasResourcePermission, KdosDataTable, type KdosDataColumn } from '../../shared/KdosDataTable';
import { blankPlatformQuery, type PlatformTablePage, type PlatformTableQuery } from '../../shared/platform-table';
import { rdOrderBomReportResource } from '@kdos/contracts';

type ReportRow = Record<string, unknown> & { id: string; divisionId: string | null; orderNumber: string; bomStatus?: string | null };
const tabs = [
  { key: 'detail', label: '订单BOM明细报表', preference: 'rd-bom-detail' },
  { key: 'orders', label: '订单BOM汇总', preference: 'rd-bom-orders' },
  { key: 'divisions', label: '事业部BOM统计', preference: 'rd-bom-divisions' }
] as const;
type View = typeof tabs[number]['key'];
const detailKeys = ['divisionId','orderNumber','itemCode','itemName','orderDate','customerDueDate','bomStatus','bomApprovalDate','bomWaitingDays','currentWaitingDays'];
const orderKeys = ['divisionId','orderNumber','orderDate','itemCount','existingBomItemCount','missingBomItemCount','unmatchedBomItemCount','completionRate','orderBomStatus'];
const divisionKeys = ['divisionId','orderCount','itemCount','existingBomItemCount','missingBomItemCount','unmatchedBomItemCount','completionRate','averageBomWaitingDays'];
const labels: Record<string,string> = { divisionId:'承接事业部',orderNumber:'订单号',itemCode:'品号',itemName:'品名',orderDate:'下单日期',customerDueDate:'客户交期',bomStatus:'BOM状态',bomApprovalDate:'BOM审核日期',bomWaitingDays:'BOM等待天数',currentWaitingDays:'当前等待天数',itemCount:'品号总数',existingBomItemCount:'有BOM品号数',missingBomItemCount:'无BOM品号数',unmatchedBomItemCount:'BOM状态为空品号数',completionRate:'BOM完成率',orderBomStatus:'订单BOM完成情况',orderCount:'订单数量',averageBomWaitingDays:'平均BOM等待天数' };
const dateKeys = new Set(['orderDate','customerDueDate','bomApprovalDate']);
const numberKeys = new Set(['bomWaitingDays','currentWaitingDays','itemCount','unmatchedBomItemCount','existingBomItemCount','missingBomItemCount','completionRate','orderCount','averageBomWaitingDays']);
function columns(view: View): KdosDataColumn<ReportRow>[] {
  const keys = view === 'detail' ? detailKeys : view === 'orders' ? orderKeys : divisionKeys;
  return keys.map(key => ({ key, dataIndex: key, title: labels[key], width: key === 'orderNumber' ? 160 : key === 'itemName' ? 200 : 135,
    ...(dateKeys.has(key) ? { render: (value: unknown) => value == null || value === '' ? '—' : String(value) } : {}),
    ...(numberKeys.has(key) ? { align: 'right' as const, render: (value: unknown) => value == null || value === '' ? '—' : key === 'completionRate' ? `${value}%` : value } : {}),
    ...(key === 'bomStatus' ? { render: (_value: unknown, row: ReportRow) => {
      const value = row.bomStatus;
      if (value == null || value === '') return '—';
      return <Tag color={value === 'HAS_BOM' ? 'green' : 'red'}>{value === 'HAS_BOM' ? '有BOM' : '无BOM'}</Tag>;
    } } : {})
  }));
}
function viewUrl(query: PlatformTableQuery, view: View) {
  const params = new URLSearchParams({ resource: rdOrderBomReportResource, page: String(query.page), pageSize: String(query.pageSize), context: JSON.stringify({ view }) });
  if (query.search.trim()) params.set('search', query.search.trim());
  if (query.filterGroup && (query.filterGroup.rules.length || query.filterGroup.groups?.length)) params.set('filterGroup', JSON.stringify(query.filterGroup));
  if (query.sortField) params.set('sortField', query.sortField);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  return `/table-filters/rows?${params}`;
}
function ReportTable({ view }: { view: View }) {
  const [query, setQuery] = useState(blankPlatformQuery());
  const url = viewUrl(query, view);
  const result = useQuery({ queryKey: [rdOrderBomReportResource, view, url], queryFn: ({ signal }) => api<PlatformTablePage<ReportRow> & { syncWarning?: string | null }>(url,{signal}), staleTime:30_000, retry:1 });
  const fields = useMemo(() => tablePermissionFieldsFor(rdOrderBomReportResource), []);
  const error = result.error instanceof ApiError ? result.error.message : result.error instanceof Error ? result.error.message : '请检查服务连接后重试';
  return <>
    {result.error && <Alert type="error" showIcon message="订单BOM报表加载失败" description={error} closable />}
    {result.data?.syncWarning && <Alert type="warning" showIcon message="E10 BOM索引暂未更新" description={result.data.syncWarning} closable />}
    <KdosDataTable<ReportRow> resource={rdOrderBomReportResource} viewKey={tabs.find(tab=>tab.key===view)!.preference} systemFields={false} selectable={false}
      columns={columns(view)} dataSource={result.data?.rows ?? []} loading={result.isPending} printContext={{ view }} quickSearch
      searchPlaceholder={view === 'detail' ? '搜索订单号、品号或品名' : view === 'orders' ? '搜索订单号' : '搜索事业部'} filterFields={fields.filter(field=>view === 'detail' ? detailKeys.includes(field.key) : view === 'orders' ? orderKeys.includes(field.key) : divisionKeys.includes(field.key))}
      serverData={{ total:result.data?.total ?? 0, resetKey:view, onQueryChange:setQuery }} scroll={{ x:'max-content' }} />
  </>;
}
export function RdOrderBomReportPage() {
  const [view,setView] = useState<View>('detail');
  if (!hasResourcePermission(rdOrderBomReportResource,'read')) return <Alert type="error" message="当前权限组没有订单BOM报表查看权限" />;
  return <Card size="small" title="订单BOM报表">
    <Tabs activeKey={view} onChange={key=>setView(key as View)} items={tabs.map(tab=>({key:tab.key,label:tab.label}))} />
    <ReportTable key={view} view={view} />
  </Card>;
}
