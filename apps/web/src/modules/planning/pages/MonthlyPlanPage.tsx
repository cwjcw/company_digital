import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Descriptions, Flex, Form, Input, InputNumber, Modal, Pagination, Select, Space, Tag, Typography, Upload } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import type { ColDef, ColGroupDef, GridApi, RowClassParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { io } from "socket.io-client";
import type { PlanningVersionContract } from "@kdos/contracts";
import { api, ApiError } from "../../../api";
import { buildPlanningColumns, monthlyPlanDisplayFields, type DepartmentOption, type DictionaryOptions, type RuntimePlanningField } from "../grid/column-builder";
import { planningFieldRegistry } from "../grid/column-registry";
import { DUE_DATE_DISPLAY_FORMAT } from "../../../shared/date-format";
import { useAuditIdentityDirectory } from "../../../shared/audit-fields";
import { KdosTableSearchFilter, TablePermissionButton } from "../../../shared/KdosDataTable";
import { AG_GRID_LOCALE_ZH_CN } from "../../../shared/ag-grid-locale-zh";

const { Text } = Typography;
type Notice = { type: "success" | "error" | "info"; text: string };
type PeriodResponse = { id: string; year: number; month: number; currentVersionId: string | null; versions: PlanningVersionContract[] } | null;
type ImportPreview = { jobId: string; summary: { total: number; warnings: number }; warnings: string[] };
type PlanPage = { rows: any[]; total: number; page: number; pageSize: number };
const planPageSizes = [20, 50, 100, 200];

function useDictionaryOptions() {
  const dictionaries = useQuery({ queryKey: ["reference-dictionaries"], queryFn: () => api<any[]>("/reference-data/dictionaries") });
  const suppliers = useQuery({ queryKey: ["reference-suppliers"], queryFn: () => api<any[]>("/reference-data/suppliers") });
  return useMemo<DictionaryOptions>(() => {
    const options: DictionaryOptions = {};
    for (const type of dictionaries.data ?? []) options[type.code] = (type.values ?? []).filter((entry: any) => entry.enabled).map((entry: any) => entry.value);
    options.supplier = (suppliers.data ?? []).filter((entry: any) => entry.enabled).map((entry: any) => entry.name);
    return options;
  }, [dictionaries.data, suppliers.data]);
}

export function MonthlyPlanPage({ year, month }: { year: number; month: number }) {
  const queryClient = useQueryClient();
  const gridApi = useRef<GridApi | null>(null);
  const saveAndExit = useRef(false);
  const dictionaryOptions = useDictionaryOptions();
  const auditIdentityNames = useAuditIdentityDirectory();
  const userKey = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const [activeVersionId, setActiveVersionId] = useState<string>();
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>();
  const [fieldOpen, setFieldOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview>();
  const [importFileName, setImportFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [creatingItem, setCreatingItem] = useState(false);
  const [reasonAction, setReasonAction] = useState<"lock" | "unlock">();
  const [reason, setReason] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>();
  const [imageOpen, setImageOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem(`kdos-form-page-size:${userKey}:monthly-plan`));
    return planPageSizes.includes(saved) ? saved : 50;
  });
  const [sort, setSort] = useState<{ field?: string; order?: "asc" | "desc" }>({});
  const [settledSearch, setSettledSearch] = useState("");
  const [settledFilters, setSettledFilters] = useState<Record<string, string>>({});
  const selectedRows = useRef(new Map<string, any>());
  const [addForm] = Form.useForm();
  const [bulkForm] = Form.useForm();
  const bulkFieldCode = Form.useWatch<string>("field", bulkForm);
  const [hiddenFields, setHiddenFields] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(`kdos-planning-hidden-v2:${userKey}`) ?? "[]"); return Array.isArray(value) ? value : []; }
    catch { return []; }
  });

  const fieldsQuery = useQuery({ queryKey: ["planning-fields"], queryFn: () => api<RuntimePlanningField[]>("/planning/fields"), retry: false });
  const organizationsQuery = useQuery({ queryKey: ["planning-organization-options"], queryFn: () => api<DepartmentOption[]>("/planning/organization-options"), retry: false });
  const fields = useMemo(() => monthlyPlanDisplayFields(fieldsQuery.data ?? planningFieldRegistry.map((field) => ({ ...field, access: field.editable ? "EDITABLE" as const : "READONLY" as const }))), [fieldsQuery.data]);
  const filterFields = useMemo(() => fields.filter((field) => field.visible && field.access !== "HIDDEN").map((field) => ({ key: field.code, label: field.label })), [fields]);
  const periodQuery = useQuery({ queryKey: ["planning-period", year, month], queryFn: () => api<PeriodResponse>(`/planning/periods/by-month?year=${year}&month=${month}`), retry: false });
  const period = periodQuery.data;
  const activeVersion = period?.versions.find((entry) => entry.id === activeVersionId);
  useEffect(() => {
    if (!period) { setActiveVersionId(undefined); return; }
    if (activeVersionId && period.versions.some((entry) => entry.id === activeVersionId)) return;
    setActiveVersionId(period.versions.find((entry) => entry.status === "DRAFT")?.id ?? period.currentVersionId ?? period.versions[0]?.id);
  }, [activeVersionId, period]);
  useEffect(() => { if (activeVersion?.status !== "DRAFT") setEditMode(false); }, [activeVersion?.status]);
  useEffect(() => { localStorage.setItem(`kdos-planning-hidden-v2:${userKey}`, JSON.stringify(hiddenFields)); }, [hiddenFields, userKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setSettledSearch(search.trim()); setSettledFilters(filters); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [filters, search]);
  useEffect(() => { setPage(1); selectedRows.current.clear(); setSelectedIds([]); }, [activeVersionId]);

  const itemsQuery = useQuery({
    queryKey: ["planning-items", activeVersionId, { page, pageSize, search: settledSearch, filters: settledFilters, sort }],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (settledSearch) query.set("search", settledSearch);
      if (Object.values(settledFilters).some((value) => value.trim())) query.set("filters", JSON.stringify(settledFilters));
      if (sort.field) query.set("sortField", sort.field);
      if (sort.order) query.set("sortOrder", sort.order);
      return api<PlanPage | any[]>(`/planning/versions/${activeVersionId}/items?${query}`);
    }, enabled: Boolean(activeVersionId), retry: false
  });
  const risksQuery = useQuery({
    queryKey: ["planning-risks", activeVersionId],
    queryFn: () => api<any>(`/planning/versions/${activeVersionId}/risks?days=7`), enabled: Boolean(activeVersionId), retry: false
  });
  const rows = Array.isArray(itemsQuery.data) ? itemsQuery.data : itemsQuery.data?.rows ?? [];
  const columnDefs = useMemo<Array<ColDef | ColGroupDef>>(() => buildPlanningColumns(fields, editMode && activeVersion?.status === "DRAFT", hiddenFields, dictionaryOptions, auditIdentityNames, organizationsQuery.data ?? []), [activeVersion?.status, auditIdentityNames, dictionaryOptions, editMode, fields, hiddenFields, organizationsQuery.data]);

  const applyGridFilterModel = useCallback((apiInstance: GridApi) => {
    const target = Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim()).map(([field, value]) => [field, { filterType: "text", type: "contains", filter: value }]));
    const current = Object.fromEntries(Object.entries(apiInstance.getFilterModel()).map(([field, model]: [string, any]) => [field, String(model?.filter ?? "")]));
    const targetValues = Object.fromEntries(Object.entries(target).map(([field, model]: [string, any]) => [field, String(model.filter)]));
    if (JSON.stringify(current) !== JSON.stringify(targetValues)) apiInstance.setFilterModel(target);
  }, [filters]);
  useEffect(() => { if (gridApi.current) applyGridFilterModel(gridApi.current); }, [applyGridFilterModel]);

  useEffect(() => {
    if (!period?.id || !activeVersionId) return;
    const token = localStorage.getItem("accessToken"); if (!token) return;
    const socket = io("/plans", { auth: { token, period: period.id }, transports: ["websocket"] });
    socket.on("plan.changed", () => { void queryClient.invalidateQueries({ queryKey: ["planning-items", activeVersionId] }); void queryClient.invalidateQueries({ queryKey: ["planning-period", year, month] }); });
    return () => { socket.close(); };
  }, [activeVersionId, month, period?.id, queryClient, year]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["planning-period", year, month] });
    void queryClient.invalidateQueries({ queryKey: ["planning-items"] });
    void queryClient.invalidateQueries({ queryKey: ["planning-risks"] });
  };
  const write = useMutation({
    mutationFn: ({ id, field, value, expectedVersion }: any) => api(`/planning/items/${id}`, { method: "PATCH", body: JSON.stringify({ field, value, expectedVersion }) }),
    onSuccess: refresh, onError: refresh
  });

  const ensureDraftVersion = async () => {
    const existingDraft = period?.versions.find((entry) => entry.status === "DRAFT");
    if (existingDraft) { setActiveVersionId(existingDraft.id); return existingDraft.id; }
    let targetPeriod = period;
    if (!targetPeriod) {
      const created = await api<any>("/planning/periods", { method: "POST", body: JSON.stringify({ year, month }) });
      targetPeriod = { ...created, versions: [] };
    }
    if (!targetPeriod) throw new Error("无法准备当前月份的计划数据");
    let draft: PlanningVersionContract | undefined;
    try {
      draft = await api<PlanningVersionContract>(`/planning/periods/${targetPeriod.id}/versions`, { method: "POST", body: JSON.stringify({ basedOnVersionId: targetPeriod.currentVersionId ?? null }) });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      const concurrent = await api<PeriodResponse>(`/planning/periods/by-month?year=${year}&month=${month}`);
      draft = concurrent?.versions.find((entry) => entry.status === "DRAFT");
      if (!draft) throw error;
    }
    const latest = await api<PeriodResponse>(`/planning/periods/by-month?year=${year}&month=${month}`);
    if (latest) queryClient.setQueryData(["planning-period", year, month], latest);
    setActiveVersionId(draft.id);
    return draft.id;
  };
  const publish = async () => {
    if (!period || !activeVersionId) return;
    try { await api(`/planning/periods/${period.id}/versions/${activeVersionId}/publish`, { method: "POST", body: "{}" }); setNotice({ type: "success", text: "计划已发布并创建快照" }); setEditMode(false); refresh(); }
    catch (error) { setNotice({ type: "error", text: (error as Error).message }); }
  };
  const submitReason = async () => {
    if (!period || !activeVersionId || !reasonAction) return;
    try {
      await api(`/planning/periods/${period.id}/versions/${activeVersionId}/${reasonAction}`, { method: "POST", body: JSON.stringify({ reason }) });
      setNotice({ type: "success", text: reasonAction === "lock" ? "计划已锁定" : "计划已解锁为正式只读版本" }); setReasonAction(undefined); setReason(""); refresh();
    } catch (error) { setNotice({ type: "error", text: (error as Error).message }); }
  };
  const createItem = async () => {
    setCreatingItem(true);
    try {
      const values = await addForm.validateFields();
      const versionId = await ensureDraftVersion();
      await api(`/planning/versions/${versionId}/items`, { method: "POST", body: JSON.stringify({ ...values, deliveryDate: values.deliveryDate?.format("YYYY-MM-DD") }) });
      setAddOpen(false); addForm.resetFields(); setNotice({ type: "success", text: "计划行已创建，可直接在表格中继续编辑" }); refresh();
    } catch (error) {
      setNotice({ type: "error", text: (error as Error).message });
    } finally { setCreatingItem(false); }
  };
  const bulkUpdate = async () => {
    if (!activeVersionId) return;
    const values = await bulkForm.validateFields(); const field = values.field; let value = values.value;
    if (fields.find((entry) => entry.code === field)?.dataType === "date" && value) value = value.format("YYYY-MM-DD");
    const selected = [...selectedRows.current.values()];
    await api(`/planning/versions/${activeVersionId}/items/bulk`, { method: "POST", body: JSON.stringify({ updates: selected.map((row) => ({ id: row.id, field, value, expectedVersion: row.version })) }) });
    selectedRows.current.clear(); setSelectedIds([]); gridApi.current?.deselectAll();
    setBulkOpen(false); bulkForm.resetFields(); setNotice({ type: "success", text: `已批量修改 ${selected.length} 行` }); refresh();
  };
  const canEdit = activeVersion?.status === "DRAFT";
  const bulkField = fields.find((field) => field.code === bulkFieldCode);
  const bulkFieldOptions = fields.filter((field) => field.editable && field.access === "EDITABLE" && field.dataType !== "image")
    .map((field) => ({ value: field.code, label: `${field.groupLabel} · ${field.label}` }));
  const risk = risksQuery.data ?? { overdue: [], dueSoon: [], processOverdue: [], openExceptions: [] };
  return <div>
    <div className="monthly-toolbar planning-version-toolbar">
      <Flex className="monthly-toolbar-row" align="center" gap={8} wrap>
        <Text strong>编排操作</Text>
        <Button type={editMode ? "primary" : "default"} disabled={!canEdit} onClick={() => setEditMode((value) => !value)}>{editMode ? "退出编辑模式" : "进入编辑模式"}</Button>
        {editMode && <Button type="primary" loading={write.isPending} onMouseDown={() => { saveAndExit.current = (gridApi.current?.getEditingCells().length ?? 0) > 0; }} onClick={() => {
          if (saveAndExit.current) gridApi.current?.stopEditing();
          else { setEditMode(false); setNotice({ type: "success", text: "保存成功；所有单元格修改均已实时提交" }); }
        }}>保存</Button>}
        {editMode && <Tag color={write.isPending ? "processing" : "success"}>{write.isPending ? "保存中" : "失焦自动保存"}</Tag>}
        <Button type="primary" disabled={!canEdit || !(Array.isArray(itemsQuery.data) ? itemsQuery.data.length : itemsQuery.data?.total)} onClick={() => Modal.confirm({ title: `发布 ${activeVersion?.name}？`, content: "发布将创建不可变快照，其他部门默认读取该正式版本。", onOk: publish })}>发布</Button>
        <Button disabled={activeVersion?.status !== "PUBLISHED"} onClick={() => setReasonAction("lock")}>锁定</Button>
        <Button danger disabled={activeVersion?.status !== "LOCKED"} onClick={() => setReasonAction("unlock")}>解锁</Button>
        <Button disabled={periodQuery.isLoading} onClick={() => setAddOpen(true)}>新增计划行</Button>
        <Button disabled={!canEdit || !selectedIds.length} onClick={() => setBulkOpen(true)}>批量修改（{selectedIds.length}）</Button>
        <Upload accept=".xlsx,.csv" showUploadList={false} disabled={periodQuery.isLoading} beforeUpload={async (file) => {
          const form = new FormData(); form.append("file", file as File); setImporting(true);
          try {
            const versionId = await ensureDraftVersion();
            const preview = await api<ImportPreview>(`/planning/versions/${versionId}/imports/preview`, { method: "POST", body: form });
            setImportFileName(file.name); setImportPreview(preview); setNotice({ type: "info", text: "文件校验完成，请核对预览并确认写入" });
          } catch (error) { setNotice({ type: "error", text: (error as Error).message }); }
          finally { setImporting(false); }
          return false;
        }}><Button loading={importing} disabled={periodQuery.isLoading}>导入 Excel</Button></Upload>
        <Button href={`/api/v1/planning/versions/${activeVersionId}/export`} target="_blank" disabled={!activeVersionId}>导出 Excel</Button>
      </Flex>
      <Flex className="monthly-toolbar-row" align="center" justify="space-between" gap={16} wrap>
        <Space wrap={false}>
          <Text strong>风险概览</Text>
          <Tag color={risk.overdue.length ? "red" : "default"}>交期逾期 {risk.overdue.length}</Tag>
          <Tag color={risk.dueSoon.length ? "orange" : "default"}>7天内到期 {risk.dueSoon.length}</Tag>
          <Tag color={risk.processOverdue.length ? "red" : "default"}>工序逾期 {risk.processOverdue.length}</Tag>
          <Tag color={risk.openExceptions.length ? "volcano" : "default"}>未关闭异常 {risk.openExceptions.length}</Tag>
        </Space>
        <Space wrap={false}>
          <KdosTableSearchFilter search={search} onSearchChange={setSearch} filters={filters} onFiltersChange={setFilters} fields={filterFields} />
          <Button icon={<EyeOutlined />} onClick={() => setFieldOpen(true)}>字段显示</Button>
          <TablePermissionButton resource="monthly-plan" />
        </Space>
      </Flex>
    </div>
    {notice && <Alert className="save-notice" type={notice.type} showIcon closable message={notice.text} onClose={() => setNotice(undefined)} />}
    {periodQuery.isLoading
      ? <Alert style={{ marginBottom: 10 }} type="info" showIcon message="正在加载计划周期；字段和空表格可先查看。" />
      : !period
        ? <Alert style={{ marginBottom: 10 }} type="info" showIcon message={`${year}年${month}月暂无计划数据；可直接导入 Excel 或新增计划行，系统会在首次写入时自动准备。`} />
        : !canEdit && <Alert style={{ marginBottom: 10 }} type="info" showIcon message="当前版本为只读；直接导入或新增计划行时，系统会自动准备新的可编辑版本。" />}
    <div className="monthly-grid ag-theme-quartz">
      <AgGridReact rowData={rows} columnDefs={columnDefs} loading={itemsQuery.isLoading} theme="legacy" localeText={AG_GRID_LOCALE_ZH_CN} singleClickEdit={editMode}
        rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }} selectionColumnDef={{ pinned: "left", lockPosition: true, width: 48, resizable: false }}
        enableCellTextSelection ensureDomOrder suppressMovableColumns tooltipShowDelay={250} getRowId={({ data }) => data.id}
        onGridReady={({ api: instance }) => { gridApi.current = instance; applyGridFilterModel(instance); }}
        onFilterChanged={({ api: instance }) => {
          const next = Object.fromEntries(Object.entries(instance.getFilterModel()).map(([field, model]: [string, any]) => [field, String(model?.filter ?? "")]).filter(([, value]) => value));
          if (JSON.stringify(next) !== JSON.stringify(filters)) setFilters(next);
        }}
        onRowDataUpdated={({ api: instance }) => instance.forEachNode((node) => { if (node.data?.id && selectedRows.current.has(node.data.id)) node.setSelected(true); })}
        onSortChanged={({ api: instance }) => {
          const state = instance.getColumnState().find((column) => column.sort);
          const next = state ? { field: state.colId, order: state.sort as "asc" | "desc" } : {};
          setSort((current) => current.field === next.field && current.order === next.order ? current : next); setPage(1);
        }}
        onSelectionChanged={({ api: instance }) => {
          const pageIds = new Set(rows.map((row) => row.id));
          for (const id of pageIds) selectedRows.current.delete(id);
          for (const row of instance.getSelectedRows()) selectedRows.current.set(row.id, row);
          setSelectedIds([...selectedRows.current.keys()]);
        }}
        onCellClicked={({ column, data }) => { if (column.getColId() === "image") { setSelectedItem(data); setImageOpen(true); } }}
        onCellValueChanged={async ({ data, colDef, newValue, oldValue }) => {
          if (newValue === oldValue || !colDef.field) return;
          try {
            await write.mutateAsync({ id: data.id, field: colDef.field, value: newValue, expectedVersion: data.version });
            if (saveAndExit.current) { setEditMode(false); setNotice({ type: "success", text: "保存成功" }); }
            else setNotice({ type: "success", text: `${data.orderNumber} / ${data.itemNumber} 已保存` });
          } catch (error) { const apiError = error as ApiError; setNotice({ type: "error", text: apiError.status === 409 ? "数据已被其他用户修改，请刷新后重试" : `保存失败：${apiError.message}` }); }
          finally { saveAndExit.current = false; }
        }}
        getRowClass={(params: RowClassParams) => params.node.rowIndex! % 2 ? "order-alt" : ""}
        defaultColDef={{ sortable: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true, minWidth: 68 }}
        overlayNoRowsTemplate="<span class='ag-overlay-no-rows-center'>本月暂无计划数据，字段结构已完整加载</span>"
        rowHeight={40} headerHeight={58} groupHeaderHeight={42} stopEditingWhenCellsLoseFocus />
    </div>
    <div className="monthly-grid-pagination"><Pagination current={page} pageSize={pageSize} total={Array.isArray(itemsQuery.data) ? itemsQuery.data.length : itemsQuery.data?.total ?? 0}
      pageSizeOptions={planPageSizes} showSizeChanger showQuickJumper showTotal={(total) => `共 ${total} 条`}
      onChange={(nextPage, nextPageSize) => {
        const sizeChanged = nextPageSize !== pageSize;
        setPageSize(nextPageSize); setPage(sizeChanged ? 1 : nextPage);
        localStorage.setItem(`kdos-form-page-size:${userKey}:monthly-plan`, String(nextPageSize));
      }} />
    </div>
    <Modal title="字段显示" width={800} open={fieldOpen} onCancel={() => setFieldOpen(false)} footer={<Button type="primary" onClick={() => setFieldOpen(false)}>完成</Button>}>
      <Flex justify="space-between" style={{ marginBottom: 12 }}><Text type="secondary">Metadata Registry：当前显示 {fields.filter((field) => !hiddenFields.includes(field.code)).length} / {fields.length} 个字段</Text><Space><Button onClick={() => setHiddenFields([])}>全部显示</Button><Button onClick={() => setHiddenFields([])}>恢复默认</Button></Space></Flex>
      <Select mode="multiple" showSearch optionFilterProp="label" maxTagCount="responsive" value={fields.filter((field) => !hiddenFields.includes(field.code)).map((field) => field.code)} style={{ width: "100%" }} options={fields.map((field) => ({ value: field.code, label: `${field.groupLabel} · ${field.label}` }))} onChange={(visible) => setHiddenFields(fields.map((field) => field.code).filter((code) => !visible.includes(code)))} />
    </Modal>
    <Modal title="导入计划预览" open={Boolean(importPreview)} confirmLoading={importing} okText="确认写入" cancelText="取消"
      onCancel={() => { if (!importing) { setImportPreview(undefined); setImportFileName(""); } }}
      onOk={async () => {
        if (!importPreview) return;
        setImporting(true);
        try {
          const result = await api<{ created: number; updated: number; repeated: boolean }>(`/planning/imports/${importPreview.jobId}/confirm`, { method: "POST", body: "{}" });
          setNotice({ type: "success", text: result.repeated ? "该文件此前已确认，未重复写入" : `导入完成：新增 ${result.created} 行，更新 ${result.updated} 行` });
          setImportPreview(undefined); setImportFileName(""); refresh();
        } catch (error) { setNotice({ type: "error", text: (error as Error).message }); }
        finally { setImporting(false); }
      }}>
      <Descriptions bordered size="small" column={2} items={[
        { key: "file", label: "文件", children: importFileName },
        { key: "period", label: "目标版本", children: `${activeVersion?.name ?? "—"} ${activeVersion?.status ?? ""}` },
        { key: "total", label: "有效行", children: String(importPreview?.summary.total ?? 0) },
        { key: "warnings", label: "提示", children: String(importPreview?.summary.warnings ?? 0) }
      ]} />
      {!!importPreview?.warnings.length && <Alert style={{ marginTop: 12 }} type="warning" showIcon message={`${importPreview.warnings.length} 条数据质量提示`} description={<ul>{importPreview.warnings.slice(0, 20).map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>} />}
    </Modal>
    <Modal title="新增计划行" open={addOpen} confirmLoading={creatingItem} onCancel={() => setAddOpen(false)} onOk={() => void createItem()}>
      <Form form={addForm} layout="vertical"><Form.Item name="orderNumber" label="订单号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="itemNumber" label="品号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="itemName" label="品名"><Input /></Form.Item><Form.Item name="productionQuantity" label="订单需求数量" rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: "100%" }} /></Form.Item><Form.Item name="deliveryDate" label="客户要求交期"><DatePicker format={DUE_DATE_DISPLAY_FORMAT} style={{ width: "100%" }} /></Form.Item></Form>
    </Modal>
    <Modal title={`批量修改 ${selectedIds.length} 行`} open={bulkOpen} onCancel={() => setBulkOpen(false)} onOk={() => void bulkUpdate()}>
      <Form form={bulkForm} layout="vertical"><Form.Item name="field" label="字段" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={bulkFieldOptions} /></Form.Item><Form.Item name="value" label="新值" rules={[{ required: true }]}>{bulkField?.dataType === "date" ? <DatePicker format={DUE_DATE_DISPLAY_FORMAT} style={{ width: "100%" }} /> : ["decimal", "integer"].includes(bulkField?.dataType ?? "") ? <InputNumber style={{ width: "100%" }} /> : bulkField?.editorType === "department" ? <Select showSearch optionFilterProp="label" options={(organizationsQuery.data ?? []).map((entry) => ({ value: entry.id, label: entry.pathLabel }))} /> : bulkField?.editorType === "dictionary" ? <Select showSearch options={(dictionaryOptions[bulkField.dictionaryCode ?? ""] ?? []).map((value) => ({ value, label: value }))} /> : <Input />}</Form.Item></Form>
    </Modal>
    <Modal title={selectedItem ? `上传简图 · 品号 ${selectedItem.itemNumber}` : "上传简图"} open={imageOpen} onCancel={() => setImageOpen(false)} footer={<Button onClick={() => setImageOpen(false)}>关闭</Button>}>
      {!selectedItem ? <Alert type="info" showIcon message="请点击表格中的简图单元格" /> : <Space wrap>
        {(selectedItem.imageRefs ?? []).map((url: string) => <img key={url} src={url} alt="简图" style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 6 }} />)}
        <Upload accept="image/jpeg,image/png,image/webp" showUploadList={false} disabled={!canEdit || (selectedItem.imageRefs?.length ?? 0) >= 2}
          customRequest={async ({ file, onSuccess, onError }: any) => {
            const form = new FormData(); form.append("image", file as File); form.append("expectedVersion", String(selectedItem.version));
            try {
              const result = await api<any>(`/planning/items/${selectedItem.id}/images`, { method: "POST", body: form });
              setSelectedItem(result); setNotice({ type: "success", text: "简图已上传" }); refresh(); onSuccess?.({});
            } catch (error) { setNotice({ type: "error", text: (error as Error).message }); onError?.(error); }
          }}><Button disabled={!canEdit || (selectedItem.imageRefs?.length ?? 0) >= 2}>选择图片（最多 2 张）</Button></Upload>
      </Space>}
    </Modal>
    <Modal title={reasonAction === "lock" ? "锁定计划" : "解锁计划"} open={Boolean(reasonAction)} onCancel={() => { setReasonAction(undefined); setReason(""); }} onOk={() => void submitReason()} okButtonProps={{ disabled: !reason.trim(), danger: reasonAction === "unlock" }}><Alert type="warning" showIcon message="该操作将写入完整审计记录" /><Input.TextArea style={{ marginTop: 12 }} rows={4} placeholder="必须填写原因" value={reason} onChange={(event) => setReason(event.target.value)} /></Modal>
  </div>;
}
