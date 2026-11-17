import { test, expect } from "@playwright/test";

const reportEndpoint = "/master-plan-system/division-order-progress/fourth";
const reportResource = "mps-division-order-progress";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("production build shows the production progress table centered with server-filterable status", async ({ page }) => {
  const user = { sub: "0199e000-0000-7000-8000-000000000001", username: "synthetic", tenantId: "synthetic", permissions: ["*"], mustChangePassword: false };
  const requests: URL[] = [];
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    requests.push(url);
    let value: unknown = [];
    if (path === "/auth/me") value = user;
    else if (path === "/table-filters/resources") value = [{ code: reportResource, status: "REGISTERED_AND_FILTERABLE" }];
    else if (path === "/table-filters/candidates" && url.searchParams.get("field") === "productionStatus") value = [{ value: "已完成", label: "已完成" }, { value: "未完成", label: "未完成" }];
    else if (path === reportEndpoint) value = {
      rows: [{ id: "synthetic", customerCode: "C001", orderNumber: "2026A0001", itemCode: "ITEM-001", itemName: "合成品项",
        orderDate: "2026-11-03", expectedShippingDate: "2026-11-05", orderQuantity: "10.0000", reviewDueDate: "2026-11-10",
        drawing: "Y", materialReady: "N", cutting: "N", weldingQuantity: "5.0000", blankQuantity: "0", surfaceTreatmentQuantity: "0",
        packagingQuantity: "0", inboundQuantity: "0", productionStatus: "未完成", inboundVerified: true, weldingComplete: false, blankComplete: false,
        surfaceTreatmentComplete: false, packagingComplete: false, inboundComplete: false }],
      total: 1, page: 1, pageSize: 100,
      diagnostics: { basePlanUnlinked: 0, baseDueDateMissing: 0, processUnlinked: 0, inboundUnverified: 0 }
    };
    await route.fulfill({ json: value });
  });
  await page.addInitScript(session => {
    localStorage.setItem("accessToken", "synthetic");
    localStorage.setItem("sessionUser", JSON.stringify(session));
  }, user);

  await page.goto("/pmc/division-order-progress/fourth");
  await page.getByRole("menuitem", { name: /报表/ }).first().click();
  await expect(page.getByText("生产进度表", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "事业四部订单生产进度报表" })).toHaveCount(1);
  await expect(page.getByText("事业四部订单生产进度", { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("客户代码、订单号、品号或品名")).toBeVisible();
  await expect(page.getByRole("button", { name: /高级筛选/ })).toBeVisible();
  await expect(page.getByText("2026-11-03", { exact: true })).toBeVisible();
  await expect(page.getByText("2026-11-05", { exact: true })).toBeVisible();
  await expect(page.getByText("多日期", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ITEM-001", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /生产状态/ })).toBeVisible();
  await expect(page.getByText("未完成", { exact: true })).toBeVisible();
  const alignments = await page.locator(".ant-table-thead th, .ant-table-tbody td").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).textAlign));
  expect(alignments.length).toBeGreaterThan(0);
  expect(alignments.every(align => align === "center")).toBe(true);
  await expect(page.locator(".kdos-column-title-label").first()).toHaveCSS("text-align", "center");
  await expect(page.locator(".kdos-data-table-toolbar")).toBeVisible();

  const fixedKeys = ["customerCode", "orderNumber", "itemCode"];
  for (const key of fixedKeys) {
    await expect(page.locator(`th[data-kdos-column-key="${key}"]`)).toHaveClass(/ant-table-cell-fix-left/);
  }
  await expect(page.locator("td.ant-table-cell-fix-left")).toHaveCount(4);
  await expect(page.locator('th[data-kdos-column-key="itemName"]')).not.toHaveClass(/ant-table-cell-fix-left/);
  await expect(page.locator('th[data-kdos-column-key="itemCode"]')).toHaveClass(/ant-table-cell-fix-left-last/);
  const fixedCell = page.locator("td.ant-table-cell-fix-left").nth(3);
  const movingCell = page.locator("td").nth(4);
  const fixedBefore = await fixedCell.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, width: rect.width, background: getComputedStyle(element).backgroundColor };
  });
  const headerBefore = await page.locator('th[data-kdos-column-key="itemCode"]').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  expect(Math.abs(fixedBefore.left - headerBefore.left)).toBeLessThan(1);
  expect(Math.abs(fixedBefore.width - headerBefore.width)).toBeLessThan(1);
  const movingBefore = await movingCell.evaluate(element => element.getBoundingClientRect().left);
  const scrollBody = page.locator(".ant-table-body");
  expect(await scrollBody.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await scrollBody.evaluate(element => { element.scrollLeft = Math.min(400, element.scrollWidth - element.clientWidth); });
  await expect.poll(() => scrollBody.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  const fixedAfter = await fixedCell.evaluate(element => element.getBoundingClientRect().left);
  const movingAfter = await movingCell.evaluate(element => element.getBoundingClientRect().left);
  expect(Math.abs(fixedAfter - fixedBefore.left)).toBeLessThan(2);
  expect(movingAfter).toBeLessThan(movingBefore - 100);
  expect(fixedBefore.background).not.toBe("rgba(0, 0, 0, 0)");

  await page.getByRole("button", { name: /高级筛选/ }).click();
  const filter = page.getByTestId("advanced-filter-panel");
  await filter.getByRole("button", { name: "添加过滤条件" }).click();
  await filter.locator(".ant-select").nth(2).click();
  const fieldInput=filter.locator(".ant-select").nth(2).locator("input");
  await fieldInput.fill("生产状态");
  await fieldInput.press("Enter");
  const valueInput=filter.locator(".ant-select").nth(4).locator("input");
  await valueInput.fill("已完成");
  await page.getByRole("option", { name: "已完成", exact: true }).click();
  const filteredRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith(reportEndpoint)) return false;
    const group = JSON.parse(url.searchParams.get("filterGroup") ?? "null");
    return group?.rules?.[0]?.field === "productionStatus" && group.rules[0].value === "已完成";
  });
  await filter.getByRole("button", { name: /应\s*用/ }).click();
  await filteredRequest;
  await expect.poll(() => requests.some(url => url.pathname.endsWith(reportEndpoint)
    && url.searchParams.get("sortField") === "orderDate" && url.searchParams.get("sortOrder") === "desc")).toBe(true);
});
