import { expect, test, type Page } from "@playwright/test";
import { planningFieldRegistry } from "@kdos/contracts";

async function mockApp(page: Page) {
  await page.route("**/api/v1/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { username?: string; password?: string };
    if (body.username !== "admin") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "用户名不存在" }) });
    if (body.password !== "test") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "密码错误" }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ accessToken: "test-token", refreshToken: "refresh", user: { sub: "u-admin", username: "admin", displayName: "测试管理员", roles: ["系统管理员"], permissions: ["*"], divisions: "*", mustChangePassword: false } }) });
  });
  await page.route("**/api/v1/plans/rolling", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "o1", orderType: null, orderNumber: "2026C235004", month: "2026-08", months: ["2026-08"], orderDate: "2026-08-01", customerDueDate: "2026-08-20", reviewDueDate: "2026-08-22", exceptionDueDate: "2026-08-25", customer: "测试客户", salesperson: "测试业务员", exceptionDeliveryMethod: "送货", orderAmount: "12800.75", totalQuantity: "64.5", completedQuantity: "0", pendingQuantity: "64.5", completionRate: 0, division: "事业一部", actualCompletionDate: null, shippingDate: null, deliveryScore: "95", qualityScore: "98" }]) }));
  await page.route("**/api/v1/plans/sales-dashboard", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "o1", orderNumber: "2026C235004", month: "2026-08", months: ["2026-08"], orderDate: "2026-08-01", customerDueDate: "2026-08-20", reviewDueDate: "2026-08-22", exceptionDueDate: "2026-08-25", customer: "测试客户", salesperson: "测试业务员", exceptionDeliveryMethod: "送货", orderAmount: "12800.75", totalQuantity: "64.5", completedQuantity: "0", pendingQuantity: "64.5", completionRate: 0, division: "事业一部", actualCompletionDate: null, shippingDate: null, deliveryScore: "95", qualityScore: "98" }]) }));
  await page.route("**/api/v1/plans/monthly?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ period: { id: "p1", year: 2026, month: 8 }, rows: [{ id: "i1", version: 1, relationKey: "2026C235004-99996277-1/1", orderNumber: "2026C235004", orderDate: "2026-08-01", customerDueDate: "2026-08-20", exceptionDueDate: "2026-08-25", itemNumber: "99996277-1/1", itemName: "双面主架", itemStatus: "进行中", month: "2026-08", productAttribute: "五金", productionQuantity: "30", historicalInboundQuantity: "0", todayInboundQuantity: "0", processes: { blank: { dueDate: "2026-08-20", quantity: "30", status: "已完成" }, bakingPlating: { dueDate: "2026-08-25", quantity: "10", status: "进行中" }, assemblyPacking: { dueDate: "2026-08-28", quantity: "0", status: "进行中" } } }] }) }));
  const planningItem = { id: "i1", version: 1, planVersionId: "v1", priority: 50, planSequence: 10, sequence: 1, planningStatus: "PENDING", responsibleOrgId: null, ownerUserId: null, relationKey: "2026C235004-99996277-1/1", orderNumber: "2026C235004", orderDate: "2026-08-01", customerDueDate: "2026-08-20", exceptionDueDate: "2026-08-25", itemNumber: "99996277-1/1", itemName: "双面主架", itemStatus: "进行中", month: "2026-08", productAttribute: "五金", productionQuantity: "30", historicalInboundQuantity: "0", todayInboundQuantity: "0", imageRefs: [], processes: { frontParts: { requiredDays: "2", dueDate: "2026-08-18", status: "进行中", exception: null }, blank: { dueDate: "2026-08-20", quantity: "30", status: "已完成" }, bakingPlating: { dueDate: "2026-08-25", quantity: "10", status: "进行中" }, assemblyPacking: { dueDate: "2026-08-28", quantity: "0", status: "进行中" } } };
  await page.route("**/api/v1/planning/fields", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(planningFieldRegistry.map((field) => ({ ...field, access: field.editable ? "EDITABLE" : "READONLY" }))) }));
  await page.route("**/api/v1/planning/periods/by-month?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "p1", year: 2026, month: 8, currentVersionId: null, versions: [{ id: "v1", tenantId: "t1", periodId: "p1", versionNumber: 1, name: "v1", status: "DRAFT", basedOnVersionId: null }] }) }));
  await page.route("**/api/v1/planning/versions/v1/items", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([planningItem]) }));
  await page.route("**/api/v1/planning/versions/v1/risks?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ overdue: [], dueSoon: [planningItem], processOverdue: [], openExceptions: [] }) }));
  await page.route("**/api/v1/planning/items/i1", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...planningItem, version: 2 }) }));
  await page.route("**/api/v1/planning/versions/v1/items/bulk", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ ...planningItem, version: 2 }]) }));
  await page.route("**/api/v1/planning/versions/v1/reorder", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ ...planningItem, planSequence: 10 }]) }));
  await page.route("**/api/v1/planning/items/i1/images", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...planningItem, imageRefs: ["/uploads/test.png"], version: 2 }) }));
  await page.route("**/api/v1/plans/daily-progress?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    date: "2026-08-18",
    processes: [{ id: "p-machining", code: "machining", name: "机加", sortOrder: 5 }, { id: "p-welding", code: "welding", name: "焊接/点焊", sortOrder: 6 }],
    rows: [{ id: "i1", sequence: 1, month: "2026-08", orderNumber: "2026C235004", orderType: null, itemNumber: "99996277-1/1", itemName: "双面主架", customer: "测试客户", division: "事业一部", productionQuantity: "30", balanceQuantity: "20", progress: { machining: null, welding: "3" } }]
  }) }));
  await page.route("**/api/v1/plans/daily-progress/*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ orderItemId: "i1", date: "2026-08-18", processCode: "machining", quantity: "5" }) }));
  await page.route("**/api/v1/plans/items/*/cell", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "i1", version: 2 }) }));
  await page.route("**/api/v1/plans/items/move", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ moved: 1, skipped: 0, target: { id: "p2", year: 2026, month: 9 } }) }));
  await page.route("**/api/v1/plans/orders/*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "o1", version: 2 }) }));
  await page.route("**/api/v1/admin/users", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "u1", username: "01382", displayName: "吴志琴", roleIds: ["r1"], roles: ["管理员"], division: null, enabled: true, lastLoginAt: null }]) }));
  await page.route("**/api/v1/admin/roles", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "r1", name: "管理员", description: "管理员", divisions: [], permissions: [] }]) }));
  await page.route("**/api/v1/master-data/suppliers", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "s1", code: "S001", name: "测试供应商", remark: "", enabled: true }]) }));
  await page.route("**/api/v1/master-data/dictionaries", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([
    { id: "dt1", code: "division", name: "事业部", values: [{ id: "dv1", value: "事业一部", sortOrder: 1, enabled: true }] },
    { id: "dt2", code: "productAttribute", name: "产品属性", values: [{ id: "dv2", value: "五金", sortOrder: 1, enabled: true }, { id: "dv3", value: "木作", sortOrder: 2, enabled: true }, { id: "dv4", value: "五金+木作", sortOrder: 3, enabled: true }] },
    { id: "dt3", code: "handlingMethod", name: "制作方式", values: ["自制", "中心外购", "外协", "自制+外协"].map((value, index) => ({ id: `hm${index}`, value, sortOrder: index, enabled: true })) },
    { id: "dt4", code: "outsourcingMethod", name: "外协方式", values: ["成品", "毛坯", "部件"].map((value, index) => ({ id: `om${index}`, value, sortOrder: index, enabled: true })) }
  ]) }));
  await page.route("**/api/v1/master-data/processes", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/v1/api-keys", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([
    { id: "key1", name: "integration-test", scopes: ["monthly-plan:*:read"], expiresAt: null, enabled: true, userId: "u1" }
  ]) }));
  await page.route("**/api/v1/api-keys/*/regenerate", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    id: "key1", name: "integration-test", apiKey: "fdt_regenerated_test_key"
  }) }));
  await page.route("**/api/v1/master-data/sales-orders", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([
    { id: "so1", orderNumber: "2026A000001", itemNumber: "P001", itemName: "测试品名", orderDate: "2026-08-01", reviewDueDate: "2026-08-10", quantity: "10", remark: "" }
  ]) }));
  await page.route("**/api/v1/master-data/finished-goods-inbound", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([
    { id: "fg1", salesOrderNumber: "2026A000001", documentDate: "2026-08-06", createdTime: "2026-08-06T08:30:00.000Z", documentNumber: "MC-2026-08-0001", businessType: "自制加工", inventoryCode: "P001", inventoryName: "测试品名", relationInfo: "2026A000001P001", receivedQuantity: "10", unitPrice: "2.5", totalAmount: "25", voucherWord: "" }
  ]) }));
}

