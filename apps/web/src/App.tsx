import { useEffect, useMemo, useRef, useState } from "react";
import {
  AuditOutlined, DatabaseOutlined, FileExcelOutlined, LogoutOutlined,
  FilterOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ScheduleOutlined
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, App as AntApp, Button, Card, DatePicker, Descriptions, Drawer, Flex, Form,
  Input, InputNumber, Layout, Menu, Modal, Progress, Select, Space, Statistic,
  Table, Tabs, Tag, TreeSelect, Typography, Upload, Switch, Checkbox, message
} from "antd";
import type { UploadFile } from "antd";
import dayjs from "dayjs";
import {
  AllCommunityModule, ModuleRegistry, type ColDef,
  type ColGroupDef, type GridApi, type RowClassParams
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { monthlyPlanColumns, type ColumnDefinition } from "@tracker/shared";
import { api, ApiError, getValue } from "./api";

ModuleRegistry.registerModules([AllCommunityModule]);
const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

function Login({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const submit = async (values: { username: string; password: string }) => {
    setLoading(true);
    setLoginError("");
    try {
      const result = await api<any>("/auth/login", { method: "POST", body: JSON.stringify(values) });
      localStorage.setItem("accessToken", result.accessToken);
      localStorage.setItem("refreshToken", result.refreshToken);
      localStorage.setItem("sessionUser", JSON.stringify(result.user));
      onLogin();
    } catch (error) {
      const errorMessage = error instanceof ApiError
        ? error.message
        : error instanceof TypeError
          ? "无法连接服务器，请确认后端服务已启动并检查网络连接"
          : error instanceof Error ? error.message : "登录失败，请稍后重试";
      setLoginError(errorMessage);
      message.error(errorMessage);
    } finally { setLoading(false); }
  };
  return <div className="login-shell">
    <Card className="login-card">
      <div className="login-mark">KN</div>
      <div className="login-title">凯南计划中心</div>
      <Text type="secondary">生产主计划与月度计划协同平台</Text>
      {loginError && <Alert type="error" showIcon message={loginError} style={{ marginTop: 16 }} />}
      <Form layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}><Input autoFocus size="large" /></Form.Item>
        <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password size="large" /></Form.Item>
        <Button htmlType="submit" type="primary" loading={loading} block size="large">登录</Button>
      </Form>
    </Card>
  </div>;
}

function Shell({ logout }: { logout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [monthlyYear, setMonthlyYear] = useState(2026);
  const [monthlyMonth, setMonthlyMonth] = useState(8);
  const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  const menu = [
    { key: "main", label: "主计划", type: "group" as const, children: [
      { key: "/sales-summary-dashboard", icon: <ScheduleOutlined />, label: "销售接单汇总大屏" },
      { key: "/sales-summary-details", icon: <FileExcelOutlined />, label: "销售接单明细" },
      { key: "/monthly", icon: <FileExcelOutlined />, label: "月度计划" }
    ] },
    { key: "master", label: "基础资料", type: "group" as const, children: [
      { key: "/master-data", icon: <DatabaseOutlined />, label: "基础资料维护" },
      { key: "/finished-goods-inbound", icon: <FileExcelOutlined />, label: "成品入库" }
    ] },
    { key: "system", label: "系统管理", type: "group" as const, children: [
      { key: "/imports", icon: <FileExcelOutlined />, label: "Excel 导入" },
      { key: "/audit", icon: <AuditOutlined />, label: "审计日志" }
    ] }
  ];
  const enhancedMenu = [...menu, {
    key: "access-pages", label: "账户与接口", type: "group" as const, children: [
      { key: "/users", icon: <DatabaseOutlined />, label: "用户与角色" },
      ...(user.roles?.includes("系统管理员") ? [{ key: "/api-keys", icon: <DatabaseOutlined />, label: "API Key" }] : [])
    ]
  }];
  return <Layout className="app-shell">
    <Sider collapsed={collapsed} width={238} className="sidebar">
      <div className="brand"><span className="brand-badge">KN</span>{!collapsed && <span>凯南计划中心</span>}</div>
      <Menu mode="inline" theme="dark" selectedKeys={[location.pathname]} defaultOpenKeys={["/monthly"]} items={enhancedMenu} onClick={({ key }) => navigate(key)} />
      <Button className="sidebar-collapse" type="primary" shape="circle" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
    </Sider>
    <Layout>
      <Header className="topbar">
        <div className="topbar-page-title">{location.pathname === "/monthly" ? `${monthlyYear}年${monthlyMonth}月计划` : ""}</div>
        <div className="topbar-user"><div><Text strong>{user.displayName ?? user.username}</Text><br /><Text type="secondary">{user.roles?.join(" / ")}</Text></div>
          <Button icon={<LogoutOutlined />} onClick={logout}>退出</Button></div>
      </Header>
      <Content className="content">
        <Routes>
          <Route path="/rolling" element={<Navigate to="/sales-summary-details" replace />} />
          <Route path="/sales-summary-dashboard" element={<SalesSummaryDashboard />} />
          <Route path="/sales-summary-details" element={<SalesSummaryDetails />} />
          <Route path="/monthly" element={<MonthlyPlan year={monthlyYear} month={monthlyMonth} setYear={setMonthlyYear} setMonth={setMonthlyMonth} />} />
          <Route path="/master-data" element={<DataOperations />} />
          <Route path="/data-operations" element={<DataOperations />} />
          <Route path="/finished-goods-inbound" element={<FinishedGoodsInboundPage />} />
          <Route path="/imports" element={<ExcelImport />} />
          <Route path="/audit" element={<AuditLogs />} />
          <Route path="/admin" element={<AdminCenter />} />
          <Route path="/users" element={<AdminCenter />} />
          <Route path="/contacts" element={<ContactDirectory />} />
          <Route path="/api-keys" element={<ApiKeyCenter />} />
          <Route path="*" element={<Navigate to="/sales-summary-details" replace />} />
        </Routes>
      </Content>
    </Layout>
  </Layout>;
}

function statusClass(rate: number | null, dueDate?: string | null) {
  if (rate !== null && rate >= 1) return "status-complete";
  if (!dueDate) return "";
  const today = dayjs().startOf("day");
  const due = dayjs(dueDate);
  if (due.isBefore(today)) return "status-overdue";
  if (due.isSame(today, "day")) return "status-due";
  return "";
}

function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  return <Flex justify="space-between" align="flex-start" className="page-header">
    <div className="page-header-title"><Title level={3}>{title}</Title>{subtitle && <Text type="secondary">{subtitle}</Text>}</div>
    {actions && <div className="page-header-actions">{actions}</div>}
  </Flex>;
}

async function downloadApiFile(path: string, filename: string) {
  const blob = await api<Blob>(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function parseCsvFile(file: File) {
  const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const parse = (line: string) => { const values: string[] = []; let current = ""; let quoted = false; for (let index = 0; index < line.length; index++) { const char = line[index]!; if (char === '"' && line[index + 1] === '"') { current += '"'; index++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { values.push(current.trim()); current = ""; } else current += char; } values.push(current.trim()); return values; };
  const headers = parse(lines.shift() ?? "");
  return lines.map((line) => Object.fromEntries(parse(line).map((value, index) => [headers[index], value])));
}

function InlineText({ value, onSave, type = "text" }: { value: unknown; onSave: (value: unknown) => Promise<unknown>; type?: "text" | "number" | "date" }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const save = async () => { const normalized = type === "number" && draft !== "" ? Number(draft) : draft; if (normalized !== value) await onSave(normalized); };
  return <Input size="small" type={type} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void save()} onPressEnter={() => void save()} />;
}

function FieldVisibility({ all, visible, onChange }: { all: Array<{ key: string; label: string }>; visible: string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)}>字段显示</Button><Modal title="字段显示" open={open} onCancel={() => setOpen(false)} footer={null}><Select mode="multiple" style={{ width: "100%" }} value={visible} options={all.map((field) => ({ value: field.key, label: field.label }))} onChange={onChange} /></Modal></>;
}

type PlanFilter = { field: string; value: string };
type DictionaryOptions = Record<string, string[]>;

function useDictionaryOptions() {
  const dictionaries = useQuery({ queryKey: ["dictionaries"], queryFn: () => api<any[]>("/master-data/dictionaries") });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api<any[]>("/master-data/suppliers") });
  return useMemo<DictionaryOptions>(() => {
    const options: DictionaryOptions = {};
    for (const type of dictionaries.data ?? []) {
      options[type.code] = (type.values ?? []).filter((entry: any) => entry.enabled).map((entry: any) => entry.value);
    }
    options.supplier = (suppliers.data ?? []).filter((supplier: any) => supplier.enabled).map((supplier: any) => supplier.name);
    return options;
  }, [dictionaries.data, suppliers.data]);
}

function filterPlanRows(rows: any[], filters: PlanFilter[], columns: ColumnDefinition[]) {
  return rows.filter((row) => filters.every((filter) => {
    if (!filter.field || !filter.value.trim()) return true;
    const column = columns.find((candidate) => candidate.key === filter.field);
    const actual = String(getValue(row, filter.field) ?? "");
    return column?.kind === "dictionary"
      ? actual === filter.value
      : actual.toLocaleLowerCase().includes(filter.value.trim().toLocaleLowerCase());
  }));
}

function matchesDateRange(value: unknown, start: string, end: string) {
  if (!start && !end) return true;
  const date = String(value ?? "");
  if (!date) return false;
  return (!start || date >= start) && (!end || date <= end);
}

