import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Dropdown, Flex, Form, Input, InputNumber, message, Modal, Select, Space, Switch, Tabs, Tag, Upload } from "antd";
import { DownloadOutlined, MoreOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { masterPlanResourceDefinitions, type TablePermissionFieldDefinition } from "@kdos/contracts";
import { api } from "../../api";
import { hasFieldPermission, hasResourcePermission, KdosDataTable, useKdosTableEditMode, type KdosTableSelection } from "../../shared/KdosDataTable";
import { PageHeader } from "../../shared/legacy-ui";
import { OrganizationSelect, type OrganizationSelectOption } from "../../shared/OrganizationSelect";
import type { AuditDirectoryUser } from "../../shared/audit-fields";
import { useNavigate, useSearchParams } from "react-router-dom";

type TableQuery = { page: number; pageSize: number; search: string; filters: Record<string, string>; sortField?: string; sortOrder?: "asc" | "desc" };
type Metadata = { resource: string; fields: TablePermissionFieldDefinition[]; createFields: TablePermissionFieldDefinition[]; actions: { create: boolean; update: boolean; delete: boolean; import: boolean; export: boolean; batchUpdate: boolean; viewWeekly?: boolean } };
type Reconciliation = { status: string; message: string | null };
const initialQuery: TableQuery = { page: 1, pageSize: 50, search: "", filters: {} };
const auditFields = new Set(["createdBy", "createdAt", "updatedBy", "updatedAt"]);
const definitionMap = new Map(masterPlanResourceDefinitions.map((entry) => [entry.code, entry]));

function pageUrl(resource: string, query: TableQuery, view: string, basePlanId?: string) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), view });
  if (query.search) params.set("search", query.search);
  if (Object.values(query.filters).some((value) => value.trim())) params.set("filters", JSON.stringify(query.filters));
  if (query.sortField) params.set("sortField", query.sortField);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  if (basePlanId) params.set("basePlanId", basePlanId);
  return `/master-plan-system/resources/${resource}?${params}`;
}

function FieldInput({ field, organizations = [], users = [], weeklyPlans = [], ...control }: { field: TablePermissionFieldDefinition; organizations?: OrganizationSelectOption[]; users?: AuditDirectoryUser[]; weeklyPlans?: Array<{ id: string; label: string }> } & Record<string, any>) {
  if (field.type === "boolean") return <Switch {...control} />;
  if (field.type === "number") return <InputNumber {...control} min={0} precision={field.key.includes("Days") || ["deliveryNumber", "intervalMinutes", "plannedPageCount", "orderWeekCount"].includes(field.key) ? 0 : 4} style={{ width: "100%" }} />;
  if (field.type === "date") return <DatePicker {...control} style={{ width: "100%" }} />;
  if (field.key === "weeklyPlanId") return <Select {...control} showSearch optionFilterProp="label" placeholder="按订单编号、品项或交期编码选择" options={weeklyPlans.map((plan) => ({ value: plan.id, label: plan.label }))} />;
  if (field.type === "dictionary" && field.options?.length) return <Select {...control} options={field.options} />;
  if (field.type === "department") return <OrganizationSelect {...control} organizations={organizations} placeholder="选择完整组织路径" />;
  if (field.type === "member") return <Select {...control} showSearch optionFilterProp="label" allowClear placeholder="选择成员" options={users.filter((user) => user.enabled).map((user) => ({ value: user.id, label: user.displayName?.trim() || user.username }))} />;
  return <Input.TextArea {...control} autoSize={{ minRows: 1, maxRows: 4 }} />;
}

function display(value: unknown, field: TablePermissionFieldDefinition, row: any) {
  if (field.key === "weeklyPlanState") return <Tag color={({ "待完善": "default", "已具备条件": "processing", "已进入周计划": "success" } as Record<string, string>)[String(value)]}>{value ? String(value) : "—"}</Tag>;
  if (field.key === "weeklyPlanMissingFields") return value ? `缺少：${String(value)}` : "—";
  if (field.key === "weeklyPlanGenerationIssue") return value ? <Tag color="error">生成失败：{String(value)}</Tag> : "—";
  if (field.type === "boolean") return <Tag color={value ? "success" : "default"}>{value ? "是" : "否"}</Tag>;
  if (field.type === "department" && row.divisionName) return row.divisionName;
  if (field.key === "weeklyPlanId" && row.weeklyPlanLabel) return row.weeklyPlanLabel;
  if (field.type === "dictionary" && value != null) return field.options?.find((option) => option.value === String(value))?.label ?? String(value);
  if (field.type === "date" && value) return dayjs(String(value)).format("YYYY-MM-DD");
  if (field.key === "completionRate") return `${Math.round(Number(value || 0) * 100)}%`;
  if (value && typeof value === "object") return JSON.stringify(value);
  return value == null || value === "" ? "—" : String(value);
}