async function login(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("凯南数字化工作台 · KDOS");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("test");
  await page.locator("button[type=submit]").click();
  await expect(page.getByText("表格操作", { exact: true })).toBeVisible();
}

async function openAugustMonthlyPlan(page: Page) {
  await page.getByText("202608", { exact: true }).click();
}

test("login reports username and password errors separately", async ({ page }) => {
  await mockApp(page);
  await page.goto("/");
  await page.getByLabel("用户名").fill("missing-user");
  await page.getByLabel("密码").fill("test");
  await page.locator("button[type=submit]").click();
  await expect(page.getByText("用户名不存在")).toBeVisible();
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("wrong-password");
  await page.locator("button[type=submit]").click();
  await expect(page.getByText("密码错误")).toBeVisible();
});

test("monthly plan selection is the first fixed column and field state is per user", async ({ page }) => {
  await mockApp(page); await login(page);
  await page.screenshot({ path: "../../docs/migration/screenshots/master-plan-after.png", fullPage: true });
  await openAugustMonthlyPlan(page);
  const title = page.locator(".topbar-page-title", { hasText: "2026年8月计划" });
  await expect(title).toBeVisible();
  await expect.poll(async () => (await title.boundingBox())?.width ?? 0).toBeGreaterThan(120);
  const headers = page.locator(".monthly-grid .ag-header-cell");
  await expect(headers.first().locator(".ag-header-select-all")).toBeVisible();
  await expect(headers.nth(1)).toContainText("优先级");
  await page.screenshot({ path: "../../docs/migration/screenshots/monthly-plan-after.png", fullPage: true });
  await expect(page.locator('.monthly-grid .ag-header-cell[col-id="relationKey"]')).toHaveCount(0);
  const orderCell = page.locator('.monthly-grid .ag-cell[col-id="orderNumber"]').first();
  await orderCell.click();
  await expect(orderCell.locator("input")).toHaveCount(0);
  await page.getByRole("button", { name: "进入编辑模式" }).click();
  await expect(page.getByRole("button", { name: "退出编辑模式" })).toBeVisible();
  const saveButton = page.getByRole("button", { name: /保\s*存/ });
  await expect(saveButton).toBeVisible();
  await expect(page.getByText("失焦自动保存")).toBeVisible();
  await expect(page.getByRole("button", { name: "从剪贴板粘贴" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /删除选中/ })).toHaveCount(0);
  await orderCell.click();
  await expect(orderCell.locator("input")).toHaveCount(0);
  const dueDateCell = page.locator('.monthly-grid .ag-cell[col-id="customerDueDate"]').first();
  await dueDateCell.click();
  await expect(dueDateCell.locator("input")).toBeVisible();
  await dueDateCell.locator("input").fill("2026-08-31");
  await saveButton.click();
  await expect(page.getByText("保存成功").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "进入编辑模式" })).toBeVisible();
  await expect(dueDateCell.locator("input")).toHaveCount(0);
  await expect(page.getByText("快速筛选", { exact: true })).toBeVisible();
  await expect(orderCell).toHaveCSS("user-select", "text");
  await page.getByRole("button", { name: "进入编辑模式" }).click();
  await page.locator(".monthly-grid .ag-body-horizontal-scroll-viewport").evaluate((element) => {
    element.scrollLeft = 400;
    element.dispatchEvent(new Event("scroll"));
  });
  const attributeCell = page.locator('.monthly-grid .ag-cell[col-id="productAttribute"]').first();
  await attributeCell.click();
  await page.keyboard.press("Enter");
  await expect(attributeCell).toHaveClass(/ag-cell-inline-editing/);
  await expect(attributeCell.locator(".ag-select")).toBeVisible();
  await page.keyboard.press("Escape");
  await orderCell.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "上传简图" })).toHaveCount(0);
  await page.locator('.monthly-grid .ag-cell[col-id="image"]').first().click();
  await expect(page.getByRole("dialog", { name: /上传简图/ })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "选择图片（最多 2 张）" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /关\s*闭/ }).click();
  await page.getByRole("button", { name: "字段显示" }).click();
  await expect(page.getByRole("dialog")).toContainText("字段显示");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("kdos-planning-hidden:admin"))).toBe(JSON.stringify(["relationKey"]));
});