function PlanFilterDrawer({ columns, options, value, onChange }: {
  columns: ColumnDefinition[];
  options: DictionaryOptions;
  value: PlanFilter[];
  onChange: (filters: PlanFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PlanFilter[]>(value);
  const activeCount = value.filter((filter) => filter.field && filter.value.trim()).length;
  const openDrawer = () => { setDraft(value); setOpen(true); };
  const update = (index: number, patch: Partial<PlanFilter>) =>
    setDraft((current) => current.map((filter, itemIndex) => itemIndex === index ? { ...filter, ...patch } : filter));
  return <>
    <Button icon={<FilterOutlined />} type={activeCount ? "primary" : "default"} onClick={openDrawer}>
      {activeCount ? `筛选（${activeCount}）` : "筛选"}
    </Button>
    <Drawer title="筛选数据" width={440} open={open} onClose={() => setOpen(false)}
      extra={<Space><Button onClick={() => setDraft([])}>清空</Button><Button type="primary" onClick={() => { onChange(draft.filter((filter) => filter.field && filter.value.trim())); setOpen(false); }}>应用筛选</Button></Space>}>
      <Text type="secondary">可同时添加多个条件；字典字段只能选择原表中的有效值。</Text>
      <Flex vertical gap={12} className="plan-filter-list">
        {draft.map((filter, index) => {
          const column = columns.find((candidate) => candidate.key === filter.field);
          const dictionaryValues = column?.dictionaryCode ? options[column.dictionaryCode] ?? [] : [];
          return <Card size="small" key={`${index}-${filter.field}`}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select showSearch optionFilterProp="label" placeholder="选择字段" value={filter.field || undefined}
                style={{ width: "100%" }}
                options={columns.map((item) => ({ value: item.key, label: item.group ? `${item.group} · ${item.header}` : item.header }))}
                onChange={(field) => update(index, { field, value: "" })} />
              {column?.kind === "dictionary"
                ? <Select showSearch allowClear optionFilterProp="label" placeholder="选择值" value={filter.value || undefined}
                    style={{ width: "100%" }} options={dictionaryValues.map((entry) => ({ value: entry, label: entry }))}
                    onChange={(selected) => update(index, { value: selected ?? "" })} />
                : <Input allowClear placeholder="输入要包含的内容" value={filter.value} onChange={(event) => update(index, { value: event.target.value })} />}
              <Button danger type="link" onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除此条件</Button>
            </Space>
          </Card>;
        })}
        <Button block onClick={() => setDraft((current) => [...current, { field: "", value: "" }])}>＋ 添加筛选条件</Button>
      </Flex>
    </Drawer>
  </>;
}

const rollingColumnsMeta: ColumnDefinition[] = [
  { key: "customer", header: "客户", group: "订单信息", kind: "text", editable: true },
  { key: "salesperson", header: "业务员", group: "订单信息", kind: "text", editable: true },
  { key: "orderNumber", header: "订单号", group: "订单信息", kind: "text", editable: false },
  { key: "orderDate", header: "下单日期", group: "订单信息", kind: "date", editable: false },
  { key: "customerDueDate", header: "客户要求交期", group: "订单信息", kind: "date", editable: true },
  { key: "reviewDueDate", header: "产前评审交期", group: "订单信息", kind: "date", editable: true },
  { key: "exceptionDueDate", header: "异常后二次交期", group: "订单信息", kind: "date", editable: true },
  { key: "exceptionDeliveryMethod", header: "异常交货方式", group: "订单信息", kind: "dictionary", editable: true, dictionaryCode: "deliveryMethod" },
  { key: "orderAmount", header: "订单金额", group: "订单信息", kind: "decimal", editable: true },
  { key: "totalQuantity", header: "订单总数量", group: "订单信息", kind: "decimal", editable: false },
  { key: "division", header: "承产单位", group: "订单执行信息", kind: "dictionary", editable: true, dictionaryCode: "division" },
  { key: "completedQuantity", header: "已完成数量", group: "订单执行信息", kind: "decimal", editable: false },
  { key: "pendingQuantity", header: "待完成数量", group: "订单执行信息", kind: "decimal", editable: false },
  { key: "completionRate", header: "完成比例", group: "订单执行信息", kind: "decimal", editable: false },
  { key: "actualCompletionDate", header: "订单实际完成日期", group: "订单执行信息", kind: "date", editable: true },
  { key: "shippingDate", header: "出货日期", group: "订单执行信息", kind: "date", editable: true },
  { key: "deliveryScore", header: "交期评分", group: "订单执行结果评估", kind: "decimal", editable: true },
  { key: "qualityScore", header: "品质评分", group: "订单执行结果评估", kind: "decimal", editable: true }
];

type RollingQuickFilters = {
  orderNumber: string;
  month: string;
  customerDueDateStart: string;
  customerDueDateEnd: string;
  reviewDueDateStart: string;
  reviewDueDateEnd: string;
  exceptionDueDateStart: string;
  exceptionDueDateEnd: string;
  completionRateStart: number | null;
  completionRateEnd: number | null;
  customer: string;
  division: string;
};

const emptyRollingQuickFilters = (): RollingQuickFilters => ({
  orderNumber: "", month: "",
  customerDueDateStart: "", customerDueDateEnd: "",
  reviewDueDateStart: "", reviewDueDateEnd: "",
  exceptionDueDateStart: "", exceptionDueDateEnd: "",
  completionRateStart: null, completionRateEnd: null,
  customer: "", division: ""
});

function salesSummaryStatus(row: any) {
  if (Number(row.completionRate ?? 0) >= 1) return "已完成";
  const dueDate = row.exceptionDueDate || row.reviewDueDate || row.customerDueDate;
  if (!dueDate) return "进行中";
  const today = dayjs().startOf("day");
  const due = dayjs(dueDate).startOf("day");
  if (due.isBefore(today)) return "延期";
  if (due.isSame(today, "day")) return "即将延期";
  return "进行中";
}

function SalesSummaryDashboard() {
  const dictionaryOptions = useDictionaryOptions();
  const [timeDimension, setTimeDimension] = useState<"year" | "month" | "day">("month");
  const [period, setPeriod] = useState<dayjs.Dayjs>(dayjs());
  const [division, setDivision] = useState<string[]>([]);
  const [customer, setCustomer] = useState<string[]>([]);
  const { data = [], isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["sales-dashboard"], queryFn: () => api<any[]>("/plans/sales-dashboard")
  });
  const filtered = useMemo(() => data.filter((row: any) => {
    const orderDate = row.orderDate ? dayjs(row.orderDate) : null;
    const matchesPeriod = Boolean(orderDate?.isValid() && orderDate.isSame(period, timeDimension));
    return matchesPeriod
      && (!division.length || division.includes(row.division ?? ""))
      && (!customer.length || customer.includes(row.customer ?? ""));
  }), [customer, data, division, period, timeDimension]);
  const divisionOptions = useMemo(() => [...new Set([
    ...(dictionaryOptions.division ?? []),
    ...data.map((row: any) => row.division).filter(Boolean)
  ])].map((value) => ({ value, label: value })), [data, dictionaryOptions.division]);
  const customerOptions = useMemo(() => [...new Set(data.map((row: any) => row.customer).filter(Boolean))]
    .sort().map((value) => ({ value, label: value })), [data]);
  const metrics = useMemo(() => {
    const totalQuantity = filtered.reduce((sum, row) => sum + Number(row.totalQuantity || 0), 0);
    const completedQuantity = filtered.reduce((sum, row) => sum + Number(row.completedQuantity || 0), 0);
    const pendingQuantity = filtered.reduce((sum, row) => sum + Number(row.pendingQuantity || 0), 0);
    const orderAmount = filtered.reduce((sum, row) => sum + Number(row.orderAmount || 0), 0);
    const statusCounts = { 已完成: 0, 进行中: 0, 即将延期: 0, 延期: 0 };
    for (const row of filtered) statusCounts[salesSummaryStatus(row) as keyof typeof statusCounts] += 1;
    return {
      totalQuantity, completedQuantity, pendingQuantity, orderAmount, statusCounts,
      completionRate: totalQuantity ? completedQuantity / totalQuantity * 100 : 0
    };
  }, [filtered]);
  const divisionRows = useMemo(() => {
    const grouped = new Map<string, { division: string; orders: number; amount: number; total: number; completed: number }>();
    for (const row of filtered) {
      const key = row.division || "未指定";
      const current = grouped.get(key) ?? { division: key, orders: 0, amount: 0, total: 0, completed: 0 };
      current.orders += 1; current.amount += Number(row.orderAmount || 0);
      current.total += Number(row.totalQuantity || 0); current.completed += Number(row.completedQuantity || 0);
      grouped.set(key, current);
    }
    return [...grouped.values()].map((row) => ({ ...row, rate: row.total ? row.completed / row.total * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered]);
  const customerRows = useMemo(() => {
    const grouped = new Map<string, { customer: string; orders: number; amount: number }>();
    for (const row of filtered) {
      const key = row.customer || "未指定";
      const current = grouped.get(key) ?? { customer: key, orders: 0, amount: 0 };
      current.orders += 1; current.amount += Number(row.orderAmount || 0); grouped.set(key, current);
    }
    return [...grouped.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
  }, [filtered]);
  const warningRows = useMemo(() => filtered.map((row: any) => {
    const dueDate = row.exceptionDueDate || row.reviewDueDate || row.customerDueDate;
    return { ...row, dueDate, status: salesSummaryStatus(row), remainingDays: dueDate ? dayjs(dueDate).startOf("day").diff(dayjs().startOf("day"), "day") : null };
  }).filter((row: any) => row.status !== "已完成" && row.dueDate && row.remainingDays <= 3)
    .sort((a: any, b: any) => a.remainingDays - b.remainingDays).slice(0, 10), [filtered]);
  const statusConfig = [
    { key: "已完成", color: "#3fa06a" }, { key: "进行中", color: "#26718f" },
    { key: "即将延期", color: "#c99332" }, { key: "延期", color: "#bb4d50" }
  ] as const;
  const integer = (value: number) => Math.round(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

  return <div className="sales-dashboard">
    <PageHeader title="销售接单汇总大屏" subtitle={`数据更新时间：${dataUpdatedAt ? dayjs(dataUpdatedAt).format("YYYY-MM-DD HH:mm:ss") : "加载中"}`}
      actions={<Space wrap>
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
      </Space>} />
    <div className="dashboard-kpi-grid">
      <Card><Statistic title="订单数" value={filtered.length} suffix="单" /></Card>
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
            const count = metrics.statusCounts[item.key];
            return <div className="dashboard-status-item" key={item.key}>
              <Flex justify="space-between"><Text>{item.key}</Text><Text strong>{count} 单</Text></Flex>
              <Progress percent={filtered.length ? Math.round(count / filtered.length * 100) : 0} strokeColor={item.color} showInfo={false} />
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
      <Card title="客户订单金额 TOP 8" loading={isLoading}>
        <Table size="small" rowKey="customer" pagination={false} dataSource={customerRows}
          columns={[
            { title: "客户", dataIndex: "customer", ellipsis: true },
            { title: "订单数", dataIndex: "orders", width: 72, align: "center" as const },
            { title: "订单金额", dataIndex: "amount", width: 120, align: "center" as const, render: (value: number) => integer(value) }
          ]} />
      </Card>
    </div>
    <div className="dashboard-panel-grid dashboard-panel-grid-bottom">
      <Card title="承产单位执行情况" loading={isLoading}>
        <div className="division-overview-grid">
          {divisionRows.map((row) => <div className="division-overview-item" key={row.division}>
            <Flex justify="space-between" align="center">
              <Text strong className="division-overview-name">{row.division}</Text>
              <Tag color="blue">{row.orders} 单</Tag>
            </Flex>
            <div className="division-overview-metrics">
              <span><Text type="secondary">订单金额</Text><Text strong>{integer(row.amount)}</Text></span>
              <span><Text type="secondary">总数量</Text><Text strong>{integer(row.total)}</Text></span>
              <span><Text type="secondary">已完成</Text><Text strong>{integer(row.completed)}</Text></span>
            </div>
            <Progress percent={Math.round(row.rate)} size="small" />
          </div>)}
          {!divisionRows.length && <div className="division-overview-empty">暂无承产单位数据</div>}
        </div>
      </Card>
      <Card title="交期预警（延期及未来 3 天）" loading={isLoading}>
        <Table size="small" rowKey="id" pagination={false} dataSource={warningRows}
          locale={{ emptyText: "暂无交期预警" }} columns={[
            { title: "订单号", dataIndex: "orderNumber", width: 140 },
            { title: "客户", dataIndex: "customer", ellipsis: true },
            { title: "承产单位", dataIndex: "division", width: 110 },
            { title: "有效交期", dataIndex: "dueDate", width: 100, render: (value: string) => dayjs(value).format("MM-DD") },
            { title: "状态", dataIndex: "status", width: 90, render: (value: string) => <Tag color={value === "延期" ? "red" : value === "即将延期" ? "orange" : "blue"}>{value}</Tag> }
          ]} />
      </Card>
    </div>
  </div>;
}

function SalesSummaryDetails() {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [rollingSaving, setRollingSaving] = useState(false);
  const [rollingLastSaved, setRollingLastSaved] = useState<string>();
  const [rollingSaveNotice, setRollingSaveNotice] = useState<{ type: "success" | "error"; text: string }>();
  const rollingGridApi = useRef<GridApi | null>(null);
  const rollingManualSave = useRef(false);
  const rollingSaveAndExit = useRef(false);
  const [filters, setFilters] = useState<PlanFilter[]>([]);
  const [quickFilters, setQuickFilters] = useState<RollingQuickFilters>(emptyRollingQuickFilters);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const rollingUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const dictionaryOptions = useDictionaryOptions();
  const rollingFieldOptions = rollingColumnsMeta.map((column) => column.key);
  const rollingVisibilityKey = `sales-summary-visible-fields:${rollingUser}`;
  const [visibleFields, setVisibleFields] = useState<string[]>(() => JSON.parse(localStorage.getItem(rollingVisibilityKey) ?? JSON.stringify(rollingFieldOptions)));
  useEffect(() => localStorage.setItem(rollingVisibilityKey, JSON.stringify(visibleFields)), [rollingVisibilityKey, visibleFields]);
  const { data = [], isLoading } = useQuery({ queryKey: ["rolling"], queryFn: () => api<any[]>("/plans/rolling") });
  const filtered = useMemo(() => filterPlanRows(data, filters, rollingColumnsMeta).filter((row: any) => {
    const completionRate = row.completionRate === null || row.completionRate === undefined
      ? null : Number(row.completionRate) * 100;
    return (!quickFilters.orderNumber || String(row.orderNumber ?? "").toLocaleLowerCase().includes(quickFilters.orderNumber.toLocaleLowerCase()))
      && (!quickFilters.month || String(row.month ?? "").includes(quickFilters.month))
      && matchesDateRange(row.customerDueDate, quickFilters.customerDueDateStart, quickFilters.customerDueDateEnd)
      && matchesDateRange(row.reviewDueDate, quickFilters.reviewDueDateStart, quickFilters.reviewDueDateEnd)
      && matchesDateRange(row.exceptionDueDate, quickFilters.exceptionDueDateStart, quickFilters.exceptionDueDateEnd)
      && (quickFilters.completionRateStart === null || (completionRate !== null && completionRate >= quickFilters.completionRateStart))
      && (quickFilters.completionRateEnd === null || (completionRate !== null && completionRate <= quickFilters.completionRateEnd))
      && (!quickFilters.customer || String(row.customer ?? "").toLocaleLowerCase().includes(quickFilters.customer.toLocaleLowerCase()))
      && (!quickFilters.division || row.division === quickFilters.division);
  }), [data, filters, quickFilters]);
  const saveRolling = () => {
    const editing = (rollingGridApi.current?.getEditingCells().length ?? 0) > 0;
    if (editing) {
      rollingManualSave.current = true;
      rollingSaveAndExit.current = true;
      rollingGridApi.current?.stopEditing();
    } else if (!rollingSaving && !rollingManualSave.current) {
      setEditMode(false);
      rollingSaveAndExit.current = false;
      setRollingSaveNotice({ type: "success", text: "保存成功" });
    }
  };
  const rollingWidths: Record<string, number> = {
    customer: 120, salesperson: 92, orderNumber: 130, orderDate: 96,
    customerDueDate: 110, reviewDueDate: 110, exceptionDueDate: 120,
    exceptionDeliveryMethod: 120, orderAmount: 120, totalQuantity: 110,
    division: 118, completedQuantity: 110, pendingQuantity: 110, completionRate: 122,
    actualCompletionDate: 138, shippingDate: 100, deliveryScore: 92, qualityScore: 92
  };
  const completionRenderer = ({ value }: any) => (
    <Progress percent={value === null ? 0 : Math.round(Number(value) * 100)} size="small"
      status={value >= 1 ? "success" : "active"} />
  );
  const makeRollingColumn = (meta: ColumnDefinition): ColDef => ({
    field: meta.key,
    headerName: meta.header,
    width: rollingWidths[meta.key] ?? 100,
    editable: editMode && Boolean(meta.editable),
    type: meta.kind === "decimal" ? "numericColumn" : undefined,
    cellEditor: meta.kind === "dictionary"
      ? "agSelectCellEditor"
      : meta.kind === "date"
        ? "agDateStringCellEditor"
        : meta.kind === "decimal" && meta.editable
          ? "agNumberCellEditor"
          : undefined,
    cellEditorParams: meta.kind === "dictionary"
      ? { values: dictionaryOptions[meta.dictionaryCode ?? ""] ?? [] } : undefined,
    valueFormatter: meta.kind === "date"
      ? ({ value }) => value ? dayjs(value).format("MM-DD") : ""
      : meta.key === "completionRate"
        ? ({ value }) => value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`
        : undefined,
    valueParser: meta.kind === "decimal" && meta.editable
      ? ({ newValue }) => newValue === "" ? null : Number(newValue) : undefined,
    cellRenderer: meta.key === "completionRate" ? completionRenderer : undefined
  });
  const groupColumns = (group: string, className: string, includeSequence = false): ColGroupDef => ({
    headerName: group,
    marryChildren: true,
    headerClass: className,
    children: [
      ...(includeSequence ? [{ headerName: "序号", valueGetter: "node.rowIndex + 1", width: 68, editable: false } as ColDef] : []),
      ...rollingColumnsMeta.filter((meta) => meta.group === group && visibleFields.includes(meta.key)).map(makeRollingColumn)
    ]
  });
  const columns: (ColDef | ColGroupDef)[] = [
    groupColumns("订单信息", "sales-summary-group-order", true),
    groupColumns("订单执行信息", "sales-summary-group-execution"),
    groupColumns("订单执行结果评估", "sales-summary-group-evaluation")
  ];
  return <div>
    <div className="monthly-toolbar rolling-toolbar">
      <Flex className="monthly-toolbar-row" align="center" gap={8} wrap>
      <Text strong className="toolbar-row-label">表格操作</Text>
      <Button type={editMode ? "primary" : "default"} onClick={() => {
        if (editMode) rollingGridApi.current?.stopEditing();
        else setRollingSaveNotice(undefined);
        setEditMode((value) => !value);
      }}>{editMode ? "退出编辑模式" : "进入编辑模式"}</Button>
      {editMode && <Button type="primary" loading={rollingSaving}
        onMouseDown={() => {
          if ((rollingGridApi.current?.getEditingCells().length ?? 0) > 0) {
            rollingManualSave.current = true;
            rollingSaveAndExit.current = true;
          }
        }}
        onClick={saveRolling}>保存</Button>}
      {editMode && <Tag color={rollingSaving ? "processing" : "success"}>{rollingSaving ? "保存中" : rollingLastSaved ? `已保存 ${rollingLastSaved}` : "失焦自动保存"}</Tag>}
      <Button onClick={() => setAddOpen(true)}>新增行</Button>
      <Text type="secondary">已选择 {selectedIds.length} 行</Text>
      <Upload accept=".xlsx" showUploadList={false} beforeUpload={async (file) => {
        const form = new FormData(); form.append("file", file as File);
        try {
          const result = await api<{ imported: number; skipped: number }>("/plans/orders/import-file", { method: "POST", body: form });
          message.success(`已导入 ${result.imported} 条接单记录${result.skipped ? `，跳过 ${result.skipped} 行` : ""}`);
          void queryClient.invalidateQueries({ queryKey: ["rolling"] });
        } catch (error) { message.error((error as Error).message); }
        return false;
      }}><Button>导入销售接单明细 Excel</Button></Upload>
      <FieldVisibility all={rollingColumnsMeta.map((column) => ({ key: column.key, label: column.header }))} visible={visibleFields} onChange={setVisibleFields} />
      </Flex>
      <Flex className="monthly-toolbar-row rolling-filter-row" align="center" gap={8} wrap>
        <PlanFilterDrawer columns={rollingColumnsMeta} options={dictionaryOptions} value={filters} onChange={setFilters} />
        <Button onClick={() => { setQuickFilters(emptyRollingQuickFilters()); setFilters([]); }}>清空筛选</Button>
        <Text strong className="toolbar-row-label quick-filter-label">快速筛选</Text>
        <Input aria-label="筛选滚动订单号" allowClear placeholder="订单号" value={quickFilters.orderNumber}
          onChange={(event) => setQuickFilters((current) => ({ ...current, orderNumber: event.target.value }))} style={{ width: 140 }} />
        <DatePicker aria-label="筛选所属月份" picker="month" allowClear format="YYYY年M月" placeholder="所属月份"
          value={quickFilters.month ? dayjs(`${quickFilters.month}-01`) : null}
          onChange={(value) => setQuickFilters((current) => ({ ...current, month: value?.format("YYYY-MM") ?? "" }))} style={{ width: 128 }} />
        <DatePicker.RangePicker aria-label="筛选滚动客户要求交期范围" allowClear format="M月D日"
          placeholder={["客户交期开始", "客户交期结束"]}
          value={quickFilters.customerDueDateStart && quickFilters.customerDueDateEnd
            ? [dayjs(quickFilters.customerDueDateStart), dayjs(quickFilters.customerDueDateEnd)] : null}
          onChange={(values) => setQuickFilters((current) => ({ ...current,
            customerDueDateStart: values?.[0]?.format("YYYY-MM-DD") ?? "",
            customerDueDateEnd: values?.[1]?.format("YYYY-MM-DD") ?? ""
          }))} style={{ width: 260 }} />
        <DatePicker.RangePicker aria-label="筛选滚动产前评审交期范围" allowClear format="M月D日"
          placeholder={["评审交期开始", "评审交期结束"]}
          value={quickFilters.reviewDueDateStart && quickFilters.reviewDueDateEnd
            ? [dayjs(quickFilters.reviewDueDateStart), dayjs(quickFilters.reviewDueDateEnd)] : null}
          onChange={(values) => setQuickFilters((current) => ({ ...current,
            reviewDueDateStart: values?.[0]?.format("YYYY-MM-DD") ?? "",
            reviewDueDateEnd: values?.[1]?.format("YYYY-MM-DD") ?? ""
          }))} style={{ width: 260 }} />
      </Flex>
      <Flex className="monthly-toolbar-row rolling-filter-row monthly-filter-row-secondary" align="center" gap={8} wrap>
        <span className="monthly-filter-indent" aria-hidden="true" />
        <DatePicker.RangePicker aria-label="筛选滚动异常后二次交期范围" allowClear format="M月D日"
          placeholder={["异常交期开始", "异常交期结束"]}
          value={quickFilters.exceptionDueDateStart && quickFilters.exceptionDueDateEnd
            ? [dayjs(quickFilters.exceptionDueDateStart), dayjs(quickFilters.exceptionDueDateEnd)] : null}
          onChange={(values) => setQuickFilters((current) => ({ ...current,
            exceptionDueDateStart: values?.[0]?.format("YYYY-MM-DD") ?? "",
            exceptionDueDateEnd: values?.[1]?.format("YYYY-MM-DD") ?? ""
          }))} style={{ width: 260 }} />
        <InputNumber aria-label="筛选完成比例下限" min={0} max={100} placeholder="比例下限" addonAfter="%"
          value={quickFilters.completionRateStart}
          onChange={(value) => setQuickFilters((current) => ({ ...current, completionRateStart: value }))} style={{ width: 128 }} />
        <InputNumber aria-label="筛选完成比例上限" min={0} max={100} placeholder="比例上限" addonAfter="%"
          value={quickFilters.completionRateEnd}
          onChange={(value) => setQuickFilters((current) => ({ ...current, completionRateEnd: value }))} style={{ width: 128 }} />
        <Input aria-label="筛选滚动客户" allowClear placeholder="客户" value={quickFilters.customer}
          onChange={(event) => setQuickFilters((current) => ({ ...current, customer: event.target.value }))} style={{ width: 126 }} />
        <Select aria-label="筛选滚动事业部" placeholder="所属事业部" allowClear value={quickFilters.division || undefined}
          onChange={(value) => setQuickFilters((current) => ({ ...current, division: value ?? "" }))}
          options={(dictionaryOptions.division ?? []).map((value) => ({ value, label: value }))} style={{ width: 136 }} />
      </Flex>
    </div>
    {rollingSaveNotice && <Alert className="save-notice" showIcon closable type={rollingSaveNotice.type}
      message={rollingSaveNotice.text} onClose={() => setRollingSaveNotice(undefined)} />}
    <div className="grid-card rolling-grid ag-theme-quartz">
      <AgGridReact rowData={filtered} columnDefs={columns} loading={isLoading} theme="legacy"
        singleClickEdit={editMode} stopEditingWhenCellsLoseFocus enableCellTextSelection ensureDomOrder
        suppressMovableColumns suppressColumnVirtualisation
        getRowId={({ data: row }) => row.id}
        onGridReady={({ api: instance }) => { rollingGridApi.current = instance; }}
        rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }} selectionColumnDef={{ pinned: "left", lockPosition: true, width: 48, resizable: false }}
        onSelectionChanged={({ api: grid }) => setSelectedIds(grid.getSelectedRows().map((row: any) => row.id))}
        onCellValueChanged={async ({ data: row, colDef, newValue, oldValue }) => {
          if (!colDef.field || newValue === oldValue) return;
          setRollingSaving(true);
          try {
            await api(`/plans/orders/${row.id}`, { method: "PATCH", body: JSON.stringify({ [colDef.field]: newValue }) });
            setRollingLastSaved(dayjs().format("HH:mm:ss"));
            if (rollingSaveAndExit.current) {
              setEditMode(false);
              setRollingSaveNotice({ type: "success", text: "保存成功" });
            }
            void queryClient.invalidateQueries({ queryKey: ["rolling"] });
          } catch (error) {
            setRollingSaveNotice({ type: "error", text: `保存失败：${(error as Error).message || "未知错误"}` });
          } finally {
            rollingManualSave.current = false;
            rollingSaveAndExit.current = false;
            setRollingSaving(false);
          }
        }}
        getRowClass={(params: RowClassParams) => `${params.node.rowIndex! % 2 ? "order-alt" : ""} ${statusClass(params.data.completionRate, params.data.reviewDueDate)}`}
        defaultColDef={{ sortable: true, resizable: true, filter: false, wrapHeaderText: true, autoHeaderHeight: true, minWidth: 68 }}
        rowHeight={44} headerHeight={56} groupHeaderHeight={42} />
    </div>
    <Modal title="新增销售接单" width={880} open={addOpen} onCancel={() => setAddOpen(false)} onOk={() => addForm.validateFields().then(async (values) => {
      const dateFields = ["orderDate", "customerDueDate", "reviewDueDate", "exceptionDueDate", "actualCompletionDate", "shippingDate"];
      const payload = { ...values };
      for (const field of dateFields) payload[field] = values[field]?.format("YYYY-MM-DD") ?? null;
      await api("/plans/orders", { method: "POST", body: JSON.stringify(payload) });
      setAddOpen(false); addForm.resetFields(); message.success("销售接单新增成功");
      void queryClient.invalidateQueries({ queryKey: ["rolling"] });
    }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={addForm} layout="vertical"><div className="master-data-form-grid">
        <Form.Item name="customer" label="客户"><Input /></Form.Item>
        <Form.Item name="salesperson" label="业务员"><Input /></Form.Item>
        <Form.Item name="orderNumber" label="订单号" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name="orderDate" label="下单日期"><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="customerDueDate" label="客户要求交期"><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="reviewDueDate" label="产前评审交期"><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="exceptionDueDate" label="异常后二次交期"><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="exceptionDeliveryMethod" label="异常交货方式"><Select allowClear options={(dictionaryOptions.deliveryMethod ?? []).map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="orderAmount" label="订单金额"><InputNumber style={{ width: "100%" }} precision={4} /></Form.Item>
        <Form.Item name="division" label="承产单位"><Select allowClear options={(dictionaryOptions.division ?? []).map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="actualCompletionDate" label="订单实际完成日期"><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="shippingDate" label="出货日期"><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="deliveryScore" label="交期评分"><InputNumber style={{ width: "100%" }} precision={2} /></Form.Item>
        <Form.Item name="qualityScore" label="品质评分"><InputNumber style={{ width: "100%" }} precision={2} /></Form.Item>
      </div></Form>
    </Modal>
  </div>;
}

const collapsibleStages = [
  { header: "毛坯", groups: ["前道配件", "机加", "焊接/点焊", "研磨", "毛坯"], representative: "毛坯", tone: "a" },
  { header: "烤漆/电镀", groups: ["木作", "油漆", "亚克力", "烤漆/电镀"], representative: "烤漆/电镀", tone: "b" },
  { header: "组装&包装", groups: ["后道包材&配件", "组装&包装"], representative: "组装&包装", tone: "a" }
] as const;

function monthlyColumnTone(column: ColumnDefinition) {
  const fixedTones: Record<string, "a" | "b"> = {
    "外协相关": "a", "图纸&BOM": "b", "五金主材": "a", "木作主材": "b"
  };
  return (column.group && fixedTones[column.group])
    || collapsibleStages.find((stage) => stage.groups.includes(column.group as never))?.tone;
}

function makeMonthlyColumn(column: ColumnDefinition, editMode: boolean, dictionaryOptions: DictionaryOptions): ColDef {
  const numeric = column.kind === "decimal";
  const dictionaryValues = column.dictionaryCode ? dictionaryOptions[column.dictionaryCode] ?? [] : [];
  const tone = monthlyColumnTone(column);
  return {
    field: column.key, headerName: column.header, editable: editMode && column.kind !== "image" && Boolean(column.editable),
    pinned: column.pinned || column.key === "relationKey" ? "left" : undefined,
    width: column.key === "relationKey" ? 170 : column.key === "sequence" ? 68 : 92,
    type: numeric ? "numericColumn" : undefined,
    cellEditor: column.kind === "dictionary" ? "agSelectCellEditor" : undefined,
    cellEditorParams: column.kind === "dictionary" ? { values: dictionaryValues } : undefined,
    headerClass: tone ? `column-tone-${tone}-header` : undefined,
    cellClass: tone ? `column-tone-${tone}` : undefined,
    valueGetter: ({ data }) => column.kind === "image" ? (data?.imageRefs?.length ?? 0) : getValue(data, column.key),
    valueFormatter: column.kind === "image"
      ? ({ value }) => value ? `${value} 张` : "上传"
      : column.kind === "date"
        ? ({ value }) => value ? dayjs(value).format("MM-DD") : ""
        : undefined,
    valueParser: numeric ? ({ newValue }) => newValue === "" ? null : Number(newValue) : undefined,
    cellClassRules: column.key.endsWith(".status") || column.key === "itemStatus" ? {
      "process-status-complete": ({ value }) => value === "已完成" || value === "完成",
      "process-status-progress": ({ value }) => value === "进行中",
      "process-status-warning": ({ value }) => value === "即将延期",
      "process-status-overdue": ({ value }) => value === "延期"
    } : undefined
  };
}

function makeMonthlyColumnDefs(editMode: boolean, hiddenFields: string[], dictionaryOptions: DictionaryOptions) {
  const output: (ColDef | ColGroupDef)[] = [];
  const orderedColumns = [...monthlyPlanColumns].sort((a, b) => a.key === "relationKey" ? -1 : b.key === "relationKey" ? 1 : 0);
  const visibleColumns = orderedColumns.filter((column) => !hiddenFields.includes(column.key));
  const handledGroups = new Set<string>();
  const handledStages = new Set<string>();
  for (const column of visibleColumns) {
    if (!column.group) {
      output.push(makeMonthlyColumn(column, editMode, dictionaryOptions));
      continue;
    }
    if (handledGroups.has(column.group)) continue;
    const stage = collapsibleStages.find((candidate) => candidate.groups.includes(column.group as never));
    if (stage) {
      if (handledStages.has(stage.header)) continue;
      handledStages.add(stage.header);
      const stageChildren = stage.groups.flatMap((group) => {
        const children = visibleColumns.filter((candidate) => candidate.group === group)
          .map((candidate) => makeMonthlyColumn(candidate, editMode, dictionaryOptions));
        if (!children.length) return [];
        handledGroups.add(group);
        return [{
          headerName: group,
          marryChildren: true,
          columnGroupShow: group === stage.representative ? undefined : "open",
          headerClass: `column-tone-${stage.tone}-header`,
          children
        } as ColGroupDef];
      });
      if (stageChildren.length) output.push({
        headerName: stage.header,
        marryChildren: true,
        openByDefault: false,
        headerClass: `column-tone-${stage.tone}-header`,
        children: stageChildren
      });
      continue;
    }
    const groupColumns = visibleColumns.filter((candidate) => candidate.group === column.group);
    handledGroups.add(column.group);
    const tone = monthlyColumnTone(column);
    output.push({
      headerName: column.group,
      marryChildren: true,
      headerClass: tone ? `column-tone-${tone}-header` : undefined,
      children: groupColumns.map((candidate) => makeMonthlyColumn(candidate, editMode, dictionaryOptions))
    });
  }
  return output;
}

function MonthlyPlan({ year, month, setYear, setMonth }: {
  year: number;
  month: number;
  setYear: React.Dispatch<React.SetStateAction<number>>;
  setMonth: React.Dispatch<React.SetStateAction<number>>;
}) {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [monthlyLastSaved, setMonthlyLastSaved] = useState<string>();
  const [monthlySaveNotice, setMonthlySaveNotice] = useState<{ type: "success" | "error"; text: string }>();
  const monthlyManualSave = useRef(false);
  const monthlySaveAndExit = useRef(false);
  const [filters, setFilters] = useState<PlanFilter[]>([]);
  const [quickFilters, setQuickFilters] = useState({
    division: "", orderNumber: "", itemNumber: "", itemStatus: "",
    customerDueDateStart: "", customerDueDateEnd: "",
    reviewDueDateStart: "", reviewDueDateEnd: "",
    exceptionDueDateStart: "", exceptionDueDateEnd: ""
  });
  const dictionaryOptions = useDictionaryOptions();
  const userKey = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  // 使用新键，让已使用过旧版本的用户也获得“关联信息默认隐藏”的默认值。
  const [hiddenFields, setHiddenFields] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`monthly-hidden-fields-v2:${userKey}`) ?? '["relationKey"]');
      return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : ["relationKey"];
    } catch {
      return ["relationKey"];
    }
  });
  const [fieldOpen, setFieldOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [monthlyImportPreview, setMonthlyImportPreview] = useState<any>();
  const [monthlyImportOpen, setMonthlyImportOpen] = useState(false);
  const [monthlyImporting, setMonthlyImporting] = useState(false);
  const [monthlyImportFileName, setMonthlyImportFileName] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addForm] = Form.useForm();
  const [moveForm] = Form.useForm();
  const [selectedItem, setSelectedItem] = useState<any>();
  const gridApi = useRef<GridApi | null>(null);
  const query = useQuery({ queryKey: ["monthly", year, month], queryFn: () => api<any>(`/plans/monthly?year=${year}&month=${month}`) });
  useEffect(() => { localStorage.setItem(`monthly-hidden-fields-v2:${userKey}`, JSON.stringify(hiddenFields)); }, [hiddenFields, userKey]);
  useEffect(() => {
    const periodId = query.data?.period?.id;
    const token = localStorage.getItem("accessToken");
    if (!periodId || !token) return;
    const socket = io("/plans", {
      auth: { token, period: periodId }, transports: ["websocket"]
    });
    socket.on("plan.changed", () => void queryClient.invalidateQueries({ queryKey: ["monthly", year, month] }));
    return () => { socket.close(); };
  }, [query.data?.period?.id, queryClient, year, month]);
  const mutation = useMutation({
    mutationFn: ({ id, field, value, expectedVersion }: any) => api(`/plans/items/${id}/cell`, { method: "PATCH", body: JSON.stringify({ field, value, expectedVersion }) }),
    onError: () => void queryClient.invalidateQueries({ queryKey: ["monthly", year, month] }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["monthly", year, month] })
  });
  const rows = useMemo(() =>
    filterPlanRows(query.data?.rows ?? [], filters, monthlyPlanColumns).filter((row: any) =>
      (!quickFilters.division || row.division === quickFilters.division)
      && (!quickFilters.orderNumber || String(row.orderNumber ?? "").includes(quickFilters.orderNumber))
      && (!quickFilters.itemNumber || String(row.itemNumber ?? "").includes(quickFilters.itemNumber))
      && (!quickFilters.itemStatus || row.itemStatus === quickFilters.itemStatus)
      && matchesDateRange(row.customerDueDate, quickFilters.customerDueDateStart, quickFilters.customerDueDateEnd)
      && matchesDateRange(row.reviewDueDate, quickFilters.reviewDueDateStart, quickFilters.reviewDueDateEnd)
      && matchesDateRange(row.exceptionDueDate, quickFilters.exceptionDueDateStart, quickFilters.exceptionDueDateEnd)
    ), [filters, query.data?.rows, quickFilters]);
  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(
    () => makeMonthlyColumnDefs(editMode, hiddenFields, dictionaryOptions),
    [dictionaryOptions, editMode, hiddenFields]
  );
  const saveMonthly = () => {
    const editing = (gridApi.current?.getEditingCells().length ?? 0) > 0;
    if (editing) {
      monthlyManualSave.current = true;
      monthlySaveAndExit.current = true;
      gridApi.current?.stopEditing();
    } else if (!mutation.isPending && !monthlyManualSave.current) {
      setEditMode(false);
      monthlySaveAndExit.current = false;
      setMonthlySaveNotice({ type: "success", text: "保存成功" });
    }
  };
  const moveSelectedItems = async () => {
    const values = await moveForm.validateFields();
    const target = values.targetPeriod as dayjs.Dayjs;
    setMoving(true);
    try {
      const result = await api<{ moved: number; skipped: number; target: { year: number; month: number } }>("/plans/items/move", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedIds,
          targetYear: target.year(),
          targetMonth: target.month() + 1
        })
      });
      setMoveOpen(false);
      moveForm.resetFields();
      setSelectedIds([]);
      setMonthlySaveNotice({
        type: "success",
        text: `已将 ${result.moved} 个品号调整到 ${result.target.year}年${String(result.target.month).padStart(2, "0")}月`
      });
      void queryClient.invalidateQueries({ queryKey: ["monthly"] });
      void queryClient.invalidateQueries({ queryKey: ["rolling"] });
    } catch (error) {
      setMonthlySaveNotice({
        type: "error",
        text: `调整月份失败：${(error as Error).message || "未知错误"}`
      });
    } finally {
      setMoving(false);
    }
  };
  return <div>
    <div className="monthly-toolbar">
      <Flex className="monthly-toolbar-row" align="center" gap={8} wrap>
      <Text strong className="toolbar-row-label">表格操作</Text>
      <Button type={editMode ? "primary" : "default"} onClick={() => {
        if (editMode) gridApi.current?.stopEditing();
        else setMonthlySaveNotice(undefined);
        setEditMode((value) => !value);
      }}>{editMode ? "退出编辑模式" : "进入编辑模式"}</Button>
      {editMode && <Button type="primary" loading={mutation.isPending}
        onMouseDown={() => {
          if ((gridApi.current?.getEditingCells().length ?? 0) > 0) {
            monthlyManualSave.current = true;
            monthlySaveAndExit.current = true;
          }
        }}
        onClick={saveMonthly}>保存</Button>}
      {editMode && <Tag color={mutation.isPending ? "processing" : "success"}>{mutation.isPending ? "保存中" : monthlyLastSaved ? `已保存 ${monthlyLastSaved}` : "失焦自动保存"}</Tag>}
      <Button onClick={() => setAddOpen(true)}>新增行</Button>
      <Button disabled={!selectedIds.length} onClick={() => {
        setMonthlySaveNotice(undefined);
        moveForm.resetFields();
        setMoveOpen(true);
      }}>调整月份（{selectedIds.length}）</Button>
      <Upload accept=".xlsx" showUploadList={false} beforeUpload={async (file) => {
        const form = new FormData();
        form.append("file", file as File); form.append("year", String(year)); form.append("month", String(month));
        setMonthlyImporting(true);
        try {
          const preview = await api<any>("/imports/preview", { method: "POST", body: form });
          setMonthlyImportPreview(preview); setMonthlyImportFileName(file.name); setMonthlyImportOpen(true);
        } catch (error) { message.error((error as Error).message); }
        finally { setMonthlyImporting(false); }
        return false;
      }}><Button loading={monthlyImporting}>导入月度计划 Excel</Button></Upload>
      <Button onClick={() => setFieldOpen(true)}>字段显示</Button>
      <Button type="primary" href={`/api/v1/plans/monthly/export?year=${year}&month=${month}`} target="_blank">导出 Excel</Button>
      </Flex>
      <Flex className="monthly-toolbar-row monthly-filter-row" align="center" gap={8} wrap>
        <PlanFilterDrawer columns={monthlyPlanColumns} options={dictionaryOptions} value={filters} onChange={setFilters} />
        <Button onClick={() => { setQuickFilters({
          division: "", orderNumber: "", itemNumber: "", itemStatus: "",
          customerDueDateStart: "", customerDueDateEnd: "",
          reviewDueDateStart: "", reviewDueDateEnd: "",
          exceptionDueDateStart: "", exceptionDueDateEnd: ""
        }); setFilters([]); }}>清空筛选</Button>
        <Text strong className="toolbar-row-label quick-filter-label">快速筛选</Text>
        <InputNumber aria-label="筛选年份" value={year} onChange={(value) => { setYear(value ?? 2026); setQuickFilters((current) => ({
          ...current,
          customerDueDateStart: "", customerDueDateEnd: "",
          reviewDueDateStart: "", reviewDueDateEnd: "",
          exceptionDueDateStart: "", exceptionDueDateEnd: ""
        })); }} min={2020} max={2200} addonAfter="年" style={{ width: 128 }} />
        <Select aria-label="筛选月份" value={month} onChange={setMonth} options={Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: `${index + 1}月` }))} style={{ width: 88 }} />
        <Select aria-label="筛选事业部" placeholder="事业部" allowClear value={quickFilters.division || undefined}
          onChange={(value) => setQuickFilters((current) => ({ ...current, division: value ?? "" }))}
          options={(dictionaryOptions.division ?? []).map((value) => ({ value, label: value }))} style={{ width: 126 }} />
        <Input aria-label="筛选订单号" allowClear placeholder="订单号" value={quickFilters.orderNumber}
          onChange={(event) => setQuickFilters((current) => ({ ...current, orderNumber: event.target.value }))} style={{ width: 140 }} />
        <Input aria-label="筛选品号" allowClear placeholder="品号" value={quickFilters.itemNumber}
          onChange={(event) => setQuickFilters((current) => ({ ...current, itemNumber: event.target.value }))} style={{ width: 140 }} />
        <Select aria-label="筛选品号状态" placeholder="品号状态" allowClear value={quickFilters.itemStatus || undefined}
          onChange={(value) => setQuickFilters((current) => ({ ...current, itemStatus: value ?? "" }))}
          options={["完成", "进行中", "即将延期", "延期"].map((value) => ({ value, label: value }))} style={{ width: 126 }} />
      </Flex>
      <Flex className="monthly-toolbar-row monthly-filter-row monthly-filter-row-secondary" align="center" gap={8} wrap>
        <span className="monthly-filter-indent" aria-hidden="true" />
        <DatePicker.RangePicker aria-label="筛选客户要求交期范围" allowClear format="M月D日"
          placeholder={["客户交期开始", "客户交期结束"]}
          value={quickFilters.customerDueDateStart && quickFilters.customerDueDateEnd
            ? [dayjs(quickFilters.customerDueDateStart), dayjs(quickFilters.customerDueDateEnd)] : null}
          onChange={(values) => setQuickFilters((current) => ({ ...current,
            customerDueDateStart: values?.[0]?.format("YYYY-MM-DD") ?? "",
            customerDueDateEnd: values?.[1]?.format("YYYY-MM-DD") ?? ""
          }))} style={{ width: 260 }} />
        <DatePicker.RangePicker aria-label="筛选产前评审交期范围" allowClear format="M月D日"
          placeholder={["评审交期开始", "评审交期结束"]}
          value={quickFilters.reviewDueDateStart && quickFilters.reviewDueDateEnd
            ? [dayjs(quickFilters.reviewDueDateStart), dayjs(quickFilters.reviewDueDateEnd)] : null}
          onChange={(values) => setQuickFilters((current) => ({ ...current,
            reviewDueDateStart: values?.[0]?.format("YYYY-MM-DD") ?? "",
            reviewDueDateEnd: values?.[1]?.format("YYYY-MM-DD") ?? ""
          }))} style={{ width: 260 }} />
        <DatePicker.RangePicker aria-label="筛选异常后二次交期范围" allowClear format="M月D日"
          placeholder={["异常交期开始", "异常交期结束"]}
          value={quickFilters.exceptionDueDateStart && quickFilters.exceptionDueDateEnd
            ? [dayjs(quickFilters.exceptionDueDateStart), dayjs(quickFilters.exceptionDueDateEnd)] : null}
          onChange={(values) => setQuickFilters((current) => ({ ...current,
            exceptionDueDateStart: values?.[0]?.format("YYYY-MM-DD") ?? "",
            exceptionDueDateEnd: values?.[1]?.format("YYYY-MM-DD") ?? ""
          }))} style={{ width: 260 }} />
      </Flex>
    </div>
    {monthlySaveNotice && <Alert className="save-notice" showIcon closable type={monthlySaveNotice.type}
      message={monthlySaveNotice.text} onClose={() => setMonthlySaveNotice(undefined)} />}
    {query.data && !query.data.period && <Alert type="info" showIcon message="这个月份尚未生成计划，可通过导入或每月自动任务创建。" />}
    <div className="monthly-grid ag-theme-quartz">
      <AgGridReact rowData={rows} columnDefs={columnDefs} loading={query.isLoading} theme="legacy" singleClickEdit={editMode} rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }} selectionColumnDef={{ pinned: "left", lockPosition: true, width: 48, resizable: false }}
        enableCellTextSelection ensureDomOrder suppressMovableColumns
        getRowId={({ data }) => data.id}
        onSelectionChanged={({ api: grid }) => setSelectedIds(grid.getSelectedRows().map((row: any) => row.id))}
        onGridReady={({ api: instance }) => { gridApi.current = instance; }}
        onCellClicked={({ column, data }) => {
          setSelectedItem(data);
          if (column.getColId() === "image") setImageOpen(true);
        }}
        onCellValueChanged={async ({ data, colDef, newValue, oldValue }) => {
          if (newValue === oldValue || !colDef.field) return;
          try {
            await mutation.mutateAsync({ id: data.id, field: colDef.field, value: newValue, expectedVersion: data.version });
            setMonthlyLastSaved(dayjs().format("HH:mm:ss"));
            if (monthlySaveAndExit.current) {
              setEditMode(false);
              setMonthlySaveNotice({ type: "success", text: "保存成功" });
            }
          } catch (error) {
            const apiError = error as ApiError;
            const detail = apiError.status === 409
              ? "数据已被其他用户修改，请刷新后重试"
              : apiError.message || "未知错误";
            setMonthlySaveNotice({ type: "error", text: `保存失败：${detail}` });
          } finally {
            monthlyManualSave.current = false;
            monthlySaveAndExit.current = false;
          }
        }}
        getRowClass={(params: RowClassParams) => params.node.rowIndex! % 2 ? "order-alt" : ""}
        defaultColDef={{ sortable: true, resizable: true, filter: false, wrapHeaderText: true, autoHeaderHeight: true, minWidth: 68 }}
        rowHeight={40} headerHeight={58} groupHeaderHeight={42} stopEditingWhenCellsLoseFocus />
    </div>
    <Modal title="字段显示" width={760} open={fieldOpen} onCancel={() => setFieldOpen(false)} footer={<Button type="primary" onClick={() => setFieldOpen(false)}>完成</Button>}>
      <Flex align="center" justify="space-between" gap={12} style={{ marginBottom: 12 }}>
        <Text type="secondary">已显示 {monthlyPlanColumns.length - hiddenFields.filter((key) => monthlyPlanColumns.some((column) => column.key === key)).length} / {monthlyPlanColumns.length} 个字段</Text>
        <Space>
          <Button onClick={() => setHiddenFields([])}>全部显示</Button>
          <Button onClick={() => setHiddenFields(["relationKey"])}>恢复默认</Button>
        </Space>
      </Flex>
      <Select mode="multiple" showSearch allowClear optionFilterProp="label" maxTagCount="responsive" maxTagTextLength={12}
        placeholder="搜索并选择需要显示的字段"
        value={monthlyPlanColumns.filter((c) => !hiddenFields.includes(c.key)).map((c) => c.key)} style={{ width: "100%" }}
        options={monthlyPlanColumns.map((c) => ({ value: c.key, label: c.group ? `${c.group} · ${c.header}` : c.header }))}
        onChange={(visible) => setHiddenFields(monthlyPlanColumns.map((c) => c.key).filter((key) => !visible.includes(key)))} />
    </Modal>
    <Modal title="导入月度计划" open={monthlyImportOpen} confirmLoading={monthlyImporting}
      okText="确认写入" cancelText="取消"
      onCancel={() => { if (!monthlyImporting) { setMonthlyImportOpen(false); setMonthlyImportPreview(undefined); } }}
      onOk={async () => {
        if (!monthlyImportPreview?.jobId) return;
        setMonthlyImporting(true);
        try {
          await api(`/imports/${monthlyImportPreview.jobId}/confirm`, { method: "POST" });
          message.success("月度计划导入成功");
          setMonthlyImportOpen(false); setMonthlyImportPreview(undefined);
          void queryClient.invalidateQueries({ queryKey: ["monthly", year, month] });
          void queryClient.invalidateQueries({ queryKey: ["rolling"] });
        } catch (error) { message.error(`导入失败：${(error as Error).message}`); }
        finally { setMonthlyImporting(false); }
      }}>
      <Descriptions size="small" column={2} bordered items={[
        { key: "file", label: "文件", children: monthlyImportFileName },
        { key: "period", label: "目标月份", children: `${year}年${month}月` },
        ...Object.entries(monthlyImportPreview?.summary ?? {}).map(([key, value]) => ({
          key, label: ({ add: "新增", update: "更新", skip: "跳过", warning: "警告", failure: "失败" } as any)[key] ?? key,
          children: String(value)
        }))
      ]} />
      {monthlyImportPreview?.warnings?.length > 0 && <Alert style={{ marginTop: 12 }} type="warning" showIcon
        message={`${monthlyImportPreview.warnings.length} 条数据质量提示`}
        description={<ul>{monthlyImportPreview.warnings.slice(0, 10).map((warning: string, index: number) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>} />}
    </Modal>
    <Modal title="新增月度计划行" open={addOpen} onCancel={() => setAddOpen(false)} onOk={() => addForm.validateFields().then(async (values) => { await api("/plans/items", { method: "POST", body: JSON.stringify({ ...values, year, month }) }); setAddOpen(false); addForm.resetFields(); void queryClient.invalidateQueries({ queryKey: ["monthly", year, month] }); })}>
      <Form form={addForm} layout="vertical"><Form.Item label="订单号" name="orderNumber" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="品号" name="itemNumber" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="品名" name="itemName"><Input /></Form.Item><Form.Item label="客户" name="customer"><Input /></Form.Item><Form.Item label="事业部" name="division"><Select allowClear options={(dictionaryOptions.division ?? []).map((value) => ({ value, label: value }))} /></Form.Item></Form>
    </Modal>
    <Modal title={`调整所选品号的月份（${selectedIds.length} 个）`} open={moveOpen} confirmLoading={moving}
      onCancel={() => { if (!moving) { setMoveOpen(false); moveForm.resetFields(); } }}
      onOk={() => void moveSelectedItems()}>
      <Alert type="info" showIcon message="所选品号将从当前月度计划移动到目标年月，其他数据保持不变。" />
      <Form form={moveForm} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item label="目标年月" name="targetPeriod" rules={[
          { required: true, message: "请选择目标年月" },
          {
            validator: (_, value) => value && value.year() === year && value.month() + 1 === month
              ? Promise.reject(new Error("目标年月不能与当前计划月份相同"))
              : Promise.resolve()
          }
        ]}>
          <DatePicker aria-label="目标年月" picker="month" format="YYYY年MM月" style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
    <Modal title={selectedItem ? `上传简图 · 品号 ${selectedItem.itemNumber}` : "上传简图"} open={imageOpen} onCancel={() => setImageOpen(false)}
      footer={<Button onClick={() => setImageOpen(false)}>关闭</Button>}>
      {!selectedItem ? <Alert type="info" showIcon message="请先在表格中选择一行" /> : <Space wrap>
        {(selectedItem.imageRefs ?? []).map((url: string) => <img key={url} src={url} alt="简图" style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 6 }} />)}
        <Upload accept="image/jpeg,image/png,image/webp" showUploadList={false}
          customRequest={async ({ file, onSuccess, onError }: any) => {
            try {
              const form = new FormData(); form.append("image", file as File);
              const result = await api<{ imageRefs: string[]; version: number }>(`/plans/items/${selectedItem.id}/images`, { method: "POST", body: form });
              setSelectedItem((current: any) => ({ ...current, imageRefs: result.imageRefs, version: result.version }));
              message.success("简图已上传"); onSuccess?.({});
              void queryClient.invalidateQueries({ queryKey: ["monthly", year, month] });
            } catch (error) { message.error((error as Error).message); onError?.(error); }
          }}>
          <Button disabled={(selectedItem.imageRefs?.length ?? 0) >= 2}>选择图片（最多 2 张）</Button>
        </Upload>
      </Space>}
    </Modal>
  </div>;
}

const inboundFieldLabels: Record<string, string> = {
  salesOrderNumber: "销售订单号", documentDate: "单据日期", createdTime: "创建时间",
  documentNumber: "单据编号", businessType: "业务类型", warehouseCode: "仓库编码",
  warehouse: "仓库", inboundCategory: "入库类别", workshopCode: "生产车间编码",
  workshop: "生产车间", handlerCode: "经手人编码", handler: "经手人", remark: "备注",
  creator: "制单人", auditor: "审核人", inventoryCode: "存货编码", inventoryName: "存货",
  specification: "规格型号", unit: "计量单位", relationInfo: "关联信息",
  receivedQuantity: "实收数量", unitPrice: "单价", totalAmount: "总金额", voucherWord: "凭证字号"
};
const inboundFields = Object.keys(inboundFieldLabels);

function DataOperations() {
  const queryClient = useQueryClient();
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api<any[]>("/master-data/suppliers") });
  const dictionaries = useQuery({ queryKey: ["dictionaries"], queryFn: () => api<any[]>("/master-data/dictionaries") });
  const processes = useQuery({ queryKey: ["processes"], queryFn: () => api<any[]>("/master-data/processes") });
  const [supplierIds, setSupplierIds] = useState<React.Key[]>([]);
  const [dictionaryIds, setDictionaryIds] = useState<React.Key[]>([]);
  const [processIds, setProcessIds] = useState<React.Key[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [supplierForm] = Form.useForm();
  const [dictionaryForm] = Form.useForm();
  const [processForm] = Form.useForm();
  const baseUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const supplierFields = ["code", "name", "remark", "enabled"];
  const dictionaryFields = ["code", "typeName", "value", "sortOrder", "enabled"];
  const processFields = ["sortOrder", "code", "name", "enableRequiredDays", "enableDueDate", "enableStatus", "enableException", "enabled"];
  const [supplierVisible, setSupplierVisible] = useState<string[]>(() => JSON.parse(localStorage.getItem(`suppliers-visible-fields:${baseUser}`) ?? JSON.stringify(supplierFields)));
  const [dictionaryVisible, setDictionaryVisible] = useState<string[]>(() => JSON.parse(localStorage.getItem(`dictionaries-visible-fields:${baseUser}`) ?? JSON.stringify(dictionaryFields)));
  const [processVisible, setProcessVisible] = useState<string[]>(() => JSON.parse(localStorage.getItem(`processes-visible-fields:${baseUser}`) ?? JSON.stringify(processFields)));
  useEffect(() => {
    localStorage.setItem(`suppliers-visible-fields:${baseUser}`, JSON.stringify(supplierVisible));
    localStorage.setItem(`dictionaries-visible-fields:${baseUser}`, JSON.stringify(dictionaryVisible));
    localStorage.setItem(`processes-visible-fields:${baseUser}`, JSON.stringify(processVisible));
  }, [baseUser, supplierVisible, dictionaryVisible, processVisible]);
  const refresh = (key: string) => void queryClient.invalidateQueries({ queryKey: [key] });
  const dictionaryRows = (dictionaries.data ?? []).flatMap((type: any) => type.values.map((value: any) => ({ ...value, typeId: type.id, code: type.code, typeName: type.name })));
  const updateSupplier = async (id: string, field: string, value: unknown) => {
    try {
      await api(`/master-data/suppliers/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
      refresh("suppliers");
    } catch (error) {
      message.error((error as Error).message);
      refresh("suppliers");
      throw error;
    }
  };
  const updateDictionaryType = async (id: string, field: string, value: unknown) => { await api(`/master-data/dictionary-types/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); refresh("dictionaries"); };
  const updateDictionaryValue = async (id: string, field: string, value: unknown) => { await api(`/master-data/dictionary-values/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); refresh("dictionaries"); };
  const updateProcess = async (id: string, field: string, value: unknown) => { await api(`/master-data/processes/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); refresh("processes"); };
  const importMasterFile = async (file: File, kind: "suppliers" | "dictionaries") => {
    const form = new FormData();
    form.append("file", file);
    setImporting(kind);
    try {
      const result = await api<{ imported: number; skipped?: number }>(`/master-data/${kind}/import-file`, { method: "POST", body: form });
      message.success(`已导入 ${result.imported} 行${result.skipped ? `，跳过 ${result.skipped} 行` : ""}`);
      refresh(kind);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setImporting(undefined);
    }
    return false;
  };
  const downloadTemplate = async (kind: "suppliers" | "dictionaries", format: "xlsx" | "csv") => {
    const name = ({
      suppliers: "供应商导入模板",
      dictionaries: "字典导入模板",
    } as const)[kind];
    try {
      await downloadApiFile(`/master-data/templates/${kind}?format=${format}`, `${name}.${format}`);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const supplierColumns = [
    { title: "编码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row.id, "code", v)} /> },
    { title: "名称", dataIndex: "name", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row.id, "name", v)} /> },
    { title: "备注", dataIndex: "remark", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row.id, "remark", v)} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <Switch checked={value} onChange={(v) => void updateSupplier(row.id, "enabled", v)} /> }
  ].filter((column) => supplierVisible.includes(column.dataIndex));
  const dictionaryColumns = [
    { title: "字典编码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryType(row.typeId, "code", v)} /> },
    { title: "字典名称", dataIndex: "typeName", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryType(row.typeId, "name", v)} /> },
    { title: "值", dataIndex: "value", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryValue(row.id, "value", v)} /> },
    { title: "顺序", dataIndex: "sortOrder", render: (value: unknown, row: any) => <InlineText type="number" value={value} onSave={(v) => updateDictionaryValue(row.id, "sortOrder", v)} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <Switch checked={value} onChange={(v) => void updateDictionaryValue(row.id, "enabled", v)} /> }
  ].filter((column) => dictionaryVisible.includes(column.dataIndex));
  const processColumns = [
    { title: "顺序", dataIndex: "sortOrder", render: (value: unknown, row: any) => <InlineText type="number" value={value} onSave={(v) => updateProcess(row.id, "sortOrder", v)} /> },
    { title: "代码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateProcess(row.id, "code", v)} /> },
    { title: "名称", dataIndex: "name", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateProcess(row.id, "name", v)} /> },
    ...["enableRequiredDays", "enableDueDate", "enableStatus", "enableException", "enabled"].map((field) => ({ title: ({ enableRequiredDays: "所需天数", enableDueDate: "交期", enableStatus: "状态", enableException: "异常", enabled: "启用" } as any)[field], dataIndex: field, render: (value: boolean, row: any) => <Switch checked={value} onChange={(v) => void updateProcess(row.id, field, v)} /> }))
  ].filter((column) => processVisible.includes(column.dataIndex));

  return <div><PageHeader title="基础数据维护" subtitle="表格内容可直接编辑；复选框支持多选" actions={<Space>
    <Button onClick={() => { supplierForm.resetFields(); supplierForm.setFieldsValue({ enabled: true }); setSupplierOpen(true); }}>新增供应商</Button>
    <Button onClick={() => setDictionaryOpen(true)}>新增字典值</Button>
    <Button onClick={() => setProcessOpen(true)}>新增工序</Button>
  </Space>} />
    <Tabs items={[
      { key: "suppliers", label: `供应商（${suppliers.data?.length ?? 0}）`, children: <>
        <Space wrap className="master-data-toolbar">
          <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importMasterFile(file as File, "suppliers")}>
            <Button loading={importing === "suppliers"}>导入供应商（CSV/XLSX）</Button>
          </Upload>
          <Button onClick={() => void downloadTemplate("suppliers", "xlsx")}>下载 XLSX 模板</Button>
          <Button onClick={() => void downloadTemplate("suppliers", "csv")}>下载 CSV 模板</Button>
          <Button danger disabled={!supplierIds.length} onClick={async () => { await api("/master-data/suppliers/delete", { method: "POST", body: JSON.stringify({ ids: supplierIds }) }); setSupplierIds([]); refresh("suppliers"); }}>停用选中（{supplierIds.length}）</Button>
          <FieldVisibility all={supplierFields.map((key) => ({ key, label: ({ code: "编码", name: "名称", remark: "备注", enabled: "启用" } as any)[key] }))} visible={supplierVisible} onChange={setSupplierVisible} />
        </Space>
        <Table rowKey="id" rowSelection={{ selectedRowKeys: supplierIds, onChange: setSupplierIds }} dataSource={suppliers.data} pagination={{ pageSize: 50 }} columns={supplierColumns} />
      </> },
      { key: "dictionaries", label: `字典值（${dictionaryRows.length}）`, children: <>
        <Space wrap className="master-data-toolbar">
          <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importMasterFile(file as File, "dictionaries")}>
            <Button loading={importing === "dictionaries"}>导入字典（CSV/XLSX）</Button>
          </Upload>
          <Button onClick={() => void downloadTemplate("dictionaries", "xlsx")}>下载 XLSX 模板</Button>
          <Button onClick={() => void downloadTemplate("dictionaries", "csv")}>下载 CSV 模板</Button>
          <Button danger disabled={!dictionaryIds.length} onClick={async () => { await api("/master-data/dictionary-values/delete", { method: "POST", body: JSON.stringify({ ids: dictionaryIds }) }); setDictionaryIds([]); refresh("dictionaries"); }}>停用选中（{dictionaryIds.length}）</Button>
          <FieldVisibility all={dictionaryFields.map((key) => ({ key, label: ({ code: "字典编码", typeName: "字典名称", value: "值", sortOrder: "顺序", enabled: "启用" } as any)[key] }))} visible={dictionaryVisible} onChange={setDictionaryVisible} />
        </Space>
        <Table rowKey="id" rowSelection={{ selectedRowKeys: dictionaryIds, onChange: setDictionaryIds }} dataSource={dictionaryRows} pagination={{ pageSize: 50 }} columns={dictionaryColumns} />
      </> },
      { key: "processes", label: `工序（${processes.data?.length ?? 0}）`, children: <>
        <Space wrap className="master-data-toolbar">
          <Upload accept=".csv" showUploadList={false} beforeUpload={async (file) => { const rows = await parseCsvFile(file as File); await api("/master-data/processes/import", { method: "POST", body: JSON.stringify({ rows: rows.map((row: any) => ({ ...row, sortOrder: Number(row.sortOrder ?? row["顺序"]), enableRequiredDays: String(row.enableRequiredDays ?? row["所需天数"]).toLowerCase() === "true", enableDueDate: String(row.enableDueDate ?? row["交期"]).toLowerCase() === "true", enableStatus: String(row.enableStatus ?? row["状态"]).toLowerCase() === "true", enableException: String(row.enableException ?? row["异常"]).toLowerCase() === "true" })) }) }); message.success(`已导入 ${rows.length} 行`); refresh("processes"); return false; }}><Button>导入工序 CSV</Button></Upload>
          <Button danger disabled={!processIds.length} onClick={async () => { await api("/master-data/processes/delete", { method: "POST", body: JSON.stringify({ ids: processIds }) }); setProcessIds([]); refresh("processes"); }}>停用选中（{processIds.length}）</Button>
          <FieldVisibility all={processFields.map((key) => ({ key, label: ({ sortOrder: "顺序", code: "代码", name: "名称", enableRequiredDays: "所需天数", enableDueDate: "交期", enableStatus: "状态", enableException: "异常", enabled: "启用" } as any)[key] }))} visible={processVisible} onChange={setProcessVisible} />
        </Space>
        <Table rowKey="id" rowSelection={{ selectedRowKeys: processIds, onChange: setProcessIds }} dataSource={processes.data} pagination={false} columns={processColumns} />
      </> }
    ]} />
    <Modal title="新增供应商" open={supplierOpen} onCancel={() => setSupplierOpen(false)} onOk={async () => {
      try {
        const values = await supplierForm.validateFields();
        await api("/master-data/suppliers", { method: "POST", body: JSON.stringify(values) });
        message.success("供应商新增成功");
        setSupplierOpen(false);
        supplierForm.resetFields();
        refresh("suppliers");
      } catch (error) {
        if (error instanceof ApiError) message.error(error.message);
      }
    }}><Form form={supplierForm} layout="vertical" initialValues={{ enabled: true }}>
      <Form.Item name="code" label="编码" rules={[{ required: true, whitespace: true, message: "请输入供应商编码" }]}><Input placeholder="编码全表唯一" /></Form.Item>
      <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请输入供应商名称" }]}><Input /></Form.Item>
      <Form.Item name="remark" label="备注"><Input /></Form.Item>
      <Form.Item name="enabled" label="是否启用" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
    </Form></Modal>
    <Modal title="新增字典值" open={dictionaryOpen} onCancel={() => setDictionaryOpen(false)} onOk={() => dictionaryForm.validateFields().then(async (values) => { await api("/master-data/dictionaries", { method: "POST", body: JSON.stringify(values) }); setDictionaryOpen(false); dictionaryForm.resetFields(); refresh("dictionaries"); })}><Form form={dictionaryForm} layout="vertical"><Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="名称"><Input /></Form.Item><Form.Item name="value" label="值" rules={[{ required: true }]}><Input /></Form.Item></Form></Modal>
    <Modal title="新增工序" open={processOpen} onCancel={() => setProcessOpen(false)} onOk={() => processForm.validateFields().then(async (values) => { await api("/master-data/processes", { method: "POST", body: JSON.stringify(values) }); setProcessOpen(false); processForm.resetFields(); refresh("processes"); })}><Form form={processForm} layout="vertical" initialValues={{ sortOrder: 1, enableDueDate: true, enableStatus: true, enabled: true }}><Form.Item name="sortOrder" label="顺序"><InputNumber /></Form.Item><Form.Item name="code" label="代码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="enableRequiredDays" label="所需天数" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableDueDate" label="交期" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableStatus" label="状态" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableException" label="异常" valuePropName="checked"><Switch /></Form.Item></Form></Modal>
  </div>;
}

function FinishedGoodsInboundPage() {
  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: ["finished-goods-inbound"],
    queryFn: () => api<any[]>("/master-data/finished-goods-inbound")
  });
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<string>();
  const [form] = Form.useForm();
  const userKey = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const visibilityKey = `finished-goods-inbound-visible-fields:${userKey}`;
  const [visibleFields, setVisibleFields] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem(visibilityKey) ?? JSON.stringify(inboundFields))
  );
  useEffect(() => {
    localStorage.setItem(visibilityKey, JSON.stringify(visibleFields));
  }, [visibilityKey, visibleFields]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finished-goods-inbound"] });
  const updateRow = async (id: string, field: string, value: unknown) => {
    try {
      await api(`/master-data/finished-goods-inbound/${id}`, {
        method: "PATCH", body: JSON.stringify({ [field]: value })
      });
      refresh();
    } catch (error) {
      message.error((error as Error).message);
      refresh();
      throw error;
    }
  };
  const importFile = async (file: File) => {
    const body = new FormData(); body.append("file", file);
    setImporting(true);
    try {
      const result = await api<{ imported: number; skipped?: number }>("/master-data/finished-goods-inbound/import-file", {
        method: "POST", body
      });
      message.success(`已导入 ${result.imported} 行${result.skipped ? `，跳过 ${result.skipped} 行` : ""}`);
      refresh();
    } catch (error) { message.error((error as Error).message); }
    finally { setImporting(false); }
    return false;
  };
  const downloadTemplate = async (format: "xlsx" | "csv") => {
    try {
      await downloadApiFile(`/master-data/templates/finished-goods-inbound?format=${format}`, `成品入库导入模板.${format}`);
    } catch (error) { message.error((error as Error).message); }
  };
  const exportData = async (format: "xlsx" | "csv") => {
    setExporting(format);
    try {
      await downloadApiFile(`/master-data/finished-goods-inbound/export?format=${format}`, `成品入库数据.${format}`);
      message.success(`成品入库 ${format.toUpperCase()} 已导出`);
    } catch (error) { message.error((error as Error).message); }
    finally { setExporting(undefined); }
  };
  const numericFields = new Set(["receivedQuantity", "unitPrice", "totalAmount"]);
  const dateFields = new Set(["documentDate"]);
  const wideFields = new Set(["remark", "inventoryName", "relationInfo"]);
  const columns = inboundFields.filter((field) => visibleFields.includes(field)).map((field) => ({
    title: inboundFieldLabels[field],
    dataIndex: field,
    width: wideFields.has(field) ? 260 : field === "createdTime" ? 190 : 145,
    render: (value: unknown, row: any) => <InlineText
      type={numericFields.has(field) ? "number" : dateFields.has(field) ? "date" : "text"}
      value={field === "createdTime" && value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : value}
      onSave={(next) => updateRow(row.id, field, next)}
    />
  }));

  return <div>
    <PageHeader title="成品入库" subtitle="独立维护成品入库数据；支持直接编辑、Excel/CSV 导入和导出" />
    <Space wrap className="master-data-toolbar">
      <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增成品入库</Button>
      <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importFile(file as File)}>
        <Button loading={importing}>导入成品入库（CSV/XLSX）</Button>
      </Upload>
      <Button onClick={() => void downloadTemplate("xlsx")}>下载 XLSX 模板</Button>
      <Button onClick={() => void downloadTemplate("csv")}>下载 CSV 模板</Button>
      <Button loading={exporting === "xlsx"} onClick={() => void exportData("xlsx")}>导出 XLSX</Button>
      <Button loading={exporting === "csv"} onClick={() => void exportData("csv")}>导出 CSV</Button>
      <Text type="secondary">已选择 {selectedIds.length} 行</Text>
      <FieldVisibility all={inboundFields.map((key) => ({ key, label: inboundFieldLabels[key] ?? key }))}
        visible={visibleFields} onChange={setVisibleFields} />
    </Space>
    <Table className="editable-master-table" rowKey="id"
      rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
      dataSource={records.data} loading={records.isLoading}
      pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
      scroll={{ x: "max-content", y: "calc(100vh - 310px)" }} columns={columns} />
    <Modal title="新增成品入库" width={1080} open={open} onCancel={() => setOpen(false)}
      onOk={() => form.validateFields().then(async (values) => {
        await api("/master-data/finished-goods-inbound", {
          method: "POST",
          body: JSON.stringify({
            ...values,
            documentDate: values.documentDate?.format("YYYY-MM-DD"),
            createdTime: values.createdTime?.toISOString()
          })
        });
        setOpen(false); form.resetFields(); message.success("成品入库记录新增成功"); refresh();
      }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={form} layout="vertical">
        <div className="master-data-form-grid inbound-form-grid">
          {inboundFields.map((field) => <Form.Item key={field} name={field} label={inboundFieldLabels[field]}
            className={field === "remark" ? "master-data-form-wide" : undefined}
            rules={["documentNumber", "inventoryCode", "relationInfo"].includes(field)
              ? [{ required: true, whitespace: true, message: `请输入${inboundFieldLabels[field]}` }] : undefined}>
            {field === "documentDate"
              ? <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              : field === "createdTime"
                ? <DatePicker showTime style={{ width: "100%" }} format="YYYY-MM-DD HH:mm:ss" />
                : numericFields.has(field)
                  ? <InputNumber style={{ width: "100%" }} precision={field === "receivedQuantity" ? 4 : 6} />
                  : field === "remark" ? <Input.TextArea rows={2} /> : <Input />}
          </Form.Item>)}
        </div>
      </Form>
    </Modal>
  </div>;
}

function ExcelImport() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(8);
  const [preview, setPreview] = useState<any>();
  const [loading, setLoading] = useState(false);
  const doPreview = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) return message.warning("请选择 Excel 文件");
    const form = new FormData(); form.append("file", file); form.append("year", String(year)); form.append("month", String(month));
    setLoading(true);
    try { setPreview(await api("/imports/preview", { method: "POST", body: form })); } catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const confirm = async () => {
    setLoading(true);
    try { await api(`/imports/${preview.jobId}/confirm`, { method: "POST" }); message.success("导入完成"); setPreview(undefined); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  return <div><PageHeader title="Excel 导入" subtitle="先预览校验，确认后以事务和业务键幂等写入" />
    <Card>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Alert showIcon type="info" message="年份和月份必须由你明确确认，系统不会按当前日期猜测。" />
        <Space>
          <InputNumber value={year} onChange={(v) => setYear(v ?? 2026)} />
          <Select value={month} onChange={setMonth} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` }))} style={{ width: 90 }} />
          <Upload accept=".xlsx" maxCount={1} fileList={fileList} beforeUpload={() => false} onChange={({ fileList: list }) => setFileList(list)}>
            <Button>选择 .xlsx 文件</Button>
          </Upload>
          <Button type="primary" loading={loading} onClick={doPreview}>上传并预览</Button>
        </Space>
        {preview && <Card title="导入预览" extra={<Button type="primary" loading={loading} onClick={confirm}>确认写入</Button>}>
          <Descriptions column={5} items={Object.entries(preview.summary).map(([key, value]) => ({ key, label: ({ add: "新增", update: "更新", skip: "跳过", warning: "警告", failure: "失败" } as any)[key], children: String(value) }))} />
          {preview.warnings?.length > 0 && <Alert type="warning" showIcon message={`${preview.warnings.length} 条数据质量提示`} description={<ul>{preview.warnings.slice(0, 10).map((warning: string) => <li key={warning}>{warning}</li>)}</ul>} />}
        </Card>}
      </Space>
    </Card>
  </div>;
}

function AuditLogs() {
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => api<any[]>("/audit-logs") });
  return <div><PageHeader title="审计日志" subtitle="所有业务修改均记录操作者、请求号与变更前后值" />
    <Table rowKey="id" loading={logs.isLoading} dataSource={logs.data} columns={[
      { title: "时间", dataIndex: "createdAt", width: 190, render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm:ss") },
      { title: "用户", dataIndex: "actorName", width: 120 }, { title: "资源", dataIndex: "resource", width: 130 },
      { title: "动作", dataIndex: "action", width: 90 }, { title: "记录 ID", dataIndex: "recordId", ellipsis: true },
      { title: "来源", dataIndex: "source", width: 90 }, { title: "requestId", dataIndex: "requestId", ellipsis: true }
    ]} />
  </div>;
}

function ApiKeyCenter() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [regenerateTarget, setRegenerateTarget] = useState<any>();
  const [regenerating, setRegenerating] = useState(false);
  const [form] = Form.useForm();
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api<any[]>("/api-keys") });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<any[]>("/admin/users") });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<any[]>("/admin/roles") });
  const create = useMutation({
    mutationFn: (values: any) => {
      const scopes = values.access === "readwrite"
        ? ["rolling-plan:*:read", "monthly-plan:*:read", "monthly-plan:*:update", "suppliers:*:read", "suppliers:*:update", "dictionaries:*:read", "dictionaries:*:update"]
        : ["rolling-plan:*:read", "monthly-plan:*:read", "suppliers:*:read", "dictionaries:*:read"];
      return api<any>("/api-keys", { method: "POST", body: JSON.stringify({ ...values, scopes }) });
    },
    onSuccess: (result) => {
      setOpen(false);
      form.resetFields();
      setRevealedKeys((current) => ({ ...current, [result.id]: result.apiKey }));
      Modal.info({ title: "请立即复制并保存 API Key", content: <Typography.Paragraph copyable code>{result.apiKey}</Typography.Paragraph> });
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (error: Error) => message.error(error.message)
  });
  const regenerate = async () => {
    if (!regenerateTarget) return;
    setRegenerating(true);
    try {
      const result = await api<any>(`/api-keys/${regenerateTarget.id}/regenerate`, { method: "POST" });
      setRevealedKeys((current) => ({ ...current, [regenerateTarget.id]: result.apiKey }));
      setRegenerateTarget(undefined);
      message.success("API KEY 已重新生成，旧 KEY 已失效");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRegenerating(false);
    }
  };
  return <div><PageHeader title="API Key 管理" subtitle="仅系统管理员可创建、关联用户并设置只读或读写权限" actions={<Button type="primary" onClick={() => setOpen(true)}>新增 API Key</Button>} />
    <Alert type="info" showIcon style={{ marginBottom: 12 }} message="完整 API KEY 仅在新建或重新生成后显示；刷新页面后将自动隐藏，请及时复制保存。" />
    <Table rowKey="id" dataSource={keys.data} loading={keys.isLoading} columns={[
      { title: "名称", dataIndex: "name" },
      { title: "API KEY", dataIndex: "apiKey", width: 430, render: (_value, row) => revealedKeys[row.id]
        ? <Typography.Text code copyable={{ text: revealedKeys[row.id] }}>{revealedKeys[row.id]}</Typography.Text>
        : <Text type="secondary">已隐藏，请重新生成后查看</Text> },
      { title: "权限", dataIndex: "scopes", render: (values: string[]) => values?.join("、") },
      { title: "到期", dataIndex: "expiresAt", render: (value) => value ? dayjs(value).format("YYYY-MM-DD") : "永不过期" },
      { title: "状态", dataIndex: "enabled", render: (value) => <Tag color={value ? "green" : "default"}>{value ? "启用" : "停用"}</Tag> },
      { title: "操作", width: 150, render: (_value, row) => <Button type="link" danger onClick={() => setRegenerateTarget(row)}>重新生成并显示</Button> }
    ]} />
    <Modal title="新增 API Key" open={open} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then((v) => create.mutate(v))} confirmLoading={create.isPending}>
      <Form form={form} layout="vertical" initialValues={{ access: "read" }}>
        <Form.Item label="名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="对应用户" name="userId" rules={[{ required: true }]}><Select options={(users.data ?? []).map((u) => ({ value: u.id, label: `${u.displayName}（${u.username}）` }))} /></Form.Item>
        <Form.Item label="权限组" name="access" rules={[{ required: true }]}><Select options={[{ value: "read", label: "只读" }, { value: "readwrite", label: "读写" }]} /></Form.Item>
        <Form.Item label="关联角色（可选）" name="roleId"><Select allowClear options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`重新生成 ${regenerateTarget?.name ?? ""} 的 API KEY？`} open={Boolean(regenerateTarget)} okText="重新生成" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={regenerating} onCancel={() => setRegenerateTarget(undefined)} onOk={() => void regenerate()}>
      <Alert type="warning" showIcon message="重新生成后，旧 KEY 会立即失效。" description="新 KEY 将显示在当前列表中，请及时复制保存。" />
    </Modal>
  </div>;
}

