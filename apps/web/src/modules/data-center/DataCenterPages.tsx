import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, message, Modal, Space, Upload } from "antd";
import { api, ApiError } from "../../api";
import { ImportFeedbackAlert, InlineText, PageHeader, downloadApiFile, failedImport, type ImportFeedback } from "../../shared/legacy-ui";
import { DUE_DATE_DISPLAY_FORMAT, isDueDateLabel } from "../../shared/date-format";
import { KdosDataTable } from "../../shared/KdosDataTable";

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
  const rows = useQuery({ queryKey: ["data-center-sales-orders"], queryFn: () => api<any[]>("/master-data/sales-orders") });
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
  const columns = salesFields.map((field) => ({
    title: field.label, dataIndex: field.key, width: field.width ?? 150,
    render: (value: unknown, row: any) => <InlineText type={field.type ?? "text"} dateDisplayFormat={isDueDateLabel(field.label) ? DUE_DATE_DISPLAY_FORMAT : undefined} value={value} onSave={(next) => update(row, field.key, next)} />
  }));
  return <div><PageHeader title="订单表" subtitle="字段与 E10 sales_order.sql 的 33 个查询结果一致；支持直接维护及 Excel/CSV 导入" actions={<Space>
    <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增订单</Button>
    <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importFile(file as File)}><Button loading={importing}>导入订单</Button></Upload>
    <Button onClick={() => void downloadApiFile("/master-data/templates/sales-orders?format=xlsx", "订单表导入模板.xlsx")}>下载模板</Button>
  </Space>} />
    <ImportFeedbackAlert value={feedback} onClose={() => setFeedback(undefined)} />
    <KdosDataTable resource="sales-orders" editable rowKey="id" loading={rows.isLoading} dataSource={rows.data} columns={columns} scroll={{ x: "max-content", y: "calc(100vh - 315px)" }} />
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
