import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, message, Modal, Popconfirm, Select, Space, Switch, Tabs, Tag } from "antd";
import dayjs from "dayjs";
import { masterPlanResourceDefinitions, type TablePermissionFieldDefinition } from "@kdos/contracts";
import { api } from "../../api";
import { hasFieldPermission, hasResourcePermission, KdosDataTable, useKdosTableEditMode } from "../../shared/KdosDataTable";
import { PageHeader } from "../../shared/legacy-ui";
import { OrganizationSelect, type OrganizationSelectOption } from "../../shared/OrganizationSelect";
import type { AuditDirectoryUser } from "../../shared/audit-fields";

type TableQuery = { page: number; pageSize: number; search: string; filters: Record<string, string>; sortField?: string; sortOrder?: "asc" | "desc" };
type Metadata = { resource: string; fields: TablePermissionFieldDefinition[]; actions: { create: boolean; update: boolean; delete: boolean } };
const initialQuery: TableQuery = { page: 1, pageSize: 50, search: "", filters: {} };
const auditFields = new Set(["createdBy", "createdAt", "updatedBy", "updatedAt"]);
const definitionMap = new Map(masterPlanResourceDefinitions.map((entry) => [entry.code, entry]));

const dictionaryOptions: Record<string, string[]> = {
  manufacturingMethod: ["自制", "中心外购", "外协", "自制+外协"], materialName: ["五金", "木作"],
  outsourcingMethod: ["成品", "毛坯", "部件"], status: ["已完成", "未完成", "延期"],
  processCode: ["cutting", "machining", "bending", "spotWelding", "welding", "woodworking", "grinding", "surfaceTreatment", "packaging"]
};

function pageUrl(resource: string, query: TableQuery, view: string) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), view });
  if (query.search) params.set("search", query.search);
  if (Object.values(query.filters).some((value) => value.trim())) params.set("filters", JSON.stringify(query.filters));
  if (query.sortField) params.set("sortField", query.sortField);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  return `/master-plan-system/resources/${resource}?${params}`;
}

function FieldInput({ field, organizations = [], users = [], ...control }: { field: TablePermissionFieldDefinition; organizations?: OrganizationSelectOption[]; users?: AuditDirectoryUser[] } & Record<string, any>) {
  if (field.type === "boolean") return <Switch {...control} />;
  if (field.type === "number") return <InputNumber {...control} min={0} precision={field.key.includes("Days") || ["deliveryNumber", "intervalMinutes", "plannedPageCount", "orderWeekCount"].includes(field.key) ? 0 : 4} style={{ width: "100%" }} />;
  if (field.type === "date") return <DatePicker {...control} style={{ width: "100%" }} />;
  if (field.type === "dictionary" && dictionaryOptions[field.key]) return <Select {...control} options={dictionaryOptions[field.key]!.map((value) => ({ label: value, value }))} />;
  if (field.type === "department") return <OrganizationSelect {...control} organizations={organizations} placeholder="选择完整组织路径" />;
  if (field.type === "member") return <Select {...control} showSearch optionFilterProp="label" allowClear placeholder="选择成员" options={users.filter((user) => user.enabled).map((user) => ({ value: user.id, label: user.displayName?.trim() || user.username }))} />;
  return <Input.TextArea {...control} autoSize={{ minRows: 1, maxRows: 4 }} />;
}

function display(value: unknown, field: TablePermissionFieldDefinition, row: any) {
  if (field.type === "boolean") return <Tag color={value ? "success" : "default"}>{value ? "是" : "否"}</Tag>;
  if (field.type === "department" && row.divisionName) return row.divisionName;
  if (field.type === "date" && value) return dayjs(String(value)).format("YYYY-MM-DD");
  if (field.key === "completionRate") return `${Math.round(Number(value || 0) * 100)}%`;
  if (value && typeof value === "object") return JSON.stringify(value);
  return value == null || value === "" ? "—" : String(value);
}

const processGroups = [
  ["cutting", "下料"], ["machining", "机加"], ["bending", "折弯"], ["spotWelding", "点焊"], ["welding", "焊接"],
  ["woodworking", "木作"], ["grinding", "研磨"], ["surfaceTreatment", "表面处理"], ["packaging", "包装"]
] as const;

