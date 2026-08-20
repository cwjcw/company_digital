import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, DatePicker, Flex, Form, Input, InputNumber, Modal, Progress,
  Select, Space, Statistic, Table, Tag, Typography, Upload, message
} from "antd";
import dayjs from "dayjs";
import { type ColDef, type ColGroupDef, type GridApi, type RowClassParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { processDefinitions, type ColumnDefinition } from "@tracker/shared";
import { api, ApiError, containsText } from "../../../api";
import {
  FieldVisibility, ImportFeedbackAlert, PageHeader, PlanFilterDrawer, auditColumns,
  emptyRollingQuickFilters, failedImport, filterPlanRows, matchesDateRange, rollingColumnsMeta,
  statusClass, useDictionaryOptions,
  type ImportFeedback, type PlanFilter, type RollingQuickFilters
} from "../../../shared/legacy-ui";

const { Text } = Typography;

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

export function SalesSummaryDashboard() {
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
            { title: "状态", dataIndex: "status", width: 90, render: (value: string) => <Tag color={value === "延期" ? "red" : value === "即将延期" ? "orange" : "blue"}>{value}</Tag> },
            ...auditColumns
          ]} />
      </Card>
    </div>
  </div>;
}

export function SalesSummaryDetails() {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [rollingSaving, setRollingSaving] = useState(false);
  const [rollingLastSaved, setRollingLastSaved] = useState<string>();
  const [rollingSaveNotice, setRollingSaveNotice] = useState<{ type: "success" | "error"; text: string }>();
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>();
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
  const rollingFieldOptions = rollingColumnsMeta.filter((column) => column.group !== "审计信息").map((column) => column.key);
  const rollingVisibilityKey = `sales-summary-visible-fields:${rollingUser}`;
  const [visibleFields, setVisibleFields] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(rollingVisibilityKey) ?? JSON.stringify(rollingFieldOptions));
      const current = Array.isArray(saved)
        ? saved.filter((field): field is string => rollingFieldOptions.includes(field))
        : rollingFieldOptions;
      return [...new Set([...current, "orderType"])];
    } catch {
      return rollingFieldOptions;
    }
  });
  useEffect(() => localStorage.setItem(rollingVisibilityKey, JSON.stringify(visibleFields)), [rollingVisibilityKey, visibleFields]);
  const { data = [], isLoading } = useQuery({ queryKey: ["rolling"], queryFn: () => api<any[]>("/plans/rolling") });
  const filtered = useMemo(() => filterPlanRows(data, filters, rollingColumnsMeta).filter((row: any) => {
    const completionRate = row.completionRate === null || row.completionRate === undefined
      ? null : Number(row.completionRate) * 100;
    return containsText(row.orderNumber, quickFilters.orderNumber)
      && (!quickFilters.month || String(row.month ?? "").includes(quickFilters.month))
      && matchesDateRange(row.customerDueDate, quickFilters.customerDueDateStart, quickFilters.customerDueDateEnd)
      && matchesDateRange(row.reviewDueDate, quickFilters.reviewDueDateStart, quickFilters.reviewDueDateEnd)
      && matchesDateRange(row.exceptionDueDate, quickFilters.exceptionDueDateStart, quickFilters.exceptionDueDateEnd)
      && (quickFilters.completionRateStart === null || (completionRate !== null && completionRate >= quickFilters.completionRateStart))
      && (quickFilters.completionRateEnd === null || (completionRate !== null && completionRate <= quickFilters.completionRateEnd))
      && containsText(row.customer, quickFilters.customer)
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
    sourceAccountName: 108, orderType: 100, customer: 120, salesperson: 92, orderNumber: 130, orderDate: 96,
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
    valueFormatter: ["createdAt", "updatedAt"].includes(meta.key)
      ? ({ value }) => value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—"
      : meta.kind === "date"
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
      ...rollingColumnsMeta.filter((meta) => meta.group === group && (group === "审计信息" || visibleFields.includes(meta.key))).map(makeRollingColumn)
    ]
  });
  const columns: (ColDef | ColGroupDef)[] = [
    groupColumns("订单信息", "sales-summary-group-order", true),
    groupColumns("订单执行信息", "sales-summary-group-execution"),
    groupColumns("订单执行结果评估", "sales-summary-group-evaluation"),
    groupColumns("审计信息", "sales-summary-group-order")
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
          setImportFeedback({ type: "success", message: `全部校验通过，成功导入 ${result.imported} 条接单记录` });
          void queryClient.invalidateQueries({ queryKey: ["rolling"] });
        } catch (error) { setImportFeedback(failedImport(error)); }
        return false;
      }}><Button>导入销售接单明细 Excel</Button></Upload>
      <FieldVisibility all={rollingColumnsMeta.filter((column) => column.group !== "审计信息").map((column) => ({ key: column.key, label: column.header }))} visible={visibleFields} onChange={setVisibleFields} />
      </Flex>
      <ImportFeedbackAlert value={importFeedback} onClose={() => setImportFeedback(undefined)} />
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

