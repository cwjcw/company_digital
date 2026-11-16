import { test, expect } from "@playwright/test";

const reportEndpoint = "/master-plan-system/division-order-progress/fourth";
const reportResource = "mps-division-order-progress";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("production SPA shows centered dates and requests the earliest-date default sort", async ({ page }) => {
  const user = { sub: "0199e000-0000-7000-8000-000000000001", username: "synthetic", tenantId: "synthetic", permissions: ["*"], mustChangePassword: false };
  const requests: URL[] = [];
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    requests.push(url);
    let value: unknown = [];
    if (path === "/auth/me") value = user;
    else if (path === "/table-filters/resources") value = [{ code: reportResource, status: "REGISTERED_AND_FILTERABLE" }];
    else if (path === reportEndpoint) value = {
      rows: [{ id: "synthetic", customerCode: "C001", orderNumber: "2026A0001", itemCode: "ITEM-001", itemName: "合成品项",
        orderDate: "2026-11-03", expectedShippingDate: "2026-11-05", orderQuantity: "10.0000", reviewDueDate: "2026-11-10",
        drawing: "Y", materialReady: "N", cutting: "N", weldingQuantity: "5.0000", blankQuantity: "0", surfaceTreatmentQuantity: "0",
        packagingQuantity: "0", inboundQuantity: "0", inboundVerified: true, weldingComplete: false, blankComplete: false,
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
  await expect(page.getByText("2026-11-03", { exact: true })).toBeVisible();
  await expect(page.getByText("2026-11-05", { exact: true })).toBeVisible();
  await expect(page.getByText("多日期", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ITEM-001", { exact: true })).toBeVisible();
  const alignments = await page.locator(".ant-table-thead th, .ant-table-tbody td").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).textAlign));
  expect(alignments.length).toBeGreaterThan(0);
  expect(alignments.every(align => align === "center")).toBe(true);
  await expect.poll(() => requests.some(url => url.pathname.endsWith(reportEndpoint)
    && url.searchParams.get("sortField") === "orderDate" && url.searchParams.get("sortOrder") === "desc")).toBe(true);
});
