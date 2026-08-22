import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, message, Modal, Select, Space, Table, Upload } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { api, ApiError } from "../../api";
import { downloadApiFile, ImportFeedbackAlert, InlineText, PageHeader, failedImport, type ImportFeedback } from "../../shared/legacy-ui";

export function BusinessCustomerMappingsPage() {
  const queryClient = useQueryClient(); const [search, setSearch] = useState(""); const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false); const [feedback, setFeedback] = useState<ImportFeedback>(); const [form] = Form.useForm();
  const rows = useQuery({ queryKey: ["business-customer-mappings", search], queryFn: () => api<any[]>(`/marketing/business-customer-mappings?search=${encodeURIComponent(search)}`) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["business-customer-mappings"] });
  const update = async (row: any, field: string, value: unknown) => { try { await api(`/marketing/business-customer-mappings/${row.id}`, { method: "PATCH", body: JSON.stringify({ ...row, [field]: value, expectedVersion: row.version }) }); refresh(); } catch (error) { message.error((error as Error).message); refresh(); throw error; } };
  const remove = async (row: any) => { await api(`/marketing/business-customer-mappings/${row.id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: row.version }) }); refresh(); };
  const importFile = async (file: File) => { const body = new FormData(); body.append("file", file); setImporting(true); try { const result = await api<{ imported: number; repeated: boolean }>("/marketing/business-customer-mappings/import", { method: "POST", body }); setFeedback({ type: "success", message: result.repeated ? "该文件已经导入，无需重复写入" : `成功导入 ${result.imported} 条业务映射` }); refresh(); } catch (error) { setFeedback(failedImport(error)); } finally { setImporting(false); } return false; };
  const columns = [
    { title: "部门", dataIndex: "department", render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "department", next)} /> },
    { title: "课室", dataIndex: "section", render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "section", next)} /> },
    { title: "业务", dataIndex: "salesperson", render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "salesperson", next)} /> },
    { title: "客户代码", dataIndex: "customerCodes", width: 420, render: (value: unknown, row: any) => <InlineText value={value} onSave={(next) => update(row, "customerCodes", next)} /> },
    { title: "操作", width: 80, render: (_: unknown, row: any) => <Button danger type="text" icon={<DeleteOutlined />} onClick={() => void remove(row)} /> }
  ];
  return <div><PageHeader title="业务人员与客户对应表" subtitle="同一业务对应多个客户时，客户代码使用 | 分隔" actions={<Space wrap>
    <Input.Search allowClear placeholder="搜索部门、课室、业务或客户代码" onSearch={setSearch} style={{ width: 320 }} />
    <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增对应关系</Button>
    <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => importFile(file as File)}><Button loading={importing}>导入业务接单周报</Button></Upload>
    <Button onClick={() => void downloadApiFile("/marketing/business-customer-mappings/export", "业务人员与客户对应表.csv")}>导出 CSV</Button>
  </Space>} />
    <ImportFeedbackAlert value={feedback} onClose={() => setFeedback(undefined)} />
    <Table rowKey="id" loading={rows.isLoading} dataSource={rows.data} columns={columns} pagination={{ pageSize: 50, showTotal: (total) => `共 ${total} 条` }} scroll={{ x: "max-content", y: "calc(100vh - 270px)" }} />
    <Modal title="新增业务与客户对应关系" open={open} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then(async (values) => { await api("/marketing/business-customer-mappings", { method: "POST", body: JSON.stringify(values) }); setOpen(false); form.resetFields(); refresh(); }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={form} layout="vertical"><Form.Item name="department" label="部门" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="section" label="课室"><Input /></Form.Item><Form.Item name="salesperson" label="业务" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="customerCodes" label="客户代码" rules={[{ required: true }]}><Input placeholder="例如 A001|A002" /></Form.Item></Form>
    </Modal>
  </div>;
}

export function OrderSchedulePage() {
  const queryClient = useQueryClient(); const [search, setSearch] = useState(""); const [selected, setSelected] = useState<string[]>([]);
  const [completion, setCompletion] = useState("all"); const [dueRange, setDueRange] = useState<[Dayjs | null, Dayjs | null] | null>(null); const [batchDate, setBatchDate] = useState<Dayjs | null>(null);
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
  const columns = [
    { title: "客户代码", dataIndex: "customerCode", width: 140 }, { title: "订单编号", dataIndex: "orderNumber", width: 170 },
    { title: "品项编码", dataIndex: "itemNumber", width: 170 }, { title: "品项名称", dataIndex: "itemName", width: 260 },
    { title: "客户交期", dataIndex: "customerDueDate", width: 140 }, { title: "订单总数量", dataIndex: "orderTotalQuantity", width: 140 },
    { title: "生产单位", dataIndex: "productionUnit", width: 160 }, { title: "订单完成比例", dataIndex: "completionRatio", width: 150, render: (value: unknown) => `${Number(value ?? 0).toFixed(2)}%` }
  ];
  return <div><PageHeader title="订单排期" subtitle="主计划同步不会覆盖客户交期；支持按订单一键选中全部品项并批量填写交期" actions={<Space wrap>
    <Input.Search allowClear placeholder="搜索客户、订单、品项、生产单位" onSearch={setSearch} style={{ width: 300 }} />
    <Select value={completion} onChange={setCompletion} style={{ width: 130 }} options={[{ value: "all", label: "全部完成度" }, { value: "unfinished", label: "未完成" }, { value: "completed", label: "已完成" }]} />
    <DatePicker.RangePicker value={dueRange} onChange={(value) => setDueRange(value as [Dayjs | null, Dayjs | null] | null)} />
    <Button type="primary" onClick={() => void sync()}>从主计划同步</Button>
    <Button onClick={() => void downloadApiFile("/marketing/order-schedules/export", "订单排期.csv")}>导出 CSV</Button>
  </Space>} />
    <Space style={{ marginBottom: 12 }} wrap><Button disabled={!selected.length} onClick={selectWholeOrders}>选中同订单全部记录</Button><DatePicker value={batchDate} onChange={setBatchDate} placeholder="批量客户交期" /><Button type="primary" disabled={!selected.length} onClick={() => void applyBatch()}>应用到所选 {selected.length} 条</Button><Button disabled={!selected.length} onClick={() => setSelected([])}>清空选择</Button></Space>
    <Table rowKey="id" rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) }} loading={rows.isLoading} dataSource={data} columns={columns} pagination={{ pageSize: 50, showTotal: (total) => `共 ${total} 条` }} scroll={{ x: "max-content", y: "calc(100vh - 310px)" }} />
  </div>;
}
