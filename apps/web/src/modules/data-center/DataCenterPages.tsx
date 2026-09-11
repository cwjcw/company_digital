import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, message, Modal, Space, Tag, Upload } from "antd";
import { api, ApiError } from "../../api";
import { ImportFeedbackAlert, InlineText, PageHeader, downloadApiFile, failedImport, type ImportFeedback } from "../../shared/legacy-ui";
import { DUE_DATE_DISPLAY_FORMAT, isDueDateLabel } from "../../shared/date-format";
import { hasFieldPermission, KdosDataTable } from "../../shared/KdosDataTable";
import { useAuditColumns } from "../../shared/audit-fields";

type ServerTableQuery = { page: number; pageSize: number; search: string; filters: Record<string, string>; sortField?: string; sortOrder?: "asc" | "desc" };
type ServerTablePage<T> = { rows: T[]; total: number; page: number; pageSize: number };
const initialTableQuery: ServerTableQuery = { page: 1, pageSize: 50, search: "", filters: {} };
const pageUrl = (path: string, query: ServerTableQuery) => {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set("search", query.search);
  if (Object.values(query.filters).some((value) => value.trim())) params.set("filters", JSON.stringify(query.filters));
  if (query.sortField) params.set("sortField", query.sortField);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  return `${path}?${params}`;
};

type SalesField = { key: string; label: string; type?: "date" | "number"; width?: number; required?: boolean };
const salesFields: SalesField[] = [
  { key: "documentDate", label: "单据日期", type: "date" }, { key: "orderDate", label: "订单日期", type: "date" },
  { key: "orderNumber", label: "订单编号", required: true }, { key: "documentName", label: "单据名称" }, { key: "closeStatus", label: "关闭状态" },
  { key: "customerCode", label: "客户代码" }, { key: "shipToCustomerCode", label: "送货客户代码" }, { key: "invoiceCustomerCode", label: "开票客户代码" },
  { key: "employeeName", label: "业务员" }, { key: "taxIncluded", label: "含税标识" }, { key: "currencyCode", label: "币种" },
  { key: "exchangeRate", label: "汇率", type: "number" }, { key: "sequenceNumber", label: "序号", type: "number" },
  { key: "itemNumber", label: "品项编码", required: true }, { key: "itemName", label: "品项名称", width: 240 }, { key: "specification", label: "规格", width: 200 },
  { key: "unitName", label: "业务单位" }, { key: "businessQuantity", label: "订单数量", type: "number" }, { key: "priceQuantity", label: "计价数量", type: "number" },
  { key: "price", label: "单价", type: "number" }, { key: "rmbPrice", label: "人民币单价", type: "number" }, { key: "rmbTaxIncludedAmount", label: "人民币含税价", type: "number" },
  { key: "deliveredBusinessQuantity", label: "已交数量", type: "number" }, { key: "plannedDeliveryDate", label: "计划交期", type: "date" },
  { key: "taxRate", label: "税率", type: "number" }, { key: "amountExcludingTaxBc", label: "本币未税金额", type: "number" }, { key: "taxBc", label: "本币税额", type: "number" },
  { key: "creatorUserId", label: "制单人编号" }, { key: "creatorUserName", label: "制单人" }, { key: "adminUnitName", label: "管理单位" },
  { key: "ownerDepartment", label: "责任部门" }, { key: "ownerEmployee", label: "责任业务" }, { key: "ownerDivision", label: "责任事业部" }
];

