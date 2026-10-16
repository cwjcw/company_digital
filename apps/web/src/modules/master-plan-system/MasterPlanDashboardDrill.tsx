import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Drawer } from "antd";
import { mpsDashboardResource as resource, type MpsDashboardFilters, type MpsDashboardRow } from "@kdos/contracts";
import { api } from "../../api";
import { KdosDataTable, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import { mpsDashboardUrl } from "./master-plan-dashboard.utils";

type Group = { logic: "AND" | "OR"; groups?: Group[]; rules: Array<{ field: string; operator: string; value: unknown }> };
type Sort = { sortField?: string; sortOrder?: "asc" | "desc" };
const sortParams = (sort: Sort): Record<string, string> => sort.sortField ? { sortField: sort.sortField, sortOrder: sort.sortOrder ?? "asc" } : {};
export type Drill = { resource: string; title: string; group: Group; view?: string };
function errorText(error: unknown) { return error instanceof Error ? error.message : "数据加载失败"; }
export function MpsDashboardDrillDrawer({ drill, close, session, filters }: { drill: Drill | null; close: () => void; session: string; filters: MpsDashboardFilters }) {
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(kdosDefaultPageSize); const [sort, setSort] = useState<Sort>({});
  const metadata = useQuery({ queryKey: [resource, session, "drill-meta", drill?.resource], queryFn: () => api<{ fields: Array<{ key: string; label: string }> }>(`/master-plan-system/resources/${drill!.resource}/meta`), enabled: !!drill });
  const result = useQuery({ queryKey: [resource, session, "drill", drill, filters, page, pageSize, sort], queryFn: () => api<{ rows: MpsDashboardRow[]; total: number }>(mpsDashboardUrl(filters, "/drill", { resourceCode: drill!.resource, page: String(page), pageSize: String(pageSize), ...sortParams(sort), filterGroup: JSON.stringify(drill!.group), ...(drill?.view ? { view: drill.view } : {}) })), enabled: !!drill && !!metadata.data, placeholderData: (previous, query) => query?.queryKey[1] === session ? previous : undefined });
  const fields = metadata.data?.fields.filter(f => ["divisionId", "primaryDivisionId", "orderNumber", "itemCode", "itemName", "requiredQuantity", "pendingQuantity", "weeklyPlanState", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue", "exceptionSummary", "processCode", "productionDate", "productionQuantity", "exceptionText"].includes(f.key)) ?? [];
  return <Drawer title={drill?.title} width="85vw" open={!!drill} onClose={close} destroyOnHidden afterOpenChange={open => { if (!open) setPage(1); }}>
    {(metadata.error || result.error) && <Alert type="error" showIcon message={errorText(metadata.error || result.error)} />}
    <KdosDataTable resource={drill?.resource ?? resource} viewKey="dashboard-drill" simple systemFields={false} loading={metadata.isLoading || result.isFetching} rowKey="id" columns={fields.map(f => ({ title: f.label, dataIndex: f.key, key: f.key, width: 180, ellipsis: true, render: (v: unknown, row: MpsDashboardRow) => f.key.endsWith("DivisionId") || f.key === "divisionId" ? String(row.divisionName ?? "—") : String(v ?? "—") }))} dataSource={result.data?.rows ?? []} scroll={{ x: fields.length * 180 }} serverData={{ total: result.data?.total ?? 0, onQueryChange: q => { setPage(q.page); setPageSize(q.pageSize); setSort({ sortField: q.sortField, sortOrder: q.sortOrder }); } }} pagination={{ pageSize }} />
  </Drawer>;
}