test("an empty month still renders the complete planning field grid", async ({ page }) => {
  await mockApp(page);
  await page.unroute("**/api/v1/planning/periods/by-month?*");
  await page.route("**/api/v1/planning/periods/by-month?*", (route) => route.fulfill({ status: 200, body: "" }));
  let periodCreated = 0;
  let versionCreated = 0;
  let itemCreated = 0;
  await page.route("**/api/v1/planning/periods", (route) => {
    periodCreated += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "p-empty", year: 2026, month: 8, currentVersionId: null }) });
  });
  await page.route("**/api/v1/planning/periods/p-empty/versions", (route) => {
    versionCreated += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "v-empty", periodId: "p-empty", versionNumber: 1, name: "v1", status: "DRAFT", basedOnVersionId: null }) });
  });
  await page.route("**/api/v1/planning/versions/v-empty/items", (route) => {
    if (route.request().method() === "POST") {
      itemCreated += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "i-empty", version: 1 }) });
    }
    return route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/v1/planning/versions/v-empty/risks?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ overdue: [], dueSoon: [], processOverdue: [], openExceptions: [] }) }));
  await login(page);
  await openAugustMonthlyPlan(page);

  await expect(page.getByText("Planning Center", { exact: true })).toBeVisible();
  await expect(page.getByText("2026年8月暂无计划数据；可直接导入 Excel 或新增计划行，系统会在首次写入时自动准备。")).toBeVisible();
  await expect(page.getByRole("button", { name: "创建周期和 v1 草稿" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新建草稿版本" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新增计划行" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "导入 Excel" })).toBeEnabled();
  await expect(page.locator(".monthly-grid .ag-header-cell").first().locator(".ag-header-select-all")).toBeVisible();
  await expect(page.locator('.monthly-grid .ag-header-cell[col-id="priority"]')).toContainText("优先级");
  await expect(page.locator('.monthly-grid .ag-header-cell[col-id="orderNumber"]')).toContainText("订单号");
  await expect(page.getByText("本月暂无计划数据，字段结构已完整加载", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "新增计划行" }).click();
  const dialog = page.getByRole("dialog", { name: "新增计划行" });
  await dialog.getByLabel("订单号").fill("2026A000001");
  await dialog.getByLabel("品号").fill("P001");
  await dialog.getByLabel("计划生产数量").fill("10");
  await dialog.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByText("计划行已创建，可直接在表格中继续编辑")).toBeVisible();
  expect({ periodCreated, versionCreated, itemCreated }).toEqual({ periodCreated: 1, versionCreated: 1, itemCreated: 1 });
});

