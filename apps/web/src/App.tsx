import { PageScrollReset } from "./shared/PageScrollReset";
import { useEffect, useState } from "react";
import {
  ApiOutlined, ApartmentOutlined, AuditOutlined, BulbOutlined, ContactsOutlined, DashboardOutlined, DatabaseOutlined, FileExcelOutlined,
  FolderOpenOutlined, HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ScheduleOutlined,
  SafetyCertificateOutlined, SettingOutlined, TeamOutlined, ToolOutlined, UserOutlined, NotificationOutlined
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
import { masterPlanResourceDefinitions, tableResourceRegistry } from "@kdos/contracts";
import { api, ApiError } from "./api";
import type { AdvancedFilterGroup } from "./shared/advanced-filter";
import { blankPlatformQuery, platformRowsKey, platformRowsUrl, type PlatformTablePage, type PlatformTableQuery } from "./shared/platform-table";
import { SalesSummaryDashboard } from "./modules/planning/pages/OperationalPlanningPages";
import { DevelopmentRequestsPage } from "./modules/development/DevelopmentRequestsPage";
import { ApprovalFlowSettingsPage } from "./modules/workflow/ApprovalFlowSettingsPage";
import { BrandLogo, ModulePortal, portalModules } from "./modules/portal/ModulePortal";
import { ProfileCenterPage } from "./modules/profile/ProfileCenterPage";
import { NotificationCenterPage } from "./modules/notifications/NotificationCenterPage";
import { FinishedGoodsOutboundPage, SalesOrdersPage, SupplierListPage } from "./modules/data-center/DataCenterPages";
import { BusinessCustomerMappingsPage, OrderSchedulePage } from "./modules/marketing/MarketingPages";
import { AdminWorkspace } from "./modules/admin/AdminWorkspace";
import { AdministratorsPage } from "./modules/admin/AdministratorsPage";
import { OrganizationPage } from "./modules/admin/OrganizationPage";
import { TablePermissionsPage } from "./modules/permissions/TablePermissionsPage";
import { HrDepartureCheckPage, HrFolderPage } from "./modules/hr/HumanResourcesPages";
import { EquipmentDashboardPage, EquipmentRegisterPage, EquipmentStatusReportPage } from "./modules/equipment/EquipmentPages";
import { KdosDataTable, useKdosTableEditMode } from "./shared/KdosDataTable";
import { MasterPlanResourcePage } from "./modules/master-plan-system/MasterPlanPages";
import {
  ImportFeedbackAlert, InlineText, PageHeader, auditColumns,
  downloadApiFile, failedImport, inboundBusinessFields, inboundFieldLabels, inboundFields, isAuditField,
  parseCsvFile, type ImportFeedback
} from "./shared/legacy-ui";

ModuleRegistry.registerModules([AllCommunityModule]);
const { Header, Sider, Content } = Layout;
const { Text } = Typography;

function EditableSwitchCell({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const { editing } = useKdosTableEditMode();
  return editing ? <Switch checked={checked} onChange={onChange} /> : <span className="kdos-readonly-cell">{checked ? "启用" : "停用"}</span>;
}
function TablePermissionsRoute() {
  const { resource = "" } = useParams();
  return <TablePermissionsPage resourceCode={decodeURIComponent(resource)} />;
}

function MasterPlanResourceRoute() {
  const { resource = "" } = useParams();
  return <MasterPlanResourcePage resource={resource} />;
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
  const [sending, setSending] = useState(false);
  const [sentEmail, setSentEmail] = useState("");
  const [requestError, setRequestError] = useState("");
  const close = () => { form.resetFields(); setSentEmail(""); setRequestError(""); onClose(); };
  const sendTemporaryPassword = async () => {
    setRequestError("");
    try {
      const values = await form.validateFields(["username", "email"]);
      setSending(true);
      const result = await api<{ status: string; email: string; temporaryPasswordLength: number; mustChangePassword: boolean }>("/auth/password-reset/request", { method: "POST", body: JSON.stringify(values) });
      setSentEmail(result.email);
      message.success("8 位临时密码已发送至邮箱");
    } catch (error: any) {
      if (Array.isArray(error?.errorFields)) return;
      const text = error instanceof Error ? error.message : "临时密码发送失败，请稍后重试";
      setRequestError(text); message.error(text);
    } finally { setSending(false); }
  };
  return <Modal title="忘记密码" open={open} onCancel={close} footer={sentEmail
    ? [<Button key="close" type="primary" onClick={close}>我知道了</Button>]
    : [<Button key="cancel" onClick={close}>取消</Button>, <Button key="send" type="primary" loading={sending} onClick={() => void sendTemporaryPassword()}>发送随机密码</Button>]}>
    <Alert type="info" showIcon message="邮箱找回密码" description="请输入最近一次修改密码时保存的邮箱。邮箱连续错误 10 次后，该账号的找回密码功能将被锁定；验证成功后系统发送 8 位临时密码。" style={{ marginBottom: 16 }} />
    {requestError && <Alert type="error" showIcon message="临时密码发送失败" description={requestError} style={{ marginBottom: 16 }} />}
    <Form form={form} layout="vertical" requiredMark={false}>
      <Form.Item name="username" label="账号" rules={[{ required: true, whitespace: true, message: "请输入账号" }]}>
        <Input disabled={Boolean(sentEmail)} autoComplete="username" placeholder="请输入登录账号" />
      </Form.Item>
      <Form.Item name="email" label="邮箱" extra="必须与最近一次修改密码时保存的邮箱一致。"
        rules={[{ required: true, type: "email", message: "请输入修改密码时保存的有效邮箱" }]}><Input disabled={Boolean(sentEmail)} autoComplete="email" /></Form.Item>
      {sentEmail && <Alert type="success" showIcon message="临时密码已发送" description={`8 位临时密码已发送至 ${sentEmail}，请查收邮件后登录。`} />}
    </Form>
  </Modal>;
}

function Shell({ logout }: { logout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const storedUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  const liveSession = useQuery({ queryKey: ["auth-session"], queryFn: () => api<any>("/auth/me"), retry: false, staleTime: 30_000 });
  const user = liveSession.data ?? storedUser;
  useEffect(() => { if (liveSession.data) localStorage.setItem("sessionUser", JSON.stringify(liveSession.data)); }, [liveSession.data]);
  const isSystemAdmin = user.isSystemAdmin === true;
  const isAnyAdministrator = isSystemAdmin || (user.moduleAdminCodes?.length ?? 0) > 0;
  const systemPaths = ["/master-data", "/data-operations", "/organization", "/audit", "/admin", "/users", "/administrators", "/contacts", "/api-keys", "/system/notifications"];
  const permissionResourceCode = location.pathname.startsWith("/permissions/") ? decodeURIComponent(location.pathname.slice("/permissions/".length)) : undefined;
  const permissionResource = tableResourceRegistry.find((resource) => resource.code === permissionResourceCode);
  const canManagePermissionResource = Boolean(permissionResource && (isSystemAdmin || user.moduleAdminCodes?.includes(permissionResource.moduleCode)));
  if (location.pathname === "/") return <ModulePortal user={user} onOpen={(module) => navigate(module.id === "system" && !isSystemAdmin ? "/administrators" : module.path)} onLogout={logout} />;
  if (systemPaths.includes(location.pathname) && !isSystemAdmin && !(["/administrators", "/system/notifications"].includes(location.pathname) && isAnyAdministrator)) return <Navigate to="/" replace />;
  if (location.pathname.startsWith("/permissions/") && !canManagePermissionResource) return <Navigate to="/" replace />;
  const permissionModuleId = permissionResource?.moduleCode ?? "system";

  const moduleId = permissionResource ? permissionModuleId : location.pathname === "/sales-summary-dashboard" ? "cockpit"
    : location.pathname.startsWith("/equipment-") || location.pathname.startsWith("/master-plan-system/") ? "planning"
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
    planning: [
      { key: "dashboard-reports", icon: <DashboardOutlined />, label: "大屏报表", children: [
        { key: "equipment-dashboards", icon: <DashboardOutlined />, label: "设备管理大屏", children: [
          { key: "/equipment-dashboard", icon: <DashboardOutlined />, label: "集团设备大屏" }
        ] }
      ] },
      { key: "master-plan-system", icon: <ScheduleOutlined />, label: "主计划系统", children: ["数据准备", "计划管理", "生产执行", "系统运维"].map((area) => ({
        key: `mps-${area}`,
        icon: <FolderOpenOutlined />,
        label: area,
        children: masterPlanResourceDefinitions.filter((entry) => entry.area === area).map((entry) => ({
          key: `/master-plan-system/${entry.code}`, icon: <FileExcelOutlined />, label: entry.label
        }))
      })) },
      { key: "equipment-management", icon: <ToolOutlined />, label: "设备管理", children: [
        { key: "/equipment-register", icon: <DatabaseOutlined />, label: "设备总台账" },
        { key: "/equipment-status-report", icon: <FileExcelOutlined />, label: "设备状态填报" }
      ] }
    ],
    data: [{ key: "data-root", label: "数据中心", children: [
      { key: "/data-center/sales-orders", icon: <FileExcelOutlined />, label: "订单表" },
      { key: "/data-center/inbound", icon: <DatabaseOutlined />, label: "入库表" },
      { key: "/data-center/outbound", icon: <DatabaseOutlined />, label: "出库表" },
      { key: "data-supply-chain", icon: <FolderOpenOutlined />, label: "供应链", children: [
        { key: "/data-center/supply-chain/suppliers", icon: <DatabaseOutlined />, label: "供应商清单" }
      ] }
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
    system: [{ key: "system-root", label: "系统管理", children: isSystemAdmin ? [
      { key: "system-master", label: "基础资料", children: [
        { key: "/master-data", icon: <DatabaseOutlined />, label: "基础资料维护" }
      ] },
      { key: "system-governance", label: "系统治理", children: [
        { key: "/system/notifications", icon: <NotificationOutlined />, label: "消息中心" },
        { key: "/organization", icon: <ApartmentOutlined />, label: "组织架构表" },
        { key: "/audit", icon: <AuditOutlined />, label: "审计日志" }
      ] },
      { key: "system-accounts", label: "账户与接口", children: [
        { key: "/users", icon: <TeamOutlined />, label: "用户与角色" },
        { key: "/administrators", icon: <SafetyCertificateOutlined />, label: "管理员" },
        { key: "/contacts", icon: <ContactsOutlined />, label: "通讯录" },
        { key: "/api-keys", icon: <ApiOutlined />, label: "API Key" }
      ] }
    ] : [{ key: "/administrators", icon: <SafetyCertificateOutlined />, label: "管理员" }, { key: "/system/notifications", icon: <NotificationOutlined />, label: "消息中心" }] }],
    profile: [{ key: "profile-root", label: "个人中心", children: [
      { key: "/profile", icon: <UserOutlined />, label: "账户资料与安全" }
    ] }]
  };
  const masterPlanPage = masterPlanResourceDefinitions.find((entry) => location.pathname === `/master-plan-system/${entry.code}`);
  const pageTitle = permissionResource ? `${permissionResource.label} · 权限管理` : masterPlanPage ? masterPlanPage.label : ({
      "/sales-summary-dashboard": "销售接单汇总大屏",
      "/equipment-dashboard": "集团设备大屏", "/equipment-register": "设备总台账", "/equipment-status-report": "设备状态填报",
      "/development-requests": "需求提报与审批", "/workflow-settings": "审批流程配置",
      "/master-data": "基础资料维护", "/data-operations": "基础资料维护", "/finished-goods-inbound": "成品入库",
      "/data-center/sales-orders": "订单表", "/data-center/inbound": "入库表", "/data-center/outbound": "出库表",
      "/data-center/supply-chain/suppliers": "供应商清单",
      "/marketing/business-customers": "业务人员与客户对应表", "/marketing/order-schedule": "订单排期",
      "/hr/workforce-planning": "人力资源规划", "/hr/recruitment": "招聘与配置", "/hr/training": "培训与开发",
      "/hr/performance": "绩效管理", "/hr/compensation": "薪酬福利管理", "/hr/employee-relations/departure-check": "离职人员检查",
      "/organization": "组织架构表", "/audit": "审计日志", "/admin": "用户与角色", "/users": "用户与角色", "/administrators": "管理员", "/contacts": "通讯录",
      "/api-keys": "API Key", "/system/notifications": "消息中心", "/profile": "个人中心"
    } as Record<string, string>)[location.pathname] ?? activeModule.title;
  return <Layout className={`app-shell${collapsed ? " sidebar-is-collapsed" : ""}`}>
    <Sider collapsed={collapsed} collapsedWidth={64} width={238} className="sidebar">
      <button type="button" className="brand" onClick={() => navigate("/")} aria-label="返回全部模块"><BrandLogo compact={collapsed} inverse /></button>
      {!collapsed && <div className={`sidebar-module-mark portal-tone-${activeModule.tone}`}><span>{activeModule.englishTitle}</span><strong>{activeModule.title}</strong></div>}
      <Button className="sidebar-home" type="text" icon={<HomeOutlined />} onClick={() => navigate("/")}>{!collapsed && "全部模块"}</Button>
      <Menu mode="inline" theme="dark" selectedKeys={[location.pathname]} defaultOpenKeys={[]} items={navigationByModule[moduleId]} onClick={({ key }) => navigate(key)} />
      <Button className="sidebar-collapse" type="primary" shape="circle" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
    </Sider>
    <Layout>
      <Header className="topbar">
        <div className="topbar-context"><Text type="secondary">{activeModule.title}</Text><h1 className="topbar-page-title">{pageTitle}</h1></div>
        <div className="topbar-user"><div><Text strong>{user.displayName ?? user.username}</Text></div>
          <Button icon={<LogoutOutlined />} onClick={logout}>退出</Button></div>
      </Header>
      <Content className="content">
        <Routes>
          <Route path="/sales-summary-dashboard" element={<SalesSummaryDashboard />} />
          <Route path="/equipment-dashboard" element={<EquipmentDashboardPage />} />
          <Route path="/equipment-register" element={<EquipmentRegisterPage />} />
          <Route path="/equipment-status-report" element={<EquipmentStatusReportPage />} />
          <Route path="/master-plan-system/:resource" element={<MasterPlanResourceRoute />} />
          <Route path="/development-requests" element={<DevelopmentRequestsPage />} />
          <Route path="/workflow-settings" element={<ApprovalFlowSettingsPage />} />
          <Route path="/master-data" element={<DataOperations />} />
          <Route path="/data-operations" element={<DataOperations />} />
          <Route path="/finished-goods-inbound" element={<Navigate to="/data-center/inbound" replace />} />
          <Route path="/data-center/sales-orders" element={<SalesOrdersPage />} />
          <Route path="/data-center/inbound" element={<FinishedGoodsInboundPage />} />
          <Route path="/data-center/outbound" element={<FinishedGoodsOutboundPage />} />
          <Route path="/data-center/supply-chain/suppliers" element={<SupplierListPage />} />
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
          <Route path="/administrators" element={<AdministratorsPage />} />
          <Route path="/contacts" element={<ContactDirectory />} />
          <Route path="/api-keys" element={<ApiKeyCenter />} />
          <Route path="/system/notifications" element={<NotificationCenterPage />} />
          <Route path="/profile" element={<ProfileCenterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Content>
    </Layout>
  </Layout>;
}

function DataOperations() {
  const queryClient = useQueryClient();
  /* KN-FILTER-001：字典与工序通过平台统一读取入口（服务端筛选/排序/分页），写操作仍走原有接口。 */
  const [dictionaryQuery, setDictionaryQuery] = useState<PlatformTableQuery>(blankPlatformQuery());
  const [processQuery, setProcessQuery] = useState<PlatformTableQuery>(blankPlatformQuery());
  const dictionaries = useQuery({ queryKey: platformRowsKey("dictionaries", dictionaryQuery), queryFn: () => api<PlatformTablePage<any>>(platformRowsUrl("dictionaries", dictionaryQuery)), placeholderData: (previous) => previous });
  const processes = useQuery({ queryKey: platformRowsKey("processes", processQuery), queryFn: () => api<PlatformTablePage<any>>(platformRowsUrl("processes", processQuery)), placeholderData: (previous) => previous });
  const [dictionaryIds, setDictionaryIds] = useState<React.Key[]>([]);
  const [processIds, setProcessIds] = useState<React.Key[]>([]);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>();
  const [dictionaryForm] = Form.useForm();
  const [processForm] = Form.useForm();
  const refresh = (key: string) => void queryClient.invalidateQueries({ queryKey: [key] });
  const dictionaryRows = dictionaries.data?.rows ?? [];
  const updateDictionaryType = async (row: any, field: string, value: unknown) => { await api(`/master-data/dictionary-types/${row.typeId}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.typeVersion }) }); refresh("dictionaries"); };
  const updateDictionaryValue = async (row: any, field: string, value: unknown) => { await api(`/master-data/dictionary-values/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.version }) }); refresh("dictionaries"); };
  const updateProcess = async (row: any, field: string, value: unknown) => { await api(`/master-data/processes/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value, expectedVersion: row.version }) }); refresh("processes"); };
  const importMasterFile = async (file: File, kind: "dictionaries") => {
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
  const downloadTemplate = async (kind: "dictionaries", format: "xlsx" | "csv") => {
    const name = ({ dictionaries: "字典导入模板" } as const)[kind];
    try {
      await downloadApiFile(`/master-data/templates/${kind}?format=${format}`, `${name}.${format}`);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const dictionaryColumns = [
    { title: "字典编码", dataIndex: "typeCode", render: (value: unknown, row: any) => <InlineText value={value} onSave={(v) => updateDictionaryType(row, "code", v)} /> },
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
    <Button onClick={() => setDictionaryOpen(true)}>新增字典值</Button>
    <Button onClick={() => setProcessOpen(true)}>新增工序</Button>
  </Space>} />
    <ImportFeedbackAlert value={importFeedback} onClose={() => setImportFeedback(undefined)} />
    <Tabs items={[
      { key: "dictionaries", label: `字典值（${dictionaries.data?.total ?? 0}）`, children: <>
        <Space wrap className="master-data-toolbar">
          <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(file) => importMasterFile(file as File, "dictionaries")}>
            <Button loading={importing === "dictionaries"}>导入字典（CSV/XLSX）</Button>
          </Upload>
          <Button onClick={() => void downloadTemplate("dictionaries", "xlsx")}>下载 XLSX 模板</Button>
          <Button onClick={() => void downloadTemplate("dictionaries", "csv")}>下载 CSV 模板</Button>
          <Button danger disabled={!dictionaryIds.length} onClick={async () => { await api("/master-data/dictionary-values/delete", { method: "POST", body: JSON.stringify({ ids: dictionaryIds }) }); setDictionaryIds([]); refresh("dictionaries"); }}>停用选中（{dictionaryIds.length}）</Button>
        </Space>
        <KdosDataTable resource="dictionaries" editable rowKey="id" rowSelection={{ selectedRowKeys: dictionaryIds, onChange: setDictionaryIds }} dataSource={dictionaryRows} serverData={{ total: dictionaries.data?.total ?? 0, onQueryChange: setDictionaryQuery }} columns={dictionaryColumns} scroll={{ x: "max-content", y: 480 }} />
      </> },
      { key: "processes", label: `工序（${processes.data?.total ?? 0}）`, children: <>
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
        <KdosDataTable resource="processes" editable rowKey="id" rowSelection={{ selectedRowKeys: processIds, onChange: setProcessIds }} dataSource={processes.data?.rows} serverData={{ total: processes.data?.total ?? 0, onQueryChange: setProcessQuery }} columns={processColumns} scroll={{ x: "max-content", y: 480 }} />
      </> }
    ]} />
    <Modal title="新增字典值" open={dictionaryOpen} onCancel={() => setDictionaryOpen(false)} onOk={() => dictionaryForm.validateFields().then(async (values) => { await api("/master-data/dictionaries", { method: "POST", body: JSON.stringify(values) }); setDictionaryOpen(false); dictionaryForm.resetFields(); refresh("dictionaries"); })}><Form form={dictionaryForm} layout="vertical"><Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="名称"><Input /></Form.Item><Form.Item name="value" label="值" rules={[{ required: true }]}><Input /></Form.Item></Form></Modal>
    <Modal title="新增工序" open={processOpen} onCancel={() => setProcessOpen(false)} onOk={() => processForm.validateFields().then(async (values) => { await api("/master-data/processes", { method: "POST", body: JSON.stringify(values) }); setProcessOpen(false); processForm.resetFields(); refresh("processes"); })}><Form form={processForm} layout="vertical" initialValues={{ sortOrder: 1, enableDueDate: true, enableStatus: true, enabled: true }}><Form.Item name="sortOrder" label="顺序"><InputNumber /></Form.Item><Form.Item name="code" label="代码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="enableRequiredDays" label="所需天数" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableDueDate" label="交期" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableStatus" label="状态" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enableException" label="异常" valuePropName="checked"><Switch /></Form.Item></Form></Modal>
  </div>;
}

type InboundTableQuery = { page: number; pageSize: number; search: string; filters: Record<string, string>; filterGroup?: AdvancedFilterGroup; sortField?: string; sortOrder?: "asc" | "desc" };
type InboundTablePage = { rows: any[]; total: number; page: number; pageSize: number };

function FinishedGoodsInboundPage() {
  const queryClient = useQueryClient();
  const [tableQuery, setTableQuery] = useState<InboundTableQuery>({ page: 1, pageSize: 50, search: "", filters: {} });
  const records = useQuery({
    queryKey: ["finished-goods-inbound", tableQuery],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(tableQuery.page), pageSize: String(tableQuery.pageSize) });
      if (tableQuery.search) params.set("search", tableQuery.search);
      if (Object.values(tableQuery.filters).some((value) => value.trim())) params.set("filters", JSON.stringify(tableQuery.filters));
      if (tableQuery.filterGroup?.rules?.length || tableQuery.filterGroup?.groups?.length) params.set("filterGroup", JSON.stringify(tableQuery.filterGroup));
      if (tableQuery.sortField) params.set("sortField", tableQuery.sortField);
      if (tableQuery.sortOrder) params.set("sortOrder", tableQuery.sortOrder);
      return api<InboundTablePage>(`/master-data/finished-goods-inbound?${params}`);
    },
    placeholderData: (previous) => previous
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
      /* KN-FILTER-001：导出与列表共用 search + FilterGroup，保证跨页导出与筛选一致。 */
      const exportParams = new URLSearchParams({ format });
      if (tableQuery.search) exportParams.set("search", tableQuery.search);
      if (tableQuery.filterGroup?.rules?.length || tableQuery.filterGroup?.groups?.length) exportParams.set("filterGroup", JSON.stringify(tableQuery.filterGroup));
      await downloadApiFile(`/master-data/finished-goods-inbound/export?${exportParams}`, `成品入库数据.${format}`);
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
    <PageHeader title="入库表" subtitle="统一展示三个来源的入库明细；来源系统、账套和源主键只读可追溯" />
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
      dataSource={records.data?.rows} loading={records.isLoading}
      serverData={{ total: records.data?.total ?? 0, onQueryChange: setTableQuery }}
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
  const [tableQuery,setTableQuery]=useState<InboundTableQuery>({page:1,pageSize:50,search:"",filters:{}});
  const logs = useQuery({ queryKey: ["audit",tableQuery], queryFn: () => {const params=new URLSearchParams({page:String(tableQuery.page),pageSize:String(tableQuery.pageSize)});if(tableQuery.search)params.set("search",tableQuery.search);if(Object.values(tableQuery.filters).some((value)=>value.trim()))params.set("filters",JSON.stringify(tableQuery.filters));if(tableQuery.filterGroup?.rules?.length || tableQuery.filterGroup?.groups?.length)params.set("filterGroup",JSON.stringify(tableQuery.filterGroup));if(tableQuery.sortField)params.set("sortField",tableQuery.sortField);if(tableQuery.sortOrder)params.set("sortOrder",tableQuery.sortOrder);return api<InboundTablePage>(`/audit-logs?${params}`);} });
  return <div><PageHeader title="审计日志" subtitle="所有业务修改均记录操作者、请求号与变更前后值" />
    <KdosDataTable resource="audit-logs" rowKey="id" loading={logs.isLoading} dataSource={logs.data?.rows} serverData={{total:logs.data?.total??0,onQueryChange:setTableQuery}} columns={[
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
  /* KN-FILTER-001：API Key 列表接入平台统一读取入口；完整 Key 永不通过列表或候选返回。 */
  const [keyQuery, setKeyQuery] = useState<PlatformTableQuery>(blankPlatformQuery());
  const keys = useQuery({ queryKey: platformRowsKey("api-keys", keyQuery), queryFn: () => api<PlatformTablePage<any>>(platformRowsUrl("api-keys", keyQuery)), placeholderData: (previous) => previous });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<any[]>("/admin/users") });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<any[]>("/admin/roles") });
  const create = useMutation({
    mutationFn: (values: any) => {
      const scopes = values.access === "tplus-sync"
        ? ["tplus-sales-orders:*:import"]
        : values.access === "readwrite"
        ? ["mps-orders:*:read", "mps-orders:*:update", "supplier-list:*:read", "dictionaries:*:read", "dictionaries:*:update"]
        : ["mps-orders:*:read", "supplier-list:*:read", "dictionaries:*:read"];
      return api<any>("/api-keys", { method: "POST", body: JSON.stringify({ ...values, scopes }) });
    },
    onSuccess: (result) => {
      setOpen(false);
      form.resetFields();
      setRevealedKeys((current) => ({ ...current, [result.id]: result.apiKey }));
      Modal.info({ title: "请立即复制并保存 API Key", content: <Typography.Paragraph copyable code>{result.apiKey}</Typography.Paragraph> });
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      void queryClient.invalidateQueries({ queryKey: ["table-filters/rows"] });
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
    <KdosDataTable resource="api-keys" rowKey="id" dataSource={keys.data?.rows} loading={keys.isLoading} serverData={{ total: keys.data?.total ?? 0, onQueryChange: setKeyQuery }} columns={[
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
  /* KN-FILTER-001：通讯录接入平台统一读取入口（服务端筛选/分页），只读、不允许编辑。 */
  const [contactQuery, setContactQuery] = useState<PlatformTableQuery>(blankPlatformQuery());
  const contacts = useQuery({ queryKey: platformRowsKey("contacts", contactQuery), queryFn: () => api<PlatformTablePage<any>>(platformRowsUrl("contacts", contactQuery)), placeholderData: (previous) => previous });
  const columns = [
    { title: "姓名", dataIndex: "name" }, { title: "工号", dataIndex: "employeeNo" }, { title: "职位", dataIndex: "position" },
    { title: "所属组织", dataIndex: "departmentPaths", render: (paths: string[][]) => <Space direction="vertical" size={0}>{(paths ?? []).map((path, index) => <span key={index}>{path.join(" / ")}</span>)}</Space> },
    { title: "直属上级", dataIndex: "directLeaders", render: (values: string[]) => values?.join("、") || "—" }, { title: "电话", dataIndex: "telephone" },
    { title: "状态", dataIndex: "enabled", render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "在职" : "停用"}</Tag> },
    ...auditColumns
  ];
  return <div><PageHeader title="通讯录" subtitle="企业微信通讯录同步目录，只读展示，不允许手工编辑。" actions={<Text type="secondary">共 {contacts.data?.total ?? 0} 位员工</Text>} /><KdosDataTable resource="contacts" rowKey="id" dataSource={contacts.data?.rows} loading={contacts.isLoading} columns={columns} serverData={{ total: contacts.data?.total ?? 0, onQueryChange: setContactQuery }} scroll={{ x: "max-content", y: "calc(100vh - 305px)" }} /></div>;
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
      <Alert type="warning" showIcon message="请填写本人常用邮箱" description="该邮箱将保存为忘记密码申请时的验证邮箱，并用于接收随机临时密码。" style={{ marginBottom: 16 }} />
      <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true }]}><Input.Password /></Form.Item>
      <Form.Item label="找回密码邮箱" name="email" rules={[{ required: true, type: "email", message: "请输入本人有效邮箱" }]}><Input autoComplete="email" /></Form.Item>
      <Form.Item label="新密码" name="nextPassword" dependencies={["currentPassword"]} rules={[{ required: true, pattern: passwordRule, message: passwordRuleText }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value !== getFieldValue("currentPassword") ? Promise.resolve() : Promise.reject(new Error("新密码不能与当前密码相同")); } })]}><Input.Password /></Form.Item>
      <Form.Item label="确认新密码" name="confirmPassword" dependencies={["nextPassword"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value === getFieldValue("nextPassword") ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")); } })]}><Input.Password /></Form.Item>
      <Button htmlType="submit" type="primary" loading={loading} block>确认修改</Button>
    </Form>
  </Card></div>;
}

export default function App() {
  const queryClient = useQueryClient();
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem("accessToken")));
  const [mustChange, setMustChange] = useState(Boolean(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").mustChangePassword));
  const logout = () => {
    queryClient.clear();
    localStorage.removeItem("accessToken"); localStorage.removeItem("refreshToken"); localStorage.removeItem("sessionUser");
    window.location.assign("/");
  };
  return <AntApp><BrowserRouter><PageScrollReset />{authenticated ? (mustChange ? <ForcePasswordChange done={() => setMustChange(false)} /> : <Shell logout={logout} />) : <Login onLogin={() => { setAuthenticated(true); setMustChange(Boolean(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").mustChangePassword)); }} />}</BrowserRouter></AntApp>;
}
