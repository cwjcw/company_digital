import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Descriptions, Flex, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, Upload } from "antd";
import type { ColDef, ColGroupDef, GridApi, RowClassParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { io } from "socket.io-client";
import type { PlanningVersionContract } from "@kdos/contracts";
import { api, ApiError, containsText } from "../../../api";
import { buildPlanningColumns, type DictionaryOptions, type RuntimePlanningField } from "../grid/column-builder";
import { planningFieldRegistry } from "../grid/column-registry";

const { Text } = Typography;
type Notice = { type: "success" | "error" | "info"; text: string };
type PeriodResponse = { id: string; year: number; month: number; currentVersionId: string | null; versions: PlanningVersionContract[] } | null;
type ImportPreview = { jobId: string; summary: { total: number; warnings: number }; warnings: string[] };

function useDictionaryOptions() {
  const dictionaries = useQuery({ queryKey: ["dictionaries"], queryFn: () => api<any[]>("/master-data/dictionaries") });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api<any[]>("/master-data/suppliers") });
  return useMemo<DictionaryOptions>(() => {
    const options: DictionaryOptions = {};
    for (const type of dictionaries.data ?? []) options[type.code] = (type.values ?? []).filter((entry: any) => entry.enabled).map((entry: any) => entry.value);
    options.supplier = (suppliers.data ?? []).filter((entry: any) => entry.enabled).map((entry: any) => entry.name);
    return options;
  }, [dictionaries.data, suppliers.data]);
}

function versionColor(status?: string) {
  return status === "DRAFT" ? "processing" : status === "PUBLISHED" ? "success" : status === "LOCKED" ? "red" : "default";
}

