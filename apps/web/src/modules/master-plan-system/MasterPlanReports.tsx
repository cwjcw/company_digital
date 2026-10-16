import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Spin } from "antd";
import { mpsDashboardResource as resource, type MpsDashboardFilters, type MpsDashboardGapCounts, type MpsDashboardRow } from "@kdos/contracts";
import { api } from "../../api";
import { hasSessionResourcePermission } from "../../shared/KdosDataTable";
import { MpsDashboardToolbar } from "./MasterPlanDashboardFilters";
import { MpsDashboardDetailTable } from "./MasterPlanDashboardTable";
import { MpsDashboardDrillDrawer, type Drill } from "./MasterPlanDashboardDrill";
import { mpsDashboardUrl } from "./master-plan-dashboard.utils";
import "./master-plan-dashboard.css";

export function MasterPlanReports({ navigationFilters }: { navigationFilters?: MpsDashboardFilters } = {}) {
  const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}"), session = JSON.stringify(user);
  const canRead = hasSessionResourcePermission(user, resource, "read"), canExport = hasSessionResourcePermission(user, resource, "export");
  const [filters, setFilters] = useState<MpsDashboardFilters>(() => navigationFilters ?? {});
  const [drill, setDrill] = useState<Drill | null>(null);
  const client = useQueryClient();
  const meta = useQuery({ queryKey: [resource, session, "gap-counts", filters], queryFn: () => api<MpsDashboardGapCounts>(mpsDashboardUrl(filters, "/gap-counts")), enabled: canRead, staleTime: 60_000, retry: false });
  const open = (row: MpsDashboardRow) => {
    const code = String(row.resource);
    if (!hasSessionResourcePermission(user, code, "read")) return;
    setDrill({ resource: code, title: String(row.riskType), group: { logic: "AND", rules: ["orderNumber", "itemCode"].filter(key => row[key]).map(field => ({ field, operator: "eq", value: row[field] })) } });
  };
  if (!canRead) return <Alert type="error" message="没有PMC分析明细报表查看权限" />;
  return <div className="mps-dashboard">
    <MpsDashboardToolbar filters={filters} session={session} fields={meta.data?.visibleFields ?? []} onChange={patch => { setFilters(old => ({ ...old, ...patch })); setDrill(null); }} onClear={() => { setFilters({}); setDrill(null); }} onRefresh={() => void client.invalidateQueries({ queryKey: [resource, session] })} refreshing={meta.isFetching} />
    {meta.error && <Alert type="error" showIcon message={(meta.error as Error).message} />}
    {meta.isLoading && <Spin aria-label="加载中" />}
    {meta.data && <>
      <MpsDashboardDetailTable key={session + JSON.stringify(filters) + "readiness"} tableKey="plan-readiness" filters={filters} session={session} canExport={canExport} />
      <MpsDashboardDetailTable key={session + JSON.stringify(filters) + "execution"} tableKey="process-execution" filters={filters} session={session} canExport={canExport} />
      <MpsDashboardDetailTable key={session + JSON.stringify(filters) + "risk"} tableKey="risk-exception" filters={filters} session={session} canExport={canExport} onOpen={hasSessionResourcePermission(user, "mps-monthly-plans", "read") ? open : undefined} />
    </>}
    <MpsDashboardDrillDrawer key={JSON.stringify(drill)} drill={drill} close={() => setDrill(null)} session={session} filters={filters} />
  </div>;
}