test("monthly plan menu exposes the 2026 month pages and daily progress saves process quantity", async ({ page }) => {
  await mockApp(page); await login(page);
  await expect(page.getByText("2026年", { exact: true })).toBeVisible();
  for (const period of ["202608", "202609", "202610", "202611", "202612"]) {
    await expect(page.getByText(period, { exact: true })).toBeVisible();
  }
  await page.getByText("202609", { exact: true }).click();
  await expect(page).toHaveURL(/\/monthly\/202609$/);
  await expect(page.locator(".topbar-page-title")).toHaveText("2026年9月计划");

  await page.getByText("日进度", { exact: true }).click();
  await expect(page).toHaveURL(/\/daily-progress$/);
  await expect(page.getByText("仅显示订单欠数大于 0 的月度计划订单 + 品号，共 1 条")).toBeVisible();
  await expect(page.locator('.daily-progress-grid .ag-header-cell[col-id="progress.machining"]')).toContainText("机加");
  await expect(page.locator('.daily-progress-grid .ag-header-cell[col-id="progress.welding"]')).toContainText("焊接/点焊");
  await page.getByRole("button", { name: "进入录入模式" }).click();
  const machiningCell = page.locator('.daily-progress-grid .ag-cell[col-id="progress.machining"]').first();
  await machiningCell.dblclick();
  const input = machiningCell.locator("input");
  await expect(input).toBeVisible();
  await input.fill("5");
  const saveRequest = page.waitForRequest((request) => request.url().includes("/api/v1/plans/daily-progress/i1") && request.method() === "PATCH");
  await page.keyboard.press("Enter");
  const request = await saveRequest;
  expect(request.postDataJSON()).toMatchObject({ processCode: "machining", quantity: 5 });
  await expect(page.getByText(/机加 已保存/)).toBeVisible();
});

test("monthly plan uses compact dates, selectable headers, colors and collapsed production stages", async ({ page }) => {
  await mockApp(page); await login(page);
  await openAugustMonthlyPlan(page);
  await expect(page.locator('.monthly-grid .ag-cell[col-id="orderDate"]').first()).toHaveText("08-01");
  const headerText = page.locator('.monthly-grid .ag-header-cell[col-id="orderNumber"] .ag-header-cell-text');
  await expect(headerText).toHaveCSS("user-select", "text");
  await expect(page.locator('.monthly-grid .ag-cell[col-id="processes.frontParts.dueDate"]')).toHaveCount(0);
  const blankStageGroup = page.locator(".monthly-grid .ag-header-group-cell", { hasText: "毛坯" })
    .filter({ has: page.locator(".ag-header-expand-icon") }).first();
  await expect(blankStageGroup).toBeVisible();
  await blankStageGroup.locator(".ag-header-expand-icon-collapsed").click();
  const frontPartsCell = page.locator('.monthly-grid .ag-cell[col-id="processes.frontParts.dueDate"]').first();
  await expect(frontPartsCell).toBeVisible();
  await expect(frontPartsCell).toHaveClass(/column-tone-a/);
  await expect(page.locator('.monthly-grid .ag-header-cell[col-id="processes.frontParts.requiredDays"]')).toContainText("所需天数");
  await expect(page.locator('.monthly-grid .ag-header-cell[col-id="processes.frontParts.status"]')).toContainText("状态");
  await expect(page.locator('.monthly-grid .ag-header-cell[col-id="processes.frontParts.exception"]')).toContainText("异常");
  await expect(page.locator(".monthly-grid .ag-header-cell-text", { hasText: "状态/数量" }).first()).toBeVisible();
  await expect(page.getByText("编排操作", { exact: true })).toBeVisible();
  await expect(page.getByText("快速筛选", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "筛选品号状态" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "筛选订单号" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "筛选品号" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入 Excel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "批量修改（0）" })).toBeVisible();
  await expect(page.getByText("7天内到期 1", { exact: true })).toBeVisible();
});

