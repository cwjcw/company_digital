import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  AuditOutlined, CalendarOutlined, DatabaseOutlined, FileExcelOutlined, FolderOpenOutlined, LogoutOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, ScheduleOutlined
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, App as AntApp, Button, Card, DatePicker, Form,
  Input, InputNumber, Layout, Menu, Modal, Select, Space,
  Table, Tabs, Tag, TreeSelect, Typography, Upload, Switch, Checkbox, message
} from "antd";
import dayjs from "dayjs";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "./api";
import { DailyProgress, SalesSummaryDashboard, SalesSummaryDetails } from "./modules/planning/pages/OperationalPlanningPages";
import {
  FieldVisibility, ImportFeedbackAlert, InlineText, PageHeader, auditColumns, auditLabels,
  downloadApiFile, failedImport, inboundBusinessFields, inboundFieldLabels, inboundFields, isAuditField,
  parseCsvFile, type ImportFeedback
} from "./shared/legacy-ui";

ModuleRegistry.registerModules([AllCommunityModule]);
const { Header, Sider, Content } = Layout;
const { Text } = Typography;
const KdosMonthlyPlanPage = lazy(() => import("./modules/planning/pages/MonthlyPlanPage").then((module) => ({ default: module.MonthlyPlanPage })));

function KdosMonthlyPlanRoute() {
  const { period = "" } = useParams();
  if (!/^\d{6}$/.test(period)) return <Navigate to="/monthly/202609" replace />;
  const year = Number(period.slice(0, 4)); const month = Number(period.slice(4, 6));
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return <Navigate to="/monthly/202609" replace />;
  return <Suspense fallback={<Alert type="info" showIcon message="正在加载 Planning Center…" />}><KdosMonthlyPlanPage year={year} month={month} /></Suspense>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const submit = async (values: { username: string; password: string }) => {
    setLoading(true);
    setLoginError("");
    try {
      const result = await api<any>("/auth/login", { method: "POST", body: JSON.stringify(values) });
      localStorage.setItem("accessToken", result.accessToken);
      localStorage.setItem("refreshToken", result.refreshToken);
      localStorage.setItem("sessionUser", JSON.stringify(result.user));
      onLogin();
    } catch (error) {
      const errorMessage = error instanceof ApiError
        ? error.message
        : error instanceof TypeError
          ? "无法连接服务器，请确认后端服务已启动并检查网络连接"
          : error instanceof Error ? error.message : "登录失败，请稍后重试";
      setLoginError(errorMessage);
      message.error(errorMessage);
    } finally { setLoading(false); }
  };
  return <div className="login-shell">
    <Card className="login-card">
      <div className="login-mark">KD</div>
      <div className="login-title">凯南数字化工作台</div>
      <Text type="secondary">Kainan Digital OS · Planning Center</Text>
      {loginError && <Alert type="error" showIcon message={loginError} style={{ marginTop: 16 }} />}
      <Form layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}><Input autoFocus size="large" /></Form.Item>
        <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password size="large" /></Form.Item>
        <Button htmlType="submit" type="primary" loading={loading} block size="large">登录</Button>
      </Form>
    </Card>
  </div>;
}

