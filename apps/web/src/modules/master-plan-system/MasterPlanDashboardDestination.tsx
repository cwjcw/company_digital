import { Alert } from "antd";
import { useLocation } from "react-router-dom";
import { readMpsDashboardNavigation } from "@kdos/contracts";
import { MasterPlanGaps } from "./MasterPlanGaps";
import { MasterPlanOrderProgress } from "./MasterPlanOrderProgress";
import { MasterPlanReports } from "./MasterPlanReports";

/** The App's original route guards run before this URL-only initialization. */
export function MasterPlanDashboardDestination({ kind }: { kind: "gaps" | "orders" | "reports" }) {
  const { search } = useLocation();
  let navigation;
  try { navigation = readMpsDashboardNavigation(search); }
  catch (error) { return <Alert type="error" message={`链接筛选条件无效：${(error as Error).message}`} />; }
  if (kind === "gaps") return <MasterPlanGaps key={search} navigationFilters={navigation?.filters} initialGap={navigation?.gap} />;
  if (kind === "orders") return <MasterPlanOrderProgress key={search} navigationFilters={navigation?.filters} />;
  return <MasterPlanReports key={search} navigationFilters={navigation?.filters} />;
}
