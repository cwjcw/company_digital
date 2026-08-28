import { lazy, Suspense, useState } from "react";
import {
  ApiOutlined, ApartmentOutlined, AuditOutlined, BulbOutlined, CalendarOutlined, ContactsOutlined, DatabaseOutlined, FileExcelOutlined,
  FolderOpenOutlined, HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ScheduleOutlined,
  SettingOutlined, TeamOutlined, UserOutlined
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, App as AntApp, Button, Card, DatePicker, Form,
  Input, InputNumber, Layout, Menu, Modal, Select, Space,
  Tabs, Tag, Typography, Upload, Switch, message
} from "antd";
import dayjs from "dayjs";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { tableResourceRegistry } from "@kdos/contracts";
import { api, ApiError } from "./api";
import { SalesSummaryDashboard, SalesSummaryDetails } from "./modules/planning/pages/OperationalPlanningPages";
import { DevelopmentRequestsPage } from "./modules/development/DevelopmentRequestsPage";
import { ApprovalFlowSettingsPage } from "./modules/workflow/ApprovalFlowSettingsPage";
import { BrandLogo, ModulePortal, portalModules } from "./modules/portal/ModulePortal";
import { ProfileCenterPage } from "./modules/profile/ProfileCenterPage";
import { FinishedGoodsOutboundPage, SalesOrdersPage } from "./modules/data-center/DataCenterPages";
import { BusinessCustomerMappingsPage, OrderSchedulePage } from "./modules/marketing/MarketingPages";
import { WeeklyPlanPage, WorkReportsPage } from "./modules/planning/pages/PlanningOperationsPages";
import { AdminWorkspace } from "./modules/admin/AdminWorkspace";
import { OrganizationPage } from "./modules/admin/OrganizationPage";
import { TablePermissionsPage } from "./modules/permissions/TablePermissionsPage";
import { HrDepartureCheckPage, HrFolderPage } from "./modules/hr/HumanResourcesPages";
import { KdosDataTable, useKdosTableEditMode } from "./shared/KdosDataTable";
import {
  ImportFeedbackAlert, InlineText, PageHeader, auditColumns,
  downloadApiFile, failedImport, inboundBusinessFields, inboundFieldLabels, inboundFields, isAuditField,
  parseCsvFile, type ImportFeedback
} from "./shared/legacy-ui";

ModuleRegistry.registerModules([AllCommunityModule]);
const { Header, Sider, Content } = Layout;
const { Text } = Typography;
const MONTHLY_CHUNK_RELOAD_KEY = "kdos:monthly-plan-chunk-reload";

