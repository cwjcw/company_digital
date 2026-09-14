import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Flex, Progress, Select, Space, Statistic, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { api } from "../../../api";
import { useDictionaryOptions } from "../../../shared/legacy-ui";
import { formatDueDate } from "../../../shared/date-format";
import { TablePermissionButton } from "../../../shared/KdosDataTable";

const { Text } = Typography;

export function SalesSummaryDashboard() {
  const sessionSubject = (() => { try { return JSON.parse(localStorage.getItem("sessionUser") ?? "{}").sub ?? "anonymous"; } catch { return "anonymous"; } })();
  const dictionaryOptions = useDictionaryOptions();
  const [timeDimension, setTimeDimension] = useState<"year" | "month" | "day">("month");
  const [period, setPeriod] = useState<dayjs.Dayjs>(dayjs());
  const [division, setDivision] = useState<string[]>([]);
  const [customer, setCustomer] = useState<string[]>([]);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["sales-dashboard",sessionSubject,timeDimension,period.format("YYYY-MM-DD"),division,customer], queryFn: () => {
      const query=new URLSearchParams({dimension:timeDimension,period:period.format("YYYY-MM-DD")});
      division.forEach(value=>query.append("division",value));customer.forEach(value=>query.append("customer",value));
      return api<any>(`/plans/sales-dashboard?${query.toString()}`);
    }, staleTime:60_000,refetchInterval:30*60_000
  });
  const dashboard=data??{metrics:{orderCount:0,orderAmount:"0",totalQuantity:"0",completedQuantity:"0",pendingQuantity:"0",completionRate:0},statusCounts:{已完成:0,进行中:0,即将延期:0,延期:0},divisionRows:[],warningRows:[],filters:{divisions:[],customers:[]}};
  const divisionOptions = useMemo(() => [...new Set([
    ...(dictionaryOptions.division ?? []),
    ...(dashboard.filters?.divisions??[])
  ])].map((value) => ({ value, label: value })), [dashboard.filters?.divisions, dictionaryOptions.division]);
  const customerOptions = useMemo(() => [...new Set(dashboard.filters?.customers??[])]
    .sort().map((value) => ({ value, label: value })), [dashboard.filters?.customers]);
  const metrics=dashboard.metrics;const divisionRows=dashboard.divisionRows??[];const warningRows=dashboard.warningRows??[];
  const statusConfig = [
    { key: "已完成", color: "#3fa06a" }, { key: "进行中", color: "#26718f" },
    { key: "即将延期", color: "#c99332" }, { key: "延期", color: "#bb4d50" }
  ] as const;
  const integer = (value: number) => Math.round(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

  return <div className="sales-dashboard">
    <Flex justify="flex-end" className="dashboard-toolbar">
      <Space wrap>
        <Select aria-label="大屏时间维度" value={timeDimension}
          onChange={(value) => setTimeDimension(value)} style={{ width: 92 }}
          options={[{ value: "year", label: "按年" }, { value: "month", label: "按月" }, { value: "day", label: "按日" }]} />
        <DatePicker aria-label="大屏筛选日期" allowClear={false}
          picker={timeDimension === "day" ? undefined : timeDimension}
          format={timeDimension === "year" ? "YYYY年" : timeDimension === "month" ? "YYYY年M月" : "YYYY年M月D日"}
          value={period} onChange={(value) => value && setPeriod(value)} style={{ width: 150 }} />
        <Select aria-label="大屏筛选事业部" mode="multiple" showSearch allowClear optionFilterProp="label"
          maxTagCount="responsive" placeholder="承产单位（可多选）" value={division}
          onChange={setDivision} style={{ width: 230 }} options={divisionOptions} />
        <Select aria-label="大屏筛选客户" mode="multiple" showSearch allowClear optionFilterProp="label"
          maxTagCount="responsive" placeholder="客户（可多选）" value={customer}
          onChange={setCustomer} style={{ width: 250 }} options={customerOptions} />
        <Button onClick={() => { setTimeDimension("month"); setPeriod(dayjs()); setDivision([]); setCustomer([]); }}>清空筛选</Button>
        <Button type="primary" loading={isLoading} onClick={() => void refetch()}>刷新数据</Button>
        <TablePermissionButton resource="sales-summary-dashboard" />
      </Space>
    </Flex>
    {isError && <Alert showIcon type="error" message="公司驾驶舱数据读取失败" description={(error as Error).message} style={{ marginBottom: 16 }} />}
    <div className="dashboard-kpi-grid">
      <Card><Statistic title="订单数" value={metrics.orderCount} suffix="单" /></Card>
      <Card><Statistic title="订单金额" value={Math.round(metrics.orderAmount)} precision={0} /></Card>
      <Card><Statistic title="订单总数量" value={Math.round(metrics.totalQuantity)} precision={0} /></Card>
      <Card><Statistic title="已完成数量" value={Math.round(metrics.completedQuantity)} precision={0} valueStyle={{ color: "#238657" }} /></Card>
      <Card><Statistic title="待完成数量" value={Math.round(metrics.pendingQuantity)} precision={0} valueStyle={{ color: metrics.pendingQuantity > 0 ? "#b87416" : "#238657" }} /></Card>
      <Card><Statistic title="整体完成率" value={Math.round(metrics.completionRate)} precision={0} suffix="%" /></Card>
    </div>
    <div className="dashboard-panel-grid dashboard-panel-grid-top">
      <Card title="订单执行状态" loading={isLoading}>
        <div className="dashboard-status-list">
          {statusConfig.map((item) => {
            const count = dashboard.statusCounts[item.key];
            return <div className="dashboard-status-item" key={item.key}>
              <Flex justify="space-between"><Text>{item.key}</Text><Text strong>{count} 单</Text></Flex>
              <Progress percent={metrics.orderCount ? Math.round(count / metrics.orderCount * 100) : 0} strokeColor={item.color} showInfo={false} />
            </div>;
          })}
        </div>
      </Card>
      <Card title="总体生产完成进度" loading={isLoading} className="dashboard-progress-card">
        <Progress type="dashboard" percent={Math.round(metrics.completionRate)} size={190}
          strokeColor={{ "0%": "#26718f", "100%": "#3fa06a" }} />
        <Flex justify="space-around" className="dashboard-progress-notes">
          <Text>完成 {integer(metrics.completedQuantity)}</Text>
          <Text>待完成 {integer(metrics.pendingQuantity)}</Text>
        </Flex>
      </Card>
    </div>
    <div className="dashboard-panel-grid dashboard-panel-grid-bottom">
      <Card title="承产单位执行情况" loading={isLoading}>
        <div className="division-overview-grid">
          {divisionRows.map((row:any) => <div className="division-overview-item" key={row.division}>
            <Flex justify="space-between" align="center">
              <Text strong className="division-overview-name">{row.division}</Text>
              <Tag color="blue">{row.orders} 单</Tag>
            </Flex>
            <div className="division-overview-metrics">
              <span><Text type="secondary">总数量</Text><Text strong>{integer(row.total)}</Text></span>
              <span><Text type="secondary">已完成</Text><Text strong>{integer(row.completed)}</Text></span>
              <span><Text type="secondary">待完成</Text><Text strong type={Number(row.pending)>0?"warning":undefined}>{integer(row.pending)}</Text></span>
            </div>
            <Flex justify="space-between" align="center"><Text type="secondary">完成率</Text><Text strong>{Number(row.rate).toFixed(1)}%</Text></Flex>
            <Progress percent={Math.round(Number(row.rate))} size="small" strokeColor={Number(row.rate)>=90?"#3fa06a":Number(row.rate)>=60?"#26718f":"#c99332"} />
          </div>)}
          {!divisionRows.length && <div className="division-overview-empty">暂无承产单位数据</div>}
        </div>
      </Card>
      <Card title="交期预警（延期及未来 3 天）" loading={isLoading}>
        <div className="dashboard-warning-list">
          {warningRows.map((row:any)=><div className="dashboard-warning-item" key={row.id}>
            <div className="dashboard-warning-order"><Text strong>{row.orderNumber}</Text><Text type="secondary" ellipsis={{tooltip:row.customer}}>{row.customer||"未指定客户"}</Text></div>
            <Text className="dashboard-warning-division">{row.division}</Text>
            <Text className="dashboard-warning-date">{formatDueDate(row.dueDate)}</Text>
            <Tag color={row.status==="延期"?"red":row.status==="即将延期"?"orange":"blue"}>{row.remainingDays<0?`延期 ${Math.abs(row.remainingDays)} 天`:row.remainingDays===0?"今日到期":`${row.remainingDays} 天后到期`}</Tag>
          </div>)}
          {!warningRows.length&&<div className="dashboard-warning-empty">暂无交期预警</div>}
        </div>
      </Card>
    </div>
  </div>;
}