test("collapsed sidebar shows the monthly plan through today's inbound and handling method", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mockApp(page); await login(page);
  await openAugustMonthlyPlan(page);
  await page.locator(".sidebar-collapse").click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-is-collapsed/);

  const todayInbound = page.locator('.monthly-grid .ag-header-cell[col-id="todayInboundQuantity"]');
  const handlingMethod = page.locator('.monthly-grid .ag-header-cell[col-id="handlingMethod"]');
  await expect(todayInbound).toBeVisible();
  await expect(handlingMethod).toBeVisible();
  await page.locator(".monthly-grid .ag-body-horizontal-scroll-viewport").evaluate((element) => {
    element.scrollLeft += 160; element.dispatchEvent(new Event("scroll"));
  });
  const rightEdge = await handlingMethod.evaluate((element) => element.getBoundingClientRect().right);
  expect(rightEdge).toBeLessThanOrEqual(1920);
  await expect(handlingMethod).toContainText("制作方式");
  await expect(page.locator('.monthly-grid .ag-header-cell[col-id="orderNumber"] .ag-header-cell-resize')).toBeAttached();
});

test("selected monthly items support batch orchestration and persisted order", async ({ page }) => {
  await mockApp(page); await login(page);
  await openAugustMonthlyPlan(page);
  const rowCheckbox = page.getByRole("checkbox", { name: /Press Space to toggle row selection/ }).first();
  await page.locator(".monthly-grid .ag-row .ag-selection-checkbox .ag-checkbox-input-wrapper").first().click();
  await expect(rowCheckbox).toBeChecked();
  const bulkButton = page.getByRole("button", { name: "批量修改（1）" });
  await expect(bulkButton).toBeEnabled(); await bulkButton.click();
  const dialog = page.getByRole("dialog", { name: "批量修改 1 行" });
  await dialog.getByLabel("字段").click(); await page.getByText("优先级", { exact: true }).last().click();
  await dialog.getByLabel("新值").fill("20");
  const bulkRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/planning/versions/v1/items/bulk") && request.method() === "POST");
  await dialog.getByRole("button", { name: "确 定" }).click();
  expect((await bulkRequest).postDataJSON()).toMatchObject({ updates: [{ id: "i1", field: "priority", value: 20, expectedVersion: 1 }] });
  await expect(page.getByText("已批量修改 1 行")).toBeVisible();
  const reorderRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/planning/versions/v1/reorder") && request.method() === "POST");
  await page.getByRole("button", { name: "移到顶部" }).click();
  expect((await reorderRequest).postDataJSON()).toEqual({ itemIds: ["i1"] });
});

