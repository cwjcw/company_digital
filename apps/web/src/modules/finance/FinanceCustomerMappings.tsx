import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, message, Modal, Select, Space, Switch, Typography } from "antd";
import dayjs from "dayjs";
import { financeDepartmentOptions, financeSalesChannelOptions, FINANCE_CUSTOMER_RESOURCE as resource, type FinanceCustomerMapping } from "@kdos/contracts";
import { api } from "../../api";
import { hasFieldPermission, hasResourcePermission, KdosDataTable, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import { useAuditColumns } from "../../shared/audit-fields";
import type { AdvancedFilterGroup } from "../../shared/advanced-filter";
type Row = FinanceCustomerMapping & Record<string, unknown>;
type Query = {
    page: number;
    pageSize: number;
    search: string;
    filters: Record<string, string>;
    filterGroup?: AdvancedFilterGroup;
    sortField?: string;
    sortOrder?: "asc" | "desc";
};
export function FinanceCustomerMappings() {
    const client = useQueryClient();
    const auditColumns = useAuditColumns();
    const canRead = hasResourcePermission(resource, "read");
    const canUpdate = hasResourcePermission(resource, "update");
    const fields = ["departmentCategory", "salesChannel"] as const;
    const pendingReadable = fields.every(k => hasFieldPermission(resource, k, "read"));
    const [query, setQuery] = useState<Query>({ page: 1, pageSize: kdosDefaultPageSize, search: "", filters: {} });
    const [pending, setPending] = useState(false);
    const [selected, setSelected] = useState<Row | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [form] = Form.useForm();
    const contextFilterGroup: AdvancedFilterGroup | undefined = pending ? { logic: "OR", rules: fields.map(field => ({ field, operator: "is_empty" })) } : undefined;
    // KdosDataTable reports its own predicates; apply the page pending predicate to the same rows/export condition.
    const appliedFilterGroup = contextFilterGroup ? { logic: "AND", rules: [], groups: [...(query.filterGroup ? [query.filterGroup] : []), contextFilterGroup] } : query.filterGroup;
    const params = new URLSearchParams({ resource, page: String(query.page), pageSize: String(query.pageSize) });
    if (query.search)
        params.set("search", query.search);
    if (appliedFilterGroup)
        params.set("filterGroup", JSON.stringify(appliedFilterGroup));
    if (query.sortField)
        params.set("sortField", query.sortField);
    if (query.sortOrder)
        params.set("sortOrder", query.sortOrder);
    const rows = useQuery({ queryKey: ["finance-customers", query, pending], queryFn: () => api<{
            rows: Row[];
            total: number;
        }>(`/table-filters/rows?${params}`), enabled: canRead, placeholderData: previous => previous });
    const summary = useQuery({ queryKey: ["finance-customer-summary"], queryFn: () => api<{
            total: number;
            pending: number | null;
            lastSync: {
                completedAt: string;
                created: number;
            } | null;
        }>("/finance/customer-mappings/summary"), enabled: canRead });
    const refresh = async () => { await Promise.all([client.invalidateQueries({queryKey:["finance-order-revision"]}),client.invalidateQueries({ queryKey: ["finance-customers"] }), client.invalidateQueries({ queryKey: ["finance-customer-summary"] }),client.invalidateQueries({queryKey:["finance-orders"]}),client.invalidateQueries({queryKey:["finance-dashboard"]}),client.invalidateQueries({queryKey:["finance-ranking"]})]); };
    const open = (row: Row) => { if (!canUpdate)
        return; setSelected(row); setError(""); form.setFieldsValue(row); };
    const save = async () => {
        if (!selected || saving)
            return;
        try {
            const values = await form.validateFields();
            setSaving(true);
            setError("");
            const body: Record<string, unknown> = { expectedVersion: selected.version };
            for (const k of fields)
                if (hasFieldPermission(resource, k, "update"))
                    body[k] = values[k] ?? null;
            await api(`/finance/customer-mappings/${selected.id}`, { method: "PATCH", body: JSON.stringify(body) });
            setSelected(null);
            message.success("客户分类已保存");
            await refresh();
        }
        catch (e) {
            setError((e as Error).message || "保存失败，请重试");
        }
        finally {
            setSaving(false);
        }
    };
    if (!canRead)
        return <Alert type="warning" message="当前权限组不能查看客户对应表"/>;
    return <div style={{ maxWidth: 1320, marginInline: "auto" }}>
    <Space wrap style={{ marginBottom: 12 }}>
      <Typography.Text>客户总数 {summary.data?.total ?? "—"}</Typography.Text>
      {summary.data?.pending != null && <Typography.Text>待分类 {summary.data.pending}</Typography.Text>}
      {summary.data?.lastSync && <Typography.Text type="secondary">最近同步 {dayjs(summary.data.lastSync.completedAt).format("YYYY-MM-DD HH:mm")} · 新增 {summary.data.lastSync.created}</Typography.Text>}
    </Space>
    {(rows.error || summary.error) && <Alert type="error" showIcon message={(rows.error || summary.error as Error)?.message} style={{ marginBottom: 12 }}/>}
    <KdosDataTable<Row> resource={resource} rowKey="id" loading={rows.isLoading} dataSource={rows.data?.rows} contextFilterGroup={contextFilterGroup} columns={[{ title: "客户编号", dataIndex: "customerCode", width: 180 }, { title: "部门类别", dataIndex: "departmentCategory", width: 160 }, { title: "内外区分", dataIndex: "salesChannel", width: 140 }, ...auditColumns]} toolbar={pendingReadable ? <Space>待分类<Switch aria-label="仅查看待分类" checked={pending} onChange={setPending}/></Space> : undefined} selectionActions={({ selectedRows, selectedRowKeys }) => canUpdate && fields.some(k => hasFieldPermission(resource, k, "update")) ? <Button disabled={selectedRowKeys.length !== 1 || selectedRows.length !== 1} onClick={() => open(selectedRows[0]!)}>修改分类</Button> : null} onRow={row => ({ onDoubleClick: () => open(row) })} serverData={{ total: rows.data?.total ?? 0, onQueryChange: setQuery }} scroll={{ x: "max-content" }}/>
    <Modal okText="保存" cancelText="取消" title="修改客户分类" open={selected !== null} onCancel={() => { if (!saving)
        setSelected(null); }} onOk={() => void save()} confirmLoading={saving} maskClosable={!saving} cancelButtonProps={{ disabled: saving }}>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }}/>}
      <Form form={form} layout="vertical">
        {hasFieldPermission(resource, "customerCode", "read") && <Form.Item label="客户编号" name="customerCode"><Input disabled/></Form.Item>}
        {fields.filter(k => hasFieldPermission(resource, k, "read")).map(k => <Form.Item key={k} label={k === "departmentCategory" ? "部门类别" : "内外区分"} name={k}>
          <Select allowClear disabled={saving || !hasFieldPermission(resource, k, "update")} options={k === "departmentCategory" ? financeDepartmentOptions : financeSalesChannelOptions}/>
        </Form.Item>)}
      </Form>
    </Modal>
  </div>;
}