function Shell({ logout }: { logout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  const monthlyPages = Array.from({ length: 5 }, (_, index) => 8 + index).map((month) => {
    const period = `2026${String(month).padStart(2, "0")}`;
    return { key: `/monthly/${period}`, label: period };
  });
  const menu = [
    { key: "main", label: "主计划", type: "group" as const, children: [
      { key: "/sales-summary-dashboard", icon: <ScheduleOutlined />, label: "销售接单汇总大屏" },
      { key: "/sales-summary-details", icon: <FileExcelOutlined />, label: "销售接单明细" },
      { key: "/monthly", icon: <FileExcelOutlined />, label: "月度计划", children: [
        { key: "/daily-progress", icon: <CalendarOutlined />, label: "日进度" },
        { key: "/monthly/2026", icon: <FolderOpenOutlined />, label: "2026年", children: monthlyPages }
      ] }
    ] },
    { key: "master", label: "基础资料", type: "group" as const, children: [
      { key: "/master-data", icon: <DatabaseOutlined />, label: "基础资料维护" },
      { key: "/finished-goods-inbound", icon: <FileExcelOutlined />, label: "成品入库" }
    ] },
    { key: "system", label: "系统管理", type: "group" as const, children: [
      { key: "/audit", icon: <AuditOutlined />, label: "审计日志" }
    ] }
  ];
  const enhancedMenu = [...menu, {
    key: "access-pages", label: "账户与接口", type: "group" as const, children: [
      { key: "/users", icon: <DatabaseOutlined />, label: "用户与角色" },
      ...(user.roles?.includes("系统管理员") ? [{ key: "/api-keys", icon: <DatabaseOutlined />, label: "API Key" }] : [])
    ]
  }];
  return <Layout className={`app-shell${collapsed ? " sidebar-is-collapsed" : ""}`}>
    <Sider collapsed={collapsed} collapsedWidth={64} width={238} className="sidebar">
      <div className="brand"><span className="brand-badge">KD</span>{!collapsed && <span>凯南数字化工作台</span>}</div>
      <Menu mode="inline" theme="dark" selectedKeys={[location.pathname]} defaultOpenKeys={["/monthly", "/monthly/2026"]} items={enhancedMenu} onClick={({ key }) => navigate(key)} />
      <Button className="sidebar-collapse" type="primary" shape="circle" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
    </Sider>
    <Layout>
      <Header className="topbar">
        <div className="topbar-page-title">{
          /^\/monthly\/\d{6}$/.test(location.pathname)
            ? `${location.pathname.slice(-6, -2)}年${Number(location.pathname.slice(-2))}月计划`
            : location.pathname === "/daily-progress" ? "日进度" : ""
        }</div>
        <div className="topbar-user"><div><Text strong>{user.displayName ?? user.username}</Text><br /><Text type="secondary">{user.roles?.join(" / ")}</Text></div>
          <Button icon={<LogoutOutlined />} onClick={logout}>退出</Button></div>
      </Header>
      <Content className="content">
        <Routes>
          <Route path="/rolling" element={<Navigate to="/sales-summary-details" replace />} />
          <Route path="/sales-summary-dashboard" element={<SalesSummaryDashboard />} />
          <Route path="/sales-summary-details" element={<SalesSummaryDetails />} />
          <Route path="/monthly" element={<Navigate to="/monthly/202608" replace />} />
          <Route path="/monthly/:period" element={<KdosMonthlyPlanRoute />} />
          <Route path="/daily-progress" element={<DailyProgress />} />
          <Route path="/master-data" element={<DataOperations />} />
          <Route path="/data-operations" element={<DataOperations />} />
          <Route path="/finished-goods-inbound" element={<FinishedGoodsInboundPage />} />
          <Route path="/audit" element={<AuditLogs />} />
          <Route path="/admin" element={<AdminCenter />} />
          <Route path="/users" element={<AdminCenter />} />
          <Route path="/contacts" element={<ContactDirectory />} />
          <Route path="/api-keys" element={<ApiKeyCenter />} />
          <Route path="*" element={<Navigate to="/sales-summary-details" replace />} />
        </Routes>
      </Content>
    </Layout>
  </Layout>;
}

function DataOperations() {
  const queryClient = useQueryClient();
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api<any[]>("/master-data/suppliers") });
  const dictionaries = useQuery({ queryKey: ["dictionaries"], queryFn: () => api<any[]>("/master-data/dictionaries") });
  const processes = useQuery({ queryKey: ["processes"], queryFn: () => api<any[]>("/master-data/processes") });
  const [supplierIds, setSupplierIds] = useState<React.Key[]>([]);
  const [dictionaryIds, setDictionaryIds] = useState<React.Key[]>([]);
  const [processIds, setProcessIds] = useState<React.Key[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>();
  const [supplierForm] = Form.useForm();
  const [dictionaryForm] = Form.useForm();
  const [processForm] = Form.useForm();
  const baseUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const supplierFields = ["code", "name", "remark", "enabled"];
  const dictionaryFields = ["code", "typeName", "value", "sortOrder", "enabled"];
  const processFields = ["sortOrder", "code", "name", "enableRequiredDays", "enableDueDate", "enableStatus", "enableException", "enabled"];
  const [supplierVisible, setSupplierVisible] = useState<string[]>(() => { const saved = JSON.parse(localStorage.getItem(`suppliers-visible-fields:${baseUser}`) ?? "[]"); return [...saved, ...supplierFields.filter((field) => !saved.includes(field))]; });
  const [dictionaryVisible, setDictionaryVisible] = useState<string[]>(() => { const saved = JSON.parse(localStorage.getItem(`dictionaries-visible-fields:${baseUser}`) ?? "[]"); return [...saved, ...dictionaryFields.filter((field) => !saved.includes(field))]; });
  const [processVisible, setProcessVisible] = useState<string[]>(() => { const saved = JSON.parse(localStorage.getItem(`processes-visible-fields:${baseUser}`) ?? "[]"); return [...saved, ...processFields.filter((field) => !saved.includes(field))]; });
  useEffect(() => {
    localStorage.setItem(`suppliers-visible-fields:${baseUser}`, JSON.stringify(supplierVisible));
    localStorage.setItem(`dictionaries-visible-fields:${baseUser}`, JSON.stringify(dictionaryVisible));
    localStorage.setItem(`processes-visible-fields:${baseUser}`, JSON.stringify(processVisible));
  }, [baseUser, supplierVisible, dictionaryVisible, processVisible]);
  const refresh = (key: string) => void queryClient.invalidateQueries({ queryKey: [key] });
  const dictionaryRows = (dictionaries.data ?? []).flatMap((type: any) => type.values.map((value: any) => ({ ...value, typeId: type.id, code: type.code, typeName: type.name })));
  const updateSupplier = async (id: string, field: string, value: unknown) => {
    try {
      await api(`/master-data/suppliers/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
      refresh("suppliers");
    } catch (error) {
      message.error((error as Error).message);
      refresh("suppliers");
      throw error;
    }
  };
  const updateDictionaryType = async (id: string, field: string, value: unknown) => { await api(`/master-data/dictionary-types/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); refresh("dictionaries"); };
  const updateDictionaryValue = async (id: string, field: string, value: unknown) => { await api(`/master-data/dictionary-values/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); refresh("dictionaries"); };
  const updateProcess = async (id: string, field: string, value: unknown) => { await api(`/master-data/processes/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); refresh("processes"); };
  const importMasterFile = async (file: File, kind: "suppliers" | "dictionaries") => {
    const form = new FormData();
    form.append("file", file);
    setImporting(kind);
    try {
      const result = await api<{ imported: number; skipped?: number }>(`/master-data/${kind}/import-file`, { method: "POST", body: form });
      setImportFeedback({ type: "success", message: `全部校验通过，成功导入 ${result.imported} 行` });
      refresh(kind);
    } catch (error) {
      setImportFeedback(failedImport(error));
    } finally {
      setImporting(undefined);
    }
    return false;
  };
  const downloadTemplate = async (kind: "suppliers" | "dictionaries", format: "xlsx" | "csv") => {
    const name = ({
      suppliers: "供应商导入模板",
      dictionaries: "字典导入模板",
    } as const)[kind];
    try {
      await downloadApiFile(`/master-data/templates/${kind}?format=${format}`, `${name}.${format}`);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const supplierColumns = [
    { title: "编码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row.id, "code", v)} /> },
    { title: "名称", dataIndex: "name", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row.id, "name", v)} /> },
    { title: "备注", dataIndex: "remark", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row.id, "remark", v)} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <Switch checked={value} onChange={(v) => void updateSupplier(row.id, "enabled", v)} /> },
    ...auditColumns
  ].filter((column) => isAuditField(column.dataIndex) || supplierVisible.includes(column.dataIndex));
  const dictionaryColumns = [
    { title: "字典编码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryType(row.typeId, "code", v)} /> },
    { title: "字典名称", dataIndex: "typeName", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryType(row.typeId, "name", v)} /> },
    { title: "值", dataIndex: "value", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryValue(row.id, "value", v)} /> },
    { title: "顺序", dataIndex: "sortOrder", render: (value: unknown, row: any) => <InlineText type="number" value={value} onSave={(v) => updateDictionaryValue(row.id, "sortOrder", v)} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <Switch checked={value} onChange={(v) => void updateDictionaryValue(row.id, "enabled", v)} /> },
    ...auditColumns
  ].filter((column) => isAuditField(column.dataIndex) || dictionaryVisible.includes(column.dataIndex));
  const processColumns = [
    { title: "顺序", dataIndex: "sortOrder", render: (value: unknown, row: any) => <InlineText type="number" value={value} onSave={(v) => updateProcess(row.id, "sortOrder", v)} /> },
    { title: "代码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateProcess(row.id, "code", v)} /> },
    { title: "名称", dataIndex: "name", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateProcess(row.id, "name", v)} /> },
    ...["enableRequiredDays", "enableDueDate", "enableStatus", "enableException", "enabled"].map((field) => ({ title: ({ enableRequiredDays: "所需天数", enableDueDate: "交期", enableStatus: "状态", enableException: "异常", enabled: "启用" } as any)[field], dataIndex: field, render: (value: boolean, row: any) => <Switch checked={value} onChange={(v) => void updateProcess(row.id, field, v)} /> })),
    ...auditColumns
  ].filter((column) => isAuditField(column.dataIndex) || processVisible.includes(column.dataIndex));

  return <div><PageHeader title="基础数据维护" subtitle="表格内容可直接编辑；复选框支持多选" actions={<Space>
    <Button onClick={() => { supplierForm.resetFields(); supplierForm.setFieldsValue({ enabled: true }); setSupplierOpen(true); }}>新增供应商</Button>
    <Button onClick={() => setDictionaryOpen(true)}>新增字典值</Button>
    <Button onClick={() => setProcessOpen(true)}>新增工序</Button>
  </Space>} />
    <ImportFeedbackAlert value={importFeedback} onClose={() => setImportFeedback(undefined)} />
    <Tabs items={[
      { key: "suppliers", label: `供应商（${suppliers.data?.length ?? 0}）`, children: <>
        <Space wrap className="master-data-toolbar">
          <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importMasterFile(file as File, "suppliers")}>
            <Button loading={importing === "suppliers"}>导入供应商（CSV/XLSX）</Button>
          </Upload>
          <Button onClick={() => void downloadTemplate("suppliers", "xlsx")}>下载 XLSX 模板</Button>
          <Button onClick={() => void downloadTemplate("suppliers", "csv")}>下载 CSV 模板</Button>
          <Button danger disabled={!supplierIds.length} onClick={async () => { await api("/master-data/suppliers/delete", { method: "POST", body: JSON.stringify({ ids: supplierIds }) }); setSupplierIds([]); refresh("suppliers"); }}>停用选中（{supplierIds.length}）</Button>
          <FieldVisibility all={supplierFields.map((key) => ({ key, label: ({ code: "编码", name: "名称", remark: "备注", enabled: "启用", ...auditLabels } as any)[key] }))} visible={supplierVisible} onChange={setSupplierVisible} />
        </Space>
        <Table rowKey="id" rowSelection={{ selectedRowKeys: supplierIds, onChange: setSupplierIds }} dataSource={suppliers.data} pagination={{ pageSize: 50 }} columns={supplierColumns} scroll={{ x: "max-content" }} />
      </> },
      { key: "dictionaries", label: `字典值（${dictionaryRows.length}）`, children: <>
        <Space wrap className="master-data-toolbar">
          <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importMasterFile(file as File, "dictionaries")}>
            <Button loading={importing === "dictionaries"}>导入字典（CSV/XLSX）</Button>
          </Upload>
          <Button onClick={() => void downloadTemplate("dictionaries", "xlsx")}>下载 XLSX 模板</Button>
          <Button onClick={() => void downloadTemplate("dictionaries", "csv")}>下载 CSV 模板</Button>
          <Button danger disabled={!dictionaryIds.length} onClick={async () => { await api("/master-data/dictionary-values/delete", { method: "POST", body: JSON.stringify({ ids: dictionaryIds }) }); setDictionaryIds([]); refresh("dictionaries"); }}>停用选中（{dictionaryIds.length}）</Button>
          <FieldVisibility all={dictionaryFields.map((key) => ({ key, label: ({ code: "字典编码", typeName: "字典名称", value: "值", sortOrder: "顺序", enabled: "启用", ...auditLabels } as any)[key] }))} visible={dictionaryVisible} onChange={setDictionaryVisible} />
        </Space>
        <Table rowKey="id" rowSelection={{ selectedRowKeys: dictionaryIds, onChange: setDictionaryIds }} dataSource={dictionaryRows} pagination={{ pageSize: 50 }} columns={dictionaryColumns} scroll={{ x: "max-content" }} />
      </> },
      { key: "processes", label: `工序（${processes.data?.length ?? 0}）`, children: <>
        <Space wrap className="master-data-toolbar">
          <Upload accept=".csv" showUploadList={false} beforeUpload={async (file) => {
            try {
              const rows = await parseCsvFile(file as File);
              const result = await api<{ imported: number }>("/master-data/processes/import", { method: "POST", body: JSON.stringify({ rows: rows.map((row: any, index) => ({ ...row, __row: index + 2, sortOrder: Number(row.sortOrder ?? row["顺序"]), enableRequiredDays: String(row.enableRequiredDays ?? row["所需天数"]).toLowerCase() === "true", enableDueDate: String(row.enableDueDate ?? row["交期"]).toLowerCase() === "true", enableStatus: String(row.enableStatus ?? row["状态"]).toLowerCase() === "true", enableException: String(row.enableException ?? row["异常"]).toLowerCase() === "true" })) }) });
              setImportFeedback({ type: "success", message: `全部校验通过，成功导入 ${result.imported} 行` }); refresh("processes");
            } catch (error) { setImportFeedback(failedImport(error)); }
            return false;
          }}><Button>导入工序 CSV</Button></Upload>
          <Button danger disabled={!processIds.length} onClick={async () => { await api("/master-data/processes/delete", { method: "POST", body: JSON.stringify({ ids: processIds }) }); setProcessIds([]); refresh("processes"); }}>停用选中（{processIds.length}）</Button>
          <FieldVisibility all={processFields.map((key) => ({ key, label: ({ sortOrder: "顺序", code: "代码", name: "名称", enableRequiredDays: "所需天数", enableDueDate: "交期", enableStatus: "状态", enableException: "异常", enabled: "启用", ...auditLabels } as any)[key] }))} visible={processVisible} onChange={setProcessVisible} />
        </Space>
        <Table rowKey="id" rowSelection={{ selectedRowKeys: processIds, onChange: setProcessIds }} dataSource={processes.data} pagination={false} columns={processColumns} scroll={{ x: "max-content" }} />
      </> }
    ]} />
    <Modal title="新增供应商" open={supplierOpen} onCancel={() => setSupplierOpen(false)} onOk={async () => {
      try {
        const values = await supplierForm.validateFields();
        await api("/master-data/suppliers", { method: "POST", body: JSON.stringify(values) });
        message.success("供应商新增成功");
        setSupplierOpen(false);
        supplierForm.resetFields();
        refresh("suppliers");
      } catch (error) {
        if (error instanceof ApiError) message.error(error.message);
      }
    }}><Form form={supplierForm} layout="vertical" initialValues={{ enabled: true }}>
      <Form.Item name="code" label="编码" rules={[{ required: true, whitespace: true, message: "请输入供应商编码" }]}><Input placeholder="编码全表唯一" /></Form.Item>
      <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请输入供应商名称" }]}><Input /></Form.Item>
      <Form.Item name="remark" label="备注"><Input /></Form.Item>
      <Form.Item name="enabled" label="是否启用" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
    </Form></Modal>
    <Modal title="新增字典值" open={dictionaryOpen} onCancel={() => setDictionaryOpen(false)} onOk={() => dictionaryForm.validateFields().then(async (values) => { await api("/master-data/dictionaries", { method: "POST", body: JSON.stringify(values) }); setDictionaryOpen(false); dictionaryForm.resetFields(); refresh("dictionaries"); })}><Form form={dictionaryForm} layout="vertical"><Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="名称"><Input /></Form.Item><Form.Item name="value" label="值" rules={[{ required: true }]}><Input /></Form.Item></Form></Modal>
    <Modal title="新增工序" open={processOpen} onCancel={() => setProcessOpen(false)} onOk={() => processForm.validateFields().then(async (values) => { await api("/master-data/processes", { method: "POST", body: JSON.stringify(values) }); setProcessOpen(false); processForm.resetFields(); refresh("processes"); })}><Form form={processForm} layout="vertical" initialValues={{ sortOrder: 1, enableDueDate: true, enableStatus: true, enabled: true }}><Form.Item name="sortOrder" label="顺序"><InputNumber /></Form.Item><Form.Item name="code" label="代码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="enableRequiredDays" label="所需天数" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableDueDate" label="交期" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableStatus" label="状态" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableException" label="异常" valuePropName="checked"><Switch /></Form.Item></Form></Modal>
  </div>;
}