test("users and master data expose add, multi-select, inline edit and import", async ({ page }) => {
  await mockApp(page); await login(page);
  await page.getByText("用户与角色", { exact: true }).click();
  await expect(page.getByRole("button", { name: "新增用户" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入用户 CSV" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "组织架构" })).toHaveCount(0);
  await expect(page.locator(".ant-table-selection-column").first()).toBeVisible();
  await expect(page.getByText("吴志琴", { exact: true })).toBeVisible();
  await expect(page.locator('input[value="吴志琴"]')).toHaveCount(0);
  await page.getByText("基础资料维护", { exact: true }).click();
  await expect(page.getByRole("button", { name: "新增供应商" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入供应商（CSV/XLSX）" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载 XLSX 模板" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载 CSV 模板" })).toBeVisible();
  await expect(page.locator('input[value="测试供应商"]')).toBeVisible();
  await page.getByRole("button", { name: "新增供应商" }).click();
  await expect(page.getByLabel("是否启用")).toBeChecked();
  await page.getByRole("dialog").getByRole("button", { name: "确 定" }).click();
  await expect(page.getByText("请输入供应商编码")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "取 消" }).click();
  await page.getByRole("tab", { name: /字典值/ }).click();
  await expect(page.getByRole("button", { name: "导入字典（CSV/XLSX）" })).toBeVisible();
  await expect(page.locator('input[value="事业一部"]')).toBeVisible();
  await expect(page.getByRole("tab", { name: /销售订单/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /成品入库/ })).toHaveCount(0);
  await page.locator(".ant-menu-item").getByText("成品入库", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "成品入库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增成品入库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入成品入库（CSV/XLSX）" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载 XLSX 模板" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载 CSV 模板" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 XLSX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 CSV" })).toBeVisible();
  await expect(page.locator('input[value="MC-2026-08-0001"]')).toBeVisible();
});

test("sales order details keep only controls and the reference table", async ({ page }) => {
  await mockApp(page); await login(page);
  const orderCell = page.locator('.grid-card .ag-cell[col-id="orderNumber"]').first();
  await expect(page.getByText("跨月订单实时汇总，不维护重复汇总数据", { exact: true })).toHaveCount(0);
  await expect(page.getByText("销售接单明细", { exact: true })).toBeVisible();
  await expect(page.locator(".content").getByText("滚动主计划", { exact: true })).toHaveCount(0);
  await expect(page.locator(".content .stats-row")).toHaveCount(0);
  await expect(page.locator(".content .dashboard-kpi-grid")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /删除选中/ })).toHaveCount(0);
  await expect(page.getByText("表格操作", { exact: true })).toBeVisible();
  await expect(page.getByText("快速筛选", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入销售接单明细 Excel" })).toBeVisible();
  await expect(page.locator(".rolling-grid .ag-header-group-cell", { hasText: "订单信息" })).toBeVisible();
  await expect(page.locator(".rolling-grid .ag-header-group-cell", { hasText: "订单执行信息" })).toBeVisible();
  await expect(page.locator(".rolling-grid .ag-header-group-cell", { hasText: "订单执行结果评估" })).toBeVisible();
  const summaryHeaders = (await page.locator(".rolling-grid .ag-header-cell-text").allTextContents()).filter(Boolean);
  expect(summaryHeaders).toEqual([
    "序号", "账套", "订单类型", "客户", "业务员", "订单号", "下单日期", "客户要求交期", "产前评审交期", "异常后二次交期",
    "异常交货方式", "订单金额", "订单总数量", "承产单位", "已完成数量", "待完成数量", "完成比例",
    "订单实际完成日期", "出货日期", "交期评分", "品质评分", "创建时间", "最后修改时间", "修改人"
  ]);
  await expect(page.getByLabel("筛选滚动订单号")).toBeVisible();
  await expect(page.getByLabel("筛选所属月份")).toBeVisible();
  await expect(page.getByLabel("筛选滚动客户要求交期范围").first()).toBeVisible();
  await expect(page.getByLabel("筛选滚动产前评审交期范围").first()).toBeVisible();
  await expect(page.getByLabel("筛选滚动异常后二次交期范围").first()).toBeVisible();
  await expect(page.getByLabel("筛选完成比例下限")).toBeVisible();
  await expect(page.getByLabel("筛选完成比例上限")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "筛选滚动客户", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "筛选滚动事业部" })).toBeVisible();
  const firstFilterRow = await page.getByPlaceholder("客户交期开始").boundingBox();
  const secondFilterRow = await page.getByPlaceholder("异常交期开始").boundingBox();
  expect(secondFilterRow!.y).toBeGreaterThan(firstFilterRow!.y + 20);
  await page.getByLabel("筛选所属月份").click();
  await expect(page.locator('td[title="2026-01"]')).toHaveText("1月");
  await page.keyboard.press("Escape");
  await page.getByLabel("筛选滚动订单号").fill("不存在的订单");
  await expect(orderCell).toHaveCount(0);
  await page.getByRole("button", { name: "清空筛选" }).click();
  await expect(orderCell).toBeVisible();
  await orderCell.click();
  await expect(orderCell.locator("input")).toHaveCount(0);
  await page.getByRole("button", { name: "进入编辑模式" }).click();
  await expect(page.getByRole("button", { name: "退出编辑模式" })).toBeVisible();
  const saveButton = page.getByRole("button", { name: /保\s*存/ });
  await expect(saveButton).toBeVisible();
  await expect(page.getByText("失焦自动保存")).toBeVisible();
  await orderCell.click();
  await expect(orderCell.locator("input")).toHaveCount(0);
  const customerCell = page.locator('.grid-card .ag-cell[col-id="customer"]').first();
  await customerCell.click();
  await expect(customerCell.locator("input")).toBeVisible();
  await customerCell.locator("input").fill("新客户");
  await saveButton.click();
  await expect(page.getByText("保存成功").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "进入编辑模式" })).toBeVisible();
  await expect(customerCell.locator("input")).toHaveCount(0);
  await expect(page.getByText("筛选", { exact: true })).toBeVisible();
});

test("sales order dashboard shows the first-version management overview", async ({ page }) => {
  await mockApp(page); await login(page);
  await page.locator(".ant-menu-item").getByText("销售接单汇总大屏", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "销售接单汇总大屏" })).toBeVisible();
  await expect(page.locator(".dashboard-kpi-grid .ant-card")).toHaveCount(6);
  await expect(page.getByText("订单执行状态", { exact: true })).toBeVisible();
  await expect(page.getByText("总体生产完成进度", { exact: true })).toBeVisible();
  await expect(page.getByText("客户订单金额 TOP 8", { exact: true })).toBeVisible();
  await expect(page.getByText("承产单位执行情况", { exact: true })).toBeVisible();
  await expect(page.getByText("交期预警（延期及未来 3 天）", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "大屏时间维度" })).toBeVisible();
  await expect(page.getByLabel("大屏筛选日期")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "大屏筛选事业部" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "大屏筛选客户" })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新数据" })).toBeVisible();
  await expect(page.locator(".division-overview-grid .division-overview-item")).toHaveCount(1);
  const amountCard = page.locator(".dashboard-kpi-grid .ant-card", { hasText: "订单金额" });
  await expect(amountCard.locator(".ant-statistic-content")).toHaveText("12,801");
  await expect(page.locator(".dashboard-kpi-grid")).not.toContainText("¥");
  await expect(page.locator(".sales-dashboard .ant-table-thead th").first()).toHaveCSS("text-align", "center");
});