function groupedColumns(resource: string, fields: TablePermissionFieldDefinition[]) {
  const column = (field: TablePermissionFieldDefinition) => ({
    title: field.label.includes("·") ? field.label.split("·")[1] : field.label,
    dataIndex: field.key,
    width: Math.max(105, Math.min(240, field.label.length * 18 + 54)),
    render: (value: unknown, row: any) => display(value, field, row)
  });
  if (!["mps-monthly-plans", "mps-weekly-plans"].includes(resource)) return fields.map(column);
  const grouped = new Set<string>(); const groups: any[] = [];
  if (resource === "mps-weekly-plans") {
    const auxiliary: Array<[string, string[]]> = [
      ["外协计划", ["outsourcingCycleDays", "outsourcingDueDate", "outsourcingStatus", "outsourcingException", "outsourcingActualInboundDate"]],
      ["技术/图纸计划", ["technicalCycleDays", "drawingDueDate", "technicalStatus", "technicalException"]],
      ["五金主材计划", ["hardwareCycleDays", "hardwareDueDate", "hardwareStatus", "hardwareException"]],
      ["木作主材计划", ["woodCycleDays", "woodDueDate", "woodStatus", "woodException"]]
    ];
    for (const [title, keys] of auxiliary) {
      const children = fields.filter((field) => keys.includes(field.key)); children.forEach((field) => grouped.add(field.key));
      if (children.length) groups.push({ title, children: children.map(column) });
    }
  }
  for (const [prefix, title] of processGroups) {
    const children = fields.filter((field) => ["CycleDays", "DueDate", "Status", "Exception"].some((suffix) => field.key === `${prefix}${suffix}`));
    children.forEach((field) => grouped.add(field.key)); if (children.length) groups.push({ title, children: children.map(column) });
  }
  return [...fields.filter((field) => !grouped.has(field.key)).map(column), ...groups];
}

function RowActions({ row, metadata, onEdit, onDelete, onSync }: { row: any; metadata: Metadata; onEdit: () => void; onDelete: () => void; onSync?: () => void }) {
  const { editing } = useKdosTableEditMode();
  if (!editing) return <span className="kdos-readonly-cell">只读浏览</span>;
  return <Space size={4}>
    {metadata.actions.update && <Button size="small" onClick={onEdit}>编辑</Button>}
    {onSync && <Button size="small" type="primary" onClick={onSync}>立即同步</Button>}
    {metadata.actions.delete && <Popconfirm title="确认删除这条记录？" onConfirm={onDelete}><Button size="small" danger>删除</Button></Popconfirm>}
  </Space>;
}