function FinishedGoodsInboundPage() {
  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: ["finished-goods-inbound"],
    queryFn: () => api<any[]>("/master-data/finished-goods-inbound")
  });
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>();
  const [exporting, setExporting] = useState<string>();
  const [form] = Form.useForm();
  const userKey = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const visibilityKey = `finished-goods-inbound-visible-fields:${userKey}`;
  const [visibleFields, setVisibleFields] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem(visibilityKey) ?? JSON.stringify(inboundBusinessFields))
  );
  useEffect(() => {
    localStorage.setItem(visibilityKey, JSON.stringify(visibleFields));
  }, [visibilityKey, visibleFields]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finished-goods-inbound"] });
  const updateRow = async (id: string, field: string, value: unknown) => {
    try {
      await api(`/master-data/finished-goods-inbound/${id}`, {
        method: "PATCH", body: JSON.stringify({ [field]: value })
      });
      refresh();
    } catch (error) {
      message.error((error as Error).message);
      refresh();
      throw error;
    }
  };
  const importFile = async (file: File) => {
    const body = new FormData(); body.append("file", file);
    setImporting(true);
    try {
      const result = await api<{ imported: number; skipped?: number }>("/master-data/finished-goods-inbound/import-file", {
        method: "POST", body
      });
      setImportFeedback({ type: "success", message: `全部校验通过，成功导入 ${result.imported} 行` });
      refresh();
    } catch (error) { setImportFeedback(failedImport(error)); }
    finally { setImporting(false); }
    return false;
  };
  const downloadTemplate = async (format: "xlsx" | "csv") => {
    try {
      await downloadApiFile(`/master-data/templates/finished-goods-inbound?format=${format}`, `成品入库导入模板.${format}`);
    } catch (error) { message.error((error as Error).message); }
  };
  const exportData = async (format: "xlsx" | "csv") => {
    setExporting(format);
    try {
      await downloadApiFile(`/master-data/finished-goods-inbound/export?format=${format}`, `成品入库数据.${format}`);
      message.success(`成品入库 ${format.toUpperCase()} 已导出`);
    } catch (error) { message.error((error as Error).message); }
    finally { setExporting(undefined); }
  };
  const numericFields = new Set(["receivedQuantity", "unitPrice", "totalAmount"]);
  const dateFields = new Set(["documentDate"]);
  const wideFields = new Set(["remark", "inventoryName", "relationInfo"]);
  const columns = inboundFields.filter((field) => isAuditField(field) || visibleFields.includes(field)).map((field) => ({
    title: inboundFieldLabels[field],
    dataIndex: field,
    width: wideFields.has(field) ? 260 : field === "createdTime" ? 190 : 145,
    render: (value: unknown, row: any) => ["createdAt", "updatedAt", "updatedBy"].includes(field)
      ? (field === "updatedBy" ? String(value ?? "system") : value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : "—")
      : <InlineText
      type={numericFields.has(field) ? "number" : dateFields.has(field) ? "date" : "text"}
      value={field === "createdTime" && value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : value}
      onSave={(next) => updateRow(row.id, field, next)}
    />
  }));

  return <div>
    <PageHeader title="成品入库" subtitle="独立维护成品入库数据；支持直接编辑、Excel/CSV 导入和导出" />
    <Space wrap className="master-data-toolbar">
      <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增成品入库</Button>
      <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importFile(file as File)}>
        <Button loading={importing}>导入成品入库（CSV/XLSX）</Button>
      </Upload>
      <Button onClick={() => void downloadTemplate("xlsx")}>下载 XLSX 模板</Button>
      <Button onClick={() => void downloadTemplate("csv")}>下载 CSV 模板</Button>
      <Button loading={exporting === "xlsx"} onClick={() => void exportData("xlsx")}>导出 XLSX</Button>
      <Button loading={exporting === "csv"} onClick={() => void exportData("csv")}>导出 CSV</Button>
      <Text type="secondary">已选择 {selectedIds.length} 行</Text>
      <FieldVisibility all={inboundBusinessFields.map((key) => ({ key, label: inboundFieldLabels[key] ?? key }))}
        visible={visibleFields} onChange={setVisibleFields} />
    </Space>
    <ImportFeedbackAlert value={importFeedback} onClose={() => setImportFeedback(undefined)} />
    <Table className="editable-master-table" rowKey="id"
      rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
      dataSource={records.data} loading={records.isLoading}
      pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
      scroll={{ x: "max-content", y: "calc(100vh - 310px)" }} columns={columns} />
    <Modal title="新增成品入库" width={1080} open={open} onCancel={() => setOpen(false)}
      onOk={() => form.validateFields().then(async (values) => {
        await api("/master-data/finished-goods-inbound", {
          method: "POST",
          body: JSON.stringify({
            ...values,
            documentDate: values.documentDate?.format("YYYY-MM-DD"),
            createdTime: values.createdTime?.toISOString()
          })
        });
        setOpen(false); form.resetFields(); message.success("成品入库记录新增成功"); refresh();
      }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={form} layout="vertical">
        <div className="master-data-form-grid inbound-form-grid">
          {inboundBusinessFields.map((field) => <Form.Item key={field} name={field} label={inboundFieldLabels[field]}
            className={field === "remark" ? "master-data-form-wide" : undefined}
            rules={["documentNumber", "inventoryCode", "relationInfo"].includes(field)
              ? [{ required: true, whitespace: true, message: `请输入${inboundFieldLabels[field]}` }] : undefined}>
            {field === "documentDate"
              ? <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              : field === "createdTime"
                ? <DatePicker showTime style={{ width: "100%" }} format="YYYY-MM-DD HH:mm:ss" />
                : numericFields.has(field)
                  ? <InputNumber style={{ width: "100%" }} precision={field === "receivedQuantity" ? 4 : 6} />
                  : field === "remark" ? <Input.TextArea rows={2} /> : <Input />}
          </Form.Item>)}
        </div>
      </Form>
    </Modal>
  </div>;
}

function AuditLogs() {
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => api<any[]>("/audit-logs") });
  return <div><PageHeader title="审计日志" subtitle="所有业务修改均记录操作者、请求号与变更前后值" />
    <Table rowKey="id" loading={logs.isLoading} dataSource={logs.data} columns={[
      { title: "用户", dataIndex: "actorName", width: 120 }, { title: "资源", dataIndex: "resource", width: 130 },
      { title: "动作", dataIndex: "action", width: 90 }, { title: "记录 ID", dataIndex: "recordId", ellipsis: true },
      { title: "来源", dataIndex: "source", width: 90 }, { title: "requestId", dataIndex: "requestId", ellipsis: true },
      ...auditColumns
    ]} scroll={{ x: "max-content" }} />
  </div>;
}

