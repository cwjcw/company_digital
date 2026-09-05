/* eslint-disable react-refresh/only-export-components -- table edit context and permission helpers are shared by cell components */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Drawer, Flex, Input, Space, Table, Tag, Typography } from "antd";
import { EditOutlined, EyeOutlined, FilterOutlined, ReloadOutlined, SafetyCertificateOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnType, ColumnsType, TableProps } from "antd/es/table";
import { tableResourceRegistry } from "@kdos/contracts";
import { useAuditColumns } from "./audit-fields";

type DataRecord = Record<string, any>;

type TableEditState = { editing: boolean; canEdit: boolean };
const KdosTableEditContext = createContext<TableEditState>({ editing: false, canEdit: false });

export function useKdosTableEditMode() {
  return useContext(KdosTableEditContext);
}

export function hasResourcePermission(resource: string, action: string) {
  try {
    const permissions: string[] = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").permissions ?? [];
    return permissions.includes("*") || permissions.includes(`${resource}:*:${action}`)
      || permissions.some((permission) => permission.startsWith(`${resource}:`) && permission.endsWith(`:${action}`));
  } catch {
    return false;
  }
}

const registeredTableResources = new Set<string>(tableResourceRegistry.map((resource) => resource.code));
export const kdosPageSizeOptions = [20, 50, 100, 200] as const;

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
    return key ? [{ key, label: typeof column.title === "string" ? column.title : key }] : [];
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
    return !key || visible.has(key) ? [column] : [];
  });
}

export type KdosFilterField = { key: string; label: string };

export function KdosTableSearchFilter({ search, onSearchChange, filters, onFiltersChange, fields, searchPlaceholder = "搜索当前表格" }: {
  search: string;
  onSearchChange: (value: string) => void;
  filters: Record<string, string>;
  onFiltersChange: (value: Record<string, string>) => void;
  fields: KdosFilterField[];
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const activeFilterCount = Object.values(filters).filter((value) => value.trim()).length;
  return <>
    <Space wrap={false}>
      <Input allowClear prefix={<SearchOutlined />} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} style={{ width: 280 }} />
      <Button type={activeFilterCount ? "primary" : "default"} icon={<FilterOutlined />} onClick={() => setOpen(true)}>筛选{activeFilterCount ? `（${activeFilterCount}）` : ""}</Button>
    </Space>
    <Drawer title="按字段筛选" width={420} open={open} onClose={() => setOpen(false)}
      extra={<Button disabled={!activeFilterCount} onClick={() => onFiltersChange({})}>清空筛选</Button>}>
      <Flex vertical gap={12}>{fields.map((field) => <label key={field.key} className="kdos-data-table-filter-field">
        <Typography.Text>{field.label}</Typography.Text>
        <Input allowClear value={filters[field.key] ?? ""} placeholder={`筛选${field.label}`}
          onChange={(event) => onFiltersChange({ ...filters, [field.key]: event.target.value })} />
      </label>)}</Flex>
    </Drawer>
  </>;
}