const processGroups = [
  ["cutting", "下料"], ["machining", "机加"], ["bending", "折弯"], ["spotWelding", "点焊"], ["welding", "焊接"],
  ["woodworking", "木作"], ["grinding", "研磨"], ["surfaceTreatment", "表面处理"], ["packaging", "包装"]
] as const;

function InlineMasterPlanCell({ resource, field, row, value, organizations, users, weeklyPlans, onSave }: {
  resource: string; field: TablePermissionFieldDefinition; row: any; value: unknown;
  organizations: OrganizationSelectOption[]; users: AuditDirectoryUser[]; weeklyPlans: Array<{ id: string; label: string }>;
  onSave: (row: any, field: TablePermissionFieldDefinition, value: unknown) => Promise<void>;
}) {
  const { editing } = useKdosTableEditMode(); const [draft, setDraft] = useState<any>(value); const [saving, setSaving] = useState(false); const lock = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const editable = editing && row.canUpdate !== false && field.editable && hasFieldPermission(resource, field.key, "update");
  if (!editable) return <>{display(value, field, row)}</>;
  const commit = async (next = draft) => {
    const normalized = next?.format ? next.format("YYYY-MM-DD") : next;
    const previous = value == null ? null : String(value); const comparable = normalized == null || normalized === "" ? null : String(normalized);
    if (lock.current || previous === comparable) return;
    lock.current = true; setSaving(true);
    try { await onSave(row, field, normalized); }
    catch { setDraft(value); }
    finally { lock.current = false; setSaving(false); }
  };
  if (field.type === "boolean") return <Switch size="small" checked={Boolean(draft)} loading={saving} onChange={(next) => { setDraft(next); void commit(next); }} />;
  if (field.type === "date") return <DatePicker size="small" value={draft ? dayjs(draft) : null} disabled={saving} onChange={(next) => { setDraft(next); void commit(next); }} style={{ width: "100%" }} />;
  if (field.type === "dictionary") return <Select size="small" value={draft || undefined} allowClear disabled={saving} onChange={(next) => { setDraft(next); void commit(next); }} options={field.options ?? []} style={{ width: "100%" }} />;
  if (field.type === "department") return <OrganizationSelect size="small" value={draft || undefined} disabled={saving} organizations={organizations} onChange={(next) => { setDraft(next); void commit(next); }} />;
  if (field.type === "member") return <Select size="small" value={draft || undefined} allowClear showSearch optionFilterProp="label" disabled={saving} options={users.filter((user) => user.enabled).map((user) => ({ value: user.id, label: user.displayName?.trim() || user.username }))} onChange={(next) => { setDraft(next); void commit(next); }} style={{ width: "100%" }} />;
  if (field.key === "weeklyPlanId") return <Select size="small" value={draft || undefined} showSearch optionFilterProp="label" disabled={saving} options={weeklyPlans.map((plan) => ({ value: plan.id, label: plan.label }))} onChange={(next) => { setDraft(next); void commit(next); }} style={{ width: "100%" }} />;
  if (field.type === "number") return <InputNumber size="small" value={draft as any} min={0} disabled={saving} onChange={setDraft} onBlur={() => void commit()} onPressEnter={(event) => { event.currentTarget.blur(); }} style={{ width: "100%" }} />;
  return <Input size="small" value={draft == null ? "" : String(draft)} disabled={saving} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()} onPressEnter={(event) => event.currentTarget.blur()} />;
}