function ApiKeyCenter() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [regenerateTarget, setRegenerateTarget] = useState<any>();
  const [regenerating, setRegenerating] = useState(false);
  const [form] = Form.useForm();
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api<any[]>("/api-keys") });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<any[]>("/admin/users") });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<any[]>("/admin/roles") });
  const create = useMutation({
    mutationFn: (values: any) => {
      const scopes = values.access === "tplus-sync"
        ? ["tplus-sales-orders:*:import"]
        : values.access === "readwrite"
        ? ["rolling-plan:*:read", "monthly-plan:*:read", "monthly-plan:*:update", "suppliers:*:read", "suppliers:*:update", "dictionaries:*:read", "dictionaries:*:update"]
        : ["rolling-plan:*:read", "monthly-plan:*:read", "suppliers:*:read", "dictionaries:*:read"];
      return api<any>("/api-keys", { method: "POST", body: JSON.stringify({ ...values, scopes }) });
    },
    onSuccess: (result) => {
      setOpen(false);
      form.resetFields();
      setRevealedKeys((current) => ({ ...current, [result.id]: result.apiKey }));
      Modal.info({ title: "请立即复制并保存 API Key", content: <Typography.Paragraph copyable code>{result.apiKey}</Typography.Paragraph> });
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (error: Error) => message.error(error.message)
  });
  const regenerate = async () => {
    if (!regenerateTarget) return;
    setRegenerating(true);
    try {
      const result = await api<any>(`/api-keys/${regenerateTarget.id}/regenerate`, { method: "POST" });
      setRevealedKeys((current) => ({ ...current, [regenerateTarget.id]: result.apiKey }));
      setRegenerateTarget(undefined);
      message.success("API KEY 已重新生成，旧 KEY 已失效");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRegenerating(false);
    }
  };
  return <div><PageHeader title="API Key 管理" subtitle="仅系统管理员可创建、关联用户并设置只读或读写权限" actions={<Button type="primary" onClick={() => setOpen(true)}>新增 API Key</Button>} />
    <Alert type="info" showIcon style={{ marginBottom: 12 }} message="完整 API KEY 仅在新建或重新生成后显示；刷新页面后将自动隐藏，请及时复制保存。" />
    <Table rowKey="id" dataSource={keys.data} loading={keys.isLoading} columns={[
      { title: "名称", dataIndex: "name" },
      { title: "API KEY", dataIndex: "apiKey", width: 430, render: (_value, row) => revealedKeys[row.id]
        ? <Typography.Text code copyable={{ text: revealedKeys[row.id] }}>{revealedKeys[row.id]}</Typography.Text>
        : <Text type="secondary">已隐藏，请重新生成后查看</Text> },
      { title: "权限", dataIndex: "scopes", render: (values: string[]) => values?.join("、") },
      { title: "到期", dataIndex: "expiresAt", render: (value) => value ? dayjs(value).format("YYYY-MM-DD") : "永不过期" },
      { title: "状态", dataIndex: "enabled", render: (value) => <Tag color={value ? "green" : "default"}>{value ? "启用" : "停用"}</Tag> },
      ...auditColumns,
      { title: "操作", width: 150, render: (_value, row) => <Button type="link" danger onClick={() => setRegenerateTarget(row)}>重新生成并显示</Button> }
    ]} scroll={{ x: "max-content" }} />
    <Modal title="新增 API Key" open={open} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then((v) => create.mutate(v))} confirmLoading={create.isPending}>
      <Form form={form} layout="vertical" initialValues={{ access: "read" }}>
        <Form.Item label="名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="对应用户" name="userId" rules={[{ required: true }]}><Select options={(users.data ?? []).map((u) => ({ value: u.id, label: `${u.displayName}（${u.username}）` }))} /></Form.Item>
        <Form.Item label="权限组" name="access" rules={[{ required: true }]}><Select options={[{ value: "read", label: "只读" }, { value: "readwrite", label: "读写" }, { value: "tplus-sync", label: "T+ 订单同步" }]} /></Form.Item>
        <Form.Item label="关联角色（可选）" name="roleId"><Select allowClear options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`重新生成 ${regenerateTarget?.name ?? ""} 的 API KEY？`} open={Boolean(regenerateTarget)} okText="重新生成" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={regenerating} onCancel={() => setRegenerateTarget(undefined)} onOk={() => void regenerate()}>
      <Alert type="warning" showIcon message="重新生成后，旧 KEY 会立即失效。" description="新 KEY 将显示在当前列表中，请及时复制保存。" />
    </Modal>
  </div>;
}