export function MonthlyPlanPage({ year, month }: { year: number; month: number }) {
  const queryClient = useQueryClient();
  const gridApi = useRef<GridApi | null>(null);
  const saveAndExit = useRef(false);
  const dictionaryOptions = useDictionaryOptions();
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
  const [reasonAction, setReasonAction] = useState<"lock" | "unlock">();
  const [reason, setReason] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>();
  const [imageOpen, setImageOpen] = useState(false);
  const [quickOrder, setQuickOrder] = useState("");
  const [quickItem, setQuickItem] = useState("");
  const [quickStatus, setQuickStatus] = useState<string>();
  const [addForm] = Form.useForm();
  const [bulkForm] = Form.useForm();
  const [hiddenFields, setHiddenFields] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(`kdos-planning-hidden:${userKey}`) ?? '["relationKey"]'); return Array.isArray(value) ? value : ["relationKey"]; }
    catch { return ["relationKey"]; }
  });

  const fieldsQuery = useQuery({ queryKey: ["planning-fields"], queryFn: () => api<RuntimePlanningField[]>("/planning/fields"), retry: false });
  const fields = fieldsQuery.data ?? planningFieldRegistry.map((field) => ({ ...field, access: field.editable ? "EDITABLE" as const : "READONLY" as const }));
  const periodQuery = useQuery({ queryKey: ["planning-period", year, month], queryFn: () => api<PeriodResponse>(`/planning/periods/by-month?year=${year}&month=${month}`), retry: false });
  const period = periodQuery.data;
  const activeVersion = period?.versions.find((entry) => entry.id === activeVersionId);
  useEffect(() => {
    if (!period) { setActiveVersionId(undefined); return; }
    if (activeVersionId && period.versions.some((entry) => entry.id === activeVersionId)) return;
    setActiveVersionId(period.versions.find((entry) => entry.status === "DRAFT")?.id ?? period.currentVersionId ?? period.versions[0]?.id);
  }, [activeVersionId, period]);
  useEffect(() => { if (activeVersion?.status !== "DRAFT") setEditMode(false); }, [activeVersion?.status]);
  useEffect(() => { localStorage.setItem(`kdos-planning-hidden:${userKey}`, JSON.stringify(hiddenFields)); }, [hiddenFields, userKey]);

  const itemsQuery = useQuery({
    queryKey: ["planning-items", activeVersionId],
    queryFn: () => api<any[]>(`/planning/versions/${activeVersionId}/items`), enabled: Boolean(activeVersionId), retry: false
  });
  const risksQuery = useQuery({
    queryKey: ["planning-risks", activeVersionId],
    queryFn: () => api<any>(`/planning/versions/${activeVersionId}/risks?days=7`), enabled: Boolean(activeVersionId), retry: false
  });
  const rows = useMemo(() => (itemsQuery.data ?? []).filter((row) => containsText(row.orderNumber, quickOrder) && containsText(row.itemNumber, quickItem) && (!quickStatus || row.itemStatus === quickStatus || row.planningStatus === quickStatus)), [itemsQuery.data, quickItem, quickOrder, quickStatus]);
  const columnDefs = useMemo<Array<ColDef | ColGroupDef>>(() => buildPlanningColumns(fields, editMode && activeVersion?.status === "DRAFT", hiddenFields, dictionaryOptions), [activeVersion?.status, dictionaryOptions, editMode, fields, hiddenFields]);

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

  const createPeriod = async () => {
    try {
      const created = await api<any>("/planning/periods", { method: "POST", body: JSON.stringify({ year, month }) });
      const draft = await api<any>(`/planning/periods/${created.id}/versions`, { method: "POST", body: "{}" });
      setActiveVersionId(draft.id); setNotice({ type: "success", text: `已创建 ${year}-${String(month).padStart(2, "0")} v1 DRAFT` }); refresh();
    } catch (error) { setNotice({ type: "error", text: (error as Error).message }); }
  };
  const createDraft = async () => {
    if (!period) return;
    try {
      const basedOnVersionId = period.currentVersionId ?? activeVersionId ?? null;
      const result = await api<any>(`/planning/periods/${period.id}/versions`, { method: "POST", body: JSON.stringify({ basedOnVersionId }) });
      setActiveVersionId(result.id); setNotice({ type: "success", text: `${result.name} DRAFT 已创建，正式版本保持不变` }); refresh();
    } catch (error) { setNotice({ type: "error", text: (error as Error).message }); }
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
    if (!activeVersionId) return;
    const values = await addForm.validateFields();
    await api(`/planning/versions/${activeVersionId}/items`, { method: "POST", body: JSON.stringify({ ...values, deliveryDate: values.deliveryDate?.format("YYYY-MM-DD") }) });
    setAddOpen(false); addForm.resetFields(); setNotice({ type: "success", text: "计划行已创建" }); refresh();
  };
  const bulkUpdate = async () => {
    if (!activeVersionId) return;
    const values = await bulkForm.validateFields(); const field = values.field; let value = values.value;
    if (field === "customerDueDate" && value) value = value.format("YYYY-MM-DD");
    const selected = (itemsQuery.data ?? []).filter((row) => selectedIds.includes(row.id));
    await api(`/planning/versions/${activeVersionId}/items/bulk`, { method: "POST", body: JSON.stringify({ updates: selected.map((row) => ({ id: row.id, field, value, expectedVersion: row.version })) }) });
    setBulkOpen(false); bulkForm.resetFields(); setNotice({ type: "success", text: `已批量修改 ${selected.length} 行` }); refresh();
  };
  const reorder = async (direction: "top" | "up" | "down" | "bottom") => {
    if (!activeVersionId || !selectedIds.length) return;
    const ordered = [...(itemsQuery.data ?? [])].sort((a, b) => a.planSequence - b.planSequence);
    const selected = new Set(selectedIds); const picked = ordered.filter((row) => selected.has(row.id)); const rest = ordered.filter((row) => !selected.has(row.id));
    let next = ordered;
    if (direction === "top") next = [...picked, ...rest];
    if (direction === "bottom") next = [...rest, ...picked];
    if (direction === "up") for (let index = 1; index < next.length; index++) if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) [next[index - 1], next[index]] = [next[index], next[index - 1]];
    if (direction === "down") for (let index = next.length - 2; index >= 0; index--) if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) [next[index], next[index + 1]] = [next[index + 1], next[index]];
    await api(`/planning/versions/${activeVersionId}/reorder`, { method: "POST", body: JSON.stringify({ itemIds: next.map((row) => row.id) }) });
    setNotice({ type: "success", text: "计划顺序已保存" }); refresh();
  };

  const canEdit = activeVersion?.status === "DRAFT";
  const risk = risksQuery.data ?? { overdue: [], dueSoon: [], processOverdue: [], openExceptions: [] };
  const versions = period?.versions ?? [];
  return <div>
    <div className="monthly-toolbar planning-version-toolbar">
      <Flex className="monthly-toolbar-row" align="center" gap={8} wrap>
        <Text strong>Planning Center</Text>
        <Tag color="blue">{year}年{String(month).padStart(2, "0")}月</Tag>
        <Select aria-label="计划版本" placeholder="尚未建立版本" value={activeVersionId} disabled={!versions.length} onChange={setActiveVersionId} style={{ width: 180 }} options={versions.map((entry) => ({ value: entry.id, label: `${entry.name} ${entry.status}` }))} />
        <Tag color={versionColor(activeVersion?.status)}>{activeVersion ? `${activeVersion.status === "LOCKED" ? "🔒 " : ""}${activeVersion.name} ${activeVersion.status}` : "未建立计划周期"}</Tag>
        {!period && <Button type="primary" loading={periodQuery.isLoading} onClick={() => void createPeriod()}>创建周期和 v1 草稿</Button>}
        <Button onClick={() => void createDraft()} disabled={!period || versions.some((entry) => entry.status === "DRAFT")}>新建草稿版本</Button>
        <Button type="primary" disabled={!canEdit || !(itemsQuery.data?.length)} onClick={() => Modal.confirm({ title: `发布 ${activeVersion?.name}？`, content: "发布将创建不可变快照，其他部门默认读取该正式版本。", onOk: publish })}>发布</Button>
        <Button disabled={activeVersion?.status !== "PUBLISHED"} onClick={() => setReasonAction("lock")}>锁定</Button>
        <Button danger disabled={activeVersion?.status !== "LOCKED"} onClick={() => setReasonAction("unlock")}>解锁</Button>
      </Flex>
      <Flex className="monthly-toolbar-row" align="center" gap={8} wrap>
        <Text strong>编排操作</Text>
        <Button type={editMode ? "primary" : "default"} disabled={!canEdit} onClick={() => setEditMode((value) => !value)}>{editMode ? "退出编辑模式" : "进入编辑模式"}</Button>
        {editMode && <Button type="primary" loading={write.isPending} onMouseDown={() => { saveAndExit.current = (gridApi.current?.getEditingCells().length ?? 0) > 0; }} onClick={() => {
          if (saveAndExit.current) gridApi.current?.stopEditing();
          else { setEditMode(false); setNotice({ type: "success", text: "保存成功；所有单元格修改均已实时提交" }); }
        }}>保存</Button>}
        {editMode && <Tag color={write.isPending ? "processing" : "success"}>{write.isPending ? "保存中" : "失焦自动保存"}</Tag>}
        <Button disabled={!canEdit} onClick={() => setAddOpen(true)}>新增计划行</Button>
        <Button disabled={!canEdit || !selectedIds.length} onClick={() => setBulkOpen(true)}>批量修改（{selectedIds.length}）</Button>
        <Button disabled={!canEdit || !selectedIds.length} onClick={() => void reorder("top")}>移到顶部</Button>
        <Button disabled={!canEdit || !selectedIds.length} onClick={() => void reorder("up")}>上移</Button>
        <Button disabled={!canEdit || !selectedIds.length} onClick={() => void reorder("down")}>下移</Button>
        <Button disabled={!canEdit || !selectedIds.length} onClick={() => void reorder("bottom")}>移到底部</Button>
        <Upload accept=".xlsx,.csv" showUploadList={false} disabled={!canEdit} beforeUpload={async (file) => {
          const form = new FormData(); form.append("file", file as File); setImporting(true);
          try {
            const preview = await api<ImportPreview>(`/planning/versions/${activeVersionId}/imports/preview`, { method: "POST", body: form });
            setImportFileName(file.name); setImportPreview(preview); setNotice({ type: "info", text: "文件校验完成，请核对预览并确认写入" });
          } catch (error) { setNotice({ type: "error", text: (error as Error).message }); }
          finally { setImporting(false); }
          return false;
        }}><Button loading={importing} disabled={!canEdit}>导入 Excel</Button></Upload>
        <Button href={`/api/v1/planning/versions/${activeVersionId}/export`} target="_blank" disabled={!activeVersionId}>导出 Excel</Button>
        <Button onClick={() => setFieldOpen(true)}>字段显示</Button>
      </Flex>
      <Flex className="monthly-toolbar-row" align="center" gap={8} wrap>
        <Text strong>快速筛选</Text>
        <Input aria-label="筛选订单号" allowClear placeholder="订单号" value={quickOrder} onChange={(event) => setQuickOrder(event.target.value)} style={{ width: 150 }} />
        <Input aria-label="筛选品号" allowClear placeholder="品号" value={quickItem} onChange={(event) => setQuickItem(event.target.value)} style={{ width: 150 }} />
        <Select aria-label="筛选品号状态" allowClear placeholder="状态" value={quickStatus} onChange={setQuickStatus} style={{ width: 130 }} options={["完成", "进行中", "即将延期", "延期", "PENDING"].map((value) => ({ value, label: value }))} />
        <Tag color={risk.overdue.length ? "red" : "default"}>交期逾期 {risk.overdue.length}</Tag>
        <Tag color={risk.dueSoon.length ? "orange" : "default"}>7天内到期 {risk.dueSoon.length}</Tag>
        <Tag color={risk.processOverdue.length ? "red" : "default"}>工序逾期 {risk.processOverdue.length}</Tag>
        <Tag color={risk.openExceptions.length ? "volcano" : "default"}>未关闭异常 {risk.openExceptions.length}</Tag>
      </Flex>
    </div>
    {notice && <Alert className="save-notice" type={notice.type} showIcon closable message={notice.text} onClose={() => setNotice(undefined)} />}
    {periodQuery.isLoading
      ? <Alert style={{ marginBottom: 10 }} type="info" showIcon message="正在加载计划周期；字段和空表格可先查看。" />
      : !period
        ? <Alert style={{ marginBottom: 10 }} type="info" showIcon message={`${year}年${month}月尚未建立 KDOS 计划周期；当前展示完整字段和空表格。`} action={<Button type="primary" onClick={() => void createPeriod()}>创建周期和 v1 草稿</Button>} />
        : !canEdit && <Alert style={{ marginBottom: 10 }} type="info" showIcon message="正式发布或锁定版本为只读；需要调整时请基于正式版本创建新的 DRAFT。" />}
    <div className="monthly-grid ag-theme-quartz">
      <AgGridReact rowData={rows} columnDefs={columnDefs} loading={itemsQuery.isLoading} theme="legacy" singleClickEdit={editMode}
        rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }} selectionColumnDef={{ pinned: "left", lockPosition: true, width: 48, resizable: false }}
        enableCellTextSelection ensureDomOrder suppressMovableColumns tooltipShowDelay={250} getRowId={({ data }) => data.id}
        onGridReady={({ api: instance }) => { gridApi.current = instance; }}
        onSelectionChanged={({ api: instance }) => setSelectedIds(instance.getSelectedRows().map((row: any) => row.id))}
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
        defaultColDef={{ sortable: true, resizable: true, filter: false, wrapHeaderText: true, autoHeaderHeight: true, minWidth: 68 }}
        overlayNoRowsTemplate="<span class='ag-overlay-no-rows-center'>本月暂无计划数据，字段结构已完整加载</span>"
        rowHeight={40} headerHeight={58} groupHeaderHeight={42} stopEditingWhenCellsLoseFocus />
    </div>
    <Modal title="字段显示" width={800} open={fieldOpen} onCancel={() => setFieldOpen(false)} footer={<Button type="primary" onClick={() => setFieldOpen(false)}>完成</Button>}>
      <Flex justify="space-between" style={{ marginBottom: 12 }}><Text type="secondary">Metadata Registry：当前显示 {fields.filter((field) => !hiddenFields.includes(field.code)).length} / {fields.length} 个字段</Text><Space><Button onClick={() => setHiddenFields([])}>全部显示</Button><Button onClick={() => setHiddenFields(["relationKey"])}>恢复默认</Button></Space></Flex>
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
    <Modal title="新增计划行" open={addOpen} onCancel={() => setAddOpen(false)} onOk={() => void createItem()}>
      <Form form={addForm} layout="vertical"><Form.Item name="orderNumber" label="订单号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="itemNumber" label="品号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="itemName" label="品名"><Input /></Form.Item><Form.Item name="productionQuantity" label="计划生产数量" rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: "100%" }} /></Form.Item><Form.Item name="deliveryDate" label="交期"><DatePicker style={{ width: "100%" }} /></Form.Item><Form.Item name="priority" label="优先级" initialValue={50}><InputNumber min={1} max={999} style={{ width: "100%" }} /></Form.Item></Form>
    </Modal>
    <Modal title={`批量修改 ${selectedIds.length} 行`} open={bulkOpen} onCancel={() => setBulkOpen(false)} onOk={() => void bulkUpdate()}>
      <Form form={bulkForm} layout="vertical"><Form.Item name="field" label="字段" rules={[{ required: true }]}><Select options={[{ value: "priority", label: "优先级" }, { value: "responsibleOrgId", label: "责任组织 ID" }, { value: "ownerUserId", label: "负责人 ID" }, { value: "customerDueDate", label: "交期" }, { value: "planningStatus", label: "计划状态" }]} /></Form.Item><Form.Item noStyle shouldUpdate={(before, after) => before.field !== after.field}>{({ getFieldValue }) => <Form.Item name="value" label="新值" rules={[{ required: true }]}>{getFieldValue("field") === "customerDueDate" ? <DatePicker style={{ width: "100%" }} /> : getFieldValue("field") === "priority" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>}</Form.Item></Form>
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
