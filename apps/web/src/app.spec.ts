import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { excelMonthlyPlanColumns, monthlyPlanColumns, processDefinitions } from "@tracker/shared";
import { containsText, getValue } from "./api";
import {
  canManageTablePermissions, hasSessionResourcePermission, kdosPageSizeOptions,
  kdosSystemFieldDefinitions, shouldResetServerTablePage
} from "./shared/KdosDataTable";

function tsxFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(full) : entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("monthly plan configuration", () => {
  it("uses the 85-column monthly-plan contract with division after sequence", () => {
    expect(excelMonthlyPlanColumns).toHaveLength(85);
    expect(monthlyPlanColumns).toHaveLength(85);
    expect(processDefinitions).toHaveLength(14);
    expect(monthlyPlanColumns[0]?.header).toBe("序号");
    expect(monthlyPlanColumns[1]).toMatchObject({ key: "responsibleOrgId", header: "事业部", kind: "department" });
    expect(monthlyPlanColumns.at(-1)?.header).toBe("客户");
  });

  it("uses four exact fields for every displayed process", () => {
    for (const code of ["drawingBom", "metalMain", "woodMain", "machining", "welding", "blank", "bakingPlating", "acrylic", "painting", "assemblyPacking", "rearPackingParts"]) {
      expect(monthlyPlanColumns.filter((column) => column.key.startsWith(`processes.${code}.`)).map((column) => column.header))
        .toEqual(["所需周期", "交期", "状态", "异常"]);
    }
    expect(monthlyPlanColumns.find((column) => column.key === "month")).toMatchObject({
      header: "月", kind: "decimal", editable: true
    });
  });

  it("reads nested process values by field key", () => {
    expect(getValue({ processes: { drawingBom: { status: "Y" } } }, "processes.drawingBom.status")).toBe("Y");
  });

  it("matches quick text filters without case sensitivity", () => {
    expect(containsText("TEST-2026-001", "test")).toBe(true);
    expect(containsText("TEST-2026-001", "  test  ")).toBe(true);
    expect(containsText("TEST-2026-001", "2026")).toBe(true);
    expect(containsText("TEST-2026-001", "other")).toBe(false);
  });

  it("ships explicit browser icons", () => {
    const root = path.resolve(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    expect(html).toContain('href="/favicon.ico?v=kn2"');
    expect(html).toContain('href="/apple-touch-icon.png?v=kn2"');
    expect(fs.statSync(path.join(root, "public/favicon.ico")).size).toBeGreaterThan(1000);
  });

  it("uses the unified KDOS table shell and exact read-only system fields", () => {
    expect(kdosSystemFieldDefinitions.map(({ key, label }) => [key, label])).toEqual([
      ["createdBy", "创建人"], ["createdAt", "创建时间"], ["updatedBy", "更新人"], ["updatedAt", "更新时间"]
    ]);
    const sourceRoot = path.resolve(__dirname);
    const directLegacyTables = tsxFiles(sourceRoot)
      .filter((file) => !file.endsWith("KdosDataTable.tsx"))
      .filter((file) => /<Table(?:\s|>)/.test(fs.readFileSync(file, "utf8")));
    expect(directLegacyTables).toEqual([]);
  });

  it("standardizes form pagination and exposes one permission page route for every resource", () => {
    expect(kdosPageSizeOptions).toEqual([20, 50, 100, 200]);
    expect(shouldResetServerTablePage("paginate")).toBe(false);
    expect(shouldResetServerTablePage("sort")).toBe(true);
    expect(shouldResetServerTablePage("filter")).toBe(true);
    const appSource = fs.readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const tableSource = fs.readFileSync(path.resolve(__dirname, "shared/KdosDataTable.tsx"), "utf8");
    expect(appSource).toContain('path="/permissions/:resource"');
    expect(tableSource).toContain('<TablePermissionButton resource={resource} />');
    expect(tableSource).toContain('showQuickJumper: true');
  });

  it("adds the supplier list under the data-center supply-chain folder", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const pageSource = fs.readFileSync(path.resolve(__dirname, "modules/data-center/DataCenterPages.tsx"), "utf8");
    expect(appSource).toContain('label: "供应链", children: [');
    expect(appSource).toContain('path="/data-center/supply-chain/suppliers" element={<SupplierListPage />}');
    expect(pageSource).toContain('resource="supplier-list"');
    expect(pageSource).toContain('systemFields={false}');
    expect(pageSource).not.toContain('resource="supplier-list" editable');
  });

  it("limits permission management to the matching module administrator", () => {
    localStorage.setItem("sessionUser", JSON.stringify({ moduleAdminCodes: ["planning"], permissions: [] }));
    expect(canManageTablePermissions("monthly-plan")).toBe(true);
    expect(canManageTablePermissions("order-schedule")).toBe(false);
    expect(canManageTablePermissions("users")).toBe(false);
  });

  it("uses only wildcard operation permissions for table action buttons", () => {
    expect(hasSessionResourcePermission({ permissions: ["equipment-status-report:*:create"] }, "equipment-status-report", "create")).toBe(true);
    expect(hasSessionResourcePermission({ permissions: ["equipment-status-report:equipmentId:create"] }, "equipment-status-report", "create")).toBe(false);
    expect(hasSessionResourcePermission({ permissions: ["equipment-status-report:*:read"] }, "equipment-status-report", "create")).toBe(false);
    expect(hasSessionResourcePermission({ isSystemAdmin: true, permissions: [] }, "equipment-status-report", "delete")).toBe(true);
  });

  it("uses the compact server-aggregated cockpit without the customer TOP 8 carousel", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "modules/planning/pages/OperationalPlanningPages.tsx"), "utf8");
    expect(source).not.toContain("客户订单金额 TOP 8");
    expect(source).toContain('api<any>(`/plans/sales-dashboard?');
    expect(source).toContain('className="dashboard-warning-list"');
    expect(source).toContain('["sales-dashboard",sessionSubject,');
    expect(source).toContain('message="公司驾驶舱数据读取失败"');
    expect(source).toContain('["rolling", rollingUserId,');
    expect(source).toContain('message="销售接单明细读取失败"');
    expect(source).not.toContain('title="交期预警" auditColumns');
  });

  it("keeps legacy oversized login headers readable only during token rotation", () => {
    const nginx = fs.readFileSync(path.resolve(__dirname, "../nginx.conf"), "utf8");
    expect(nginx).toContain("large_client_header_buffers 4 32k;");
  });

  it("keeps equipment navigation typography aligned and gives the status table real import/export actions", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const styles = fs.readFileSync(path.resolve(__dirname, "styles.css"), "utf8");
    const equipmentSource = fs.readFileSync(path.resolve(__dirname, "modules/equipment/EquipmentPages.tsx"), "utf8");
    expect(appSource).toContain('{ key: "dashboard-reports", icon: <DashboardOutlined />, label: "大屏报表"');
    expect(appSource).toContain('{ key: "master-plan-dashboards", icon: <DashboardOutlined />, label: "主计划大屏"');
    expect(appSource).toContain('{ key: "/on-hand-summary-dashboard", icon: <DashboardOutlined />, label: "集团主计划" }');
    expect(appSource).toContain('{ key: "equipment-dashboards", icon: <DashboardOutlined />, label: "设备管理大屏"');
    expect(appSource).toContain('{ key: "/equipment-dashboard", icon: <DashboardOutlined />, label: "集团设备大屏" }');
    expect(appSource).toContain('{ key: "planning-root", icon: <ScheduleOutlined />, label: "生产主计划"');
    expect(appSource).toContain('{ key: "equipment-management", icon: <ToolOutlined />, label: "设备管理"');
    expect(appSource).not.toContain('label: "设备管理驾驶舱"');
    expect(appSource).toContain('defaultOpenKeys={[]}');
    expect(appSource).not.toContain('defaultOpenKeys={[`${moduleId}-root`');
    expect(styles).toContain('.sidebar .ant-menu-root > .ant-menu-submenu-open > .ant-menu-submenu-title');
    expect(styles).toContain('font-weight: 500 !important;');
    expect(styles).not.toContain('.equipment-dashboard .kdos-data-table .ant-table-body { max-height: 360px !important; }');
    expect(styles).toContain('.equipment-dashboard .equipment-analysis-card .ant-table-body { max-height: none !important; }');
    expect(equipmentSource).toContain('/equipment/status-reports/import-preview');
    expect(equipmentSource).toContain('/equipment/status-reports/import-confirm');
    expect(equipmentSource).toContain('/equipment/status-reports/export');
    expect(equipmentSource).toContain('title="按部门设备运行分析"');
    expect(equipmentSource).toContain('title="设备总数量"');
    expect(equipmentSource).toContain('title="首批监控数量"');
    expect(equipmentSource).toContain('title="待上线数量"');
    expect(equipmentSource).toContain('title="当天有数据"');
    expect(equipmentSource).toContain('{ title: "事业部", dataIndex: "division", width: 150, fixed: "left" }, { title: "部门"');
    expect(equipmentSource).toContain('mode="multiple"');
    expect(equipmentSource).toContain('query.append("departmentId", departmentId)');
    expect(equipmentSource).not.toContain("设备状态按每台设备最近一次填报");
    expect(equipmentSource).not.toContain("每台受监控设备至少每7天填报一次");
  });

  it("renders the September on-hand dashboard from the server aggregate", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "modules/planning/pages/OnHandSummaryDashboard.tsx"), "utf8");
    expect(source).toContain("/planning/on-hand-summary?year=${SOURCE_YEAR}&month=${SOURCE_MONTH}");
    expect(source).not.toContain("数据来源：{SOURCE_YEAR}年{SOURCE_MONTH}月计划");
    expect(source).not.toContain("每 5 分钟自动刷新");
    expect(source).toContain('resource="on-hand-summary-dashboard"');
    expect(source).toContain("客户在手欠数 TOP 12");
    expect(source).toContain("事业部在手执行情况");
    expect(source).toContain("工序风险概览");
  });

  it("requires account and saved email, warns about lockout, and keeps reset failures visible", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");
    const profileSource = fs.readFileSync(path.resolve(__dirname, "modules/profile/ProfileCenterPage.tsx"), "utf8");
    expect(source).toContain('name="username" label="账号"');
    expect(source).toContain('name="email" label="邮箱"');
    expect(source).toContain("发送随机密码");
    expect(source).toContain("邮箱连续错误 10 次后");
    expect(source).toContain('label="找回密码邮箱" name="email"');
    expect(source).toContain("该邮箱将保存为忘记密码申请时的验证邮箱");
    expect(profileSource).toContain('name="email" label="找回密码邮箱"');
    expect(profileSource).toContain("每次修改密码时以本次填写为准");
    expect(source).toContain('message="临时密码发送失败"');
    expect(source).not.toContain("mainlandMobileRule");
    expect(source).not.toContain('/auth/password-reset/confirm');
  });
});