test("api key list can regenerate, reveal and copy a key", async ({ page }) => {
  await mockApp(page); await login(page);
  await page.getByText("API Key", { exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "API KEY" })).toBeVisible();
  await expect(page.getByText("已隐藏，请重新生成后查看")).toBeVisible();
  await page.getByRole("button", { name: "重新生成并显示" }).click();
  const dialog = page.getByRole("dialog", { name: /重新生成 integration-test/ });
  await expect(dialog).toContainText("旧 KEY 会立即失效");
  await dialog.getByRole("button", { name: "重新生成" }).click();
  await expect(page.getByText("fdt_regenerated_test_key", { exact: true })).toBeVisible();
  await expect(page.locator(".ant-typography-copy").first()).toBeVisible();
});

test("development requests follow both approval levels and resource planning", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApp(page);
  const people = [
    { id: "u-admin", username: "admin", employeeNo: "A001", displayName: "测试管理员", position: "系统管理员", departmentPaths: [["集团"]], managerIds: ["u-manager"] },
    { id: "u-manager", username: "manager", employeeNo: "M001", displayName: "李经理", position: "部门经理", departmentPaths: [["集团", "业务部"]], managerIds: [] },
    { id: "u-handler", username: "developer", employeeNo: "D001", displayName: "开发人员", position: "开发工程师", departmentPaths: [["集团", "信息部"]], managerIds: ["u-handler-manager"] },
    { id: "u-handler-manager", username: "devmanager", employeeNo: "D002", displayName: "开发主管", position: "信息部经理", departmentPaths: [["集团", "信息部"]], managerIds: [] }
  ];
  let row: any;
  const events: any[] = [];
  const update = (status: string, availableActions: string[], patch: Record<string, unknown> = {}) => {
    row = { ...row, ...patch, status, availableActions, updatedAt: "2026-08-21T04:00:00.000Z" };
  };
  await page.route("**/api/v1/development-requests/people", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(people) }));
  await page.route("**/api/v1/development-requests?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(row ? [row] : []) }));
  await page.route("**/api/v1/development-requests", async (route) => {
    const body = route.request().postDataJSON() as any;
    row = {
      id: "req-1", requestNumber: "REQ-202608-000001", title: body.title, category: body.category,
      description: body.description, businessValue: body.businessValue, urgency: body.urgency, desiredDate: body.desiredDate,
      status: "PENDING_REQUESTER_APPROVAL", requesterId: "u-admin", requesterName: "测试管理员",
      requesterManagerId: body.requesterManagerId, requesterManagerName: "李经理", handlerId: null, handlerName: null,
      handlerManagerId: null, handlerManagerName: null, requiredResources: null, estimatedWorkdays: null,
      plannedCompletionDate: null, createdAt: "2026-08-21T03:00:00.000Z", updatedAt: "2026-08-21T03:00:00.000Z",
      availableActions: ["REQUESTER_APPROVE", "REQUESTER_REJECT"]
    };
    events.push({ id: "e1", action: "SUBMIT", actorName: "测试管理员", comment: "提交需求", toStatus: row.status, createdAt: row.createdAt });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(row) });
  });
  await page.route("**/api/v1/development-requests/req-1/requester-decision", async (route) => {
    const body = route.request().postDataJSON() as any;
    expect(body.approved).toBe(true);
    update("PENDING_ADMIN_ASSIGNMENT", ["ASSIGN"]);
    events.push({ id: "e2", action: "REQUESTER_APPROVE", actorName: "李经理", toStatus: row.status, createdAt: row.updatedAt });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(row) });
  });
  await page.route("**/api/v1/development-requests/req-1/assign", async (route) => {
    const body = route.request().postDataJSON() as any;
    expect(body).toMatchObject({ handlerId: "u-handler", handlerManagerId: "u-handler-manager" });
    update("PENDING_HANDLER_PLAN", ["SUBMIT_PLAN"], { handlerId: body.handlerId, handlerName: "开发人员", handlerManagerId: body.handlerManagerId, handlerManagerName: "开发主管" });
    events.push({ id: "e3", action: "ASSIGN", actorName: "测试管理员", toStatus: row.status, createdAt: row.updatedAt });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(row) });
  });
  await page.route("**/api/v1/development-requests/req-1/plan", async (route) => {
    const body = route.request().postDataJSON() as any;
    expect(body).toMatchObject({ requiredResources: "1 名开发人员、测试环境", estimatedWorkdays: 8, plannedCompletionDate: "2026-09-30" });
    update("PENDING_HANDLER_MANAGER_APPROVAL", ["HANDLER_APPROVE", "HANDLER_REJECT"], { requiredResources: body.requiredResources, estimatedWorkdays: "8", plannedCompletionDate: body.plannedCompletionDate });
    events.push({ id: "e4", action: "SUBMIT_PLAN", actorName: "开发人员", toStatus: row.status, createdAt: row.updatedAt });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(row) });
  });
  await page.route("**/api/v1/development-requests/req-1/handler-manager-decision", async (route) => {
    const body = route.request().postDataJSON() as any;
    expect(body.approved).toBe(true);
    update("APPROVED_FOR_DEVELOPMENT", []);
    events.push({ id: "e5", action: "HANDLER_APPROVE", actorName: "开发主管", toStatus: row.status, createdAt: row.updatedAt });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(row) });
  });
  await page.route("**/api/v1/development-requests/req-1", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...row, events }) }));

  await login(page);
  await expect(page.getByText("需求与开发", { exact: true })).toBeVisible();
  await page.getByText("需求提报与审批", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "需求与开发" })).toBeVisible();
  await expect(page.getByText("待我处理", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提报新需求" }).click();
  const requestDialog = page.getByRole("dialog", { name: "提报新需求" });
  await requestDialog.getByLabel("需求标题").fill("新增质量异常闭环功能");
  await expect(requestDialog.getByText(/李经理（M001/)).toBeVisible();
  await requestDialog.getByLabel("需求说明").fill("建立质量异常提报、跟踪和关闭流程，并保留完整处理记录。");
  await requestDialog.getByLabel("业务价值").fill("减少线下沟通并提升异常关闭效率。");
  await requestDialog.getByRole("button", { name: /提交审批/ }).click();
  await expect(page.getByText("新增质量异常闭环功能")).toBeVisible();

  await page.getByRole("button", { name: "上级通过" }).click();
  const firstApproval = page.getByRole("dialog", { name: /上级通过/ });
  await firstApproval.getByLabel("审批意见").fill("同意，进入开发评估。");
  await firstApproval.getByRole("button", { name: /上级通过/ }).click();
  await expect(page.getByRole("button", { name: "分配处理人" })).toBeVisible();

  await page.getByRole("button", { name: "分配处理人" }).click();
  const assignDialog = page.getByRole("dialog", { name: /分配处理人员/ });
  await assignDialog.getByLabel("处理人员", { exact: true }).click();
  await page.getByText(/开发人员（D001/).click();
  await expect(assignDialog.getByText(/开发主管（D002/)).toBeVisible();
  await assignDialog.getByRole("button", { name: /确认分配/ }).click();
  await expect(page.getByRole("button", { name: "填写资源与工期" })).toBeVisible();

  await page.getByRole("button", { name: "填写资源与工期" }).click();
  const planDialog = page.getByRole("dialog", { name: /填写开发资源与工期/ });
  await planDialog.getByLabel("开发所需资源").fill("1 名开发人员、测试环境");
  await planDialog.getByLabel("开发所需时间（工作日）").fill("8");
  await planDialog.getByLabel("计划完成日期").fill("2026-09-30");
  await planDialog.getByLabel("计划完成日期").press("Enter");
  await planDialog.getByRole("button", { name: /提交上级审批/ }).click();
  await expect(page.getByRole("button", { name: "开发审批通过" })).toBeVisible();

  await page.getByRole("button", { name: "开发审批通过" }).click();
  const finalApproval = page.getByRole("dialog", { name: /开发审批通过/ });
  await finalApproval.getByLabel("审批意见").fill("资源与工期合理，同意开发。");
  await finalApproval.getByRole("button", { name: /开发审批通过/ }).click();
  await expect(page.getByText("已批准开发", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: /详\s*情/ }).click();
  await expect(page.getByText("流程记录", { exact: true })).toBeVisible();
  await expect(page.getByText("处理人上级审批通过", { exact: true })).toBeVisible();
});

test("monthly save failure is reported and keeps edit mode", async ({ page }) => {
  await mockApp(page);
  await page.unroute("**/api/v1/planning/items/i1");
  await page.route("**/api/v1/planning/items/i1", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ message: "模拟保存错误" })
  }));
  await login(page);
  await openAugustMonthlyPlan(page);
  await page.getByRole("button", { name: "进入编辑模式" }).click();
  await expect(page.getByRole("button", { name: "退出编辑模式" })).toBeVisible();
  const dueDateCell = page.locator('.monthly-grid .ag-cell[col-id="customerDueDate"]').first();
  await expect(dueDateCell).toBeVisible();
  await dueDateCell.click();
  if (await page.getByRole("button", { name: "进入编辑模式" }).isVisible()) {
    await page.getByRole("button", { name: "进入编辑模式" }).click();
    await dueDateCell.click();
  }
  await dueDateCell.press("F2");
  await expect(dueDateCell.locator("input")).toBeVisible();
  await dueDateCell.locator("input").fill("2026-08-30");
  await page.getByRole("button", { name: /保\s*存/ }).click();
  await expect(page.getByText("保存失败：模拟保存错误").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "退出编辑模式" })).toBeVisible();
});