function ColumnFilterPanel({ label, value, onApply, onClear, close }: {
  label: string; value: string; onApply: (value: string) => void; onClear: () => void; close: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const apply = () => { onApply(draft.trim()); close(); };
  return <div className="kdos-column-filter-panel" onKeyDown={(event) => event.stopPropagation()}>
    <Typography.Text strong>{label}</Typography.Text>
    <Typography.Text type="secondary">文本筛选：包含</Typography.Text>
    <Input autoFocus allowClear value={draft} placeholder={`输入要查找的${label}`} onChange={(event) => setDraft(event.target.value)} onPressEnter={apply} />
    <Flex justify="space-between" gap={8}>
      <Button onClick={() => { setDraft(""); onClear(); close(); }}>清除</Button>
      <Button type="primary" onClick={apply}>筛选</Button>
    </Flex>
  </div>;
}

function addColumnHeaderFilters<RecordType extends DataRecord>(
  columns: ColumnsType<RecordType>, filters: Record<string, string>, onFiltersChange: (filters: Record<string, string>) => void
): ColumnsType<RecordType> {
  return columns.map((raw) => {
    const column = raw as ColumnType<RecordType> & { children?: ColumnsType<RecordType> };
    if (column.children?.length) return { ...column, children: addColumnHeaderFilters(column.children, filters, onFiltersChange) };
    const key = columnKey(column);
    if (!key || column.dataIndex == null || column.filterDropdown) return column;
    const label = typeof column.title === "string" ? column.title : key;
    return {
      ...column,
      filteredValue: filters[key] ? [filters[key]] : null,
      filterIcon: (filtered: boolean) => <span title="筛选" aria-label={`${label}筛选`}><FilterOutlined style={{ color: filtered ? "#176B87" : undefined }} /></span>,
      filterDropdown: ({ close }) => <ColumnFilterPanel label={label} value={filters[key] ?? ""} close={close}
        onApply={(value) => onFiltersChange({ ...filters, [key]: value })}
        onClear={() => { const next = { ...filters }; delete next[key]; onFiltersChange(next); }} />
    };
  });
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
  /** Server-backed paging/search/filtering for ERP-sized tables. */
  serverData?: {
    total: number;
    onQueryChange: (query: { page: number; pageSize: number; search: string; filters: Record<string, string>; sortField?: string; sortOrder?: "asc" | "desc" }) => void;
  };
};

export function KdosDataTable<RecordType extends DataRecord>({
  resource, columns, dataSource, systemFields = true, toolbar, searchPlaceholder = "搜索当前表格", shellClassName, className, editable = false, simple = false,
  defaultHiddenFields = [],
  pagination, scroll, serverData, ...tableProps
}: KdosDataTableProps<RecordType>) {
  const systemAuditColumns = useAuditColumns() as ColumnsType<RecordType>;
  const userKey = (() => { try { return JSON.parse(localStorage.getItem("sessionUser") ?? "{}").sub ?? "anonymous"; } catch { return "anonymous"; } })();
  const storageKey = `kdos-form-view:${userKey}:${resource}`;
  const pageSizeStorageKey = `kdos-form-page-size:${userKey}:${resource}`;
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState<"ascend" | "descend">();
  const serverMode = Boolean(serverData);
  const requestedPagination = pagination && typeof pagination === "object" ? pagination : undefined;
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem(pageSizeStorageKey));
    return kdosPageSizeOptions.includes(saved as (typeof kdosPageSizeOptions)[number]) ? saved : Number(requestedPagination?.pageSize ?? 50);
  });
  const canEdit = editable && hasResourcePermission(resource, "update");
  useEffect(() => { setEditing(false); setCurrentPage(1); setSortField(""); setSortOrder(undefined); }, [resource]);
  useEffect(() => { setCurrentPage(1); }, [filters, search]);
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
  const renderedColumns = useMemo(
    () => addColumnHeaderFilters(filterColumns(allColumns, visible), filters, setFilters),
    [allColumns, filters, visible]
  );
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
      page: currentPage, pageSize, search: search.trim(), filters, sortField: sortField || undefined,
      sortOrder: sortOrder === "descend" ? "desc" : sortOrder === "ascend" ? "asc" : undefined
    }), 250);
    return () => window.clearTimeout(timer);
  }, [serverMode, currentPage, filters, pageSize, search, sortField, sortOrder]);
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil((serverData?.total ?? rows.length) / pageSize));
    if (currentPage > lastPage) setCurrentPage(lastPage);
  }, [currentPage, pageSize, rows.length, serverData?.total]);
  const isRegisteredForm = registeredTableResources.has(resource);
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
        <KdosTableSearchFilter search={search} onSearchChange={setSearch} filters={filters} onFiltersChange={setFilters} fields={fields} searchPlaceholder={searchPlaceholder} />
        <Button icon={<EyeOutlined />} onClick={() => setDrawerOpen(true)}>字段显示</Button>
        <TablePermissionButton resource={resource} />
      </Space>
    </Flex>}
    <Table<RecordType>
      {...tableProps}
      className={["kdos-data-table", className].filter(Boolean).join(" ")}
      rowKey={tableProps.rowKey ?? "id"}
      dataSource={rows}
      columns={renderedColumns}
      pagination={resolvedPagination}
      scroll={scroll ?? { x: "max-content", y: "calc(100vh - 310px)" }}
      sticky
      onChange={(paginationState, tableFilters, sorter, extra) => {
        if (serverMode) {
          const active = (Array.isArray(sorter) ? sorter[0] : sorter) as { field?: React.Key; columnKey?: React.Key; order?: "ascend" | "descend" };
          setSortField(String(active?.field ?? active?.columnKey ?? ""));
          setSortOrder(active?.order);
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
