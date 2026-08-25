import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, message, Modal, Select, Space, Upload } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { api, ApiError } from "../../api";
import { downloadApiFile, ImportFeedbackAlert, InlineText, PageHeader, failedImport, type ImportFeedback } from "../../shared/legacy-ui";
import { DUE_DATE_DISPLAY_FORMAT, formatDueDate } from "../../shared/date-format";
import { KdosDataTable, useKdosTableEditMode } from "../../shared/KdosDataTable";

type DirectoryUser = { id: string; displayName: string; departmentPaths: string[][]; enabled: boolean };

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
  if (!editing) {
    const names = (value ?? []).map((id) => mergedUsers.find((user) => user.id === id)?.displayName ?? id);
    return <span className="kdos-readonly-cell">{names.join("、") || "—"}</span>;
  }
  return <Select
    mode="multiple" showSearch optionFilterProp="label" value={draft} loading={saving} maxTagCount="responsive"
    placeholder="选择通讯录成员" style={{ minWidth: 280, width: "100%" }}
    options={mergedUsers.map((user) => ({ value: user.id, label: user.enabled ? user.displayName : `${user.displayName}（已停用）`, disabled: !user.enabled }))}
    onChange={(ids) => { setDraft(ids); setDirty(true); }} onOpenChange={(open) => { if (!open) void commit(); }}
  />;
}

function MappingDeleteAction({ row, onRemove }: { row: any; onRemove: (row: any) => Promise<void> }) {
  const { editing } = useKdosTableEditMode();
  return editing ? <Button danger type="text" icon={<DeleteOutlined />} aria-label="删除对应关系" onClick={() => void onRemove(row)} /> : null;
}

export function BusinessCustomerMappingsPage() {
  const queryClient = useQueryClient(); const [search, setSearch] = useState(""); const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false); const [feedback, setFeedback] = useState<ImportFeedback>(); const [form] = Form.useForm();
  const rows = useQuery({ queryKey: ["business-customer-mappings", search], queryFn: () => api<any[]>(`/marketing/business-customer-mappings?search=${encodeURIComponent(search)}`) });
  const directory = useQuery({ queryKey: ["marketing-directory-users"], queryFn: () => api<DirectoryUser[]>("/marketing/directory-users") });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["business-customer-mappings"] });
  const update = async (row: any, field: string, value: unknown) => { try { const payload = { department: row.department, section: row.section, customerCode: row.customerCode, salespersonUserIds: row.salespersonUserIds ?? [], [field]: value, expectedVersion: row.version }; await api(`/marketing/business-customer-mappings/${row.id}`, { method: "PATCH", body: JSON.stringify(payload) }); refresh(); } catch (error) { message.error((error as Error).message); refresh(); throw error; } };
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
  const columns = [
    { title: "部门", dataIndex: "department", render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "department", next)} /> },
    { title: "课室", dataIndex: "section", render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "section", next)} /> },
    { title: "客户", dataIndex: "customerCode", width: 180, render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "customerCode", next)} /> },
    { title: "业务员", dataIndex: "salespersonUserIds", width: 360, render: (value: string[], row: any) => <UserMultiSelectCell value={value ?? []} users={directory.data ?? []} selectedUsers={row.salespersonUsers ?? []} onSave={(ids) => update(row, "salespersonUserIds", ids)} /> },
    { title: "操作", width: 80, render: (_: unknown, row: any) => <MappingDeleteAction row={row} onRemove={remove} /> }
  ];
  return <div><PageHeader title="业务人员与客户对应表" subtitle="每个客户一行；业务员从通讯录中多选" actions={<Space wrap>
    <Input.Search allowClear placeholder="搜索部门、课室、客户或业务员" onSearch={setSearch} style={{ width: 320 }} />
    <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增对应关系</Button>
    <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => importFile(file as File)}><Button loading={importing}>导入业务接单周报</Button></Upload>
    <Button onClick={() => void downloadApiFile("/marketing/business-customer-mappings/export", "业务人员与客户对应表.csv")}>导出 CSV</Button>
  </Space>} />
    <ImportFeedbackAlert value={feedback} onClose={() => setFeedback(undefined)} />
    <KdosDataTable resource="business-customer-mapping" editable rowKey="id" loading={rows.isLoading} dataSource={rows.data} columns={columns} scroll={{ x: "max-content", y: "calc(100vh - 325px)" }} />
    <Modal title="新增业务与客户对应关系" open={open} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then(async (values) => { await api("/marketing/business-customer-mappings", { method: "POST", body: JSON.stringify({ ...values, salespersonUserIds: values.salespersonUserIds ?? [] }) }); setOpen(false); form.resetFields(); refresh(); }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={form} layout="vertical"><Form.Item name="department" label="部门" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="section" label="课室"><Input /></Form.Item><Form.Item name="customerCode" label="客户" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="salespersonUserIds" label="业务员"><Select mode="multiple" showSearch optionFilterProp="label" placeholder="从通讯录选择，可多选" options={(directory.data ?? []).map((user) => ({ value: user.id, label: user.displayName }))} /></Form.Item></Form>
    </Modal>
  </div>;
}