function groupedColumns(resource: string, fields: TablePermissionFieldDefinition[], renderCell?: (value: unknown, field: TablePermissionFieldDefinition, row: any) => React.ReactNode) {
  const column = (field: TablePermissionFieldDefinition) => ({
    title: field.label.includes("·") ? field.label.split("·")[1] : field.label,
    dataIndex: field.key,
    width: Math.max(105, Math.min(240, field.label.length * 18 + 54)),
    render: (value: unknown, row: any) => renderCell ? renderCell(value, field, row) : display(value, field, row)
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

function RowActions({ metadata, row, onEdit, onDelete, onSync, onReport, onViewWeekly }: { metadata: Metadata; row: any; onEdit: () => void; onDelete: () => void; onSync?: () => void; onReport?: () => void; onViewWeekly?: () => void }) {
  const { editing } = useKdosTableEditMode();
  const items = [
    onViewWeekly ? { key: "viewWeekly", label: "查看周计划", onClick: onViewWeekly } : null,
    editing && metadata.actions.update && row.canUpdate !== false && !row.pendingTask ? { key: "edit", label: "编辑", onClick: onEdit } : null,
    editing && row.pendingTask && metadata.actions.create && onReport ? { key: "report", label: "报工", onClick: onReport } : null,
    editing && onSync ? { key: "sync", label: "立即同步", onClick: onSync } : null,
    metadata.actions.delete && row.canDelete !== false && !row.pendingTask ? { key: "delete", label: "删除", danger: true, onClick: () => Modal.confirm({ title: "确认删除这条记录？", content: "删除后不可恢复。", okText: "删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: onDelete }) } : null
  ].filter(Boolean) as Array<{ key: string; label: string; danger?: boolean; onClick: () => void }>;
  if (!items.length) return null;
  return <Dropdown trigger={["click"]} menu={{ items }} placement="bottomRight">
    <Button type="text" size="small" icon={<MoreOutlined />} aria-label="更多操作" title="更多操作" />
  </Dropdown>;
}

export function MasterPlanResourcePage({ resource }: { resource: string }) {
  const info = definitionMap.get(resource as any);
  const queryClient = useQueryClient(); const navigate = useNavigate(); const [searchParams] = useSearchParams(); const basePlanId = resource === "mps-weekly-plans" ? searchParams.get("basePlanId") ?? undefined : undefined;
  const [tableQuery, setTableQuery] = useState(initialQuery); const [view, setView] = useState("ALL");
  const sessionSubject = (() => { try { return JSON.parse(localStorage.getItem("sessionUser") ?? "{}").sub ?? "anonymous"; } catch { return "anonymous"; } })();
  const [form] = Form.useForm(); const [modal, setModal] = useState<{ mode: "create" | "edit"; row?: any } | null>(null);
  const saveLock = useRef(false); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState<string | null>(null);
  const [batchForm] = Form.useForm();
  const [batchSelection, setBatchSelection] = useState<KdosTableSelection<any> | null>(null);
  const [batchField, setBatchField] = useState<TablePermissionFieldDefinition | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [importPreview, setImportPreview] = useState<{ total: number; errors: Array<{ row: number; reason: string }>; previewId?: string | null; blockedReason?: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const metadata = useQuery({ queryKey: ["mps-meta", sessionSubject, resource], queryFn: () => api<Metadata>(`/master-plan-system/resources/${resource}/meta`), staleTime: 60_000 });
  const organizations = useQuery({ queryKey: ["mps-organization-options", sessionSubject, resource], queryFn: () => api<OrganizationSelectOption[]>(`/master-plan-system/references/organizations?resource=${encodeURIComponent(resource)}`), staleTime: 300_000, enabled: Boolean(metadata.data?.fields.some((field) => field.type === "department")) });
  const users = useQuery({ queryKey: ["mps-directory-users"], queryFn: () => api<AuditDirectoryUser[]>("/directory/users"), staleTime: 300_000 });
  const weeklyPlans = useQuery({ queryKey: ["mps-weekly-plan-options", sessionSubject], queryFn: () => api<Array<{ id: string; label: string }>>("/master-plan-system/references/weekly-plans"), staleTime: 60_000, enabled: ["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource) && Boolean(metadata.data) });
  const rows = useQuery({ queryKey: ["mps-rows", sessionSubject, resource, tableQuery, view, basePlanId], queryFn: () => api<{ rows: any[]; total: number }>(pageUrl(resource, tableQuery, view, basePlanId)), placeholderData: (previous) => previous, enabled: Boolean(metadata.data), staleTime: 60_000 });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["mps-rows", sessionSubject, resource] });
  const refreshRelatedPlans = useCallback(async () => {
    await Promise.all(["mps-base-plans", "mps-weekly-plans"].map((code) => queryClient.invalidateQueries({ queryKey: ["mps-rows", sessionSubject, code] })));
  }, [queryClient, sessionSubject]);
  /* 基础计划 -> 周计划必须通过稳定 base_plan_id 定位，禁止按订单号/品项/交期模糊搜索。 */
  const viewWeeklyPlan = useCallback((row: any) => {
    const weeklyPlanId = row?.weeklyPlanId ? String(row.weeklyPlanId) : "";
    if (!weeklyPlanId) { message.info("该基础计划尚未生成周计划"); return; }
    navigate(`/master-plan-system/resources/mps-weekly-plans?basePlanId=${encodeURIComponent(weeklyPlanId)}`);
  }, [navigate]);
  const clearWeeklyPlanFilter = useCallback(() => navigate("/master-plan-system/resources/mps-weekly-plans"), [navigate]);
  const saveInline = useCallback(async (row: any, field: TablePermissionFieldDefinition, value: unknown) => {
    try {
      const updated = await api<{ version: number; values: Record<string, unknown>; reconciliation?: Reconciliation }>(`/master-plan-system/resources/${resource}/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field.key]: value, expectedVersion: row.version }) });
      const confirmedValue = updated.values[field.key];
      if (resource === "mps-base-plans") {
        await refreshRelatedPlans();
        if (updated.reconciliation?.status === "FAILED") message.warning(updated.reconciliation.message ?? "基础计划已保存，但周计划生成失败。");
        else if (updated.reconciliation && updated.reconciliation.status !== "SUCCESS") message.info(updated.reconciliation.message ?? "基础计划已保存，周计划正在生成。");
        else message.success(`${field.label}已保存；周计划状态已刷新`);
      } else {
        queryClient.setQueriesData<{ rows: any[]; total: number }>({ queryKey: ["mps-rows", sessionSubject, resource] }, (current) => current ? { ...current, rows: current.rows.map((entry) => entry.id === row.id ? { ...entry, [field.key]: confirmedValue, version: Number(updated.version), ...(field.type === "department" ? { divisionName: organizations.data?.find((option) => option.id === confirmedValue)?.pathLabel ?? null } : {}) } : entry) } : current);
        message.success(`${field.label}已保存`);
      }
    } catch (error) { message.error((error as Error).message || `${field.label}保存失败`); throw error; }
  }, [organizations.data, queryClient, refreshRelatedPlans, resource, sessionSubject]);
  const editableFields = (metadata.data?.fields ?? []).filter((field) => field.editable && hasFieldPermission(resource, field.key, "update"));
  const formFields = modal?.mode === "create" ? (metadata.data?.createFields ?? []) : editableFields;
  const openCreate = () => { form.resetFields(); setSaveError(null); if (resource === "mps-weekly-process-plans") form.setFieldValue("reportDate", dayjs()); setModal({ mode: "create" }); };
  const openReport = (row: any) => { form.resetFields(); setSaveError(null); form.setFieldsValue({ weeklyPlanId: row.weeklyPlanId, processCode: row.processCode, productionDate: dayjs() }); setModal({ mode: "create", row }); };
  const openEdit = (row: any) => {
    form.resetFields();
    setSaveError(null);
    form.setFieldsValue(Object.fromEntries(editableFields.map((field) => [field.key, field.type === "date" && row[field.key] ? dayjs(row[field.key]) : row[field.key]])));
    setModal({ mode: "edit", row });
  };
  const save = async () => {
    if (saveLock.current) return;
    saveLock.current = true; setSaving(true); setSaveError(null);
    try {
      const values = await form.validateFields();
      const payload = Object.fromEntries(Object.entries(values).map(([key, value]: [string, any]) => [key, value?.format ? value.format("YYYY-MM-DD") : value]));
      const edited = modal?.mode === "edit";
      const saved = edited
        ? await api<{ reconciliation?: Reconciliation }>(`/master-plan-system/resources/${resource}/${modal!.row.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, expectedVersion: modal!.row.version }) })
        : await api<{ reconciliation?: Reconciliation }>(`/master-plan-system/resources/${resource}`, { method: "POST", body: JSON.stringify(payload) });
      setModal(null);
      if (resource === "mps-base-plans") {
        await refreshRelatedPlans();
        if (saved?.reconciliation?.status === "FAILED") message.warning(saved.reconciliation.message ?? "基础计划已保存，但周计划生成失败。");
        else if (saved?.reconciliation && saved.reconciliation.status !== "SUCCESS") message.info(saved.reconciliation.message ?? "基础计划已保存，周计划正在生成。");
        else message.success(edited ? "修改成功；周计划状态已刷新" : "新增成功；周计划状态已刷新");
      } else {
        message.success(edited ? "修改成功" : "新增成功"); refresh();
      }
    } catch (error) {
      const validation = error as { errorFields?: Array<{ name: Array<string | number>; errors: string[] }>; message?: string };
      const reason = validation.errorFields?.[0]?.errors?.[0] ?? validation.message ?? "保存失败，请检查填写内容后重试";
      if (validation.errorFields?.[0]?.name) form.scrollToField(validation.errorFields[0].name, { behavior: "smooth", block: "center" });
      setSaveError(reason); message.error(reason);
    } finally {
      saveLock.current = false; setSaving(false);
    }
  };
  const saveBatch = async () => {
    if (!batchSelection || !batchField) return;
    const values = await batchForm.validateFields();
    const raw = values.value; const value = raw?.format ? raw.format("YYYY-MM-DD") : raw;
    setBatchSaving(true);
    try {
      const result = await api<{ succeeded: number; failed: number; items: Array<{ id: string; success: boolean; reason?: string }> }>(`/master-plan-system/resources/${resource}/batch`, {
        method: "PATCH",
        body: JSON.stringify({ records: batchSelection.selectedRows.map((row) => ({ id: row.id, expectedVersion: row.version })), fieldKey: batchField.key, value, idempotencyKey: crypto.randomUUID() })
      });
      if (result.failed) {
        Modal.warning({ title: `批量修改完成：成功 ${result.succeeded} 条，失败 ${result.failed} 条`, content: <div>{result.items.filter((item) => !item.success).slice(0, 20).map((item) => <div key={item.id}>{item.id}：{item.reason}</div>)}</div> });
      } else {
        message.success(`批量修改成功，共 ${result.succeeded} 条`);
        batchSelection.clearSelection(); setBatchSelection(null); batchForm.resetFields(); setBatchField(null);
      }
      refresh();
    } finally { setBatchSaving(false); }
  };
  const syncMutation = useMutation({ mutationFn: (syncKey: string) => api<{ count: number }>(`/master-plan-system/sync/${syncKey}`, { method: "POST" }), onSuccess: (result) => { message.success(`同步完成，共处理 ${result.count} 条变更`); refresh(); void queryClient.invalidateQueries({ queryKey: ["mps-rows"] }); }, onError: (error) => message.error((error as Error).message) });
  const download = async (path: string, filename: string) => {
    const blob = await api<Blob>(path); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  };
  const previewImport = async (file: File) => {
    const body = new FormData(); body.append("file", file); setImporting(true); setImportError(null); setImportPreview(null);
    try { setImportPreview(await api(`/master-plan-system/resources/${resource}/import-preview`, { method: "POST", body })); }
    catch (error) { setImportError(`导入失败\n\n${(error as Error).message}`); }
    finally { setImporting(false); }
    return false;
  };
  const confirmImport = async () => {
    if (!importPreview?.previewId) return; setImporting(true); setImportError(null);
    try {
      const result = await api<{ created: number; updated: number }>(`/master-plan-system/resources/${resource}/import-confirm`, { method: "POST", body: JSON.stringify({ previewId: importPreview.previewId }) });
      message.success(`导入完成，新增 ${result.created ?? 0} 条，更新 ${result.updated ?? 0} 条`); setImportPreview(null); refresh();
    } catch (error) { setImportError(`导入失败，本次数据未提交。\n\n失败原因：\n${(error as Error).message}\n\n本次整批数据均未写入。`); }
    finally { setImporting(false); }
  };
  const businessFields = (metadata.data?.fields ?? []).filter((field) => !auditFields.has(field.key));
  const columns = useMemo(() => groupedColumns(resource, businessFields, (value, field, row) => <InlineMasterPlanCell resource={resource} field={field} row={row} value={value} organizations={organizations.data ?? []} users={users.data ?? []} weeklyPlans={weeklyPlans.data ?? []} onSave={saveInline} />), [businessFields, resource, organizations.data, users.data, weeklyPlans.data, saveInline]);
  if (!info) return null;
  const canViewWeekly = resource === "mps-base-plans" && Boolean(metadata.data?.actions.viewWeekly);
  const hasRowActions = Boolean(metadata.data) && (canViewWeekly || metadata.data!.actions.update || metadata.data!.actions.delete || (resource === "mps-process-reports" && metadata.data!.actions.create));
  const withActions = hasRowActions ? [...columns, {
    title: null, key: "__rowActions", width: 52, fixed: "right" as const,
    render: (_: unknown, row: any) => <RowActions metadata={metadata.data!} row={row} onEdit={() => openEdit(row)}
      onDelete={async () => { try { await api(`/master-plan-system/resources/${resource}/${row.id}?expectedVersion=${row.version}`, { method: "DELETE" }); message.success("删除成功"); refresh(); } catch (error) { message.error((error as Error).message); } }}
      onReport={resource === "mps-process-reports" ? () => openReport(row) : undefined}
      onViewWeekly={canViewWeekly && (row.weeklyPlanId || row.weeklyPlanState === "已进入周计划") ? () => viewWeeklyPlan(row) : undefined}
      onSync={resource === "mps-sync-configs" ? () => syncMutation.mutate(row.syncKey) : undefined} />
  }] : columns;
  const viewTabs = ["mps-group-plans", "mps-monthly-plans"].includes(resource) ? <Tabs activeKey={view} onChange={setView} items={[{ key: "ALL", label: "全部" }, { key: "INCOMPLETE", label: "未完成" }, { key: "COMPLETE", label: "已完成" }]} />
    : resource === "mps-process-reports" ? <Tabs activeKey={view === "PENDING" ? "PENDING" : "ACTUAL"} onChange={setView} items={[{ key: "ACTUAL", label: "实际报工" }, { key: "PENDING", label: "待报工任务" }]} /> : undefined;
  return <div>
    <PageHeader title={info.label} subtitle={`${info.area} · 新版主计划独立数据模型；默认只读浏览，进入编辑模式后方可维护获权字段`} actions={<Space>
      {metadata.data?.actions.import && <Button icon={<DownloadOutlined />} onClick={() => void download(`/master-plan-system/resources/${resource}/import-template`, `${info.label}-导入模板.xlsx`).catch((error) => message.error((error as Error).message))}>导入模板</Button>}
      {metadata.data?.actions.import && <Upload accept=".xlsx" maxCount={1} showUploadList={false} beforeUpload={previewImport}><Button loading={importing} icon={<UploadOutlined />}>导入</Button></Upload>}
      {metadata.data?.actions.export && <Button icon={<DownloadOutlined />} onClick={() => void download(`${pageUrl(resource, tableQuery, view, basePlanId).replace("?", "/export?")}`, `${info.label}.xlsx`).catch((error) => message.error((error as Error).message))}>导出</Button>}
      {metadata.data?.actions.create && hasResourcePermission(resource, "create") && <Button type="primary" onClick={openCreate}>新增</Button>}
    </Space>} />
    {basePlanId && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="仅显示该事业部基础计划生成的周计划" action={<Button size="small" onClick={clearWeeklyPlanFilter}>清除定位</Button>} />}
    {viewTabs}
    <KdosDataTable resource={resource} editable={Boolean(metadata.data?.actions.update)} rowKey="id" loading={metadata.isLoading || rows.isLoading}
      dataSource={rows.data?.rows} columns={withActions} serverData={{ total: rows.data?.total ?? 0, onQueryChange: setTableQuery }}
      selectionActions={(selection) => selection.editing && metadata.data?.actions.batchUpdate
        ? <Button type="primary" onClick={() => { batchForm.resetFields(); setBatchField(null); setBatchSelection(selection); }}>批量修改</Button>
        : null}
      scroll={{ x: "max-content", y: "calc(100vh - 330px)" }} />
    <Modal title={modal?.mode === "create" ? `新增${info.label}` : `编辑${info.label}`} open={Boolean(modal)} onCancel={() => { if (!saving) setModal(null); }} onOk={() => void save()} confirmLoading={saving} width={760} destroyOnHidden>
      <Form form={form} layout="vertical" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0 16px", maxHeight: "62vh", overflowY: "auto" }}>
        {saveError && <Alert type="error" showIcon message={saveError} style={{ gridColumn: "1 / -1" }} />}
        {formFields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} valuePropName={field.type === "boolean" ? "checked" : "value"} rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}><FieldInput field={field} organizations={organizations.data ?? []} users={users.data ?? []} weeklyPlans={weeklyPlans.data ?? []} /></Form.Item>)}
      </Form>
    </Modal>
    <Modal title={importPreview ? "导入预览" : "导入失败"} open={Boolean(importPreview || importError)} onCancel={() => { setImportPreview(null); setImportError(null); }} onOk={() => void confirmImport()}
      okText="确认导入" cancelText="取消" confirmLoading={importing} okButtonProps={{ disabled: !importPreview?.previewId || Boolean(importPreview?.errors.length) }}>
      {importError && <Alert type="error" showIcon message="导入失败" description={<span style={{ whiteSpace: "pre-line" }}>{importError.replace(/^导入失败\n\n/, "")}</span>} style={{ marginBottom: 12 }} />}
      {importPreview && <>
      <p>共解析 {importPreview?.total ?? 0} 条。确认后整批事务提交。</p>
      {importPreview?.blockedReason && <Alert type="warning" showIcon message={importPreview.blockedReason} />}
      {importPreview?.errors.length ? <><Alert type="error" showIcon message="导入校验失败" description={importPreview.errors.length > 100 ? `共发现 ${importPreview.errors.length} 条错误，当前显示前 100 条。` : `发现 ${importPreview.errors.length} 条错误`} style={{ marginBottom: 12 }} /><div style={{ maxHeight: 320, overflow: "auto" }}>{importPreview.errors.slice(0, 100).map((error) => <div key={`${error.row}-${error.reason}`}>第 {error.row} 行：{error.reason}</div>)}</div></> : !importPreview?.blockedReason && <Tag color="success">校验通过，可以确认导入</Tag>}
      </>}
    </Modal>
    <Modal title={<Space><span>批量修改</span><Tag>本次操作将修改 {batchSelection?.selectedRowKeys.length ?? 0} 条数据</Tag></Space>}
      open={Boolean(batchSelection)} onCancel={() => { setBatchSelection(null); batchForm.resetFields(); setBatchField(null); }}
      confirmLoading={batchSaving} onOk={() => void saveBatch().catch((error) => message.error((error as Error).message))}
      okButtonProps={{ disabled: !batchField }} okText="确定" cancelText="取消"
      footer={(_, { OkBtn, CancelBtn }) => <Flex justify="space-between" align="center"><Button type="link" href={`/audit?resource=${encodeURIComponent(resource)}&action=batch_updated`}>查看修改记录</Button><Space><CancelBtn /><OkBtn /></Space></Flex>}>
      <Tag color="blue">单次最多修改 50000 条数据</Tag>
      <p>图片、附件、定位、手写签名、选择数据、查询、分割线、文字识别、按钮字段不支持批量修改。</p>
      <Form form={batchForm} layout="vertical">
        <Form.Item label="请选择需要修改的字段" required>
          <Select value={batchField?.key} placeholder="请选择需要修改的字段" options={editableFields.map((field) => ({ label: field.label, value: field.key }))}
            onChange={(key) => { batchForm.resetFields(["value"]); setBatchField(editableFields.find((field) => field.key === key) ?? null); }} />
        </Form.Item>
        <Form.Item name="value" label="修改为" rules={[{ required: true, message: "请填写修改后的值" }]}>
          {batchField ? <FieldInput field={batchField} organizations={organizations.data ?? []} users={users.data ?? []} /> : <Input disabled placeholder="请先选择字段" />}
        </Form.Item>
      </Form>
    </Modal>
  </div>;
}
