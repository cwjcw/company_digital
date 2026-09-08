import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EyeOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Flex, Modal, Pagination, Select, Space, Typography } from "antd";
import type { ColDef, ColGroupDef, GridApi, RowClassParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { io } from "socket.io-client";
import { api } from "../../../api";
import { useAuditIdentityDirectory } from "../../../shared/audit-fields";
import { AG_GRID_LOCALE_ZH_CN } from "../../../shared/ag-grid-locale-zh";
import { KdosTableSearchFilter, TablePermissionButton } from "../../../shared/KdosDataTable";
import { buildPlanningColumns, monthlyPlanDisplayFields, type DepartmentOption, type RuntimePlanningField } from "../grid/column-builder";
import { planningFieldRegistry } from "../grid/column-registry";

const { Text } = Typography;
type PlanPage = { rows: any[]; total: number; page: number; pageSize: number };
const pageSizes = [20, 50, 100, 200];

export function RollingPlanPage() {
  const queryClient = useQueryClient();
  const gridApi = useRef<GridApi | null>(null);
  const auditIdentityNames = useAuditIdentityDirectory();
  const userKey = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").sub ?? "anonymous";
  const [fieldOpen, setFieldOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [settledSearch, setSettledSearch] = useState("");
  const [settledFilters, setSettledFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem(`kdos-form-page-size:${userKey}:rolling-plan-table`) ?? 50);
    return pageSizes.includes(saved) ? saved : 50;
  });
  const [sort, setSort] = useState<{ field?: string; order?: "asc" | "desc" }>({});
  const [hiddenFields, setHiddenFields] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(`kdos-rolling-plan-hidden:${userKey}`) ?? "[]"); return Array.isArray(value) ? value : []; }
    catch { return []; }
  });
  const fieldsQuery = useQuery({ queryKey: ["rolling-plan-fields", userKey], queryFn: () => api<RuntimePlanningField[]>("/planning-operations/rolling-plan/fields"), retry: false });
  const organizationsQuery = useQuery({ queryKey: ["rolling-plan-organizations", userKey], queryFn: () => api<DepartmentOption[]>("/planning-operations/rolling-plan/organization-options"), retry: false });
  const fields = useMemo(() => monthlyPlanDisplayFields(fieldsQuery.data ?? planningFieldRegistry.map((field) => ({ ...field, access: "READONLY" as const }))), [fieldsQuery.data]);
  const filterFields = useMemo(() => fields.filter((field) => field.visible && field.access !== "HIDDEN").map((field) => ({ key: field.code, label: field.label })), [fields]);
  useEffect(() => { localStorage.setItem(`kdos-rolling-plan-hidden:${userKey}`, JSON.stringify(hiddenFields)); }, [hiddenFields, userKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setSettledSearch(search.trim()); setSettledFilters(filters); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [filters, search]);
  const itemsQuery = useQuery({
    queryKey: ["rolling-plan-items", userKey, { page, pageSize, search: settledSearch, filters: settledFilters, sort }],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (settledSearch) query.set("search", settledSearch);
      if (Object.values(settledFilters).some((value) => value.trim())) query.set("filters", JSON.stringify(settledFilters));
      if (sort.field) query.set("sortField", sort.field);
      if (sort.order) query.set("sortOrder", sort.order);
      return api<PlanPage>(`/planning-operations/rolling-plan/items?${query}`);
    }, retry: false
  });
  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) return;
    const socket = io("/plans", { auth: { token }, transports: ["websocket"] });
    socket.on("table.changed", (event: { resource?: string }) => {
      if (event.resource === "rolling-plan-table") void queryClient.invalidateQueries({ queryKey: ["rolling-plan-items"] });
    });
    return () => { socket.close(); };
  }, [queryClient]);
  const rows = itemsQuery.data?.rows ?? [];
  const columnDefs = useMemo<Array<ColDef | ColGroupDef>>(() => buildPlanningColumns(fields, false, hiddenFields, {}, auditIdentityNames, organizationsQuery.data ?? []), [auditIdentityNames, fields, hiddenFields, organizationsQuery.data]);
  const applyGridFilterModel = useCallback((instance: GridApi) => {
    const target = Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim()).map(([field, value]) => [field, { filterType: "text", type: "contains", filter: value }]));
    const current = Object.fromEntries(Object.entries(instance.getFilterModel()).map(([field, model]: [string, any]) => [field, String(model?.filter ?? "")]));
    const targetValues = Object.fromEntries(Object.entries(target).map(([field, model]: [string, any]) => [field, String(model.filter)]));
    if (JSON.stringify(current) !== JSON.stringify(targetValues)) instance.setFilterModel(target);
  }, [filters]);
  useEffect(() => { if (gridApi.current) applyGridFilterModel(gridApi.current); }, [applyGridFilterModel]);

  return <div>
    <div className="monthly-toolbar planning-version-toolbar">
      <Flex className="monthly-toolbar-row" justify="space-between" align="center" gap={16} wrap>
        <Space><Text strong>滚动计划表</Text><Text type="secondary">字段结构与月度计划一致；数据由订单排期所选记录手工同步</Text></Space>
        <Space wrap={false}>
          <KdosTableSearchFilter search={search} onSearchChange={setSearch} filters={filters} onFiltersChange={setFilters} fields={filterFields} />
          <Button icon={<EyeOutlined />} onClick={() => setFieldOpen(true)}>字段显示</Button>
          <TablePermissionButton resource="rolling-plan-table" />
        </Space>
      </Flex>
    </div>
    <div className="monthly-grid ag-theme-quartz">
      <AgGridReact rowData={rows} columnDefs={columnDefs} loading={itemsQuery.isLoading} theme="legacy" localeText={AG_GRID_LOCALE_ZH_CN}
        enableCellTextSelection ensureDomOrder suppressMovableColumns tooltipShowDelay={250} getRowId={({ data }) => data.id}
        onGridReady={({ api: instance }) => { gridApi.current = instance; applyGridFilterModel(instance); }}
        onFilterChanged={({ api: instance }) => {
          const next = Object.fromEntries(Object.entries(instance.getFilterModel()).map(([field, model]: [string, any]) => [field, String(model?.filter ?? "")]).filter(([, value]) => value));
          if (JSON.stringify(next) !== JSON.stringify(filters)) setFilters(next);
        }}
        onSortChanged={({ api: instance }) => {
          const state = instance.getColumnState().find((column) => column.sort);
          const next = state ? { field: state.colId, order: state.sort as "asc" | "desc" } : {};
          setSort((current) => current.field === next.field && current.order === next.order ? current : next); setPage(1);
        }}
        getRowClass={(params: RowClassParams) => params.node.rowIndex! % 2 ? "order-alt" : ""}
        defaultColDef={{ sortable: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true, minWidth: 68 }}
        overlayNoRowsTemplate="<span class='ag-overlay-no-rows-center'>暂无滚动计划数据，请在订单排期中选择记录后同步</span>"
        rowHeight={40} headerHeight={58} groupHeaderHeight={42} />
    </div>
    <div className="monthly-grid-pagination"><Pagination current={page} pageSize={pageSize} total={itemsQuery.data?.total ?? 0}
      showSizeChanger={false} showQuickJumper showTotal={(total) => `共 ${total} 条`}
      onChange={(nextPage) => setPage(nextPage)} />
      <Select aria-label="每页显示条数" value={pageSize} options={pageSizes.map((value) => ({ value, label: `${value} 条/页` }))} onChange={(value) => { setPageSize(value); setPage(1); localStorage.setItem(`kdos-form-page-size:${userKey}:rolling-plan-table`, String(value)); }} />
    </div>
    <Modal title="字段显示" width={800} open={fieldOpen} onCancel={() => setFieldOpen(false)} footer={<Button type="primary" onClick={() => setFieldOpen(false)}>完成</Button>}>
      <Flex justify="space-between" style={{ marginBottom: 12 }}><Text type="secondary">当前显示 {fields.filter((field) => !hiddenFields.includes(field.code)).length} / {fields.length} 个字段</Text><Button onClick={() => setHiddenFields([])}>全部显示</Button></Flex>
      <Select mode="multiple" showSearch optionFilterProp="label" maxTagCount="responsive" value={fields.filter((field) => !hiddenFields.includes(field.code)).map((field) => field.code)} style={{ width: "100%" }} options={fields.map((field) => ({ value: field.code, label: `${field.groupLabel} · ${field.label}` }))} onChange={(visible) => setHiddenFields(fields.map((field) => field.code).filter((code) => !visible.includes(code)))} />
    </Modal>
  </div>;
}