function EditableSwitchCell({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const { editing } = useKdosTableEditMode();
  return editing ? <Switch checked={checked} onChange={onChange} /> : <span className="kdos-readonly-cell">{checked ? "启用" : "停用"}</span>;
}
const KdosMonthlyPlanPage = lazy(async () => {
  try {
    const module = await import("./modules/planning/pages/MonthlyPlanPage");
    sessionStorage.removeItem(MONTHLY_CHUNK_RELOAD_KEY);
    return { default: module.MonthlyPlanPage };
  } catch (error) {
    if (!sessionStorage.getItem(MONTHLY_CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(MONTHLY_CHUNK_RELOAD_KEY, "1");
      window.location.reload();
      return await new Promise<never>(() => undefined);
    }
    sessionStorage.removeItem(MONTHLY_CHUNK_RELOAD_KEY);
    throw error;
  }
});

function KdosMonthlyPlanRoute() {
  const { period = "" } = useParams();
  if (!/^\d{6}$/.test(period)) return <Navigate to="/monthly/202609" replace />;
  const year = Number(period.slice(0, 4)); const month = Number(period.slice(4, 6));
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return <Navigate to="/monthly/202609" replace />;
  return <Suspense fallback={<Alert type="info" showIcon message="正在加载 Planning Center…" />}><KdosMonthlyPlanPage year={year} month={month} /></Suspense>;
}

function TablePermissionsRoute() {
  const { resource = "" } = useParams();
  return <TablePermissionsPage resourceCode={decodeURIComponent(resource)} />;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const submit = async (values: { username: string; password: string }) => {
    setLoading(true);
    setLoginError("");
    try {
      const result = await api<any>("/auth/login", { method: "POST", body: JSON.stringify(values) });
      localStorage.setItem("accessToken", result.accessToken);
      localStorage.setItem("refreshToken", result.refreshToken);
      localStorage.setItem("sessionUser", JSON.stringify(result.user));
      window.history.replaceState(null, "", "/");
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
      <BrandLogo compact />
      <div className="login-title">凯南数字化工作台</div>
      <Text type="secondary">Kainan Digital OS · 企业数字化工作入口</Text>
      {loginError && <Alert type="error" showIcon message={loginError} style={{ marginTop: 16 }} />}
      <Form layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}><Input autoFocus size="large" /></Form.Item>
        <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password size="large" /></Form.Item>
        <Button htmlType="submit" type="primary" loading={loading} block size="large">登录</Button>
        <Button type="link" block onClick={() => setForgotOpen(true)}>忘记密码</Button>
      </Form>
      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </Card>
  </div>;
}

const passwordRule = /^(?=.{8,64}$)(?=.*[A-Za-z])(?=.*\d)\S+$/;
const passwordRuleText = "密码须为 8–64 位，至少包含一个字母和一个数字，不能包含空格，且不能与当前密码相同";

function ForgotPasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const close = () => { form.resetFields(); setRequested(false); setVerifiedEmail(""); onClose(); };
  const requestCode = async () => {
    const values = await form.validateFields(["mobile", "email"]);
    setSending(true);
    try {
      const result = await api<{ phoneVerified: boolean; email: string }>("/auth/password-reset/request", { method: "POST", body: JSON.stringify(values) });
      setRequested(true); setVerifiedEmail(result.email);
      message.success("手机号码验证通过，验证码已发送至邮箱");
    } catch (error) { message.error((error as Error).message); } finally { setSending(false); }
  };
  const reset = async () => {
    const values = await form.validateFields();
    setResetting(true);
    try {
      await api("/auth/password-reset/confirm", { method: "POST", body: JSON.stringify(values) });
      message.success("密码已重置，请使用新密码登录"); close();
    } catch (error) { message.error((error as Error).message); } finally { setResetting(false); }
  };
  return <Modal title="忘记密码" open={open} onCancel={close} footer={requested
    ? [<Button key="back" onClick={() => setRequested(false)}>返回</Button>, <Button key="reset" type="primary" loading={resetting} onClick={() => void reset()}>重置密码</Button>]
    : [<Button key="cancel" onClick={close}>取消</Button>, <Button key="send" type="primary" loading={sending} onClick={() => void requestCode()}>发送邮箱验证码</Button>]}>
    <Alert type="info" showIcon message="密码规则" description={passwordRuleText} style={{ marginBottom: 16 }} />
    <Form form={form} layout="vertical" requiredMark={false}>
      <Form.Item name="mobile" label="手机号码" rules={[{ required: true, message: "请输入通讯录中的手机号码" }]}><Input disabled={requested} autoComplete="tel" /></Form.Item>
      <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入通讯录中的有效邮箱" }]}><Input disabled={requested} autoComplete="email" /></Form.Item>
      {requested && <>
        <Alert type="success" showIcon message="手机号码验证通过" description={`验证码已发送至 ${verifiedEmail}`} style={{ marginBottom: 16 }} />
        <Form.Item name="code" label="邮箱验证码" rules={[{ required: true, pattern: /^\d{6}$/, message: "请输入 6 位验证码" }]}><Input inputMode="numeric" maxLength={6} /></Form.Item>
        <Form.Item name="nextPassword" label="新密码" rules={[{ required: true, pattern: passwordRule, message: passwordRuleText }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="confirmPassword" label="确认新密码" dependencies={["nextPassword"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value === getFieldValue("nextPassword") ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")); } })]}><Input.Password autoComplete="new-password" /></Form.Item>
      </>}
    </Form>
  </Modal>;
}

function Shell({ logout }: { logout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  const isSystemAdmin = user.roles?.includes("系统管理员");
  const systemPaths = ["/master-data", "/data-operations", "/organization", "/audit", "/admin", "/users", "/contacts", "/api-keys"];
  const monthlyPages = Array.from({ length: 5 }, (_, index) => 8 + index).map((month) => {
    const period = `2026${String(month).padStart(2, "0")}`;
    return { key: `/monthly/${period}`, label: period };
  });
  const weeklyPages = [
    { start: "2026-08-16", end: "2026-08-22" }, { start: "2026-08-23", end: "2026-08-29" },
    { start: "2026-08-30", end: "2026-09-05" }, { start: "2026-09-06", end: "2026-09-12" }
  ].map((week) => ({ key: `/weekly/${week.start.replaceAll("-", "")}`, label: `${week.start.slice(5)} 至 ${week.end.slice(5)}` }));
  if (location.pathname === "/") return <ModulePortal user={user} onOpen={(module) => navigate(module.path)} onLogout={logout} />;
  if ((systemPaths.includes(location.pathname) || location.pathname.startsWith("/permissions/")) && !isSystemAdmin) return <Navigate to="/" replace />;

  const permissionResourceCode = location.pathname.startsWith("/permissions/") ? decodeURIComponent(location.pathname.slice("/permissions/".length)) : undefined;
  const permissionResource = tableResourceRegistry.find((resource) => resource.code === permissionResourceCode);
  const permissionModuleId = permissionResource?.module === "公司驾驶舱" ? "cockpit"
    : permissionResource?.module === "主计划" ? "planning"
    : permissionResource?.module === "数据中心" ? "data"
    : permissionResource?.module === "营销中心" ? "marketing"
    : permissionResource?.module === "人力资源" ? "hr"
    : permissionResource?.module === "流程审批" ? "workflow" : "system";

  const moduleId = permissionResource ? permissionModuleId : location.pathname === "/sales-summary-dashboard" ? "cockpit"
    : ["/sales-summary-details", "/rolling", "/work-reports"].includes(location.pathname) || location.pathname.startsWith("/monthly") || location.pathname.startsWith("/weekly") ? "planning"
    : location.pathname.startsWith("/data-center") || location.pathname === "/finished-goods-inbound" ? "data"
    : location.pathname.startsWith("/marketing") ? "marketing"
    : location.pathname.startsWith("/hr") ? "hr"
    : ["/development-requests", "/workflow-settings"].includes(location.pathname) ? "workflow"
    : location.pathname === "/profile" ? "profile" : "system";
  const activeModule = portalModules.find((module) => module.id === moduleId)!;
  const navigationByModule: Record<string, any[]> = {
    cockpit: [{ key: "cockpit-root", label: "公司驾驶舱", children: [
      { key: "/sales-summary-dashboard", icon: <ScheduleOutlined />, label: "销售接单汇总大屏" }
    ] }],
    planning: [{ key: "planning-root", label: "主计划", children: [
      { key: "/sales-summary-details", icon: <FileExcelOutlined />, label: "销售接单明细" },
      { key: "/monthly", icon: <CalendarOutlined />, label: "月度计划", children: [
        { key: "/monthly/2026", icon: <FolderOpenOutlined />, label: "2026年", children: monthlyPages }
      ] },
      { key: "/weekly", icon: <CalendarOutlined />, label: "周计划", children: weeklyPages },
      { key: "/work-reports", icon: <FileExcelOutlined />, label: "报工表" }
    ] }],
    data: [{ key: "data-root", label: "数据中心", children: [
      { key: "/data-center/sales-orders", icon: <FileExcelOutlined />, label: "订单表" },
      { key: "/data-center/inbound", icon: <DatabaseOutlined />, label: "入库表" },
      { key: "/data-center/outbound", icon: <DatabaseOutlined />, label: "出库表" }
    ] }],
    marketing: [{ key: "marketing-root", label: "营销中心", children: [
      { key: "/marketing/business-customers", icon: <TeamOutlined />, label: "业务人员与客户对应表" },
      { key: "/marketing/order-schedule", icon: <ScheduleOutlined />, label: "订单排期" }
    ] }],
    hr: [{ key: "hr-root", label: "人力资源", children: [
      { key: "/hr/workforce-planning", icon: <FolderOpenOutlined />, label: "人力资源规划" },
      { key: "/hr/recruitment", icon: <FolderOpenOutlined />, label: "招聘与配置" },
      { key: "/hr/training", icon: <FolderOpenOutlined />, label: "培训与开发" },
      { key: "/hr/performance", icon: <FolderOpenOutlined />, label: "绩效管理" },
      { key: "/hr/compensation", icon: <FolderOpenOutlined />, label: "薪酬福利管理" },
      { key: "hr-employee-relations", icon: <FolderOpenOutlined />, label: "员工关系管理", children: [
        { key: "/hr/employee-relations/departure-check", icon: <TeamOutlined />, label: "离职人员检查" }
      ] }
    ] }],
    workflow: [{ key: "workflow-root", label: "流程审批", children: [
      { key: "/development-requests", icon: <BulbOutlined />, label: "需求提报与审批" },
      { key: "/workflow-settings", icon: <SettingOutlined />, label: "审批流程配置" }
    ] }],
    system: [{ key: "system-root", label: "系统管理", children: [
      { key: "system-master", label: "基础资料", children: [
        { key: "/master-data", icon: <DatabaseOutlined />, label: "基础资料维护" }
      ] },
      { key: "system-governance", label: "系统治理", children: [
        { key: "/organization", icon: <ApartmentOutlined />, label: "组织架构表" },
        { key: "/audit", icon: <AuditOutlined />, label: "审计日志" }
      ] },
      { key: "system-accounts", label: "账户与接口", children: [
        { key: "/users", icon: <TeamOutlined />, label: "用户与角色" },
        { key: "/contacts", icon: <ContactsOutlined />, label: "通讯录" },
        { key: "/api-keys", icon: <ApiOutlined />, label: "API Key" }
      ] }
    ] }],
    profile: [{ key: "profile-root", label: "个人中心", children: [
      { key: "/profile", icon: <UserOutlined />, label: "账户资料与安全" }
    ] }]
  };
  const pageTitle = permissionResource ? `${permissionResource.label} · 权限管理` : /^\/monthly\/\d{6}$/.test(location.pathname)
    ? `${location.pathname.slice(-6, -2)}年${Number(location.pathname.slice(-2))}月计划`
    : /^\/weekly\/\d{8}$/.test(location.pathname) ? `周计划 ${location.pathname.slice(-8)}`
    : ({
      "/sales-summary-dashboard": "销售接单汇总大屏", "/sales-summary-details": "销售接单明细",
      "/work-reports": "报工表", "/development-requests": "需求提报与审批", "/workflow-settings": "审批流程配置",
      "/master-data": "基础资料维护", "/data-operations": "基础资料维护", "/finished-goods-inbound": "成品入库",
      "/data-center/sales-orders": "订单表", "/data-center/inbound": "入库表", "/data-center/outbound": "出库表",
      "/marketing/business-customers": "业务人员与客户对应表", "/marketing/order-schedule": "订单排期",
      "/hr/workforce-planning": "人力资源规划", "/hr/recruitment": "招聘与配置", "/hr/training": "培训与开发",
      "/hr/performance": "绩效管理", "/hr/compensation": "薪酬福利管理", "/hr/employee-relations/departure-check": "离职人员检查",
      "/organization": "组织架构表", "/audit": "审计日志", "/admin": "用户与角色", "/users": "用户与角色", "/contacts": "通讯录",
      "/api-keys": "API Key", "/profile": "个人中心"
    } as Record<string, string>)[location.pathname] ?? activeModule.title;
  return <Layout className={`app-shell${collapsed ? " sidebar-is-collapsed" : ""}`}>
    <Sider collapsed={collapsed} collapsedWidth={64} width={238} className="sidebar">
      <button type="button" className="brand" onClick={() => navigate("/")} aria-label="返回全部模块"><BrandLogo compact={collapsed} inverse /></button>
      {!collapsed && <div className={`sidebar-module-mark portal-tone-${activeModule.tone}`}><span>{activeModule.englishTitle}</span><strong>{activeModule.title}</strong></div>}
      <Button className="sidebar-home" type="text" icon={<HomeOutlined />} onClick={() => navigate("/")}>{!collapsed && "全部模块"}</Button>
      <Menu mode="inline" theme="dark" selectedKeys={[location.pathname]} defaultOpenKeys={[`${moduleId}-root`, "/monthly", "/monthly/2026", "/weekly", "hr-employee-relations", "system-master", "system-governance", "system-accounts"]} items={navigationByModule[moduleId]} onClick={({ key }) => navigate(key)} />
      <Button className="sidebar-collapse" type="primary" shape="circle" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
    </Sider>
    <Layout>
      <Header className="topbar">
        <div className="topbar-context"><Text type="secondary">{activeModule.title}</Text><div className="topbar-page-title">{pageTitle}</div></div>
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
          <Route path="/weekly/20260816" element={<WeeklyPlanPage startDate="2026-08-16" />} />
          <Route path="/weekly/20260823" element={<WeeklyPlanPage startDate="2026-08-23" />} />
          <Route path="/weekly/20260830" element={<WeeklyPlanPage startDate="2026-08-30" />} />
          <Route path="/weekly/20260906" element={<WeeklyPlanPage startDate="2026-09-06" />} />
          <Route path="/work-reports" element={<WorkReportsPage />} />
          <Route path="/development-requests" element={<DevelopmentRequestsPage />} />
          <Route path="/workflow-settings" element={<ApprovalFlowSettingsPage />} />
          <Route path="/master-data" element={<DataOperations />} />
          <Route path="/data-operations" element={<DataOperations />} />
          <Route path="/finished-goods-inbound" element={<Navigate to="/data-center/inbound" replace />} />
          <Route path="/data-center/sales-orders" element={<SalesOrdersPage />} />
          <Route path="/data-center/inbound" element={<FinishedGoodsInboundPage />} />
          <Route path="/data-center/outbound" element={<FinishedGoodsOutboundPage />} />
          <Route path="/marketing/business-customers" element={<BusinessCustomerMappingsPage />} />
          <Route path="/marketing/two-week-schedule" element={<Navigate to="/marketing/order-schedule" replace />} />
          <Route path="/marketing/order-schedule" element={<OrderSchedulePage />} />
          <Route path="/hr/workforce-planning" element={<HrFolderPage title="人力资源规划" />} />
          <Route path="/hr/recruitment" element={<HrFolderPage title="招聘与配置" />} />
          <Route path="/hr/training" element={<HrFolderPage title="培训与开发" />} />
          <Route path="/hr/performance" element={<HrFolderPage title="绩效管理" />} />
          <Route path="/hr/compensation" element={<HrFolderPage title="薪酬福利管理" />} />
          <Route path="/hr/employee-relations/departure-check" element={<HrDepartureCheckPage />} />
          <Route path="/permissions/:resource" element={<TablePermissionsRoute />} />
          <Route path="/audit" element={<AuditLogs />} />
          <Route path="/organization" element={<OrganizationPage />} />
          <Route path="/admin" element={<AdminWorkspace />} />
          <Route path="/users" element={<AdminWorkspace />} />
          <Route path="/contacts" element={<ContactDirectory />} />
          <Route path="/api-keys" element={<ApiKeyCenter />} />
          <Route path="/profile" element={<ProfileCenterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
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
  const refresh = (key: string) => void queryClient.invalidateQueries({ queryKey: [key] });
  const dictionaryRows = (dictionaries.data ?? []).flatMap((type: any) => type.values.map((value: any) => ({ ...value, typeId: type.id, typeVersion: type.version, code: type.code, typeName: type.name })));
  const updateSupplier = async (row: any, field: string, value: unknown) => {
    try {
      await api(`/master-data/suppliers/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.version }) });
      refresh("suppliers");
    } catch (error) {
      message.error((error as Error).message);
      refresh("suppliers");
      throw error;
    }
  };
  const updateDictionaryType = async (row: any, field: string, value: unknown) => { await api(`/master-data/dictionary-types/${row.typeId}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.typeVersion }) }); refresh("dictionaries"); };
  const updateDictionaryValue = async (row: any, field: string, value: unknown) => { await api(`/master-data/dictionary-values/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.version }) }); refresh("dictionaries"); };
  const updateProcess = async (row: any, field: string, value: unknown) => { await api(`/master-data/processes/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.version }) }); refresh("processes"); };
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
    { title: "编码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row, "code", v)} /> },
    { title: "名称", dataIndex: "name", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row, "name", v)} /> },
    { title: "备注", dataIndex: "remark", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateSupplier(row, "remark", v)} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <EditableSwitchCell checked={value} onChange={(v) => void updateSupplier(row, "enabled", v)} /> },
    ...auditColumns
  ];
  const dictionaryColumns = [
    { title: "字典编码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryType(row, "code", v)} /> },
    { title: "字典名称", dataIndex: "typeName", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryType(row, "name", v)} /> },
    { title: "值", dataIndex: "value", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryValue(row, "value", v)} /> },
    { title: "顺序", dataIndex: "sortOrder", render: (value: unknown, row: any) => <InlineText type="number" value={value} onSave={(v) => updateDictionaryValue(row, "sortOrder", v)} /> },
    { title: "启用", dataIndex: "enabled", render: (value: boolean, row: any) => <EditableSwitchCell checked={value} onChange={(v) => void updateDictionaryValue(row, "enabled", v)} /> },
    ...auditColumns
  ];
  const processColumns = [
    { title: "顺序", dataIndex: "sortOrder", render: (value: unknown, row: any) => <InlineText type="number" value={value} onSave={(v) => updateProcess(row, "sortOrder", v)} /> },
    { title: "代码", dataIndex: "code", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateProcess(row, "code", v)} /> },
    { title: "名称", dataIndex: "name", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateProcess(row, "name", v)} /> },
    ...["enableRequiredDays", "enableDueDate", "enableStatus", "enableException", "enabled"].map((field) => ({ title: ({ enableRequiredDays: "所需天数", enableDueDate: "交期", enableStatus: "状态", enableException: "异常", enabled: "启用" } as any)[field], dataIndex: field, render: (value: boolean, row: any) => <EditableSwitchCell checked={value} onChange={(v) => void updateProcess(row, field, v)} /> })),
    ...auditColumns
  ];

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
        </Space>
        <KdosDataTable resource="suppliers" editable rowKey="id" rowSelection={{ selectedRowKeys: supplierIds, onChange: setSupplierIds }} dataSource={suppliers.data} pagination={{ pageSize: 50 }} columns={supplierColumns} scroll={{ x: "max-content", y: 480 }} />
      </> },
      { key: "dictionaries", label: `字典值（${dictionaryRows.length}）`, children: <>
        <Space wrap className="master-data-toolbar">
          <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importMasterFile(file as File, "dictionaries")}>
            <Button loading={importing === "dictionaries"}>导入字典（CSV/XLSX）</Button>
          </Upload>
          <Button onClick={() => void downloadTemplate("dictionaries", "xlsx")}>下载 XLSX 模板</Button>
          <Button onClick={() => void downloadTemplate("dictionaries", "csv")}>下载 CSV 模板</Button>
          <Button danger disabled={!dictionaryIds.length} onClick={async () => { await api("/master-data/dictionary-values/delete", { method: "POST", body: JSON.stringify({ ids: dictionaryIds }) }); setDictionaryIds([]); refresh("dictionaries"); }}>停用选中（{dictionaryIds.length}）</Button>
        </Space>
        <KdosDataTable resource="dictionaries" editable rowKey="id" rowSelection={{ selectedRowKeys: dictionaryIds, onChange: setDictionaryIds }} dataSource={dictionaryRows} pagination={{ pageSize: 50 }} columns={dictionaryColumns} scroll={{ x: "max-content", y: 480 }} />
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
        </Space>
        <KdosDataTable resource="processes" editable rowKey="id" rowSelection={{ selectedRowKeys: processIds, onChange: setProcessIds }} dataSource={processes.data} pagination={false} columns={processColumns} scroll={{ x: "max-content", y: 480 }} />
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
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finished-goods-inbound"] });
  const updateRow = async (row: any, field: string, value: unknown) => {
    try {
      await api(`/master-data/finished-goods-inbound/${row.id}`, {
        method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.version })
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
  const numericFields = new Set(["lineNumber", "receivedQuantity"]);
  const dateFields = new Set(["documentDate", "inboundDate"]);
  const wideFields = new Set(["documentNumber", "workOrderNumber", "salesOrderNumber", "inventoryCode", "inventoryName"]);
  const columns = inboundFields.map((field) => ({
    title: inboundFieldLabels[field],
    dataIndex: field,
    width: wideFields.has(field) ? 260 : field === "createdTime" ? 190 : 145,
    render: (value: unknown, row: any) => isAuditField(field)
      ? (field === "createdBy" ? String(value ?? "—") : value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : "—")
      : <InlineText
      type={numericFields.has(field) ? "number" : dateFields.has(field) ? "date" : "text"}
      value={field === "createdTime" && value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : value}
      onSave={(next) => updateRow(row, field, next)}
    />
  }));

  return <div>
    <PageHeader title="入库表" subtitle="字段来自 25年-现在入库明细.xlsx；已导入 2026 年以来数据" />
    <Space wrap className="master-data-toolbar">
      <Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新增入库记录</Button>
      <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importFile(file as File)}>
        <Button loading={importing}>导入入库表（CSV/XLSX）</Button>
      </Upload>
      <Button onClick={() => void downloadTemplate("xlsx")}>下载 XLSX 模板</Button>
      <Button onClick={() => void downloadTemplate("csv")}>下载 CSV 模板</Button>
      <Button loading={exporting === "xlsx"} onClick={() => void exportData("xlsx")}>导出 XLSX</Button>
      <Button loading={exporting === "csv"} onClick={() => void exportData("csv")}>导出 CSV</Button>
      <Text type="secondary">已选择 {selectedIds.length} 行</Text>
    </Space>
    <ImportFeedbackAlert value={importFeedback} onClose={() => setImportFeedback(undefined)} />
    <KdosDataTable resource="finished-goods-inbound" editable className="editable-master-table" rowKey="id"
      rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
      dataSource={records.data} loading={records.isLoading}
      pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
      scroll={{ x: "max-content", y: "calc(100vh - 310px)" }} columns={columns} />
    <Modal title="新增入库记录" width={1080} open={open} onCancel={() => setOpen(false)}
      onOk={() => form.validateFields().then(async (values) => {
        await api("/master-data/finished-goods-inbound", {
          method: "POST",
          body: JSON.stringify({
            ...values,
            documentDate: values.documentDate?.format("YYYY-MM-DD"),
            inboundDate: values.inboundDate?.format("YYYY-MM-DD")
          })
        });
        setOpen(false); form.resetFields(); message.success("入库记录新增成功"); refresh();
      }).catch((error) => { if (error instanceof ApiError) message.error(error.message); })}>
      <Form form={form} layout="vertical">
        <div className="master-data-form-grid inbound-form-grid">
          {inboundBusinessFields.map((field) => <Form.Item key={field} name={field} label={inboundFieldLabels[field]}
            className={field === "remark" ? "master-data-form-wide" : undefined}
            rules={["documentNumber", "inventoryCode", "lineNumber"].includes(field)
              ? [{ required: true, message: `请输入${inboundFieldLabels[field]}` }] : undefined}>
            {dateFields.has(field)
              ? <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
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
    <KdosDataTable resource="audit-logs" rowKey="id" loading={logs.isLoading} dataSource={logs.data} columns={[
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
    <KdosDataTable resource="api-keys" rowKey="id" dataSource={keys.data} loading={keys.isLoading} columns={[
      { title: "名称", dataIndex: "name" },
      { title: "API KEY", dataIndex: "apiKey", width: 430, render: (_value: unknown, row: any) => revealedKeys[row.id]
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


function ContactDirectory() {
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<any[]>("/admin/contacts") });
  const columns = [
    { title: "姓名", dataIndex: "name" }, { title: "工号", dataIndex: "employeeNo" }, { title: "职位", dataIndex: "position" },
    { title: "所属组织", dataIndex: "departmentPaths", render: (paths: string[][]) => <Space direction="vertical" size={0}>{(paths ?? []).map((path, index) => <span key={index}>{path.join(" / ")}</span>)}</Space> },
    { title: "直属上级", dataIndex: "directLeaders", render: (values: string[]) => values?.join("、") || "—" }, { title: "电话", dataIndex: "telephone" },
    { title: "状态", dataIndex: "enabled", render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "在职" : "停用"}</Tag> },
    ...auditColumns
  ];
  return <div><PageHeader title="通讯录" subtitle="企业微信通讯录同步目录，只读展示，不允许手工编辑。" actions={<Text type="secondary">共 {contacts.data?.length ?? 0} 位员工</Text>} /><KdosDataTable resource="contacts" rowKey="id" dataSource={contacts.data} loading={contacts.isLoading} columns={columns} scroll={{ x: "max-content", y: "calc(100vh - 305px)" }} /></div>;
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
  return <div className="login-shell"><Card className="login-card"><div className="login-title">首次登录，请修改密码</div><Text type="secondary">{passwordRuleText}</Text>
    <Form form={form} layout="vertical" onFinish={submit} style={{ marginTop: 20 }}>
      <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true }]}><Input.Password /></Form.Item>
      <Form.Item label="新密码" name="nextPassword" dependencies={["currentPassword"]} rules={[{ required: true, pattern: passwordRule, message: passwordRuleText }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value !== getFieldValue("currentPassword") ? Promise.resolve() : Promise.reject(new Error("新密码不能与当前密码相同")); } })]}><Input.Password /></Form.Item>
      <Button htmlType="submit" type="primary" loading={loading} block>确认修改</Button>
    </Form>
  </Card></div>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("accessToken")));
  const [mustChange, setMustChange] = useState(Boolean(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").mustChangePassword));
  const logout = () => {
    localStorage.removeItem("accessToken"); localStorage.removeItem("refreshToken"); localStorage.removeItem("sessionUser");
    window.location.assign("/");
  };
  return <AntApp><BrowserRouter>{authenticated ? (mustChange ? <ForcePasswordChange done={() => setMustChange(false)} /> : <Shell logout={logout} />) : <Login onLogin={() => { setAuthenticated(true); setMustChange(Boolean(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").mustChangePassword)); }} />}</BrowserRouter></AntApp>;
}
