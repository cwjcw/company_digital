import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Spin, Statistic } from "antd";
import { mpsDashboardGaps, mpsDashboardResource as resource, type MpsDashboardFilters, type MpsDashboardGapCounts, type MpsDashboardGapKey } from "@kdos/contracts";
import { api } from "../../api";
import { hasSessionResourcePermission, TablePermissionButton } from "../../shared/KdosDataTable";
import { MpsDateFilter, MpsRemoteSelect } from "./MasterPlanDashboardFilters";
import { MpsDashboardGapList } from "./MasterPlanDashboardTable";
import { mpsDashboardUrl } from "./master-plan-dashboard.utils";
import "./master-plan-dashboard.css";

export function MasterPlanGaps() {
  const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  const session = JSON.stringify(user);
  const canRead = hasSessionResourcePermission(user, resource, "read");
  const canExport = hasSessionResourcePermission(user, resource, "export");
  // Preserve REV2's initial/clear scope (no date restriction).
  const [filters, setFilters] = useState<MpsDashboardFilters>({});
  const [selected, setSelected] = useState<MpsDashboardGapKey>("missing-shipping-plan");
  const client = useQueryClient();
  const result = useQuery({
    queryKey: [resource, session, "gap-counts", filters],
    queryFn: () => api<MpsDashboardGapCounts>(mpsDashboardUrl(filters, "/gap-counts")),
    enabled: canRead, placeholderData: (previous, query) => query?.queryKey[1] === session ? previous : undefined,
    staleTime: 60_000, refetchInterval: 30 * 60_000, retry: false
  });
  const data = result.data;
  const visible = (field: string) => data?.visibleFields.includes(field) ?? false;
  const apply = (patch: MpsDashboardFilters) => setFilters(old => ({ ...old, ...patch }));
  if (!canRead) return <Alert type="error" message="没有待处理事项大屏查看权限" />;
  return <div className="mps-dashboard mps-gaps-dashboard">
    <div className="mps-dashboard-toolbar">
      {(["divisionId", "customerCode", "orderNumber", "itemCode"] as const).filter(field => visible(field)).map(field =>
        <MpsRemoteSelect key={session + field} field={field} filters={filters} session={session} onChange={apply} />)}
      <MpsDateFilter filters={filters} onChange={apply} allowOrder={visible("orderDate")} allowDelivery={visible("deliveryDate")} />
      <Button onClick={() => setFilters({})}>清空筛选</Button>
      <Button aria-label="刷新数据" loading={result.isFetching} onClick={() => void client.invalidateQueries({ queryKey: [resource, session] })}>刷新数据</Button>
      <TablePermissionButton resource={resource} />
    </div>
    {result.error && <Alert type="error" showIcon message={(result.error as Error).message} />}
    {result.isLoading && <Spin aria-label="加载中" />}
    {data && <>
      <Card><div className="mps-dashboard-kpis">{mpsDashboardGaps.filter(g => data.gaps[g.key] != null).map(g =>
        <button className="mps-kpi" key={g.key} onClick={() => { setSelected(g.key); document.getElementById("mps-gap-list")?.scrollIntoView?.({ behavior: "smooth" }); }}>
          <Statistic title={g.title} value={data.gaps[g.key]} />
        </button>)}{!Object.keys(data.gaps).length && <Empty description="暂无可见指标" />}</div></Card>
      <MpsDashboardGapList key={session + JSON.stringify(filters)} preserveState selected={selected} onSelect={setSelected} counts={data.gaps} filters={filters} session={session} canExport={canExport} />
    </>}
  </div>;
}
