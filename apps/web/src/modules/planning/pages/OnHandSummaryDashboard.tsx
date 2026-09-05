import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Flex, Progress, Space, Statistic, Tag, Typography } from "antd";
import type { OnHandSummaryContract } from "@kdos/contracts";
import { api } from "../../../api";
import { TablePermissionButton } from "../../../shared/KdosDataTable";
import { formatDueDate } from "../../../shared/date-format";

const { Text } = Typography;
const SOURCE_YEAR = 2026;
const SOURCE_MONTH = 9;
const emptyDashboard: OnHandSummaryContract = {
  source: { year: SOURCE_YEAR, month: SOURCE_MONTH, periodId: null, versionId: null, versionName: null, versionStatus: null },
  visibleFields: [], metrics: {}, statusCounts: {}, divisionRows: [], customerRows: [], processRows: [], warningRows: []
};

function quantity(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "0";
}

export function OnHandSummaryDashboard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["on-hand-summary-dashboard", SOURCE_YEAR, SOURCE_MONTH],
    queryFn: () => api<OnHandSummaryContract>(`/planning/on-hand-summary?year=${SOURCE_YEAR}&month=${SOURCE_MONTH}`),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false
  });
  const dashboard = data ?? emptyDashboard;
  const visible = useMemo(() => new Set(dashboard.visibleFields), [dashboard.visibleFields]);
  const metrics = dashboard.metrics;
  const completionRate = Number(metrics.completionRate ?? 0);
  const statusConfig = [
    { key: "完成", color: "#28a36a" }, { key: "进行中", color: "#26718f" },
    { key: "即将延期", color: "#d49a2f" }, { key: "延期", color: "#c5484d" }
  ] as const;
  const itemCount = Number(metrics.itemCount ?? 0);

  return <div className="on-hand-dashboard">
    <Flex justify="flex-end" align="center" gap={12} wrap className="on-hand-dashboard-toolbar">
      <Space>
        <Button type="primary" loading={isLoading} onClick={() => void refetch()}>刷新数据</Button>
        <TablePermissionButton resource="on-hand-summary-dashboard" />
      </Space>
    </Flex>
    {error && <Alert type="error" showIcon message="在手汇总加载失败" description={(error as Error).message} />}
    {!error && !isLoading && !dashboard.source.versionId && <Alert type="info" showIcon message={`${SOURCE_YEAR}年${SOURCE_MONTH}月暂无计划版本`} />}

    <div className="on-hand-kpi-grid">
      {visible.has("itemCount") && <Card loading={isLoading}><Statistic title="计划品号" value={Number(metrics.itemCount ?? 0)} suffix="项" /></Card>}
      {visible.has("orderCount") && <Card loading={isLoading}><Statistic title="在手订单" value={Number(metrics.orderCount ?? 0)} suffix="单" /></Card>}
      {visible.has("customerCount") && <Card loading={isLoading}><Statistic title="涉及客户" value={Number(metrics.customerCount ?? 0)} suffix="家" /></Card>}
      {visible.has("productionQuantity") && <Card loading={isLoading}><Statistic title="订单需求数量" value={quantity(metrics.productionQuantity)} /></Card>}
      {visible.has("inboundQuantity") && <Card loading={isLoading}><Statistic title="累计入库数量" value={quantity(metrics.inboundQuantity)} valueStyle={{ color: "#238657" }} /></Card>}
      {visible.has("todayInboundQuantity") && <Card loading={isLoading}><Statistic title="当天入库数量" value={quantity(metrics.todayInboundQuantity)} valueStyle={{ color: "#26718f" }} /></Card>}
      {visible.has("balanceQuantity") && <Card loading={isLoading}><Statistic title="在手欠数" value={quantity(metrics.balanceQuantity)} valueStyle={{ color: "#b56b18" }} /></Card>}
    </div>

    {visible.has("responsibleOrgId") && <Card title="事业部在手执行情况" loading={isLoading} className="on-hand-division-card">
      <div className="on-hand-division-grid">
        {dashboard.divisionRows.map((row, index) => <div className="on-hand-division-row" key={`${row.divisionId ?? "unassigned"}-${index}`}>
          <Flex justify="space-between" align="center" gap={12}>
            <Text strong ellipsis={{ tooltip: row.divisionPath }}>{row.divisionName ?? "未归属事业部"}</Text>
            {(visible.has("orderCount") || visible.has("itemCount")) && <Text type="secondary">
              {visible.has("orderCount") ? `${row.orderCount ?? 0} 单` : ""}
              {visible.has("orderCount") && visible.has("itemCount") ? " · " : ""}
              {visible.has("itemCount") ? `${row.itemCount ?? 0} 项` : ""}
            </Text>}
          </Flex>
          {visible.has("completionRate") && <Progress percent={Math.round(Number(row.completionRate ?? 0))} size="small" strokeColor="#26718f" />}
          <Flex justify="space-between" gap={10} wrap>
            {visible.has("productionQuantity") && <Text type="secondary">需求 {quantity(row.productionQuantity)}</Text>}
            {visible.has("inboundQuantity") && <Text type="secondary">入库 {quantity(row.inboundQuantity)}</Text>}
            {visible.has("balanceQuantity") && <Text strong>欠数 {quantity(row.balanceQuantity)}</Text>}
          </Flex>
        </div>)}
        {!dashboard.divisionRows.length && <div className="on-hand-empty">暂无事业部汇总数据</div>}
      </div>
    </Card>}

    <div className="on-hand-panel-grid on-hand-panel-grid-top">
      {visible.has("itemStatus") && <Card title="在手状态结构" loading={isLoading}>
        <div className="dashboard-status-list">
          {statusConfig.map((item) => {
            const count = Number(dashboard.statusCounts[item.key] ?? 0);
            return <div className="dashboard-status-item" key={item.key}>
              <Flex justify="space-between"><Text>{item.key}</Text><Text strong>{count.toLocaleString("zh-CN")} 项</Text></Flex>
              <Progress percent={itemCount ? Math.round(count / itemCount * 100) : 0} strokeColor={item.color} showInfo={false} />
            </div>;
          })}
        </div>
      </Card>}
      {visible.has("completionRate") && <Card title="9月计划总体入库进度" loading={isLoading} className="on-hand-progress-card">
        <Progress type="dashboard" percent={Math.round(completionRate)} size={190} strokeColor={{ "0%": "#26718f", "100%": "#28a36a" }} />
        <Flex justify="space-around" className="dashboard-progress-notes">
          {visible.has("inboundQuantity") && <Text>累计入库 {quantity(metrics.inboundQuantity)}</Text>}
          {visible.has("balanceQuantity") && <Text>在手欠数 {quantity(metrics.balanceQuantity)}</Text>}
        </Flex>
      </Card>}
    </div>

    <div className="on-hand-panel-grid on-hand-panel-grid-middle">
      {visible.has("customer") && <Card title="客户在手欠数 TOP 12" loading={isLoading}>
        <div className="on-hand-ranking-list">
          {dashboard.customerRows.map((row, index) => <div className="on-hand-ranking-row" key={`${row.customer}-${index}`}>
            <span className="on-hand-ranking-index">{index + 1}</span>
            <Text className="on-hand-ranking-name" ellipsis={{ tooltip: row.customer }}>{row.customer ?? "未维护客户"}</Text>
            {visible.has("orderCount") && <Text type="secondary">{row.orderCount ?? 0} 单</Text>}
            {visible.has("balanceQuantity") && <Text strong>{quantity(row.balanceQuantity)}</Text>}
            {visible.has("completionRate") && <Progress percent={Math.round(Number(row.completionRate ?? 0))} size="small" />}
          </div>)}
          {!dashboard.customerRows.length && <div className="on-hand-empty">暂无客户汇总数据</div>}
        </div>
      </Card>}
      {visible.has("processName") && <Card title="工序风险概览" loading={isLoading}>
        <div className="on-hand-process-grid">
          {dashboard.processRows.map((row, index) => <div className="on-hand-process-row" key={`${row.processName}-${index}`}>
            <Flex justify="space-between" align="center"><Text strong>{row.processName ?? "未命名工序"}</Text><Text type="secondary">{row.itemCount ?? 0} 项</Text></Flex>
            <Flex gap={6} wrap>
              {visible.has("completedCount") && <Tag color="green">完成 {row.completedCount ?? 0}</Tag>}
              {visible.has("overdueCount") && <Tag color={Number(row.overdueCount) > 0 ? "red" : "default"}>延期 {row.overdueCount ?? 0}</Tag>}
              {visible.has("exceptionCount") && <Tag color={Number(row.exceptionCount) > 0 ? "volcano" : "default"}>异常 {row.exceptionCount ?? 0}</Tag>}
            </Flex>
          </div>)}
          {!dashboard.processRows.length && <div className="on-hand-empty">暂无工序数据</div>}
        </div>
      </Card>}
    </div>

    {(visible.has("orderNumber") || visible.has("itemNumber")) && <Card title="重点在手订单（延期及未来 7 天）" loading={isLoading} className="on-hand-warning-card">
      <div className="on-hand-warning-list">
        {dashboard.warningRows.map((row, index) => <div className="on-hand-warning-row" key={`${row.orderNumber}-${row.itemNumber}-${index}`}>
          {visible.has("orderNumber") && <Text strong>{row.orderNumber}</Text>}
          {visible.has("itemNumber") && <Text>{row.itemNumber}</Text>}
          {visible.has("itemName") && <Text ellipsis={{ tooltip: row.itemName ?? undefined }}>{row.itemName || "未维护品名"}</Text>}
          {visible.has("customer") && <Text ellipsis={{ tooltip: row.customer }}>{row.customer}</Text>}
          {visible.has("responsibleOrgId") && <Tag>{row.divisionName ?? "未归属"}</Tag>}
          {visible.has("customerDueDate") && <Text>{formatDueDate(row.customerDueDate)}</Text>}
          {visible.has("balanceQuantity") && <Text strong>{quantity(row.balanceQuantity)}</Text>}
          {visible.has("itemStatus") && <Tag color={row.itemStatus === "延期" ? "red" : "orange"}>{row.itemStatus}</Tag>}
        </div>)}
        {!dashboard.warningRows.length && <div className="on-hand-empty">暂无重点预警订单</div>}
      </div>
    </Card>}
  </div>;
}
