/* eslint-disable react-refresh/only-export-components -- table edit context and permission helpers are shared by cell components */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type Key, type ReactNode } from "react";
import { Button, Checkbox, Drawer, Flex, Input, Space, Table, Tag, Typography } from "antd";
import { EditOutlined, EyeOutlined, ReloadOutlined, SafetyCertificateOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnType, ColumnsType, TableProps } from "antd/es/table";
import { isTableFieldFilterable, tablePermissionFieldsFor, tableResourceRegistry } from "@kdos/contracts";
import type { TablePermissionFieldDefinition, TableResourceCode } from "@kdos/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuditColumns } from "./audit-fields";
import { KdosAdvancedFilter, emptyFilterGroup, type AdvancedFilterGroup } from "./advanced-filter";

type DataRecord = Record<string, any>;

type TableEditState = { editing: boolean; canEdit: boolean };
const KdosTableEditContext = createContext<TableEditState>({ editing: false, canEdit: false });

export function useKdosTableEditMode() {
  return useContext(KdosTableEditContext);
}

export function hasSessionResourcePermission(session: { permissions?: string[]; isSystemAdmin?: boolean; moduleAdminCodes?: string[] } | null | undefined, resource: string, action: string) {
  const permissions = session?.permissions ?? [];
  const definition = tableResourceRegistry.find((item) => item.code === resource);
  return session?.isSystemAdmin === true || permissions.includes("*")
    || Boolean(definition && session?.moduleAdminCodes?.includes(definition.moduleCode))
    || permissions.includes(`${resource}:*:${action}`);
}

export function hasResourcePermission(resource: string, action: string) {
  try {
    return hasSessionResourcePermission(JSON.parse(localStorage.getItem("sessionUser") ?? "{}"), resource, action);
  } catch {
    return false;
  }
}

export function hasFieldPermission(resource: string, field: string, action: "read" | "update") {
  try {
    const session = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
    const definition = tableResourceRegistry.find((item) => item.code === resource);
    return session.isSystemAdmin === true || session.permissions?.includes("*")
      || (definition && session.moduleAdminCodes?.includes(definition.moduleCode))
      || session.permissions?.includes(`${resource}:${field}:${action}`)
      || (action === "read" && session.permissions?.includes(`${resource}:${field}:update`));
  } catch {
    return false;
  }
}

const registeredTableResources = new Set<string>(tableResourceRegistry.map((resource) => resource.code));
export const kdosPageSizeOptions = [20, 50, 100, 200] as const;

export function shouldResetServerTablePage(action: "paginate" | "sort" | "filter") {
  return action === "sort" || action === "filter";
}

export function canManageTablePermissions(resource?: string) {
  try {
    const session = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
    if (session.isSystemAdmin === true || session.permissions?.includes("*")) return true;
    const definition = tableResourceRegistry.find((item) => item.code === resource);
    return Boolean(definition && session.moduleAdminCodes?.includes(definition.moduleCode));
  } catch {
    return false;
  }
}

export function TablePermissionButton({ resource }: { resource: string }) {
  if (!registeredTableResources.has(resource) || !canManageTablePermissions(resource)) return null;
  const currentPath = `${window.location.pathname}${window.location.search}`;
  const href = `/permissions/${encodeURIComponent(resource)}?from=${encodeURIComponent(currentPath)}`;
  return <Button href={href} icon={<SafetyCertificateOutlined />}>权限管理</Button>;
}

export const kdosSystemFieldDefinitions = [
  { key: "createdBy", label: "创建人", width: 150 },
  { key: "createdAt", label: "创建时间", width: 175 },
  { key: "updatedBy", label: "更新人", width: 150 },
  { key: "updatedAt", label: "更新时间", width: 175 },
] as const;

function columnKey<RecordType>(column: ColumnType<RecordType>) {
  if (column.key != null) return String(column.key);
  if (Array.isArray(column.dataIndex)) return column.dataIndex.join(".");
  return column.dataIndex == null ? "" : String(column.dataIndex);
}

function valueAt(row: DataRecord, path: string) {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as DataRecord)[key] : undefined, row);
}

function comparable(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number") return value;
  return String(value).toLocaleLowerCase();
}