export function SalesOrdersPage() {
  const queryClient = useQueryClient();
  const [tableQuery, setTableQuery] = useState<ServerTableQuery>(initialTableQuery);
  const rows = useQuery({
    queryKey: ["data-center-sales-orders", tableQuery],
    queryFn: () => api<ServerTablePage<any>>(pageUrl("/master-data/sales-orders", tableQuery)),
    placeholderData: (previous) => previous
  });
  const [open, setOpen] = useState(false); const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<ImportFeedback>(); const [form] = Form.useForm();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["data-center-sales-orders"] });
  const update = async (row: any, field: string, value: unknown) => {
    try { await api(`/master-data/sales-orders/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.version }) }); refresh(); }
    catch (error) { message.error((error as Error).message); refresh(); throw error; }
  };
  const importFile = async (file: File) => {
    const body = new FormData(); body.append("file", file); setImporting(true);
    try { const result = await api<{ imported: number }>("/master-data/sales-orders/import-file", { method: "POST", body }); setFeedback({ type: "success", message: `成功导入 ${result.imported} 行` }); refresh(); }
    catch (error) { setFeedback(failedImport(error)); } finally { setImporting(false); }
    return false;
  };
  const columns = [
    { title: "来源系统", dataIndex: "sourceSystem", width: 120 },
    { title: "来源数据库/账套", dataIndex: "sourceDatabase", width: 220 },
    { title: "来源主键", dataIndex: "sourceKey", width: 240 },
    ...salesFields.map((field) => ({
    title: field.label, dataIndex: field.key, width: field.width ?? 150,
    render: (value: unknown, row: any) => <InlineText type={field.type ?? "text"} dateDisplayFormat={isDueDateLabel(field.label) ? DUE_DATE_DISPLAY_FORMAT : undefined} value={value} onSave={(next) => update(row, field.key, next)} />
    }))
  ];
  return <div><PageHeader title="订单表" subtitle="统一展示 E10、T+凯南智能、T+科加智能的全部客户订单；来源字段只读可追溯" actions={<Space>
    <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增订单</Button>
    <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importFile(file as File)}><Button loading={importing}>导入订单</Button></Upload>
    <Button onClick={() => void downloadApiFile("/master-data/templates/sales-orders?format=xlsx", "订单表导入模板.xlsx")}>下载模板</Button>
  </Space>} />
    <ImportFeedbackAlert value={feedback} onClose={() => setFeedback(undefined)} />
    <KdosDataTable resource="sales-orders" editable rowKey="id" loading={rows.isLoading} dataSource={rows.data?.rows} columns={columns}
      serverData={{ total: rows.data?.total ?? 0, onQueryChange: setTableQuery }}
      scroll={{ x: "max-content", y: "calc(100vh - 315px)" }} />
    <Modal title="新增订单" width={1000} open={open} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then(async (values) => {
      const payload = Object.fromEntries(Object.entries(values).map(([key, value]: [string, any]) => [key, value?.format ? value.format("YYYY-MM-DD") : value]));
      await api("/master-data/sales-orders", { method: "POST", body: JSON.stringify(payload) });
      setOpen(false); form.resetFields(); message.success("订单已新增"); refresh();
    }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={form} layout="vertical" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0 16px", maxHeight: "62vh", overflowY: "auto" }}>{salesFields.map((field) =>
        <Form.Item key={field.key} name={field.key} label={field.label} rules={field.required ? [{ required: true }] : undefined}>
          {field.type === "date" ? <DatePicker format={isDueDateLabel(field.label) ? DUE_DATE_DISPLAY_FORMAT : undefined} style={{ width: "100%" }} /> : field.type === "number" ? <InputNumber precision={field.key === "sequenceNumber" ? 0 : 6} style={{ width: "100%" }} /> : <Input />}
        </Form.Item>
      )}</Form>
    </Modal>
  </div>;
}

type OutboundField = { key: string; label: string; type?: "date" | "number"; width?: number; required?: boolean };
const outboundFields: OutboundField[] = [
  { key: "documentDate", label: "单据日期", type: "date" }, { key: "documentNumber", label: "出库单号", required: true, width: 190 },
  { key: "documentStatus", label: "单据状态" }, { key: "directionValue", label: "出入库方向值", type: "number" },
  { key: "voucherType", label: "单据类型" }, { key: "businessType", label: "业务类型" },
  { key: "customerCode", label: "客户代码" }, { key: "customerName", label: "客户名称", width: 220 },
  { key: "salesOrderNumber", label: "销售订单号", width: 190 }, { key: "itemNumber", label: "品项编码", required: true, width: 190 },
  { key: "itemName", label: "品项名称", width: 260 }, { key: "specification", label: "规格型号", width: 200 },
  { key: "quantity", label: "出库数量", type: "number" }, { key: "unit", label: "计量单位" },
  { key: "unitPrice", label: "单价", type: "number" }, { key: "totalAmount", label: "金额", type: "number" },
  { key: "warehouseCode", label: "仓库编码" }, { key: "warehouse", label: "仓库名称" },
  { key: "sourceDocumentNumber", label: "来源单号", width: 190 }, { key: "creator", label: "制单人" },
  { key: "auditor", label: "审核人" }, { key: "remark", label: "备注", width: 260 }
];

export function FinishedGoodsOutboundPage() {
  const queryClient = useQueryClient();
  const [tableQuery, setTableQuery] = useState<ServerTableQuery>(initialTableQuery);
  const rows = useQuery({
    queryKey: ["finished-goods-outbound", tableQuery],
    queryFn: () => api<ServerTablePage<any>>(pageUrl("/master-data/finished-goods-outbound", tableQuery)),
    placeholderData: (previous) => previous
  });
  const [open, setOpen] = useState(false); const [form] = Form.useForm();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finished-goods-outbound"] });
  const update = async (row: any, field: string, value: unknown) => {
    try { await api(`/master-data/finished-goods-outbound/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.version }) }); refresh(); }
    catch (error) { message.error((error as Error).message); refresh(); throw error; }
  };
  const columns = [
    { title: "来源系统", dataIndex: "sourceSystem", width: 120 },
    { title: "来源数据库/账套", dataIndex: "sourceDatabase", width: 220 },
    { title: "来源主键", dataIndex: "sourceKey", width: 240 },
    ...outboundFields.map((field) => ({ title: field.label, dataIndex: field.key, width: field.width ?? 150,
    render: (value: unknown, row: any) => <InlineText type={field.type ?? "text"} dateDisplayFormat={field.type === "date" ? DUE_DATE_DISPLAY_FORMAT : undefined}
      value={value} onSave={(next) => update(row, field.key, next)} /> }))
  ];
  return <div><PageHeader title="出库表" subtitle="统一展示三个来源的出库明细；保留来源账套和源主键，不稳定关联不自动冲减订单欠数" actions={<Space>
    <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增出库记录</Button>
    <Button onClick={() => void downloadApiFile("/master-data/finished-goods-outbound/export", "出库数据.xlsx")}>导出 XLSX</Button>
  </Space>} />
    <KdosDataTable resource="finished-goods-outbound" editable rowKey="id" loading={rows.isLoading} dataSource={rows.data?.rows} columns={columns}
      serverData={{ total: rows.data?.total ?? 0, onQueryChange: setTableQuery }}
      scroll={{ x: "max-content", y: "calc(100vh - 300px)" }} />
    <Modal title="新增出库记录" width={1080} open={open} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then(async (values) => {
      const payload = Object.fromEntries(Object.entries(values).map(([key, value]: [string, any]) => [key, value?.format ? value.format("YYYY-MM-DD") : value]));
      await api("/master-data/finished-goods-outbound", { method: "POST", body: JSON.stringify(payload) });
      setOpen(false); form.resetFields(); message.success("出库记录新增成功"); refresh();
    }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={form} layout="vertical" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0 16px", maxHeight: "62vh", overflowY: "auto" }}>
        {outboundFields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} rules={field.required ? [{ required: true }] : undefined}>
          {field.type === "date" ? <DatePicker format={DUE_DATE_DISPLAY_FORMAT} style={{ width: "100%" }} /> : field.type === "number" ? <InputNumber precision={field.key === "directionValue" ? 0 : 6} style={{ width: "100%" }} /> : <Input />}
        </Form.Item>)}
      </Form>
    </Modal>
  </div>;
}