function AdminCenter() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [editingOrganizationId, setEditingOrganizationId] = useState<string>();
  const [editingRole, setEditingRole] = useState<any>();
  const [permissionDraft, setPermissionDraft] = useState<Record<string, Record<string, boolean>>>({});
  const [assignmentUsers, setAssignmentUsers] = useState<string[]>([]);
  const [assignmentOrganizations, setAssignmentOrganizations] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<React.Key[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<React.Key[]>([]);
  const [form] = Form.useForm();
  const [roleForm] = Form.useForm();
  const [organizationForm] = Form.useForm();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<any[]>("/admin/users") });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<any[]>("/admin/roles") });
  const organizations = useQuery({ queryKey: ["organization-units"], queryFn: () => api<any[]>("/admin/organization-units") });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<any[]>("/admin/contacts") });
  const dictionaryOptions = useDictionaryOptions();
  const permissionResources = [
    ["sales-summary-dashboard", "销售接单汇总大屏"], ["rolling-plan", "销售接单明细"], ["monthly-plan", "月度计划"],
    ["finished-goods-inbound", "成品入库"], ["sales-orders", "销售订单"], ["suppliers", "供应商"], ["dictionaries", "字典"],
    ["processes", "工序"], ["users", "用户"], ["roles", "角色与权限"], ["organization", "组织架构"], ["imports", "导入记录"], ["audit-logs", "审计日志"]
  ] as const;
  const permissionActions = [["read", "查看"], ["create", "新增"], ["update", "编辑"], ["import", "导入"], ["export", "导出"]] as const;
  const adminUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const allUserFields = ["username", "displayName", "position", "departmentPaths", "roles", "enabled", "lastLoginAt"];
  const [visibleUserFields, setVisibleUserFields] = useState<string[]>(() => {
    const saved = JSON.parse(localStorage.getItem(`users-visible-fields:${adminUser}`) ?? "null");
    return Array.isArray(saved) ? [...saved, ...allUserFields.filter((field) => !saved.includes(field))] : allUserFields;
  });
  useEffect(() => localStorage.setItem(`users-visible-fields:${adminUser}`, JSON.stringify(visibleUserFields)), [adminUser, visibleUserFields]);
  const createUser = useMutation({
    mutationFn: (values: any) => api("/admin/users", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => { message.success("用户已创建，首次登录必须修改密码"); setOpen(false); form.resetFields(); void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (error: Error) => message.error(error.message)
  });
  const updateUser = async (id: string, patch: Record<string, unknown>) => { await api(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); };
  const updateRole = async (id: string, patch: Record<string, unknown>) => { await api(`/admin/roles/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); void queryClient.invalidateQueries({ queryKey: ["admin-roles"] }); };
  const resetPassword = async (id: string) => { try { await api(`/admin/users/${id}/reset-password`, { method: "POST" }); message.success("密码已重置为 kainice123，用户首次登录需修改密码"); } catch (error) { message.error((error as Error).message); } };
  const openRolePermissions = (role: any) => {
    const next: Record<string, Record<string, boolean>> = {};
    for (const [resource] of permissionResources) {
      const saved = role.permissions?.find((permission: any) => permission.resource === resource && permission.fieldKey === "*") ?? {};
      next[resource] = Object.fromEntries(permissionActions.map(([action]) => [action, Boolean(saved[action])])) as Record<string, boolean>;
    }
    setEditingRole(role); setPermissionDraft(next);
    setAssignmentUsers(role.userIds ?? []); setAssignmentOrganizations(role.organizationUnitIds ?? []);
    roleForm.setFieldsValue({ description: role.description }); setRoleOpen(true);
  };
  const saveRolePermissions = async () => {
    const values = await roleForm.validateFields();
    await updateRole(editingRole.id, {
      description: values.description,
      userIds: assignmentUsers,
      organizationUnitIds: assignmentOrganizations,
      permissions: permissionResources.map(([resource]) => ({ resource, fieldKey: "*", ...(permissionDraft[resource] ?? {}) }))
    });
    message.success("角色权限已保存"); setRoleOpen(false);
  };
  const userColumns = [
    { title: "职位", dataIndex: "position" }, { title: "所属部门", dataIndex: "departmentPaths", render: (paths: string[][]) => <Space direction="vertical" size={0}>{(paths ?? []).map((path, index) => <span key={index}>{path.join(" / ")}</span>)}</Space> },
    { title: "工号/账号", dataIndex: "username" }, { title: "姓名", dataIndex: "displayName" },
    { title: "角色", dataIndex: "roles", render: (_values: string[], row: any) => <Select mode="multiple" value={row.roleIds} style={{ minWidth: 180 }} options={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))} onChange={(roleIds) => void updateUser(row.id, { roleIds })} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <Switch checked={value} onChange={(v) => void updateUser(row.id, { enabled: v })} /> },
    { title: "上次登录", dataIndex: "lastLoginAt", render: (value: string | null) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" }
    ,{ title: "密码", dataIndex: "password", render: (_: unknown, row: any) => <Button type="link" onClick={() => void resetPassword(row.id)}>重置密码</Button> }
  ].filter((column) => visibleUserFields.includes(column.dataIndex as string) || column.dataIndex === "password");
  const roleColumns = [
    { title: "角色", dataIndex: "name", render: (value: string, row: any) => <InlineText value={value} onSave={(v) => updateRole(row.id, { name: v })} /> }, { title: "说明", dataIndex: "description", render: (value: string, row: any) => <InlineText value={value} onSave={(v) => updateRole(row.id, { description: v })} /> },
    { title: "权限条目", dataIndex: "permissions", render: (values: any[]) => values?.length ?? 0 },
    { title: "配置", render: (_: unknown, row: any) => <Button type="link" onClick={() => openRolePermissions(row)}>配置表格权限</Button> }
  ];
  const organizationColumns = [
    { title: "层级", dataIndex: "level", render: (value: number) => `第 ${value} 级` },
    { title: "组织名称", dataIndex: "name", render: (value: string, row: any) => <InlineText value={value} onSave={(v) => api(`/admin/organization-units/${row.id}`, { method: "PATCH", body: JSON.stringify({ name: v }) }).then(() => organizations.refetch())} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <Switch checked={value} onChange={(enabled) => void api(`/admin/organization-units/${row.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }).then(() => organizations.refetch())} /> }
  ];
  const organizationTreeData = useMemo(() => {
    const units = organizations.data ?? [];
    const make = (parentId: string | null): any[] => units.filter((unit) => (unit.parentId ?? null) === parentId).map((unit) => ({
      key: unit.id, value: unit.id,
      title: unit.name,
      children: make(unit.id)
    }));
    return make(null);
  }, [organizations.data, organizationForm]);
  const contactColumns = [
    { title: "姓名", dataIndex: "name" }, { title: "工号", dataIndex: "employeeNo" }, { title: "职位", dataIndex: "position" },
    { title: "所属组织", dataIndex: "departmentPaths", render: (paths: string[][]) => <Space direction="vertical" size={0}>{(paths ?? []).map((path, index) => <span key={index}>{path.join(" / ")}</span>)}</Space> },
    { title: "直属上级", dataIndex: "directLeaders", render: (values: string[]) => values?.join("、") || "—" }, { title: "电话", dataIndex: "telephone" },
    { title: "状态", dataIndex: "enabled", render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "在职" : "停用"}</Tag> }
  ];
  const importContacts = async (file: File) => {
    const body = new FormData(); body.append("file", file);
    try { const result = await api<{ imported: number; sourceRows: number }>("/admin/contacts/import-file", { method: "POST", body }); message.success(`通讯录已同步：${result.imported} 位员工（源文件 ${result.sourceRows} 行）`); void contacts.refetch(); }
    catch (error) { message.error((error as Error).message); }
    return false;
  };
  return <div><PageHeader title="用户与角色" subtitle="可直接编辑；复选框支持多选批量停用" actions={<Space><Upload accept=".csv" showUploadList={false} beforeUpload={async (file) => { const raw = await parseCsvFile(file as File); const rows = raw.map((row: any) => ({ username: row.username ?? row["账号"], displayName: row.displayName ?? row["姓名"], division: row.division ?? row["事业部"], roleIds: String(row.roles ?? row["角色"] ?? "").split(/[、|;]/).map((name) => roles.data?.find((role) => role.name === name)?.id).filter(Boolean) })); await api("/admin/users/import", { method: "POST", body: JSON.stringify({ rows }) }); message.success(`已导入 ${rows.length} 个用户`); void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); return false; }}><Button>导入用户 CSV</Button></Upload><Button danger disabled={!selectedUserIds.length} onClick={async () => { await api("/admin/users/delete", { method: "POST", body: JSON.stringify({ ids: selectedUserIds }) }); setSelectedUserIds([]); void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); }}>停用选中（{selectedUserIds.length}）</Button><FieldVisibility all={allUserFields.map((key) => ({ key, label: ({ username: "账号", displayName: "姓名", roles: "角色", division: "事业部", enabled: "状态", lastLoginAt: "上次登录" } as any)[key] }))} visible={visibleUserFields} onChange={setVisibleUserFields} /><Button type="primary" onClick={() => setOpen(true)}>新增用户</Button></Space>} />
    <Tabs items={[
      { key: "users", label: "用户", children: <Table rowKey="id" rowSelection={{ selectedRowKeys: selectedUserIds, onChange: setSelectedUserIds }} dataSource={users.data} loading={users.isLoading} columns={userColumns} /> },
      { key: "roles", label: "角色与权限", children: <Table rowKey="id" rowSelection={{ selectedRowKeys: selectedRoleIds, onChange: setSelectedRoleIds }} dataSource={roles.data} loading={roles.isLoading} columns={roleColumns} /> }
    ]} />
    <Modal title={`配置角色权限：${editingRole?.name ?? ""}`} open={roleOpen} width={1050} onCancel={() => setRoleOpen(false)} onOk={() => void saveRolePermissions()}>
      <Button style={{ marginBottom: 12 }} onClick={() => setAssignmentOpen(true)}>添加用户或架构</Button>
      <Form form={roleForm} layout="vertical"><Form.Item name="description" label="角色说明"><Input /></Form.Item></Form>
      <Table rowKey="resource" size="small" pagination={false} dataSource={permissionResources.map(([resource, label]) => ({ resource, label }))} columns={[{ title: "表/页面", dataIndex: "label" }, ...permissionActions.map(([action, label]) => ({ title: label, align: "center" as const, render: (_: unknown, row: any) => <Checkbox checked={Boolean(permissionDraft[row.resource]?.[action])} onChange={(event) => setPermissionDraft((previous) => ({ ...previous, [row.resource]: { ...(previous[row.resource] ?? {}), [action]: event.target.checked } }))} /> }))]} />
    </Modal>
    <Modal title="添加用户或架构" open={assignmentOpen} onCancel={() => setAssignmentOpen(false)} onOk={() => setAssignmentOpen(false)}>
      <Form layout="vertical">
        <Form.Item label="指定用户"><Select mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive" value={assignmentUsers} onChange={setAssignmentUsers} options={(users.data ?? []).map((user: any) => ({ value: user.id, label: `${user.displayName}（${user.employeeNo ?? user.username}）` }))} placeholder="可搜索并多选用户" /></Form.Item>
        <Form.Item label="指定组织架构"><TreeSelect treeData={organizationTreeData} treeCheckable showCheckedStrategy={TreeSelect.SHOW_PARENT} treeDefaultExpandAll multiple value={assignmentOrganizations} onChange={setAssignmentOrganizations} placeholder="展开后选择组织架构" style={{ width: "100%" }} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={editingOrganizationId ? "编辑组织单元" : "新增组织单元"} open={organizationOpen} onCancel={() => setOrganizationOpen(false)} onOk={() => organizationForm.validateFields().then(async (values) => { await api(editingOrganizationId ? `/admin/organization-units/${editingOrganizationId}` : "/admin/organization-units", { method: editingOrganizationId ? "PATCH" : "POST", body: JSON.stringify(editingOrganizationId ? { name: values.name } : values) }); message.success(editingOrganizationId ? "组织单元已更新" : "组织单元已新增"); setOrganizationOpen(false); organizations.refetch(); })}>
      <Form form={organizationForm} layout="vertical"><Form.Item name="level" label="层级" rules={[{ required: true }]}><Select options={[1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }))} /></Form.Item><Form.Item name="parentId" label="上级组织"><Select allowClear options={(organizations.data ?? []).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="name" label="组织名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item></Form>
    </Modal>
    <Modal title="新增用户" open={open} okText="创建" cancelText="取消" confirmLoading={createUser.isPending} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then((values) => createUser.mutate(values))}>
      <Form form={form} layout="vertical" initialValues={{ roleIds: [], password: "kainice123" }}>
        <Form.Item label="账号" name="username" rules={[{ required: true, pattern: /^[a-zA-Z0-9_.-]{3,64}$/, message: "3–64 位字母、数字、._-" }]}><Input /></Form.Item>
        <Form.Item label="姓名" name="displayName" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="首次密码" name="password" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item>
        <Form.Item label="角色" name="roleIds" rules={[{ required: true }]}><Select mode="multiple" options={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))} /></Form.Item>
        <Form.Item label="所属事业部" name="division"><Select allowClear options={["事业一部", "事业二部", "事业三部", "事业四部", "贻居", "电镀厂"].map((value) => ({ value }))} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}

