import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Form, Input, InputNumber, message, Modal, Select, Space, Tag, Upload } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { api, ApiError } from "../../api";
import { downloadApiFile, ImportFeedbackAlert, InlineText, PageHeader, failedImport, type ImportFeedback } from "../../shared/legacy-ui";
import { DUE_DATE_DISPLAY_FORMAT, formatDueDate } from "../../shared/date-format";
import { hasResourcePermission, KdosDataTable, useKdosTableEditMode } from "../../shared/KdosDataTable";
import { createOrganizationMembershipIndex } from "@kdos/permissions";
import { OrganizationSelect } from "../../shared/OrganizationSelect";

type DirectoryUser = { id: string; displayName: string; departmentPaths: string[][]; enabled: boolean };
type DirectoryOrganization = { id: string; name: string; parentId: string | null; path: string[]; pathLabel: string; enabled: boolean };
type TableQuery = { page: number; pageSize: number; search: string; filters: Record<string, string>; sortField?: string; sortOrder?: "asc" | "desc" };
type TablePage<T> = { rows: T[]; total: number; page: number; pageSize: number };
const blankQuery: TableQuery = { page: 1, pageSize: 50, search: "", filters: {} };
const tableUrl = (path: string, query: TableQuery, extra: Record<string,string> = {}) => {
  const params=new URLSearchParams({...extra,page:String(query.page),pageSize:String(query.pageSize)});
  if(query.search)params.set("search",query.search);if(Object.values(query.filters).some((value)=>value.trim()))params.set("filters",JSON.stringify(query.filters));
  if(query.sortField)params.set("sortField",query.sortField);if(query.sortOrder)params.set("sortOrder",query.sortOrder);
  return `${path}?${params}`;
};
const pageRows = <T,>(data?: TablePage<T> | T[]) => Array.isArray(data) ? data : data?.rows ?? [];
const pageTotal = <T,>(data?: TablePage<T> | T[]) => Array.isArray(data) ? data.length : data?.total ?? 0;

function DepartmentSelectCell({ value, display, organizations, onSave, allowClear = false }: { value?: string | null; display?: string | null; organizations: DirectoryOrganization[]; onSave: (id: string | null) => Promise<void>; allowClear?: boolean }) {
  const { editing } = useKdosTableEditMode();
  if (!editing) return <span className="kdos-readonly-cell">{display || "—"}</span>;
  return <OrganizationSelect allowClear={allowClear} value={value || undefined} placeholder="选择完整组织路径" style={{ minWidth: 240, width: "100%" }}
    organizations={organizations}
    onChange={(id) => void onSave(id ?? null)} />;
}

function UserMultiSelectCell({ value, users, selectedUsers, onSave }: { value: string[]; users: DirectoryUser[]; selectedUsers: DirectoryUser[]; onSave: (ids: string[]) => Promise<void> }) {
  const { editing } = useKdosTableEditMode();
  const [draft, setDraft] = useState<string[]>(value ?? []); const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(value ?? []); setDirty(false); }, [value]);
  const commit = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try { await onSave(draft); setDirty(false); } finally { setSaving(false); }
  };
  const mergedUsers = [...new Map([...users, ...selectedUsers].map((user) => [user.id, user])).values()];
  const selectableIds = new Set(users.map((user) => user.id));
  if (!editing) {
    const names = (value ?? []).map((id) => mergedUsers.find((user) => user.id === id)?.displayName ?? id);
    return <span className="kdos-readonly-cell">{names.join("、") || "—"}</span>;
  }
  return <Select
    mode="multiple" showSearch optionFilterProp="label" value={draft} loading={saving} maxTagCount="responsive"
    placeholder="选择通讯录成员" style={{ minWidth: 280, width: "100%" }}
    options={mergedUsers.map((user) => ({ value: user.id, label: !user.enabled ? `${user.displayName}（已停用）` : selectableIds.has(user.id) ? user.displayName : `${user.displayName}（不属于所选部门）`, disabled: !user.enabled || !selectableIds.has(user.id) }))}
    onChange={(ids) => { setDraft(ids); setDirty(true); }} onOpenChange={(open) => { if (!open) void commit(); }}
  />;
}