const supplierColumns = [
  { title: "来源系统", dataIndex: "sourceSystem", width: 100 },
  { title: "来源数据库", dataIndex: "sourceDatabase", width: 190 },
  { title: "来源账套", dataIndex: "sourceAccountName", width: 120 },
  { title: "来源主键", dataIndex: "sourceId", width: 150 },
  { title: "供应商编码", dataIndex: "code", width: 150, fixed: "left" as const },
  { title: "供应商名称", dataIndex: "name", width: 260, fixed: "left" as const },
  { title: "供应商简称", dataIndex: "abbreviation", width: 220 },
  { title: "助记码", dataIndex: "shorthand", width: 140 },
  { title: "分类编码", dataIndex: "categoryCode", width: 130 },
  { title: "供应商分类", dataIndex: "categoryName", width: 180 },
  { title: "往来单位类型", dataIndex: "partnerTypeLabel", width: 140 },
  { title: "法人代表", dataIndex: "representative", width: 140 },
  { title: "联系人", dataIndex: "contact", width: 140 },
  { title: "手机", dataIndex: "mobilePhone", width: 150 },
  { title: "电话", dataIndex: "telephone", width: 170 },
  { title: "传真", dataIndex: "fax", width: 170 },
  { title: "邮箱", dataIndex: "email", width: 220 },
  { title: "地址", dataIndex: "address", width: 320 },
  { title: "状态", dataIndex: "enabled", width: 90, render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? "启用" : "停用"}</Tag> },
  { title: "T+更新时间", dataIndex: "sourceUpdatedAt", width: 180 }
];

export function SupplierListPage() {
  const [tableQuery, setTableQuery] = useState<ServerTableQuery>(initialTableQuery);
  const auditColumns = useAuditColumns();
  const rows = useQuery({
    queryKey: ["supplier-list", tableQuery],
    queryFn: () => api<ServerTablePage<any>>(pageUrl("/supply-chain/suppliers", tableQuery)),
    placeholderData: (previous) => previous
  });
  const visibleColumns = [...supplierColumns, ...auditColumns].filter((column) =>
    hasFieldPermission("supplier-list", String(column.dataIndex), "read")
  );
  return <div>
    <PageHeader title="供应商清单" subtitle="来源于 T+ 凯南智能、科加智能账套；清单只读并保留来源追溯信息" />
    <KdosDataTable resource="supplier-list" systemFields={false} rowKey="id" loading={rows.isLoading}
      dataSource={rows.data?.rows} columns={visibleColumns}
      serverData={{ total: rows.data?.total ?? 0, onQueryChange: setTableQuery }}
      scroll={{ x: "max-content", y: "calc(100vh - 300px)" }} />
  </div>;
}
