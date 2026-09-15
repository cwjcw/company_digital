import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Alert, Button, Card, DatePicker, Flex, Form, Input, InputNumber, Modal,
  Select, Space, Statistic, Switch, Tag, Typography, Upload, message
} from "antd";
import dayjs from "dayjs";
import { api } from "../../api";
import { KdosDataTable, TablePermissionButton, hasSessionResourcePermission } from "../../shared/KdosDataTable";
import { PageHeader, downloadApiFile } from "../../shared/legacy-ui";
import { OrganizationSelect } from "../../shared/OrganizationSelect";

type TableQuery = { page: number; pageSize: number; search: string; filters: Record<string, string>; sortField?: string; sortOrder?: "asc" | "desc" };
type PageResult<T> = { rows: T[]; total: number; page: number; pageSize: number };
type EquipmentAsset = {
  id: string; divisionId: string; divisionName: string; usageDepartmentId: string | null;
  usageDepartmentName: string; equipmentCode: string; equipmentName: string; purchaseDate: string | null;
  plannedStartupMinutes: number;
  monitored: boolean; responsibleUserIds: string[]; responsibleUsers: Array<{ id: string; displayName: string }>;
  version: number; createdBy?: string; createdAt?: string; updatedBy?: string; updatedAt?: string;
};
type EquipmentStatus = {
  id: string; equipmentId: string; equipmentCode: string; equipmentName: string; divisionId: string;
  divisionName: string; usageDepartmentId: string | null; usageDepartmentName: string; reportDate: string;
  runtimeMinutes: number; faultMinutes: number; faultReason: string | null; version: number;
  responsibleUserIds: string[]; responsibleUsers: Array<{ id: string; displayName: string }>;
};
type StatusImportPreview = {
  fileHash: string; signature: string; total: number; createCount: number; updateCount: number; unchangedCount: number;
  rows: Array<{ rowNumber: number; divisionName: string; equipmentCode: string; equipmentName: string; reportDate: string; runtimeMinutes: number; faultMinutes: number; faultReason: string | null; equipmentId: string; action: string }>;
  errors: Array<{ rowNumber: number; message: string }>;
};
type EquipmentOption = Pick<EquipmentAsset, "id" | "equipmentCode" | "equipmentName" | "divisionId" | "divisionName" | "usageDepartmentId" | "usageDepartmentName">;
type OrganizationOption = { id: string; name: string; parentId: string | null; path: string[]; pathLabel: string };
type EquipmentOptions = {
  equipment: EquipmentOption[];
  users: Array<{ id: string; displayName: string }>;
  organizations: OrganizationOption[];
  faultReasons: string[];
};

const blankQuery: TableQuery = { page: 1, pageSize: 50, search: "", filters: {} };
const divisionNames = new Set(["事业一部", "事业二部", "事业三部", "事业四部", "研发中心"]);