function AdminCenter() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>();
  const [permissionDraft, setPermissionDraft] = useState<Record<string, Record<string, boolean>>>({});
  const [assignmentUsers, setAssignmentUsers] = useState<string[]>([]);
  const [assignmentOrganizations, setAssignmentOrganizations] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<React.Key[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<React.Key[]>([]);
  const [form] = Form.useForm();
  const [roleForm] = Form.useForm();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<any[]>("/admin/users") });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<any[]>("/admin/roles") });
  const organizations = useQuery({ queryKey: ["organization-units"], queryFn: () => api<any[]>("/admin/organization-units") });
  const permissionResources = [
    ["sales-summary-dashboard", "销售接单汇总大屏"], ["rolling-plan", "销售接单明细"], ["monthly-plan", "月度计划"],
    ["finished-goods-inbound", "成品入库"], ["sales-orders", "销售订单"], ["suppliers", "供应商"], ["dictionaries", "字典"],
    ["processes", "工序"], ["users", "用户"], ["roles", "角色与权限"], ["organization", "组织架构"], ["imports", "导入记录"], ["audit-logs", "审计日志"],
    ["tplus-sales-orders", "T+ 销售订单同步"]
  ] as const;
  const permissionActions = [["read", "查看"], ["create", "新增"], ["update", "编辑"], ["delete", "删除/停用"], ["import", "导入"], ["export", "导出"]] as const;
  const adminUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}").username ?? "anonymous";
  const allUserFields = ["username", "displayName", "position", "departmentPaths", "roles", "enabled", "lastLoginAt"];
  const [visibleUserFields, setVisibleUserFields] = useState<string[]>(() => {
    const saved = JSON.parse(localStorage.getItem(`users-visible-fields:${adminUser}`) ?? "null");
    return Array.isArray(saved) ? [...saved, ...allUserFields.filter((field) => !saved.includes(field))] : allUserFields;
  });
  useEffect(() => localStorage.setItem(`users-visible-fields:${adminUser}`, JSON.stringify(visibleUserFields)), [adminUser, visibleUserFields]);
  const createUser = useMutation({
    mutationFn: (values: any) => api("/admin/users", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => { message.success("用户已创建，首次登录必须修改密码"); setOpen(false); form.resetFields(); void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (error: Error) => message.error(error.message)
  });
  const updateUser = async (id: string, patch: Record<string, unknown>) => { await api(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); };
  const updateRole = async (id: string, patch: Record<string, unknown>) => { await api(`/admin/roles/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); void queryClient.invalidateQueries({ queryKey: ["admin-roles"] }); };
  const resetPassword = async (id: string) => { try { await api(`/admin/users/${id}/reset-password`, { method: "POST" }); message.success("密码已重置为 kainice123，用户首次登录需修改密码"); } catch (error) { message.error((error as Error).message); } };
  const openRolePermissions = (role: any) => {
    const next: Record<string, Record<string, boolean>> = {};
    for (const [resource] of permissionResources) {
      const saved = role.permissions?.find((permission: any) => permission.resource === resource && permission.fieldKey === "*") ?? {};
      next[resource] = Object.fromEntries(permissionActions.map(([action]) => [action, Boolean(saved[action])])) as Record<string, boolean>;
    }
    setEditingRole(role); setPermissionDraft(next);
    setAssignmentUsers(role.userIds ?? []); setAssignmentOrganizations(role.organizationUnitIds ?? []);
    roleForm.setFieldsValue({ name: role.name, description: role.description }); setRoleOpen(true);
  };
  const openNewRole = () => {
    setEditingRole(undefined);
    setPermissionDraft(Object.fromEntries(permissionResources.map(([resource]) => [resource,
      Object.fromEntries(permissionActions.map(([action]) => [action, false]))])));
    setAssignmentUsers([]); setAssignmentOrganizations([]);
    roleForm.resetFields(); setRoleOpen(true);
  };
  const saveRolePermissions = async () => {
    const values = await roleForm.validateFields();
    const payload = {
      name: values.name.trim(), description: values.description,
      userIds: assignmentUsers,
      organizationUnitIds: assignmentOrganizations,
      permissions: permissionResources.map(([resource]) => ({ resource, fieldKey: "*", ...(permissionDraft[resource] ?? {}) }))
    };
    if (editingRole) await updateRole(editingRole.id, payload);
    else await api("/admin/roles", { method: "POST", body: JSON.stringify(payload) });
    await queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
    message.success(editingRole ? "角色权限已保存" : "角色已创建并配置权限"); setRoleOpen(false);
  };
  const userColumns = [
    { title: "职位", dataIndex: "position" }, { title: "所属部门", dataIndex: "departmentPaths", render: (paths: string[][]) => <Space direction="vertical" size={0}>{(paths ?? []).map((path, index) => <span key={index}>{path.join(" / ")}</span>)}</Space> },
    { title: "工号/账号", dataIndex: "username" }, { title: "姓名", dataIndex: "displayName" },
    { title: "角色", dataIndex: "roles", render: (_values: string[], row: any) => <Select mode="multiple" value={row.roleIds} style={{ minWidth: 180 }} options={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))} onChange={(roleIds) => void updateUser(row.id, { roleIds })} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <Switch checked={value} onChange={(v) => void updateUser(row.id, { enabled: v })} /> },
    { title: "上次登录", dataIndex: "lastLoginAt", render: (value: string | null) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" },
    ...auditColumns
    ,{ title: "密码", dataIndex: "password", render: (_: unknown, row: any) => <Button type="link" onClick={() => void resetPassword(row.id)}>重置密码</Button> }
  ].filter((column) => isAuditField(column.dataIndex as string) || visibleUserFields.includes(column.dataIndex as string) || column.dataIndex === "password");
  const roleColumns = [
    { title: "角色", dataIndex: "name", render: (value: string, row: any) => <InlineText value={value} onSave={(v) => updateRole(row.id, { name: v })} /> }, { title: "说明", dataIndex: "description", render: (value: string, row: any) => <InlineText value={value} onSave={(v) => updateRole(row.id, { description: v })} /> },
    { title: "权限条目", dataIndex: "permissions", render: (values: any[]) => values?.length ?? 0 },
    ...auditColumns,
    { title: "配置", render: (_: unknown, row: any) => <Button type="link" onClick={() => openRolePermissions(row)}>配置表格权限</Button> }
  ];
  const organizationTreeData = useMemo(() => {
    const units = organizations.data ?? [];
    const make = (parentId: string | null): any[] => units.filter((unit) => (unit.parentId ?? null) === parentId).map((unit) => ({
      key: unit.id, value: unit.id,
      title: unit.name,
      children: make(unit.id)
    }));
    return make(null);
  }, [organizations.data]);
  return <div><PageHeader title="用户与角色" subtitle="可直接编辑；复选框支持多选批量停用" actions={<Space><Upload accept=".csv" showUploadList={false} beforeUpload={async (file) => { const raw = await parseCsvFile(file as File); const rows = raw.map((row: any) => ({ username: row.username ?? row["账号"], displayName: row.displayName ?? row["姓名"], division: row.division ?? row["事业部"], roleIds: String(row.roles ?? row["角色"] ?? "").split(/[、|;]/).map((name) => roles.data?.find((role) => role.name === name)?.id).filter(Boolean) })); await api("/admin/users/import", { method: "POST", body: JSON.stringify({ rows }) }); message.success(`已导入 ${rows.length} 个用户`); void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); return false; }}><Button>导入用户 CSV</Button></Upload><Button danger disabled={!selectedUserIds.length} onClick={async () => { await api("/admin/users/delete", { method: "POST", body: JSON.stringify({ ids: selectedUserIds }) }); setSelectedUserIds([]); void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); }}>停用选中（{selectedUserIds.length}）</Button><FieldVisibility all={allUserFields.map((key) => ({ key, label: ({ username: "账号", displayName: "姓名", roles: "角色", division: "事业部", enabled: "状态", lastLoginAt: "上次登录" } as any)[key] }))} visible={visibleUserFields} onChange={setVisibleUserFields} /><Button type="primary" onClick={() => setOpen(true)}>新增用户</Button></Space>} />
    <Tabs items={[
      { key: "users", label: "用户", children: <Table rowKey="id" rowSelection={{ selectedRowKeys: selectedUserIds, onChange: setSelectedUserIds }} dataSource={users.data} loading={users.isLoading} columns={userColumns} scroll={{ x: "max-content" }} /> },
      { key: "roles", label: "角色与权限", children: <><Space style={{ marginBottom: 12 }}><Button type="primary" onClick={openNewRole}>新增角色</Button><Text type="secondary">可手工新增角色，并逐项配置页面及操作权限</Text></Space><Table rowKey="id" rowSelection={{ selectedRowKeys: selectedRoleIds, onChange: setSelectedRoleIds }} dataSource={roles.data} loading={roles.isLoading} columns={roleColumns} scroll={{ x: "max-content" }} /></> }
    ]} />
    <Modal title={editingRole ? `配置角色权限：${editingRole.name}` : "新增角色与权限"} open={roleOpen} width={1120} onCancel={() => setRoleOpen(false)} onOk={() => void saveRolePermissions()}>
      <Button style={{ marginBottom: 12 }} onClick={() => setAssignmentOpen(true)}>添加用户或架构</Button>
      <Form form={roleForm} layout="vertical"><Form.Item name="name" label="角色名称" rules={[{ required: true, whitespace: true, message: "请输入角色名称" }]}><Input maxLength={100} /></Form.Item><Form.Item name="description" label="角色说明"><Input maxLength={255} /></Form.Item></Form>
      <Table rowKey="resource" size="small" pagination={false} dataSource={permissionResources.map(([resource, label]) => {
        const permission = editingRole?.permissions?.find((entry: any) => entry.resource === resource && entry.fieldKey === "*");
        return { resource, label, createdAt: permission?.createdAt, updatedAt: permission?.updatedAt, updatedBy: permission?.updatedBy };
      })} columns={[{ title: "表/页面", dataIndex: "label" }, ...permissionActions.map(([action, label]) => ({ title: label, align: "center" as const, render: (_: unknown, row: any) => <Checkbox checked={Boolean(permissionDraft[row.resource]?.[action])} onChange={(event) => setPermissionDraft((previous) => ({ ...previous, [row.resource]: { ...(previous[row.resource] ?? {}), [action]: event.target.checked } }))} /> })), ...auditColumns]} scroll={{ x: "max-content" }} />
    </Modal>
    <Modal title="添加用户或架构" open={assignmentOpen} onCancel={() => setAssignmentOpen(false)} onOk={() => setAssignmentOpen(false)}>
      <Form layout="vertical">
        <Form.Item label="指定用户"><Select mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive" value={assignmentUsers} onChange={setAssignmentUsers} options={(users.data ?? []).map((user: any) => ({ value: user.id, label: `${user.displayName}（${user.employeeNo ?? user.username}）` }))} placeholder="可搜索并多选用户" /></Form.Item>
        <Form.Item label="指定组织架构"><TreeSelect treeData={organizationTreeData} treeCheckable showCheckedStrategy={TreeSelect.SHOW_PARENT} treeDefaultExpandAll multiple value={assignmentOrganizations} onChange={setAssignmentOrganizations} placeholder="展开后选择组织架构" style={{ width: "100%" }} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="新增用户" open={open} okText="创建" cancelText="取消" confirmLoading={createUser.isPending} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then((values) => createUser.mutate(values))}>
      <Form form={form} layout="vertical" initialValues={{ roleIds: [], password: "kainice123" }}>
        <Form.Item label="账号" name="username" rules={[{ required: true, pattern: /^[a-zA-Z0-9_.-]{3,64}$/, message: "3–64 位字母、数字、._-" }]}><Input /></Form.Item>
        <Form.Item label="姓名" name="displayName" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="首次密码" name="password" rules={[{ required: true, min: 10 }]}><Input.Password /></Form.Item>
        <Form.Item label="角色" name="roleIds" rules={[{ required: true }]}><Select mode="multiple" options={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))} /></Form.Item>
        <Form.Item label="所属事业部" name="division"><Select allowClear options={["事业一部", "事业二部", "事业三部", "事业四部", "贻居", "电镀厂"].map((value) => ({ value }))} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}

function ContactDirectory() {
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<any[]>("/admin/contacts") });
  const columns = [
    { title: "姓名", dataIndex: "name" }, { title: "工号", dataIndex: "employeeNo" }, { title: "职位", dataIndex: "position" },
    { title: "所属组织", dataIndex: "departmentPaths", render: (paths: string[][]) => <Space direction="vertical" size={0}>{(paths ?? []).map((path, index) => <span key={index}>{path.join(" / ")}</span>)}</Space> },
    { title: "直属上级", dataIndex: "directLeaders", render: (values: string[]) => values?.join("、") || "—" }, { title: "电话", dataIndex: "telephone" },
    { title: "状态", dataIndex: "enabled", render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "在职" : "停用"}</Tag> },
    ...auditColumns
  ];
  return <div><PageHeader title="通讯录" subtitle="企业微信通讯录同步目录，只读展示，不允许手工编辑。" actions={<Text type="secondary">共 {contacts.data?.length ?? 0} 位员工</Text>} /><Table rowKey="id" dataSource={contacts.data} loading={contacts.isLoading} columns={columns} pagination={{ pageSize: 50, showSizeChanger: true }} scroll={{ x: "max-content", y: "calc(100vh - 250px)" }} /></div>;
}

function ForcePasswordChange({ done }: { done: () => void }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const submit = async (values: any) => {
    setLoading(true);
    try {
      const result = await api<any>("/auth/change-password", { method: "POST", body: JSON.stringify(values) });
      localStorage.setItem("accessToken", result.accessToken); localStorage.setItem("refreshToken", result.refreshToken); localStorage.setItem("sessionUser", JSON.stringify(result.user));
      message.success("密码已修改"); done();
    } catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  return <div className="login-shell"><Card className="login-card"><div className="login-title">首次登录，请修改密码</div><Text type="secondary">密码至少 8 位，且必须同时包含字母和数字。</Text>
    <Form form={form} layout="vertical" onFinish={submit} style={{ marginTop: 20 }}>
      <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true }]}><Input.Password /></Form.Item>
      <Form.Item label="新密码" name="nextPassword" rules={[{ required: true, pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/, message: "至少 8 位且包含字母和数字" }]}><Input.Password /></Form.Item>
      <Button htmlType="submit" type="primary" loading={loading} block>确认修改</Button>
    </Form>
  </Card></div>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("accessToken")));
  const [mustChange, setMustChange] = useState(Boolean(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").mustChangePassword));
  const logout = () => { localStorage.removeItem("accessToken"); localStorage.removeItem("refreshToken"); localStorage.removeItem("sessionUser"); setAuthenticated(false); };
  return <AntApp><BrowserRouter>{authenticated ? (mustChange ? <ForcePasswordChange done={() => setMustChange(false)} /> : <Shell logout={logout} />) : <Login onLogin={() => { setAuthenticated(true); setMustChange(Boolean(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").mustChangePassword)); }} />}</BrowserRouter></AntApp>;
}