type DailyProgressResponse = {
  date: string;
  processes: Array<{ id: string; code: string; name: string; sortOrder: number }>;
  rows: Array<{
    id: string;
    sequence: number;
    month: string;
    orderNumber: string;
    orderType: string | null;
    itemNumber: string;
    itemName: string | null;
    customer: string | null;
    division: string | null;
    productionQuantity: string;
    balanceQuantity: string;
    progress: Record<string, string | null>;
  }>;
};

export function DailyProgress() {
  const queryClient = useQueryClient();
  const [workDate, setWorkDate] = useState(dayjs());
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string }>();
  const [filters, setFilters] = useState({ orderNumber: "", itemNumber: "", month: "", division: "" });
  const date = workDate.format("YYYY-MM-DD");
  const dictionaryOptions = useDictionaryOptions();
  const query = useQuery({
    queryKey: ["daily-progress", date],
    queryFn: () => api<DailyProgressResponse>(`/plans/daily-progress?date=${date}`)
  });
  const rows = useMemo(() => (query.data?.rows ?? []).filter((row) =>
    containsText(row.orderNumber, filters.orderNumber)
      && containsText(row.itemNumber, filters.itemNumber)
      && (!filters.month || row.month === filters.month)
      && (!filters.division || row.division === filters.division)
  ), [filters, query.data?.rows]);
  const processes = query.data?.processes ?? processDefinitions.map((process) => ({
    id: process.code, code: process.code, name: process.name, sortOrder: process.order
  }));
  const columns = useMemo<(ColDef | ColGroupDef)[]>(() => [
    {
      headerName: "订单与品号",
      marryChildren: true,
      pinned: "left",
      children: [
        { headerName: "序号", field: "sequence", width: 68, editable: false, pinned: "left" },
        { headerName: "年月", field: "month", width: 92, editable: false, pinned: "left" },
        { headerName: "订单号", field: "orderNumber", width: 138, editable: false, pinned: "left" },
        { headerName: "品号", field: "itemNumber", width: 150, editable: false, pinned: "left" },
        { headerName: "品名", field: "itemName", width: 150, editable: false },
        { headerName: "订单需求数量", field: "productionQuantity", width: 118, editable: false, type: "numericColumn" },
        { headerName: "订单欠数", field: "balanceQuantity", width: 100, editable: false, type: "numericColumn",
          cellClass: "daily-balance-cell" }
      ]
    },
    {
      headerName: `${date} 当日完成数量`,
      marryChildren: true,
      children: processes.map((process) => ({
        headerName: process.name,
        field: `progress.${process.code}`,
        width: 110,
        editable: editMode,
        type: "numericColumn",
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 0, precision: 4 },
        valueParser: ({ newValue }: { newValue: unknown }) => newValue === "" || newValue === null ? null : Number(newValue),
        headerClass: "daily-process-header",
        cellClass: editMode ? "daily-progress-editable" : undefined
      }))
    },
    {
      headerName: "辅助信息",
      marryChildren: true,
      children: [
        { headerName: "订单类型", field: "orderType", width: 100, editable: false },
        { headerName: "客户", field: "customer", width: 120, editable: false },
        { headerName: "事业部", field: "division", width: 118, editable: false }
      ]
    }
  ], [date, editMode, processes]);

  return <div>
    <div className="monthly-toolbar daily-progress-toolbar">
      <Flex className="monthly-toolbar-row" align="center" gap={8} wrap>
        <Text strong className="toolbar-row-label">日进度录入</Text>
        <DatePicker aria-label="日进度日期" value={workDate} allowClear={false} format="YYYY-MM-DD"
          onChange={(value) => { if (value) { setWorkDate(value); setNotice(undefined); } }} />
        <Button type={editMode ? "primary" : "default"} onClick={() => setEditMode((value) => !value)}>
          {editMode ? "退出录入模式" : "进入录入模式"}
        </Button>
        {editMode && <Tag color={saving ? "processing" : "success"}>{saving ? "保存中" : "单元格失焦自动保存"}</Tag>}
        <Text type="secondary">仅显示订单欠数大于 0 的月度计划订单 + 品号，共 {rows.length} 条</Text>
      </Flex>
      <Flex className="monthly-toolbar-row" align="center" gap={8} wrap>
        <Text strong className="toolbar-row-label">快速筛选</Text>
        <Input aria-label="筛选日进度订单号" allowClear placeholder="订单号" value={filters.orderNumber}
          onChange={(event) => setFilters((current) => ({ ...current, orderNumber: event.target.value }))} style={{ width: 148 }} />
        <Input aria-label="筛选日进度品号" allowClear placeholder="品号" value={filters.itemNumber}
          onChange={(event) => setFilters((current) => ({ ...current, itemNumber: event.target.value }))} style={{ width: 148 }} />
        <Select aria-label="筛选日进度月份" allowClear placeholder="年月" value={filters.month || undefined}
          options={Array.from({ length: 5 }, (_, index) => {
            const month = String(index + 8).padStart(2, "0");
            return { value: `2026-${month}`, label: `2026-${month}` };
          })}
          onChange={(value) => setFilters((current) => ({ ...current, month: value ?? "" }))} style={{ width: 118 }} />
        <Select aria-label="筛选日进度事业部" allowClear placeholder="事业部" value={filters.division || undefined}
          options={(dictionaryOptions.division ?? []).map((value) => ({ value, label: value }))
          }
          onChange={(value) => setFilters((current) => ({ ...current, division: value ?? "" }))} style={{ width: 130 }} />
        <Button onClick={() => setFilters({ orderNumber: "", itemNumber: "", month: "", division: "" })}>清空筛选</Button>
      </Flex>
    </div>
    {notice && <Alert className="save-notice" showIcon closable type={notice.type} message={notice.text}
      onClose={() => setNotice(undefined)} />}
    <div className="monthly-grid daily-progress-grid ag-theme-quartz">
      <AgGridReact rowData={rows} columnDefs={columns} loading={query.isLoading} theme="legacy"
        singleClickEdit={editMode} stopEditingWhenCellsLoseFocus enableCellTextSelection ensureDomOrder
        suppressMovableColumns getRowId={({ data }) => data.id}
        onCellValueChanged={async ({ data: row, colDef, newValue, oldValue }) => {
          if (newValue === oldValue || !colDef.field?.startsWith("progress.")) return;
          const processCode = colDef.field.slice("progress.".length);
          setSaving(true);
          try {
            await api(`/plans/daily-progress/${row.id}`, {
              method: "PATCH",
              body: JSON.stringify({ date, processCode, quantity: newValue })
            });
            setNotice({ type: "success", text: `${row.orderNumber} / ${row.itemNumber} / ${colDef.headerName} 已保存` });
            await queryClient.invalidateQueries({ queryKey: ["daily-progress", date] });
          } catch (error) {
            setNotice({ type: "error", text: `保存失败：${(error as Error).message || "未知错误"}` });
            await query.refetch();
          } finally { setSaving(false); }
        }}
        getRowClass={(params: RowClassParams) => params.node.rowIndex! % 2 ? "order-alt" : ""}
        defaultColDef={{ sortable: true, resizable: true, filter: false, wrapHeaderText: true, autoHeaderHeight: true, minWidth: 68 }}
        rowHeight={42} headerHeight={58} groupHeaderHeight={42} />
    </div>
  </div>;
}