export function OrderSchedulePage() {
  const queryClient = useQueryClient(); const [search, setSearch] = useState(""); const [selected, setSelected] = useState<string[]>([]);
  const [completion, setCompletion] = useState("all"); const [dueRange, setDueRange] = useState<[Dayjs | null, Dayjs | null] | null>(null); const [batchDate, setBatchDate] = useState<Dayjs | null>(null);
  const [editing, setEditing] = useState<any>(); const [saving, setSaving] = useState(false); const [editForm] = Form.useForm();
  const rows = useQuery({ queryKey: ["order-schedules", search], queryFn: () => api<any[]>(`/marketing/order-schedules?search=${encodeURIComponent(search)}`) });
  const refresh = () => { setSelected([]); void queryClient.invalidateQueries({ queryKey: ["order-schedules"] }); };
  const data = (rows.data ?? []).filter((row) => {
    const ratio = Number(row.completionRatio ?? 0); if (completion === "unfinished" && ratio >= 100) return false; if (completion === "completed" && ratio < 100) return false;
    if (!dueRange?.[0] && !dueRange?.[1]) return true; if (!row.customerDueDate) return false;
    const due = dayjs(row.customerDueDate); return (!dueRange[0] || !due.isBefore(dueRange[0], "day")) && (!dueRange[1] || !due.isAfter(dueRange[1], "day"));
  });
  const applyBatch = async () => {
    if (!selected.length) return message.warning("请先选择排期记录");
    const selectedRows = (rows.data ?? []).filter((row) => selected.includes(row.id));
    await api("/marketing/order-schedules/batch-due-date", { method: "PATCH", body: JSON.stringify({ rows: selectedRows.map((row) => ({ id: row.id, expectedVersion: row.version })), customerDueDate: batchDate?.format("YYYY-MM-DD") ?? null }) });
    message.success(`已批量更新 ${selectedRows.length} 条客户交期`); setBatchDate(null); refresh();
  };
  const sync = async () => { const result = await api<{ synced: number }>("/marketing/order-schedules/sync-from-planning", { method: "POST" }); message.success(`已从主计划同步 ${result.synced} 条，原客户交期保持不变`); refresh(); };
  const selectWholeOrders = () => { const orders = new Set((rows.data ?? []).filter((row) => selected.includes(row.id)).map((row) => row.orderNumber)); setSelected((rows.data ?? []).filter((row) => orders.has(row.orderNumber)).map((row) => row.id)); };
  const openEditor = () => {
    const row = (rows.data ?? []).find((item) => item.id === selected[0]); if (!row) return;
    setEditing(row); editForm.setFieldsValue({ ...row, customerDueDate: row.customerDueDate ? dayjs(row.customerDueDate) : null, orderTotalQuantity: Number(row.orderTotalQuantity), completionRatio: Number(row.completionRatio) });
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
    { title: "客户代码", dataIndex: "customerCode", width: 140 }, { title: "订单编号", dataIndex: "orderNumber", width: 170 },
    { title: "品项编码", dataIndex: "itemNumber", width: 170 }, { title: "品项名称", dataIndex: "itemName", width: 260 },
    { title: "客户交期", dataIndex: "customerDueDate", width: 140, render: (value: unknown) => formatDueDate(value) }, { title: "订单总数量", dataIndex: "orderTotalQuantity", width: 140 },
    { title: "生产单位", dataIndex: "productionUnit", width: 160 }, { title: "订单完成比例", dataIndex: "completionRatio", width: 150, render: (value: unknown) => `${Number(value ?? 0).toFixed(2)}%` }
  ];
  return <div><PageHeader title="订单排期" subtitle="主计划同步不会覆盖客户交期；支持按订单一键选中全部品项并批量填写交期" actions={<Space wrap>
    <Input.Search allowClear placeholder="搜索客户、订单、品项、生产单位" onSearch={setSearch} style={{ width: 300 }} />
    <Select value={completion} onChange={setCompletion} style={{ width: 130 }} options={[{ value: "all", label: "全部完成度" }, { value: "unfinished", label: "未完成" }, { value: "completed", label: "已完成" }]} />
    <DatePicker.RangePicker format={DUE_DATE_DISPLAY_FORMAT} value={dueRange} onChange={(value) => setDueRange(value as [Dayjs | null, Dayjs | null] | null)} />
    <Button type="primary" onClick={() => void sync()}>从主计划同步</Button>
    <Button onClick={() => void downloadApiFile("/marketing/order-schedules/export", "订单排期.csv")}>导出 CSV</Button>
  </Space>} />
    <Space style={{ marginBottom: 12 }} wrap><Button disabled={selected.length !== 1} onClick={openEditor}>编辑所选</Button><Button disabled={!selected.length} onClick={selectWholeOrders}>选中同订单全部记录</Button><DatePicker format={DUE_DATE_DISPLAY_FORMAT} value={batchDate} onChange={setBatchDate} placeholder="批量客户交期" /><Button type="primary" disabled={!selected.length} onClick={() => void applyBatch()}>应用到所选 {selected.length} 条</Button><Button disabled={!selected.length} onClick={() => setSelected([])}>清空选择</Button></Space>
    <KdosDataTable resource="order-schedule" rowKey="id" rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) }} loading={rows.isLoading} dataSource={data} columns={columns} scroll={{ x: "max-content", y: "calc(100vh - 365px)" }} />
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
      </Form>
    </Modal>
  </div>;
}
