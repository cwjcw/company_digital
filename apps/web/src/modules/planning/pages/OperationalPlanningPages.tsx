import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, DatePicker, Flex, Form, Input, InputNumber, Modal, Progress,
  Pagination, Select, Space, Statistic, Tag, Typography, Upload, message
} from "antd";
import dayjs from "dayjs";
import { type ColDef, type ColGroupDef, type GridApi, type RowClassParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { type ColumnDefinition } from "@tracker/shared";
import { api, ApiError } from "../../../api";
import {
  FieldVisibility, ImportFeedbackAlert, PlanFilterDrawer,
  emptyRollingQuickFilters, failedImport, rollingColumnsMeta,
  formatAuditUser, statusClass, useAuditIdentityDirectory, useDictionaryOptions,
  type ImportFeedback, type PlanFilter, type RollingQuickFilters
} from "../../../shared/legacy-ui";
import { DUE_DATE_DISPLAY_FORMAT, formatDueDate, isDueDateLabel } from "../../../shared/date-format";
import { TablePermissionButton } from "../../../shared/KdosDataTable";
import { AG_GRID_LOCALE_ZH_CN } from "../../../shared/ag-grid-locale-zh";

const { Text } = Typography;

export function SalesSummaryDashboard() {
  const dictionaryOptions = useDictionaryOptions();
  const [timeDimension, setTimeDimension] = useState<"year" | "month" | "day">("month");
  const [period, setPeriod] = useState<dayjs.Dayjs>(dayjs());
  const [division, setDivision] = useState<string[]>([]);
  const [customer, setCustomer] = useState<string[]>([]);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sales-dashboard",timeDimension,period.format("YYYY-MM-DD"),division,customer], queryFn: () => {
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

export function SalesSummaryDetails() {
  const auditIdentityNames = useAuditIdentityDirectory();
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
  const [settledFilters, setSettledFilters] = useState<PlanFilter[]>([]);
  const [settledQuickFilters, setSettledQuickFilters] = useState<RollingQuickFilters>(emptyRollingQuickFilters);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ field?: string; order?: "asc" | "desc" }>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const rollingUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const rollingPageSizeKey = `kdos-form-page-size:${rollingUser}:rolling-plan`;
  const [pageSize, setPageSize] = useState(() => { const value=Number(localStorage.getItem(rollingPageSizeKey));return [20,50,100,200].includes(value)?value:50; });
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
  useEffect(() => {
    const timer = window.setTimeout(() => { setSettledFilters(filters); setSettledQuickFilters(quickFilters); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [filters, quickFilters]);
  const rollingQuery = useQuery({
    queryKey: ["rolling", { page, pageSize, filters: settledFilters, quickFilters: settledQuickFilters, sort }],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), filters: JSON.stringify(settledFilters), quickFilters: JSON.stringify(settledQuickFilters) });
      if(sort.field)query.set("sortField",sort.field);if(sort.order)query.set("sortOrder",sort.order);
      return api<{ rows: any[]; total: number; page: number; pageSize: number }|any[]>(`/plans/rolling?${query}`);
    }
  });
  const data = Array.isArray(rollingQuery.data) ? rollingQuery.data : rollingQuery.data?.rows ?? [];
  const isLoading = rollingQuery.isLoading;
  const applyRollingGridFilterModel = useCallback((apiInstance: GridApi) => {
    const target = Object.fromEntries(filters.filter((filter) => filter.field && filter.value.trim())
      .map((filter) => [filter.field, { filterType: "text", type: "contains", filter: filter.value }]));
    const current = Object.fromEntries(Object.entries(apiInstance.getFilterModel()).map(([field, model]: [string, any]) => [field, String(model?.filter ?? "")]));
    const targetValues = Object.fromEntries(filters.filter((filter) => filter.field && filter.value.trim()).map((filter) => [filter.field, filter.value]));
    if (JSON.stringify(current) !== JSON.stringify(targetValues)) apiInstance.setFilterModel(target);
  }, [filters]);
  useEffect(() => { if (rollingGridApi.current) applyRollingGridFilterModel(rollingGridApi.current); }, [applyRollingGridFilterModel]);
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
    filter: "agTextColumnFilter",
    filterParams: { filterOptions: ["contains"], maxNumConditions: 1, buttons: ["apply", "clear"], closeOnApply: true },
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
    valueFormatter: ["createdBy", "updatedBy"].includes(meta.key)
      ? ({ value }) => formatAuditUser(value, auditIdentityNames)
      : ["createdAt", "updatedAt"].includes(meta.key)
      ? ({ value }) => value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—"
      : meta.kind === "date"
      ? ({ value }) => isDueDateLabel(meta.header) ? formatDueDate(value) : value ? dayjs(value).format("MM-DD") : ""
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
      ...(includeSequence ? [{ headerName: "序号", valueGetter: ({ node }: any) => (page - 1) * pageSize + Number(node.rowIndex ?? 0) + 1, width: 68, editable: false } as ColDef] : []),
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
      <TablePermissionButton resource="rolling-plan" />
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
        <DatePicker.RangePicker aria-label="筛选滚动客户要求交期范围" allowClear format={DUE_DATE_DISPLAY_FORMAT}
          placeholder={["客户交期开始", "客户交期结束"]}
          value={quickFilters.customerDueDateStart && quickFilters.customerDueDateEnd
            ? [dayjs(quickFilters.customerDueDateStart), dayjs(quickFilters.customerDueDateEnd)] : null}
          onChange={(values) => setQuickFilters((current) => ({ ...current,
            customerDueDateStart: values?.[0]?.format("YYYY-MM-DD") ?? "",
            customerDueDateEnd: values?.[1]?.format("YYYY-MM-DD") ?? ""
          }))} style={{ width: 260 }} />
        <DatePicker.RangePicker aria-label="筛选滚动产前评审交期范围" allowClear format={DUE_DATE_DISPLAY_FORMAT}
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
        <DatePicker.RangePicker aria-label="筛选滚动异常后二次交期范围" allowClear format={DUE_DATE_DISPLAY_FORMAT}
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
      <AgGridReact rowData={data} columnDefs={columns} loading={isLoading} theme="legacy" localeText={AG_GRID_LOCALE_ZH_CN}
        singleClickEdit={editMode} stopEditingWhenCellsLoseFocus enableCellTextSelection ensureDomOrder
        suppressMovableColumns suppressColumnVirtualisation
        getRowId={({ data: row }) => row.id}
        onGridReady={({ api: instance }) => { rollingGridApi.current = instance; applyRollingGridFilterModel(instance); }}
        onFilterChanged={({ api: instance }) => {
          const next = Object.entries(instance.getFilterModel()).map(([field, model]: [string, any]) => ({ field, value: String(model?.filter ?? "") })).filter((filter) => filter.value);
          if (JSON.stringify(next) !== JSON.stringify(filters)) setFilters(next);
        }}
        onSortChanged={({ api: instance }) => {
          const active=instance.getColumnState().find((column)=>column.sort);
          const next=active?{field:active.colId,order:active.sort as "asc"|"desc"}:{};
          setSort((current)=>current.field===next.field&&current.order===next.order?current:next);setPage(1);
        }}
        rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }} selectionColumnDef={{ pinned: "left", lockPosition: true, width: 48, resizable: false }}
        onSelectionChanged={({ api: grid }) => setSelectedIds(grid.getSelectedRows().map((row: any) => row.id))}
        onCellValueChanged={async ({ data: row, colDef, newValue, oldValue }) => {
          if (!colDef.field || newValue === oldValue) return;
          setRollingSaving(true);
          try {
            await api(`/plans/orders/${row.id}`, { method: "PATCH", body: JSON.stringify({ [colDef.field]: newValue, expectedVersion: row.version }) });
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
        defaultColDef={{ sortable: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true, minWidth: 68 }}
        rowHeight={44} headerHeight={56} groupHeaderHeight={42} />
    </div>
    <div className="monthly-grid-pagination"><Pagination current={page} pageSize={pageSize} total={Array.isArray(rollingQuery.data) ? rollingQuery.data.length : rollingQuery.data?.total ?? 0}
      pageSizeOptions={[20, 50, 100, 200]} showSizeChanger showQuickJumper showTotal={(total) => `共 ${total} 条`}
      onChange={(nextPage, nextPageSize) => { const changed=nextPageSize!==pageSize;setPageSize(nextPageSize);setPage(changed?1:nextPage);localStorage.setItem(rollingPageSizeKey,String(nextPageSize)); }} /></div>
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
        <Form.Item name="customerDueDate" label="客户要求交期"><DatePicker style={{ width: "100%" }} format={DUE_DATE_DISPLAY_FORMAT} /></Form.Item>
        <Form.Item name="reviewDueDate" label="产前评审交期"><DatePicker style={{ width: "100%" }} format={DUE_DATE_DISPLAY_FORMAT} /></Form.Item>
        <Form.Item name="exceptionDueDate" label="异常后二次交期"><DatePicker style={{ width: "100%" }} format={DUE_DATE_DISPLAY_FORMAT} /></Form.Item>
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