function tableUrl(path: string, query: TableQuery) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set("search", query.search);
  for (const [key, value] of Object.entries(query.filters)) if (value.trim()) params.set(key, value.trim());
  if (query.sortField) params.set("sortField", query.sortField);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  return `${path}?${params}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function durationText(value: unknown) {
  const minutes = Math.max(0, Number(value) || 0);
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
}

function shanghaiYesterday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return dayjs(`${value("year")}-${value("month")}-${value("day")}`).subtract(1, "day");
}

function DurationFields({ prefix, label }: { prefix: "plannedStartup" | "runtime" | "fault"; label: string }) {
  return <Form.Item label={label} required>
    <Space.Compact block>
      <Form.Item name={`${prefix}Hours`} noStyle rules={[{ required: true, message: `请输入${label}` }]}>
        <InputNumber min={0} precision={0} addonAfter="小时" style={{ width: "50%" }} />
      </Form.Item>
      <Form.Item name={`${prefix}MinutePart`} noStyle rules={[{ required: true, message: `请输入${label}` }]}>
        <InputNumber min={0} max={59} precision={0} addonAfter="分钟" style={{ width: "50%" }} />
      </Form.Item>
    </Space.Compact>
  </Form.Item>;
}

function useEquipmentPermissions(resource: "equipment-register" | "equipment-status-report") {
  const session = useQuery({ queryKey: ["auth-session"], queryFn: () => api<{ permissions?: string[] }>("/auth/me"), retry: false, staleTime: 0, refetchOnMount: "always" });
  const allows = (action: string) => hasSessionResourcePermission(session.data, resource, action);
  return { canRead: allows("read"), canCreate: allows("create"), canUpdate: allows("update"), canDelete: allows("delete"), canImport: allows("import"), canExport: allows("export") };
}

function useEquipmentOptions(kind: "asset" | "status", enabled: boolean) {
  const path = kind === "status" ? "/equipment/status-options" : "/equipment/options";
  return useQuery({ queryKey: ["equipment-options", kind], queryFn: () => api<EquipmentOptions>(path), staleTime: 60_000, enabled });
}

export function EquipmentRegisterPage() {
  const queryClient = useQueryClient();
  const [tableQuery, setTableQuery] = useState<TableQuery>(blankQuery);
  const [editing, setEditing] = useState<EquipmentAsset>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const permissions = useEquipmentPermissions("equipment-register");
  const { canRead, canCreate, canUpdate, canDelete } = permissions;
  const options = useEquipmentOptions("asset", canCreate || canUpdate);
  const records = useQuery({
    queryKey: ["equipment-assets", tableQuery],
    queryFn: () => api<PageResult<EquipmentAsset>>(tableUrl("/equipment/assets", tableQuery)),
    placeholderData: (previous) => previous,
    enabled: canRead
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["equipment-assets"] });
  const organizationOptions = options.data?.organizations ?? [];
  const divisionOptions = organizationOptions.filter((item) => divisionNames.has(item.name));
  const memberOptions = (options.data?.users ?? []).map((item) => ({ value: item.id, label: item.displayName }));

  const openCreate = () => {
    setEditing(undefined); form.resetFields(); form.setFieldsValue({ plannedStartupHours: 0, plannedStartupMinutePart: 0, monitored: false, responsibleUserIds: [] }); setOpen(true);
  };
  const openEdit = (row: EquipmentAsset) => {
    const plannedStartup = Number(row.plannedStartupMinutes ?? 0);
    setEditing(row); form.setFieldsValue({
      divisionId: row.divisionId, usageDepartmentId: row.usageDepartmentId, equipmentCode: row.equipmentCode,
      equipmentName: row.equipmentName, purchaseDate: row.purchaseDate ? dayjs(row.purchaseDate) : null,
      plannedStartupHours: Math.floor(plannedStartup / 60), plannedStartupMinutePart: plannedStartup % 60,
      monitored: row.monitored, responsibleUserIds: row.responsibleUserIds ?? []
    }); setOpen(true);
  };
  const save = async () => {
    try {
      const values = await form.validateFields(); setSaving(true);
      const { plannedStartupHours, plannedStartupMinutePart, ...assetValues } = values;
      const plannedStartupMinutes = Number(plannedStartupHours ?? 0) * 60 + Number(plannedStartupMinutePart ?? 0);
      const payload = { ...assetValues, plannedStartupMinutes, purchaseDate: values.purchaseDate?.format("YYYY-MM-DD") ?? null, expectedVersion: editing?.version };
      await api(editing ? `/equipment/assets/${editing.id}` : "/equipment/assets", {
        method: editing ? "PATCH" : "POST", body: JSON.stringify(payload)
      });
      message.success(editing ? "设备已更新" : "设备已新增"); setOpen(false); refresh();
      void queryClient.invalidateQueries({ queryKey: ["equipment-options"] });
      void queryClient.invalidateQueries({ queryKey: ["equipment-dashboard"] });
    } catch (error: any) {
      if (!Array.isArray(error?.errorFields)) message.error(errorText(error));
    } finally { setSaving(false); }
  };
  const remove = (row: EquipmentAsset) => Modal.confirm({
    title: `停用设备 ${row.equipmentCode}？`, content: "历史状态填报会保留，停用后不再出现在新填报设备列表中。", okText: "确认停用", okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await api(`/equipment/assets/${row.id}?expectedVersion=${row.version}`, { method: "DELETE" });
        await refresh(); void queryClient.invalidateQueries({ queryKey: ["equipment-options"] });
        message.success("设备已停用");
      } catch (error) { message.error(errorText(error)); throw error; }
    }
  });

  const columns: any[] = [
    { title: "事业部", dataIndex: "divisionName", width: 110, fixed: "left" },
    { title: "使用部门", dataIndex: "usageDepartmentName", width: 130 },
    { title: "设备编号", dataIndex: "equipmentCode", width: 150, fixed: "left" },
    { title: "设备名称", dataIndex: "equipmentName", width: 220 },
    { title: "购买日期", dataIndex: "purchaseDate", width: 115, render: (value: string | null) => value ? dayjs(value).format("YYYY-MM-DD") : "—" },
    { title: "设备计划开机时间", dataIndex: "plannedStartupMinutes", width: 170, render: durationText },
    { title: "状态填报", dataIndex: "monitored", width: 110, render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "需要填报" : "无需填报"}</Tag> },
    { title: "责任人（可多选）", dataIndex: "responsibleUserIds", width: 240, render: (_ids: string[], row: EquipmentAsset) => row.responsibleUsers?.length ? row.responsibleUsers.map((user) => <Tag key={user.id}>{user.displayName}</Tag>) : <Typography.Text type="warning">未指定</Typography.Text> },
    ...(canUpdate || canDelete ? [{ title: "操作", key: "actions", width: 150, fixed: "right", render: (_: unknown, row: EquipmentAsset) => <Space>
      {canUpdate && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>}
      {canDelete && <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(row)}>停用</Button>}
    </Space> }] : [])
  ];

  return <div>
    <PageHeader title="设备总台账" subtitle=""
      actions={<Space>{canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增设备</Button>}<Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button></Space>} />
    <KdosDataTable resource="equipment-register" rowKey="id" columns={columns} dataSource={records.data?.rows}
      loading={records.isLoading} serverData={{ total: records.data?.total ?? 0, onQueryChange: setTableQuery }} scroll={{ x: 1670, y: "calc(100vh - 310px)" }} />
    <Modal title={editing ? "编辑设备" : "新增设备"} width={760} open={open} onCancel={() => setOpen(false)} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical" requiredMark={false}>
        <div className="equipment-form-grid">
          <Form.Item name="divisionId" label="事业部（部门字段）" rules={[{ required: true, message: "请选择事业部" }]}>
            <OrganizationSelect organizations={divisionOptions} placeholder="研发请选择“研发中心”" />
          </Form.Item>
          <Form.Item name="usageDepartmentId" label="使用部门"><OrganizationSelect allowClear organizations={organizationOptions} placeholder="选择完整组织路径" /></Form.Item>
          <Form.Item name="equipmentCode" label="设备编号" rules={[{ required: true, whitespace: true, message: "请输入设备编号" }]}><Input /></Form.Item>
          <Form.Item name="equipmentName" label="设备名称" rules={[{ required: true, whitespace: true, message: "请输入设备名称" }]}><Input /></Form.Item>
          <Form.Item name="purchaseDate" label="购买日期"><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
          <DurationFields prefix="plannedStartup" label="设备计划开机时间" />
          <Form.Item name="monitored" label="纳入每周状态填报" valuePropName="checked"><Switch checkedChildren="需要" unCheckedChildren="无需" /></Form.Item>
          <Form.Item className="equipment-form-wide" name="responsibleUserIds" label="责任人（允许多选）"><Select mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive" options={memberOptions} /></Form.Item>
        </div>
      </Form>
    </Modal>
  </div>;
}

export function EquipmentStatusReportPage() {
  const queryClient = useQueryClient();
  const [tableQuery, setTableQuery] = useState<TableQuery>(blankQuery);
  const [editing, setEditing] = useState<EquipmentStatus>();
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>();
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false); const [confirmingImport, setConfirmingImport] = useState(false);
  const [exporting, setExporting] = useState(false); const [importPreview, setImportPreview] = useState<StatusImportPreview>();
  const [form] = Form.useForm();
  const permissions = useEquipmentPermissions("equipment-status-report");
  const { canRead, canCreate, canUpdate, canDelete, canImport, canExport } = permissions;
  const options = useEquipmentOptions("status", canCreate || canUpdate);
  const records = useQuery({
    queryKey: ["equipment-status", tableQuery], queryFn: () => api<PageResult<EquipmentStatus>>(tableUrl("/equipment/status-reports", tableQuery)),
    placeholderData: (previous) => previous,
    enabled: canRead
  });
  const selectedEquipment = useMemo(() => options.data?.equipment.find((item) => item.id === selectedEquipmentId), [options.data?.equipment, selectedEquipmentId]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["equipment-status"] });
  const equipmentOptions = (options.data?.equipment ?? []).map((item) => ({ value: item.id, label: `${item.equipmentCode}｜${item.equipmentName}｜${item.divisionName}` }));
  const previewImport = async (file: File) => {
    const body = new FormData(); body.append("file", file); setImporting(true);
    try {
      const preview = await api<StatusImportPreview>("/equipment/status-reports/import-preview", { method: "POST", body });
      setImportPreview(preview);
    } catch (error) { message.error(errorText(error)); }
    finally { setImporting(false); }
    return false;
  };
  const confirmImport = async () => {
    if (!importPreview || importPreview.errors.length) return;
    setConfirmingImport(true);
    try {
      const result = await api<{ created: number; updated: number; unchanged: number; repeated: boolean }>("/equipment/status-reports/import-confirm", {
        method: "POST", body: JSON.stringify({ fileHash: importPreview.fileHash, signature: importPreview.signature, rows: importPreview.rows })
      });
      message.success(result.repeated ? "该文件已经导入，本次未重复写入" : `导入完成：新增 ${result.created} 条，更新 ${result.updated} 条，未变化 ${result.unchanged} 条`);
      setImportPreview(undefined); refresh(); void queryClient.invalidateQueries({ queryKey: ["equipment-dashboard"] });
    } catch (error) { message.error(errorText(error)); }
    finally { setConfirmingImport(false); }
  };
  const exportRows = async () => {
    setExporting(true);
    try {
      const query = new URLSearchParams(); if (tableQuery.search) query.set("search", tableQuery.search);
      for (const [key, value] of Object.entries(tableQuery.filters)) if (value.trim()) query.set(key, value.trim());
      await downloadApiFile(`/equipment/status-reports/export?${query}`, "设备状态填报.xlsx"); message.success("设备状态填报已导出");
    } catch (error) { message.error(errorText(error)); }
    finally { setExporting(false); }
  };
  const [exportingTemplate, setExportingTemplate] = useState(false);
  const exportTemplate = async () => {
    setExportingTemplate(true);
    try { await downloadApiFile("/equipment/status-reports/import-template", "设备状态填报导入模板.xlsx"); }
    catch (error) { message.error(errorText(error)); }
    finally { setExportingTemplate(false); }
  };
  const setInitial = (row?: EquipmentStatus) => {
    if ((row && !canUpdate) || (!row && !canCreate)) { message.error("当前权限不允许此操作"); return; }
    setEditing(row); const runtime = Number(row?.runtimeMinutes ?? 0); const fault = Number(row?.faultMinutes ?? 0);
    const equipmentId = row?.equipmentId; setSelectedEquipmentId(equipmentId);
    form.setFieldsValue({ equipmentId, reportDate: row?.reportDate ? dayjs(row.reportDate) : dayjs(), runtimeHours: Math.floor(runtime / 60), runtimeMinutePart: runtime % 60, faultHours: Math.floor(fault / 60), faultMinutePart: fault % 60, faultReason: row?.faultReason ?? undefined });
    setOpen(true);
  };
  const save = async () => {
    if ((editing && !canUpdate) || (!editing && !canCreate)) { message.error("当前权限不允许此操作"); setOpen(false); return; }
    try {
      const values = await form.validateFields(); setSaving(true);
      const runtimeMinutes = Number(values.runtimeHours ?? 0) * 60 + Number(values.runtimeMinutePart ?? 0);
      const faultMinutes = Number(values.faultHours ?? 0) * 60 + Number(values.faultMinutePart ?? 0);
      if (faultMinutes > 0 && !values.faultReason) { form.setFields([{ name: "faultReason", errors: ["故障时长大于0时必须选择故障原因"] }]); return; }
      await api(editing ? `/equipment/status-reports/${editing.id}` : "/equipment/status-reports", {
        method: editing ? "PATCH" : "POST", body: JSON.stringify({ equipmentId: values.equipmentId, reportDate: values.reportDate.format("YYYY-MM-DD"), runtimeMinutes, faultMinutes, faultReason: values.faultReason ?? null, expectedVersion: editing?.version })
      });
      message.success(editing ? "设备状态已更新" : "设备状态已填报"); setOpen(false); refresh(); void queryClient.invalidateQueries({ queryKey: ["equipment-dashboard"] });
    } catch (error: any) {
      if (!Array.isArray(error?.errorFields)) message.error(errorText(error));
    } finally { setSaving(false); }
  };
  const remove = (row: EquipmentStatus) => Modal.confirm({
    title: `删除 ${row.equipmentCode} 在 ${row.reportDate} 的填报？`, okText: "确认删除", okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await api(`/equipment/status-reports/${row.id}?expectedVersion=${row.version}`, { method: "DELETE" });
        await refresh(); void queryClient.invalidateQueries({ queryKey: ["equipment-dashboard"] });
        message.success("填报记录已删除");
      } catch (error) { message.error(errorText(error)); throw error; }
    }
  });
  const columns: any[] = [
    { title: "设备编号", dataIndex: "equipmentCode", width: 150, fixed: "left" }, { title: "设备名称", dataIndex: "equipmentName", width: 210 },
    { title: "使用部门", dataIndex: "usageDepartmentName", width: 130 }, { title: "事业部", dataIndex: "divisionName", width: 110 },
    { title: "责任人", dataIndex: "responsibleUserIds", width: 220, render: (_ids: string[], row: EquipmentStatus) => row.responsibleUsers?.length
      ? row.responsibleUsers.map((user) => <Tag key={user.id}>{user.displayName}</Tag>)
      : <Typography.Text type="warning">未指定</Typography.Text> },
    { title: "填报日期", dataIndex: "reportDate", width: 120, render: (value: string) => dayjs(value).format("YYYY-MM-DD") },
    { title: "运行时长", dataIndex: "runtimeMinutes", width: 130, render: durationText },
    { title: "故障时长", dataIndex: "faultMinutes", width: 130, render: (value: number) => <Typography.Text type={value > 0 ? "danger" : undefined}>{durationText(value)}</Typography.Text> },
    { title: "故障原因", dataIndex: "faultReason", width: 150, render: (value: string | null) => value ? <Tag color="red">{value}</Tag> : "—" },
    ...(canUpdate || canDelete ? [{ title: "操作", key: "actions", width: 150, fixed: "right", render: (_: unknown, row: EquipmentStatus) => <Space>
      {canUpdate && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => setInitial(row)}>编辑</Button>}
      {canDelete && <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(row)}>删除</Button>}
    </Space> }] : [])
  ];

  return <div>
    <KdosDataTable resource="equipment-status-report" rowKey="id" columns={columns} dataSource={records.data?.rows} defaultHiddenFields={["responsibleUserIds"]}
      toolbar={<>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setInitial(); }}>填报设备状态</Button>}
        {canImport && <Upload accept=".xlsx,.csv" showUploadList={false} beforeUpload={(file) => previewImport(file as File)}><Button icon={<UploadOutlined />} loading={importing}>导入</Button></Upload>}
        {(canCreate || canImport || canExport) && <Button icon={<DownloadOutlined />} loading={exportingTemplate} onClick={() => void exportTemplate()}>导出模板</Button>}
        {canExport && <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportRows()}>导出</Button>}
        <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
      </>}
      loading={records.isLoading} serverData={{ total: records.data?.total ?? 0, onQueryChange: setTableQuery }} scroll={{ x: 1450, y: "calc(100vh - 310px)" }} />
    <Modal title={editing ? "编辑设备状态" : "填报设备状态"} width={700} open={open} onCancel={() => setOpen(false)} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical" requiredMark={false}>
        {!editing && options.isSuccess && equipmentOptions.length === 0 && <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message="暂无可以填报的设备"
          description="设备总台账中尚未将任何设备标记为“需要填报”。请先由有权限的人员在设备总台账中确认需要监测的设备。" />}
        <Form.Item name="equipmentId" label="设备编号" rules={[{ required: true, message: "请选择设备编号" }]}>
          <Select autoFocus showSearch optionFilterProp="label" options={equipmentOptions} onChange={setSelectedEquipmentId} disabled={Boolean(editing)}
            loading={options.isLoading} notFoundContent="暂无标记为需要填报的设备" placeholder="先选择设备编号" />
        </Form.Item>
        <div className="equipment-form-grid equipment-auto-fields">
          <Form.Item label="设备名称"><Input readOnly value={selectedEquipment?.equipmentName ?? editing?.equipmentName ?? ""} /></Form.Item>
          <Form.Item label="使用部门"><Input readOnly value={selectedEquipment?.usageDepartmentName ?? editing?.usageDepartmentName ?? ""} /></Form.Item>
          <Form.Item label="事业部"><Input readOnly value={selectedEquipment?.divisionName ?? editing?.divisionName ?? ""} /></Form.Item>
          <Form.Item name="reportDate" label="填报日期" rules={[{ required: true, message: "请选择填报日期" }]}>
            <DatePicker allowClear={false} style={{ width: "100%" }} format="YYYY-MM-DD" disabledDate={(date) => date.startOf("day").isAfter(dayjs().startOf("day")) || date.startOf("day").isBefore(dayjs().subtract(6, "day").startOf("day"))} />
          </Form.Item>
          <DurationFields prefix="runtime" label="运行时长" />
          <DurationFields prefix="fault" label="故障时长" />
          <Form.Item name="faultReason" label="故障原因" className="equipment-form-wide"><Select allowClear options={(options.data?.faultReasons ?? []).map((value) => ({ value, label: value }))} placeholder="无故障可不选；有故障必须选择" /></Form.Item>
        </div>
      </Form>
    </Modal>
    <Modal title="设备状态导入预览" width={760} open={Boolean(importPreview)} onCancel={() => setImportPreview(undefined)}
      okText="确认导入" okButtonProps={{ disabled: Boolean(importPreview?.errors.length || !importPreview?.rows.length) }} confirmLoading={confirmingImport} onOk={() => void confirmImport()} destroyOnHidden>
      {importPreview && <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert type={importPreview.errors.length ? "error" : "success"} showIcon
          message={importPreview.errors.length ? `发现 ${importPreview.errors.length} 项错误，修正文件后重新导入` : "文件校验通过，可以确认导入"}
          description={`共 ${importPreview.total} 条；预计新增 ${importPreview.createCount} 条、更新 ${importPreview.updateCount} 条、未变化 ${importPreview.unchangedCount} 条。`} />
        {importPreview.errors.slice(0, 20).map((error) => <Typography.Text type="danger" key={`${error.rowNumber}-${error.message}`}>第 {error.rowNumber} 行：{error.message}</Typography.Text>)}
      </Space>}
    </Modal>
  </div>;
}

type DashboardData = {
  windowStart: string; windowEnd: string; windowDays: number;
  metrics: Record<string, number>;
  divisionRows: Array<{
    division: string; equipmentCount: number; normalCount: number; faultCount: number; idleCount: number; unreportedCount: number;
    runtimeMinutes: number; faultMinutes: number; runtimeDailyAverageMinutes: number; faultDailyAverageMinutes: number;
  }>;
  departmentRows: Array<{
    division: string; departmentId: string | null; department: string; equipmentCount: number; normalCount: number; faultCount: number; idleCount: number; unreportedCount: number;
    runtimeMinutes: number; faultMinutes: number; runtimeDailyAverageMinutes: number; faultDailyAverageMinutes: number;
  }>;
  filters: {
    divisions: Array<{ id: string; name: string }>;
    departments: Array<{ id: string; name: string }>;
  };
};

type DashboardPeriodType = "day" | "month" | "year" | "custom";
const { RangePicker } = DatePicker;

export function EquipmentDashboardPage() {
  const [periodType, setPeriodType] = useState<DashboardPeriodType>("day");
  const [period, setPeriod] = useState(() => shanghaiYesterday());
  const [customRange, setCustomRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => {
    const yesterday = shanghaiYesterday();
    return [yesterday.startOf("month"), yesterday];
  });
  const [divisionId, setDivisionId] = useState<string>();
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const dashboard = useQuery({
    queryKey: ["equipment-dashboard", periodType, period.format("YYYY-MM-DD"), customRange[0].format("YYYY-MM-DD"), customRange[1].format("YYYY-MM-DD"), divisionId, departmentIds.join("|")],
    queryFn: () => {
      const query = new URLSearchParams({ periodType });
      if (periodType === "day") query.set("period", period.format("YYYY-MM-DD"));
      if (periodType === "month") query.set("period", period.format("YYYY-MM"));
      if (periodType === "year") query.set("period", period.format("YYYY"));
      if (periodType === "custom") { query.set("startDate", customRange[0].format("YYYY-MM-DD")); query.set("endDate", customRange[1].format("YYYY-MM-DD")); }
      if (divisionId) query.set("divisionId", divisionId);
      for (const departmentId of departmentIds) query.append("departmentId", departmentId);
      return api<DashboardData>(`/equipment/dashboard?${query.toString()}`);
    },
    refetchInterval: 30 * 60_000
  });
  const data = dashboard.data;
  const metrics = data?.metrics ?? {};
  const firstBatchMonitoring = Number(metrics.firstBatchMonitoringEquipment ?? 0);
  const divisionOptions = (data?.filters.divisions ?? []).map((item) => ({ value: item.id, label: item.name }));
  const departmentOptions = (data?.filters.departments ?? []).map((item) => ({ value: item.id, label: item.name }));
  const resetFilters = () => {
    const yesterday = shanghaiYesterday();
    setPeriodType("day"); setPeriod(yesterday); setCustomRange([yesterday.startOf("month"), yesterday]); setDivisionId(undefined); setDepartmentIds([]);
  };
  const updateCustomRange = (value: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) => {
    if (!value?.[0] || !value[1]) return;
    if (value[1].isAfter(value[0].add(24, "month"))) { message.error("自定义日期跨度不能超过24个月"); return; }
    setCustomRange([value[0], value[1]]);
  };
  return <div className="equipment-dashboard">
    <Flex justify="flex-end" className="equipment-dashboard-toolbar">
      <Space wrap>
        <Select aria-label="设备驾驶舱统计周期" value={periodType} onChange={setPeriodType} style={{ width: 112 }} options={[{ value: "day", label: "按日" }, { value: "month", label: "按月" }, { value: "year", label: "按年" }, { value: "custom", label: "自定义日期" }]} />
        {periodType !== "custom" ? <DatePicker aria-label="设备驾驶舱统计日期" allowClear={false} picker={periodType === "day" ? "date" : periodType} value={period} onChange={(value) => value && setPeriod(value)} format={periodType === "day" ? "YYYY-MM-DD" : periodType === "year" ? "YYYY年" : "YYYY年M月"} style={{ width: 150 }} />
          : <RangePicker aria-label="设备驾驶舱自定义日期" allowClear={false} value={customRange} onChange={updateCustomRange} format="YYYY-MM-DD" />}
        <Select aria-label="设备驾驶舱事业部筛选" allowClear showSearch optionFilterProp="label" placeholder="事业部" value={divisionId}
          onChange={(value) => { setDivisionId(value); setDepartmentIds([]); }} style={{ width: 170 }} options={divisionOptions} />
        <Select aria-label="设备驾驶舱部门筛选" mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive"
          placeholder="部门（可多选）" value={departmentIds} onChange={setDepartmentIds} style={{ minWidth: 220, maxWidth: 360 }} options={departmentOptions} />
        <Button onClick={resetFilters}>清空筛选</Button>
        <Button type="primary" icon={<ReloadOutlined />} loading={dashboard.isFetching} onClick={() => void dashboard.refetch()}>刷新数据</Button>
        <TablePermissionButton resource="equipment-dashboard" />
      </Space>
    </Flex>
    <Typography.Title level={4}>设备情况统计</Typography.Title>
    <div className="equipment-kpi-grid">
      <Card className="equipment-kpi-card equipment-kpi-card-total"><Statistic title="设备总数量" value={metrics.totalEquipment ?? 0} suffix="台" /></Card>
      <Card className="equipment-kpi-card equipment-kpi-card-monitoring"><Statistic title="首批监控数量" value={firstBatchMonitoring} suffix="台" /></Card>
      <Card className="equipment-kpi-card equipment-kpi-card-pending"><Statistic title="待上线数量" value={metrics.pendingGoLiveEquipment ?? 0} suffix="台" /></Card>
      <Card className="equipment-kpi-card equipment-kpi-card-recorded"><Statistic title="有数据设备" value={metrics.dailyRecordedEquipment ?? 0} suffix="台" /></Card>
      <Card><Statistic title="正常运行" value={metrics.normalEquipment ?? 0} suffix="台" valueStyle={{ color: "#2e9363" }} /></Card>
      <Card><Statistic title="存在故障" value={metrics.faultEquipment ?? 0} suffix="台" valueStyle={{ color: "#cf3f3f" }} /></Card>
      <Card><Statistic title="运行总时长" value={durationText(metrics.runtimeMinutes)} /></Card>
      <Card><Statistic title="运行日均" value={durationText(metrics.runtimeDailyAverageMinutes)} /></Card>
      <Card><Statistic title="故障总时长" value={durationText(metrics.faultMinutes)} valueStyle={{ color: Number(metrics.faultMinutes) > 0 ? "#cf3f3f" : undefined }} /></Card>
      <Card><Statistic title="故障日均" value={durationText(metrics.faultDailyAverageMinutes)} valueStyle={{ color: Number(metrics.faultDailyAverageMinutes) > 0 ? "#cf3f3f" : undefined }} /></Card>
    </div>
    <Card className="equipment-analysis-card" title="按事业部设备运行分析" loading={dashboard.isLoading}>
      <KdosDataTable resource="equipment-dashboard" simple systemFields={false} pagination={false} rowKey="division" dataSource={data?.divisionRows} scroll={{ x: 1300 }} columns={[
        { title: "事业部", dataIndex: "division", width: 150, fixed: "left" }, { title: "监控设备", dataIndex: "equipmentCount", width: 100 },
        { title: "正常运行", dataIndex: "normalCount", width: 100, render: (value: number) => <Typography.Text type={value ? "success" : undefined}>{value}</Typography.Text> },
        { title: "存在故障", dataIndex: "faultCount", width: 100, render: (value: number) => <Typography.Text type={value ? "danger" : undefined}>{value}</Typography.Text> },
        { title: "未运行", dataIndex: "idleCount", width: 90 }, { title: "未填报", dataIndex: "unreportedCount", width: 90 },
        { title: "运行总时长", dataIndex: "runtimeMinutes", width: 140, render: durationText }, { title: "运行日均", dataIndex: "runtimeDailyAverageMinutes", width: 140, render: durationText },
        { title: "故障总时长", dataIndex: "faultMinutes", width: 140, render: (value: number) => <Typography.Text type={value ? "danger" : undefined}>{durationText(value)}</Typography.Text> },
        { title: "故障日均", dataIndex: "faultDailyAverageMinutes", width: 140, render: (value: number) => <Typography.Text type={value ? "danger" : undefined}>{durationText(value)}</Typography.Text> }
      ]} />
    </Card>
    <Card className="equipment-analysis-card" title="按部门设备运行分析" loading={dashboard.isLoading}>
      <KdosDataTable resource="equipment-dashboard" simple systemFields={false} pagination={false}
        rowKey={(row) => `${row.division}-${row.departmentId ?? `unassigned-${row.department}`}`} dataSource={data?.departmentRows} scroll={{ x: 1450 }} columns={[
          { title: "事业部", dataIndex: "division", width: 150, fixed: "left" }, { title: "部门", dataIndex: "department", width: 150, fixed: "left" }, { title: "监控设备", dataIndex: "equipmentCount", width: 100 },
          { title: "正常运行", dataIndex: "normalCount", width: 100, render: (value: number) => <Typography.Text type={value ? "success" : undefined}>{value}</Typography.Text> },
          { title: "存在故障", dataIndex: "faultCount", width: 100, render: (value: number) => <Typography.Text type={value ? "danger" : undefined}>{value}</Typography.Text> },
          { title: "未运行", dataIndex: "idleCount", width: 90 }, { title: "未填报", dataIndex: "unreportedCount", width: 90 },
          { title: "运行总时长", dataIndex: "runtimeMinutes", width: 140, render: durationText }, { title: "运行日均", dataIndex: "runtimeDailyAverageMinutes", width: 140, render: durationText },
          { title: "故障总时长", dataIndex: "faultMinutes", width: 140, render: (value: number) => <Typography.Text type={value ? "danger" : undefined}>{durationText(value)}</Typography.Text> },
          { title: "故障日均", dataIndex: "faultDailyAverageMinutes", width: 140, render: (value: number) => <Typography.Text type={value ? "danger" : undefined}>{durationText(value)}</Typography.Text> }
        ]} />
    </Card>
  </div>;
}