function decorate<RecordType extends DataRecord>(columns: ColumnsType<RecordType>, serverMode = false, sortField = "", sortOrder?: "ascend" | "descend"): ColumnsType<RecordType> {
  return columns.map((raw) => {
    const column = raw as ColumnType<RecordType> & { children?: ColumnsType<RecordType> };
    if (column.children?.length) return { ...column, children: decorate(column.children, serverMode, sortField, sortOrder) };
    const key = columnKey(column);
    return {
      ...column,
      key: column.key ?? key,
      sorter: serverMode && column.dataIndex != null ? true : column.sorter ?? (key ? ((left: RecordType, right: RecordType) => {
        const a = comparable(valueAt(left, key)); const b = comparable(valueAt(right, key));
        return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "zh-CN", { numeric: true });
      }) : undefined),
      sortOrder: serverMode && key === sortField ? sortOrder : column.sortOrder,
      showSorterTooltip: false
    };
  });
}

function flatten<RecordType>(columns: ColumnsType<RecordType>): Array<{ key: string; label: string }> {
  return columns.flatMap((raw) => {
    const column = raw as ColumnType<RecordType> & { children?: ColumnsType<RecordType> };
    if (column.children?.length) return flatten(column.children);
    const key = columnKey(column);
    return key && !key.startsWith("__") ? [{ key, label: typeof column.title === "string" ? column.title : key }] : [];
  });
}

function filterColumns<RecordType>(columns: ColumnsType<RecordType>, visible: Set<string>): ColumnsType<RecordType> {
  return columns.flatMap((raw) => {
    const column = raw as ColumnType<RecordType> & { children?: ColumnsType<RecordType> };
    if (column.children?.length) {
      const children = filterColumns(column.children, visible);
      return children.length ? [{ ...column, children }] : [];
    }
    const key = columnKey(column);
    return !key || key.startsWith("__") || visible.has(key) ? [column] : [];
  });
}

export type KdosFilterField = { key: string; label: string };

/* KN-FILTER-002：工具栏只保留快速搜索（Excel“查找”语义）。旧“筛选”抽屉（legacy Record<string,string>）已删除。 */
export function KdosTableQuickSearch({ search, onSearchChange, searchPlaceholder = "搜索当前表格" }: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
}) {
  return <Input allowClear prefix={<SearchOutlined />} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} style={{ width: 280 }} />;
}

export type KdosDataTableProps<RecordType extends DataRecord> = Omit<TableProps<RecordType>, "columns" | "dataSource"> & {
  resource: string;
  columns: ColumnsType<RecordType>;
  dataSource?: readonly RecordType[];
  systemFields?: boolean;
  toolbar?: ReactNode;
  searchPlaceholder?: string;
  shellClassName?: string;
  /** Minimal read-only list without search, filter or field-view controls. */
  simple?: boolean;
  /** Tables always start in browse mode. When enabled, authorized users can explicitly enter edit mode. */
  editable?: boolean;
  /** Fields hidden for users who have not saved a personal column view yet. */
  defaultHiddenFields?: string[];
  /** Optional view discriminator so different views of one resource keep separate column and page-size preferences. */
  viewKey?: string;
  /** 正式字段 metadata：提供后启用类型化高级筛选（操作符与值控件全部由 metadata 决定）。 */
  filterFields?: TablePermissionFieldDefinition[];
  /** KN-FILTER-001：页面自带列表接口时，把已应用的 FilterGroup 交给页面自行下发到后端。 */
  onFilterGroupChange?: (group: AdvancedFilterGroup) => void;
  /** Standard record selection is enabled by default for registered business tables. */
  selectable?: boolean;
  /** Optional actions that consume the table's stable, cross-page selection. */
  selectionActions?: (selection: KdosTableSelection<RecordType>) => ReactNode;
  /** Server-backed paging/search/filtering for ERP-sized tables. */
  serverData?: {
    total: number;
    onQueryChange: (query: { page: number; pageSize: number; search: string; filters: Record<string, string>; filterGroup?: AdvancedFilterGroup; sortField?: string; sortOrder?: "asc" | "desc" }) => void;
  };
};

export type KdosTableSelection<RecordType extends DataRecord> = {
  selectedRowKeys: Key[];
  selectedRows: RecordType[];
  total: number;
  editing: boolean;
  canEdit: boolean;
  clearSelection: () => void;
};

function recordKey<RecordType extends DataRecord>(row: RecordType, rowKey: TableProps<RecordType>["rowKey"]): Key {
  if (typeof rowKey === "function") return rowKey(row);
  return row[String(rowKey ?? "id")] as Key;
}