function MappingDeleteAction({ row, onRemove }: { row: any; onRemove: (row: any) => Promise<void> }) {
  const { editing } = useKdosTableEditMode();
  return editing ? <Button danger type="text" icon={<DeleteOutlined />} aria-label="删除对应关系" onClick={() => void onRemove(row)} /> : null;
}

export function BusinessCustomerMappingsPage() {
  const queryClient = useQueryClient(); const [tableQuery,setTableQuery]=useState<TableQuery>(blankQuery); const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false); const [syncingDirectory, setSyncingDirectory] = useState(false); const [feedback, setFeedback] = useState<ImportFeedback>(); const [form] = Form.useForm();
  const rows = useQuery({ queryKey: ["business-customer-mappings",tableQuery], queryFn: () => api<TablePage<any>|any[]>(tableUrl("/marketing/business-customer-mappings",tableQuery)) });
  const directory = useQuery({ queryKey: ["marketing-directory-users"], queryFn: () => api<DirectoryUser[]>("/marketing/directory-users") });
  const organizations = useQuery({ queryKey: ["marketing-directory-organizations"], queryFn: () => api<DirectoryOrganization[]>("/marketing/directory-organizations") });
  const organizationMembership = useMemo(() => createOrganizationMembershipIndex(organizations.data ?? []), [organizations.data]);
  const usersInDepartment = (departmentId: string | null | undefined) => !departmentId ? [] : (directory.data ?? []).filter((user) => user.enabled && (user.departmentPaths ?? []).some((path) => organizationMembership.departmentPathBelongsTo(path, departmentId)));
  const newDepartmentId = Form.useWatch("departmentId", form);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["business-customer-mappings"] });
  const update = async (row: any, field: string, value: unknown) => { try { const payload = { departmentId: row.departmentId, section: row.section, customerCode: row.customerCode, salespersonUserIds: row.salespersonUserIds ?? [], [field]: value, expectedVersion: row.version }; await api(`/marketing/business-customer-mappings/${row.id}`, { method: "PATCH", body: JSON.stringify(payload) }); refresh(); } catch (error) { message.error((error as Error).message); refresh(); throw error; } };
  const remove = async (row: any) => { await api(`/marketing/business-customer-mappings/${row.id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: row.version }) }); refresh(); };
  const importFile = async (file: File) => { const body = new FormData(); body.append("file", file); setImporting(true); try {
    const result = await api<{ imported: number; repeated: boolean; ignoredBlankCustomerRows: number; unmatchedSalespeople: string[]; ambiguousSalespeople: Array<{ name: string }>; crossSectionCustomers: Array<{ customerCode: string; locations: string[] }> }>("/marketing/business-customer-mappings/import", { method: "POST", body });
    setFeedback({ type: "success", message: result.repeated ? "该文件已经导入，无需重复写入" : `成功导入 ${result.imported} 个客户；忽略 ${result.ignoredBlankCustomerRows} 行空客户` });
    if (result.unmatchedSalespeople.length || result.ambiguousSalespeople.length || result.crossSectionCustomers.length) Modal.info({
      title: "导入完成，以下情况未阻断导入", width: 680,
      content: <Space direction="vertical" style={{ width: "100%" }}>
        <div>通讯录未匹配业务员：{result.unmatchedSalespeople.join("、") || "无"}</div>
        <div>通讯录重名业务员：{result.ambiguousSalespeople.map((item) => item.name).join("、") || "无"}</div>
        <div>跨课室客户：{result.crossSectionCustomers.map((item) => `${item.customerCode}（${item.locations.join("；")}）`).join("、") || "无"}</div>
      </Space>
    });
    refresh();
  } catch (error) { setFeedback(failedImport(error)); } finally { setImporting(false); } return false; };
  const syncDepartments = async () => {
    setSyncingDirectory(true);
    try {
      const result = await api<{ sourceCustomers: number; resolved: number; mappingsUpdated: number; skipped: Array<{ customerCode: string; reason: string }> }>("/marketing/business-customer-mappings/sync-departments-from-directory", { method: "POST" });
      message.success(`部门同步完成：对应表更新 ${result.mappingsUpdated} 行`);
      if (result.skipped.length) Modal.warning({ title: "以下客户未调整部门", content: result.skipped.map((item) => `${item.customerCode}：${item.reason}`).join("；") });
      refresh();
    } catch (error) { message.error((error as Error).message); } finally { setSyncingDirectory(false); }
  };
  const columns = [
    { key: "department", title: "部门", dataIndex: "departmentId", width: 220, render: (value: string | null, row: any) => <DepartmentSelectCell value={value} display={row.department} organizations={organizations.data ?? []} onSave={(next) => update(row, "departmentId", next)} /> },
    { key: "section", title: "课室", dataIndex: "section", width: 180, render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "section", next)} /> },
    { title: "客户", dataIndex: "customerCode", width: 180, render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "customerCode", next)} /> },
    { title: "业务员", dataIndex: "salespersonUserIds", width: 360, render: (value: string[], row: any) => <UserMultiSelectCell value={value ?? []} users={usersInDepartment(row.departmentId)} selectedUsers={row.salespersonUsers ?? []} onSave={(ids) => update(row, "salespersonUserIds", ids)} /> },
    { title: "操作", width: 80, render: (_: unknown, row: any) => <MappingDeleteAction row={row} onRemove={remove} /> }
  ];
  return <div><PageHeader title="业务人员与客户对应表" subtitle="每个客户一行；业务员从通讯录中多选" actions={<Space wrap>
    <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增对应关系</Button>
    <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => importFile(file as File)}><Button loading={importing}>导入业务接单周报</Button></Upload>
    {hasResourcePermission("business-customer-mapping", "import") ? <Button loading={syncingDirectory} onClick={() => void syncDepartments()}>按通讯录更新部门</Button> : null}
    <Button onClick={() => void downloadApiFile("/marketing/business-customer-mappings/export", "业务人员与客户对应表.csv")}>导出 CSV</Button>
  </Space>} />
    <ImportFeedbackAlert value={feedback} onClose={() => setFeedback(undefined)} />
    <KdosDataTable resource="business-customer-mapping" editable rowKey="id" loading={rows.isLoading} dataSource={pageRows(rows.data)} columns={columns}
      serverData={{total:pageTotal(rows.data),onQueryChange:setTableQuery}} searchPlaceholder="搜索部门、课室、客户或业务员" scroll={{ x: "max-content", y: "calc(100vh - 325px)" }} />
    <Modal title="新增业务与客户对应关系" open={open} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then(async (values) => { await api("/marketing/business-customer-mappings", { method: "POST", body: JSON.stringify({ ...values, salespersonUserIds: values.salespersonUserIds ?? [] }) }); setOpen(false); form.resetFields(); refresh(); }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={form} layout="vertical"><Form.Item name="departmentId" label="部门" rules={[{ required: true, message: "请选择部门" }]}><OrganizationSelect organizations={organizations.data ?? []} placeholder="选择完整组织路径" onChange={() => form.setFieldValue("salespersonUserIds", [])} /></Form.Item><Form.Item name="section" label="课室"><Input placeholder="普通文本，例如：一课" /></Form.Item><Form.Item name="customerCode" label="客户" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="salespersonUserIds" label="业务员"><Select disabled={!newDepartmentId} mode="multiple" showSearch optionFilterProp="label" placeholder={newDepartmentId ? "仅显示所选部门及子部门内的在职用户" : "请先选择部门"} options={usersInDepartment(newDepartmentId).map((user) => ({ value: user.id, label: user.displayName }))} /></Form.Item></Form>
    </Modal>
  </div>;
}

export function OrderSchedulePage() {
  const [importPreview, setImportPreview] = useState<{ total: number; errors: Array<{ row: number; reason: string }>; token: string | null; rows: any[] }>();
  const [importError, setImportError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const importLock = useRef(false);
  const previewExcel = async (file: File) => {
    if (importLock.current) return;
    importLock.current = true; setImportBusy(true); setImportError(""); setImportPreview(undefined);
    try { const body = new FormData(); body.append("file", file); setImportPreview(await api("/marketing/order-schedules/import-preview", { method: "POST", body })); }
    catch (error) { setImportError((error as Error).message); }
    finally { importLock.current = false; setImportBusy(false); }
  };
  const confirmExcel = async () => {
    if (importLock.current || !importPreview?.token) return;
    importLock.current = true; setImportBusy(true); setImportError("");
    try {
      const result = await api<{ imported: number; repeated: boolean }>("/marketing/order-schedules/import-confirm", { method: "POST", body: JSON.stringify({ token: importPreview.token }) });
      await queryClient.invalidateQueries({ queryKey: ["order-schedules"] });
      message.success(`${result.repeated ? "文件已导入，无需重复写入" : "导入成功"}：${result.imported} 条`); setImportPreview(undefined);
    } catch (error) { setImportError((error as Error).message); }
    finally { importLock.current = false; setImportBusy(false); }
  };
  const queryClient = useQueryClient(); const [tableQuery,setTableQuery]=useState<TableQuery>(blankQuery); const [selected, setSelected] = useState<string[]>([]);
  const selectedRows=useRef(new Map<string,any>());
  const [completion, setCompletion] = useState("all"); const [dueRange, setDueRange] = useState<[Dayjs | null, Dayjs | null] | null>(null); const [batchDate, setBatchDate] = useState<Dayjs | null>(null);
  const [editing, setEditing] = useState<any>(); const [saving, setSaving] = useState(false); const [deleting, setDeleting] = useState(false); const [editForm] = Form.useForm();
  const scheduleExtra={completion,dueStart:dueRange?.[0]?.format("YYYY-MM-DD")??"",dueEnd:dueRange?.[1]?.format("YYYY-MM-DD")??""};
  const rows = useQuery({ queryKey: ["order-schedules",tableQuery,scheduleExtra], queryFn: () => api<TablePage<any>|any[]>(tableUrl("/marketing/order-schedules",tableQuery,scheduleExtra)) });
  const refresh = () => { setSelected([]);selectedRows.current.clear(); void queryClient.invalidateQueries({ queryKey: ["order-schedules"] }); };
  const data = pageRows(rows.data);
  useEffect(()=>{for(const row of data)if(selected.includes(row.id))selectedRows.current.set(row.id,row);},[data,selected]);
  const applyBatch = async () => {
    if (!selected.length) return message.warning("请先选择排期记录");
    const snapshots = [...selectedRows.current.values()];
    await api("/marketing/order-schedules/batch-due-date", { method: "PATCH", body: JSON.stringify({ rows: snapshots.map((row) => ({ id: row.id, expectedVersion: row.version })), customerDueDate: batchDate?.format("YYYY-MM-DD") ?? null }) });
    message.success(`已批量更新 ${snapshots.length} 条客户交期`); setBatchDate(null); refresh();
  };
  const removeSelected = () => {
    if (!selected.length) return message.warning("请先选择排期记录");
    const snapshots = selected.map((id) => selectedRows.current.get(id) ?? data.find((row) => row.id === id)).filter(Boolean);
    if (snapshots.length !== selected.length) return message.error("所选排期数据已失效，请刷新后重新选择");
    Modal.confirm({
      title: `确认删除所选 ${snapshots.length} 条订单排期？`, content: "删除后无法恢复。", okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => {
        setDeleting(true);
        try {
          const result = await api<{ deleted: number }>("/marketing/order-schedules/batch-delete", { method: "POST", body: JSON.stringify({ rows: snapshots.map((row) => ({ id: row.id, expectedVersion: row.version })) }) });
          message.success(`已删除 ${result.deleted} 条订单排期`); refresh();
        } catch (error) { message.error((error as Error).message); throw error; }
        finally { setDeleting(false); }
      }
    });
  };
  const selectWholeOrders = async () => { const orders=[...new Set([...selectedRows.current.values()].map((row)=>row.orderNumber).filter(Boolean))];for(const orderNumber of orders){const result=await api<TablePage<any>>(tableUrl("/marketing/order-schedules",{...blankQuery,pageSize:200},{exactOrderNumber:orderNumber}));for(const row of result.rows)selectedRows.current.set(row.id,row);}setSelected([...selectedRows.current.keys()]); };
  const openEditor = () => {
    const row = selected.length === 1 ? selectedRows.current.get(selected[0]!) : undefined; if (!row) return;
    setEditing(row); editForm.setFieldsValue({ ...row, status: row.status ?? "NORMAL", customerDueDate: row.customerDueDate ? dayjs(row.customerDueDate) : null, orderTotalQuantity: Number(row.orderTotalQuantity), completionRatio: Number(row.completionRatio) });
  };
  const saveEditing = async () => {
    if (!editing) return;
    try {
      const values = await editForm.validateFields(); setSaving(true);
      await api(`/marketing/order-schedules/${editing.id}`, { method: "PATCH", body: JSON.stringify({ ...values, customerDueDate: values.customerDueDate?.format("YYYY-MM-DD") ?? null, sourcePlanItemId: editing.sourcePlanItemId ?? null, expectedVersion: editing.version }) });
      message.success("订单排期已更新"); setEditing(undefined); editForm.resetFields(); refresh();
    } catch (error) {
      if (!(error && typeof error === "object" && "errorFields" in error)) message.error((error as Error).message);
    } finally { setSaving(false); }
  };
  const columns = [
    { title: "客户代码", dataIndex: "customerCode", width: 140 },
    { key: "department", title: "部门", dataIndex: "department", width: 220, render: (value: unknown) => String(value ?? "").trim() || "—" },
    { key: "section", title: "课室", dataIndex: "section", width: 180, render: (value: unknown) => String(value ?? "").trim() || "—" },
    { title: "业务员", dataIndex: "salespersonNames", width: 180, render: (value: string[]) => value?.join("、") || "—" },
    { title: "订单编号", dataIndex: "orderNumber", width: 170 },
    { title: "品项编码", dataIndex: "itemNumber", width: 170 }, { title: "品项名称", dataIndex: "itemName", width: 260 },
    { title: "客户交期", dataIndex: "customerDueDate", width: 140, render: (value: unknown) => formatDueDate(value) }, { title: "订单总数量", dataIndex: "orderTotalQuantity", width: 140 },
    { title: "生产单位", dataIndex: "productionUnit", width: 160 }, { title: "订单完成比例", dataIndex: "completionRatio", width: 150, render: (value: unknown) => `${Number(value ?? 0).toFixed(2)}%` },
    { title: "状态", dataIndex: "status", width: 100, render: (value: unknown) => value === "VOID" ? <Tag color="red">作废</Tag> : <Tag color="green">正常</Tag> }
  ];
  return <div><PageHeader title="订单排期" subtitle="维护客户订单的品项、交期、数量、生产单位和完成状态" actions={<Space wrap>
    <Select value={completion} onChange={setCompletion} style={{ width: 130 }} options={[{ value: "all", label: "全部完成度" }, { value: "unfinished", label: "未完成" }, { value: "completed", label: "已完成" }]} />
    <DatePicker.RangePicker format={DUE_DATE_DISPLAY_FORMAT} value={dueRange} onChange={(value) => setDueRange(value as [Dayjs | null, Dayjs | null] | null)} />
    <Button onClick={() => void downloadApiFile("/marketing/order-schedules/export", "订单排期.csv")}>导出 CSV</Button>
  </Space>} />
    <Space style={{ marginBottom: 12 }} wrap><Button disabled={selected.length !== 1} onClick={openEditor}>编辑所选</Button>{hasResourcePermission("order-schedule", "delete") ? <Button danger icon={<DeleteOutlined />} loading={deleting} disabled={!selected.length} onClick={removeSelected}>删除所选 {selected.length} 条</Button> : null}<Button disabled={!selected.length} onClick={() => void selectWholeOrders()}>选中同订单全部记录</Button><DatePicker format={DUE_DATE_DISPLAY_FORMAT} value={batchDate} onChange={setBatchDate} placeholder="批量客户交期" /><Button type="primary" disabled={!selected.length} onClick={() => void applyBatch()}>应用到所选 {selected.length} 条</Button><Button disabled={!selected.length} onClick={() => {setSelected([]);selectedRows.current.clear();}}>清空选择</Button></Space>
    <KdosDataTable resource="order-schedule" rowKey="id" rowSelection={{ selectedRowKeys: selected,preserveSelectedRowKeys:true,onChange:(keys,currentRows)=>{const pageIds=new Set(data.map((row)=>row.id));for(const id of pageIds)selectedRows.current.delete(id);for(const row of currentRows)selectedRows.current.set(row.id,row);setSelected(keys.map(String));} }} loading={rows.isLoading} dataSource={data} columns={columns}
      serverData={{total:pageTotal(rows.data),onQueryChange:setTableQuery}} searchPlaceholder="搜索部门、课室、业务员、客户或订单"
      toolbar={hasResourcePermission("order-schedule", "import") ? <Space wrap>
        <Button onClick={() => void downloadApiFile("/marketing/order-schedules/import-template", "订单排期导入模板.xlsx").catch((error) => setImportError(error.message))}>导出导入模板</Button>
        <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => { void previewExcel(file); return false; }}><Button loading={importBusy}>导入 Excel</Button></Upload>
      </Space> : null}
      scroll={{ x: "max-content", y: "calc(100vh - 365px)" }} />
    {importError && <Alert type="error" showIcon message="导入失败" description={importError} />}
    <Modal title="订单排期导入预览" width={900} open={Boolean(importPreview)} onCancel={() => !importBusy && setImportPreview(undefined)} onOk={() => void confirmExcel()} confirmLoading={importBusy} okText="确认导入" cancelText="取消" okButtonProps={{ disabled: !importPreview?.token || Boolean(importPreview?.errors.length) }}>
      {importError && <Alert type="error" showIcon message="导入失败" description={importError} />}
      <p>共 {importPreview?.total ?? 0} 行；按订单编号 + 品项编码新增或更新。预览最多显示前20行。</p>
      {importPreview?.errors.length ? <KdosDataTable resource="order-schedule-import-errors" systemFields={false} simple rowKey={(row) => `${row.row}:${row.reason}`} dataSource={importPreview.errors} columns={[{ title: "Excel行号", dataIndex: "row" }, { title: "失败原因", dataIndex: "reason" }]} size="small" /> : <KdosDataTable resource="order-schedule-import-preview" systemFields={false} simple rowKey={(row) => JSON.stringify([row.orderNumber, row.itemNumber])} dataSource={importPreview?.rows ?? []} columns={columns.filter((column) => ["customerCode", "orderNumber", "itemNumber", "itemName", "orderTotalQuantity", "customerDueDate"].includes(String(column.dataIndex)))} scroll={{ x: 900 }} size="small" />}
    </Modal>
    <Modal title="编辑订单排期" open={Boolean(editing)} confirmLoading={saving} onCancel={() => { setEditing(undefined); editForm.resetFields(); }} onOk={() => void saveEditing()} destroyOnHidden>
      <Form form={editForm} layout="vertical">
        <Form.Item name="customerCode" label="客户代码" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name="orderNumber" label="订单编号" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name="itemNumber" label="品项编码" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name="itemName" label="品项名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name="customerDueDate" label="客户交期"><DatePicker format={DUE_DATE_DISPLAY_FORMAT} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="orderTotalQuantity" label="订单总数量" rules={[{ required: true, message: "请输入订单总数量" }]}><InputNumber min={0} precision={4} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="productionUnit" label="生产单位"><Input /></Form.Item>
        <Form.Item name="completionRatio" label="订单完成比例（%）" rules={[{ required: true, message: "请输入订单完成比例" }]}><InputNumber min={0} max={100} precision={4} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}><Select options={[{ value: "NORMAL", label: "正常" }, { value: "VOID", label: "作废" }]} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