function ContactDirectory() {
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<any[]>("/admin/contacts") });
  const columns = [
    { title: "姓名", dataIndex: "name" }, { title: "工号", dataIndex: "employeeNo" }, { title: "职位", dataIndex: "position" },
    { title: "所属组织", dataIndex: "departmentPaths", render: (paths: string[][]) => <Space direction="vertical" size={0}>{(paths ?? []).map((path, index) => <span key={index}>{path.join(" / ")}</span>)}</Space> },
    { title: "直属上级", dataIndex: "directLeaders", render: (values: string[]) => values?.join("、") || "—" }, { title: "电话", dataIndex: "telephone" },
    { title: "状态", dataIndex: "enabled", render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "在职" : "停用"}</Tag> }
  ];
  return <div><PageHeader title="通讯录" subtitle="企业微信通讯录同步目录，只读展示，不允许手工编辑。" actions={<Text type="secondary">共 {contacts.data?.length ?? 0} 位员工</Text>} /><Table rowKey="id" dataSource={contacts.data} loading={contacts.isLoading} columns={columns} pagination={{ pageSize: 50, showSizeChanger: true }} scroll={{ x: "max-content", y: "calc(100vh - 250px)" }} /></div>;
}

function ForcePasswordChange({ done }: { done: () => void }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const submit = async (values: any) => {
    setLoading(true);
    try {
      const result = await api<any>("/auth/change-password", { method: "POST", body: JSON.stringify(values) });
      localStorage.setItem("accessToken", result.accessToken); localStorage.setItem("refreshToken", result.refreshToken); localStorage.setItem("sessionUser", JSON.stringify(result.user));
      message.success("密码已修改"); done();
    } catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  return <div className="login-shell"><Card className="login-card"><div className="login-title">首次登录，请修改密码</div><Text type="secondary">密码至少 8 位，且必须同时包含字母和数字。</Text>
    <Form form={form} layout="vertical" onFinish={submit} style={{ marginTop: 20 }}>
      <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true }]}><Input.Password /></Form.Item>
      <Form.Item label="新密码" name="nextPassword" rules={[{ required: true, pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/, message: "至少 8 位且包含字母和数字" }]}><Input.Password /></Form.Item>
      <Button htmlType="submit" type="primary" loading={loading} block>确认修改</Button>
    </Form>
  </Card></div>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("accessToken")));
  const [mustChange, setMustChange] = useState(Boolean(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").mustChangePassword));
  const logout = () => { localStorage.removeItem("accessToken"); localStorage.removeItem("refreshToken"); localStorage.removeItem("sessionUser"); setAuthenticated(false); };
  return <AntApp><BrowserRouter>{authenticated ? (mustChange ? <ForcePasswordChange done={() => setMustChange(false)} /> : <Shell logout={logout} />) : <Login onLogin={() => { setAuthenticated(true); setMustChange(Boolean(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").mustChangePassword)); }} />}</BrowserRouter></AntApp>;
}