export function MasterPlanResourcePage({ resource }: { resource: string }) {
  const info = definitionMap.get(resource as any);
  const queryClient = useQueryClient(); const [tableQuery, setTableQuery] = useState(initialQuery); const [view, setView] = useState("ALL");
  const [form] = Form.useForm(); const [modal, setModal] = useState<{ mode: "create" | "edit"; row?: any } | null>(null);
  const organizations = useQuery({ queryKey: ["planning-organization-options"], queryFn: () => api<OrganizationSelectOption[]>("/planning/organization-options"), staleTime: 300_000 });
  const users = useQuery({ queryKey: ["mps-directory-users"], queryFn: () => api<AuditDirectoryUser[]>("/directory/users"), staleTime: 300_000 });
  const metadata = useQuery({ queryKey: ["mps-meta", resource], queryFn: () => api<Metadata>(`/master-plan-system/resources/${resource}/meta`) });
  const rows = useQuery({ queryKey: ["mps-rows", resource, tableQuery, view], queryFn: () => api<{ rows: any[]; total: number }>(pageUrl(resource, tableQuery, view)), placeholderData: (previous) => previous, enabled: Boolean(metadata.data) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["mps-rows", resource] });
  const editableFields = (metadata.data?.fields ?? []).filter((field) => field.editable && hasFieldPermission(resource, field.key, "update"));
  const openCreate = () => { form.resetFields(); setModal({ mode: "create" }); };
  const openEdit = (row: any) => {
    form.resetFields();
    form.setFieldsValue(Object.fromEntries(editableFields.map((field) => [field.key, field.type === "date" && row[field.key] ? dayjs(row[field.key]) : row[field.key]])));
    setModal({ mode: "edit", row });
  };
  const save = async () => {
    const values = await form.validateFields();
    const payload = Object.fromEntries(Object.entries(values).map(([key, value]: [string, any]) => [key, value?.format ? value.format("YYYY-MM-DD") : value]));
    if (modal?.mode === "edit") await api(`/master-plan-system/resources/${resource}/${modal.row.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, expectedVersion: modal.row.version }) });
    else await api(`/master-plan-system/resources/${resource}`, { method: "POST", body: JSON.stringify(payload) });
    message.success(modal?.mode === "edit" ? "修改成功" : "新增成功"); setModal(null); refresh();
  };
  const syncMutation = useMutation({ mutationFn: (syncKey: string) => api<{ count: number }>(`/master-plan-system/sync/${syncKey}`, { method: "POST" }), onSuccess: (result) => { message.success(`同步完成，共处理 ${result.count} 条变更`); refresh(); void queryClient.invalidateQueries({ queryKey: ["mps-rows"] }); }, onError: (error) => message.error((error as Error).message) });
  const businessFields = (metadata.data?.fields ?? []).filter((field) => !auditFields.has(field.key));
  const columns = useMemo(() => groupedColumns(resource, businessFields), [businessFields, resource]);
  if (!info) return null;
  const withActions = metadata.data && (metadata.data.actions.update || metadata.data.actions.delete) ? [...columns, {
    title: "操作", key: "actions", width: resource === "mps-sync-configs" ? 190 : 130, fixed: "right" as const,
    render: (_: unknown, row: any) => <RowActions row={row} metadata={metadata.data!} onEdit={() => openEdit(row)}
      onDelete={async () => { try { await api(`/master-plan-system/resources/${resource}/${row.id}?expectedVersion=${row.version}`, { method: "DELETE" }); message.success("删除成功"); refresh(); } catch (error) { message.error((error as Error).message); } }}
      onSync={resource === "mps-sync-configs" ? () => syncMutation.mutate(row.syncKey) : undefined} />
  }] : columns;
  const viewTabs = ["mps-group-plans", "mps-monthly-plans"].includes(resource) ? <Tabs activeKey={view} onChange={setView} items={[{ key: "ALL", label: "全部" }, { key: "INCOMPLETE", label: "未完成" }, { key: "COMPLETE", label: "已完成" }]} /> : undefined;
  return <div>
    <PageHeader title={info.label} subtitle={`${info.area} · 新版主计划独立数据模型；默认只读浏览，进入编辑模式后方可维护获权字段`} actions={<Space>
      {metadata.data?.actions.create && hasResourcePermission(resource, "create") && <Button type="primary" onClick={openCreate}>新增</Button>}
    </Space>} />
    {viewTabs}
    <KdosDataTable resource={resource} editable={Boolean(metadata.data?.actions.update)} rowKey="id" loading={metadata.isLoading || rows.isLoading}
      dataSource={rows.data?.rows} columns={withActions} serverData={{ total: rows.data?.total ?? 0, onQueryChange: setTableQuery }}
      scroll={{ x: "max-content", y: "calc(100vh - 330px)" }} />
    <Modal title={modal?.mode === "create" ? `新增${info.label}` : `编辑${info.label}`} open={Boolean(modal)} onCancel={() => setModal(null)} onOk={() => void save().catch((error) => message.error((error as Error).message))} width={760} destroyOnHidden>
      <Form form={form} layout="vertical" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0 16px", maxHeight: "62vh", overflowY: "auto" }}>
        {editableFields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} valuePropName={field.type === "boolean" ? "checked" : "value"} rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}><FieldInput field={field} organizations={organizations.data ?? []} users={users.data ?? []} /></Form.Item>)}
      </Form>
    </Modal>
  </div>;
}