export function KdosDataTable<RecordType extends DataRecord>({
  resource, columns, dataSource, systemFields = true, toolbar, searchPlaceholder = "搜索当前表格", shellClassName, className, editable = false, simple = false, viewKey,
  filterFields, onFilterGroupChange, selectable, selectionActions,
  defaultHiddenFields = [],
  pagination, scroll, serverData, ...tableProps
}: KdosDataTableProps<RecordType>) {
  /*
   * KN-FILTER-001：字段 metadata 默认取契约中的正式定义（所有 44 个 resource 都有）。
   * 页面无需逐个传 filterFields；特殊视图（例如主计划 PENDING）可以显式覆盖。
   */
  const resolvedFilterFields = filterFields ?? tablePermissionFieldsFor(resource as TableResourceCode);
  const systemAuditColumns = useAuditColumns() as ColumnsType<RecordType>;
  const userKey = (() => { try { return JSON.parse(localStorage.getItem("sessionUser") ?? "{}").sub ?? "anonymous"; } catch { return "anonymous"; } })();
  const preferenceKey = viewKey ? `${resource}:${viewKey}` : resource;
  const storageKey = `kdos-form-view:${userKey}:${preferenceKey}`;
  const pageSizeStorageKey = `kdos-form-page-size:${userKey}:${preferenceKey}`;
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<"ascend" | "descend">();
  /* 类型化高级筛选：草稿在面板内维护，只有点击“筛选/清空”才写入 applied 并触发服务端查询。 */
  const [filterGroup, setFilterGroup] = useState<AdvancedFilterGroup>(emptyFilterGroup());
  /* KN-FILTER-001 capability：只有已接入平台筛选的资源才显示正式高级筛选，避免“可填写但服务端忽略”。 */
  const filterCapabilities = useQuery({
    queryKey: ["table-filter-resources"],
    queryFn: () => api<Array<{ code: string; filterableFields: string[] }>>("/table-filters/resources"),
    staleTime: 300_000,
    enabled: Boolean(resolvedFilterFields?.length) && !simple
  });
  const registeredFilterCodes = Array.isArray(filterCapabilities.data) ? filterCapabilities.data : [];
  const typedFilteringSupported = Boolean(resolvedFilterFields?.length) && registeredFilterCodes.some((entry: { code: string }) => entry.code === resource);
  /* 只有真正可筛选（filterable 且类型支持操作符）的字段才进入高级筛选，structure/attachment 等不会出现假筛选项。 */
  const supportedFilterFields = typedFilteringSupported ? resolvedFilterFields.filter((field) => isTableFieldFilterable(field)) : undefined;
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const selectedRecords = useRef(new Map<Key, RecordType>());
  const serverMode = Boolean(serverData);
  const requestedPagination = pagination && typeof pagination === "object" ? pagination : undefined;
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem(pageSizeStorageKey));
    return kdosPageSizeOptions.includes(saved as (typeof kdosPageSizeOptions)[number]) ? saved : Number(requestedPagination?.pageSize ?? 50);
  });
  const canEdit = editable && hasResourcePermission(resource, "update");
  useEffect(() => {
    setEditing(false); setCurrentPage(1); setSortField(""); setSortOrder(undefined);
    setSelectedRowKeys([]); selectedRecords.current.clear();
  }, [resource]);
  useEffect(() => { setCurrentPage(1); }, [filters, search, filterGroup]);
  useEffect(() => { setFilterGroup(emptyFilterGroup()); }, [resource, viewKey]);
  const filterGroupCallback = useRef(onFilterGroupChange);
  useEffect(() => { filterGroupCallback.current = onFilterGroupChange; }, [onFilterGroupChange]);
  useEffect(() => { filterGroupCallback.current?.(filterGroup); }, [filterGroup]);
  const allColumns = useMemo(() => {
    const business = decorate(columns, serverMode, sortField, sortOrder);
    if (!systemFields) return business;
    const systemKeys = new Set(kdosSystemFieldDefinitions.map((field) => field.key as string));
    const withoutClientAuditColumns = business.filter((column) => !systemKeys.has(columnKey(column)));
    return [...withoutClientAuditColumns, ...systemAuditColumns] as ColumnsType<RecordType>;
  }, [columns, serverMode, sortField, sortOrder, systemFields, systemAuditColumns]);
  const fields = useMemo(() => flatten(allColumns), [allColumns]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null"); return Array.isArray(saved) ? saved : []; } catch { return []; }
  });
  const effectiveVisible = visibleKeys.length ? visibleKeys : fields.map((field) => field.key).filter((key) => !defaultHiddenFields.includes(key));
  useEffect(() => { if (visibleKeys.length) localStorage.setItem(storageKey, JSON.stringify(visibleKeys)); }, [storageKey, visibleKeys]);
  const visible = useMemo(() => new Set(effectiveVisible), [effectiveVisible]);
  /* KN-FILTER-002：列头不再提供筛选下拉，正式条件只能通过“高级筛选”建立。 */
  const renderedColumns = useMemo(() => filterColumns(allColumns, visible), [allColumns, visible]);
  const searchableKeys = useMemo(() => fields.map((field) => field.key), [fields]);
  const clientRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    const activeFilters = Object.entries(filters).filter(([, value]) => value.trim());
    return (dataSource ?? []).filter((row) => {
      if (keyword && !searchableKeys.some((key) => String(valueAt(row, key) ?? "").toLocaleLowerCase().includes(keyword))) return false;
      return activeFilters.every(([key, value]) => String(valueAt(row, key) ?? "").toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()));
    });
  }, [dataSource, filters, search, searchableKeys]);
  const rows = serverData ? (dataSource ?? []) : clientRows;
  const serverQueryCallback = useRef(serverData?.onQueryChange);
  useEffect(() => { serverQueryCallback.current = serverData?.onQueryChange; }, [serverData?.onQueryChange]);
  useEffect(() => {
    if (!serverMode) return;
    const timer = window.setTimeout(() => serverQueryCallback.current?.({
      page: currentPage, pageSize, search: search.trim(), filters, filterGroup, sortField: sortField || undefined,
      sortOrder: sortOrder === "descend" ? "desc" : sortOrder === "ascend" ? "asc" : undefined
    }), 250);
    return () => window.clearTimeout(timer);
  }, [serverMode, currentPage, filters, filterGroup, pageSize, search, sortField, sortOrder]);
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil((serverData?.total ?? rows.length) / pageSize));
    if (currentPage > lastPage) setCurrentPage(lastPage);
  }, [currentPage, pageSize, rows.length, serverData?.total]);
  const isRegisteredForm = registeredTableResources.has(resource);
  const selectionEnabled = selectable ?? (isRegisteredForm && !simple);
  const clearSelection = () => { setSelectedRowKeys([]); selectedRecords.current.clear(); };
  const selectionState: KdosTableSelection<RecordType> = {
    selectedRowKeys,
    selectedRows: selectedRowKeys.flatMap((key) => {
      const row = selectedRecords.current.get(key);
      return row ? [row] : [];
    }),
    total: serverData?.total ?? clientRows.length,
    editing: editing && canEdit,
    canEdit,
    clearSelection
  };
  const internalRowSelection: TableProps<RecordType>["rowSelection"] = selectionEnabled ? {
    selectedRowKeys,
    preserveSelectedRowKeys: true,
    fixed: true,
    columnWidth: 48,
    onSelect: (record, selected) => {
      const key = recordKey(record, tableProps.rowKey);
      if (selected) selectedRecords.current.set(key, record); else selectedRecords.current.delete(key);
      setSelectedRowKeys((current) => selected ? (current.includes(key) ? current : [...current, key]) : current.filter((item) => item !== key));
    },
    onSelectAll: (selected, _selectedRows, changedRows) => {
      const changedKeys = new Set(changedRows.map((row) => recordKey(row, tableProps.rowKey)));
      for (const row of changedRows) {
        const key = recordKey(row, tableProps.rowKey);
        if (selected) selectedRecords.current.set(key, row); else selectedRecords.current.delete(key);
      }
      setSelectedRowKeys((current) => selected
        ? [...current, ...[...changedKeys].filter((key) => !current.includes(key))]
        : current.filter((key) => !changedKeys.has(key)));
    }
  } : undefined;
  const resolvedPagination = pagination === false && !isRegisteredForm ? false : {
    ...requestedPagination,
    current: currentPage,
    pageSize,
    total: serverData?.total ?? requestedPagination?.total,
    pageSizeOptions: [...kdosPageSizeOptions],
    showSizeChanger: true,
    showQuickJumper: true,
    showTotal: (total: number) => `共 ${total} 条`,
    position: ["bottomRight" as const],
    onChange: (page: number, nextPageSize: number) => {
      const sizeChanged = nextPageSize !== pageSize;
      setPageSize(nextPageSize);
      setCurrentPage(sizeChanged ? 1 : page);
      localStorage.setItem(pageSizeStorageKey, String(nextPageSize));
      requestedPagination?.onChange?.(sizeChanged ? 1 : page, nextPageSize);
    }
  };

  return <KdosTableEditContext.Provider value={{ editing: editing && canEdit, canEdit }}><section className={["kdos-data-table-shell", shellClassName].filter(Boolean).join(" ")} data-resource={resource} data-edit-mode={editing && canEdit ? "editing" : "readonly"}>
    {!simple && <Flex className="kdos-data-table-toolbar" justify="space-between" align="center" gap={12} wrap>
      <Space wrap>
        {canEdit && <Button type={editing ? "primary" : "default"} icon={<EditOutlined />} onClick={() => setEditing((value) => !value)}>
          {editing ? "退出编辑模式" : "进入编辑模式"}
        </Button>}
        {editing && canEdit && <Tag color="processing">编辑模式 · 单元格失焦自动保存</Tag>}
        {toolbar}
      </Space>
      <Space wrap>
        <KdosTableQuickSearch search={search} onSearchChange={setSearch} searchPlaceholder={searchPlaceholder} />
        {typedFilteringSupported ? <KdosAdvancedFilter resource={resource} fields={supportedFilterFields ?? []} value={filterGroup}
          onApply={(group) => { setFilters({}); setFilterGroup(group); }} />
          : resolvedFilterFields?.length && !filterCapabilities.isLoading
            ? <Button disabled title="该表暂未接入统一筛选平台，请使用顶部搜索或列头筛选">高级筛选（暂不支持）</Button>
            : null}
        <Button icon={<EyeOutlined />} onClick={() => setDrawerOpen(true)}>字段显示</Button>
        <TablePermissionButton resource={resource} />
      </Space>
    </Flex>}
    {!simple && selectedRowKeys.length > 0 && <Flex className="kdos-data-table-selection-toolbar" justify="space-between" align="center" gap={12} wrap>
      <Space wrap>
        <Typography.Text strong>已选 {selectedRowKeys.length}/{selectionState.total}</Typography.Text>
        <Button type="link" onClick={clearSelection}>清空选择</Button>
      </Space>
      {selectionActions?.(selectionState)}
    </Flex>}
    <Table<RecordType>
      {...tableProps}
      className={["kdos-data-table", className].filter(Boolean).join(" ")}
      rowKey={tableProps.rowKey ?? "id"}
      rowSelection={tableProps.rowSelection ?? internalRowSelection}
      dataSource={rows}
      columns={renderedColumns}
      pagination={resolvedPagination}
      scroll={scroll ?? { x: "max-content", y: "calc(100vh - 310px)" }}
      sticky
      onChange={(paginationState, tableFilters, sorter, extra) => {
        if (serverMode && extra.action === "sort") {
          const active = (Array.isArray(sorter) ? sorter[0] : sorter) as { field?: React.Key; columnKey?: React.Key; order?: "ascend" | "descend" };
          setSortField(String(active?.field ?? active?.columnKey ?? ""));
          setSortOrder(active?.order);
        }
        if (serverMode && shouldResetServerTablePage(extra.action)) {
          setCurrentPage(1);
        }
        tableProps.onChange?.(paginationState, tableFilters, sorter, extra);
      }}
    />
    {!simple && <Drawer title="字段显示与个人视图" width={400} open={drawerOpen} onClose={() => setDrawerOpen(false)}
      extra={<Button icon={<ReloadOutlined />} onClick={() => { setVisibleKeys([]); localStorage.removeItem(storageKey); }}>恢复默认</Button>}>
      <Typography.Paragraph type="secondary">字段设置只保存到当前账号；创建人、创建时间、更新人、更新时间可以隐藏，但不能编辑。</Typography.Paragraph>
      <Checkbox.Group value={effectiveVisible} onChange={(keys) => setVisibleKeys(keys.map(String))} style={{ width: "100%" }}>
        <Flex vertical gap={8}>{fields.map((field) => <Checkbox key={field.key} value={field.key}>{field.label}</Checkbox>)}</Flex>
      </Checkbox.Group>
    </Drawer>}
  </section></KdosTableEditContext.Provider>;
}
