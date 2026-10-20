import { expect, test } from "@playwright/test";
import contracts from "@kdos/contracts";

const resource = "mps-shipping-plans";
const divisionId = "0199d000-0000-7000-8000-000000000010";

test("shipping create allows all three optional fields empty and still requires other fields", async ({ page }) => {
  const fields = contracts.tablePermissionFieldsFor(resource);
  const user = { sub: "synthetic-shipping-user", permissions: ["*"], isSystemAdmin: true, tableDataScopes: [] };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(user => {
    localStorage.setItem("accessToken", "synthetic-intercepted-token");
    localStorage.setItem("sessionUser", JSON.stringify(user));
  }, user);
  // All APIs, including POST, are intercepted: this test never writes production data.
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: user });
    if (path.endsWith("/meta")) return route.fulfill({ json: { resource, fields, createFields: fields.filter(field => field.editable), actions: { create: true, update: true, import: true, export: true } } });
    if (path.includes("/references/organizations")) return route.fulfill({ json: [{ id: divisionId, name: "合成测试事业部", pathLabel: "合成测试事业部" }] });
    if (path.endsWith(`/resources/${resource}`) && request.method() === "POST") {
      writes.push(request.postDataJSON());
      return route.fulfill({ json: { id: "synthetic-row", version: 1 } });
    }
    if (path.endsWith(`/resources/${resource}`)) return route.fulfill({ json: { rows: [], total: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/master-plan-system/${resource}`);
  await page.getByRole("button", { name: /新\s*增/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /确\s*定|OK/ }).click();
  await expect(dialog.getByText("请填写客户编码", { exact: true }).first()).toBeVisible();
  expect(writes).toHaveLength(0);
  for (const [label, value] of [["客户编码", "SYN-C"], ["订单编号", "SYN-SO"], ["品项编码", "SYN-I"], ["计划数量", "1"]]) {
    await dialog.getByLabel(label!, { exact: true }).fill(value!);
  }
  await dialog.getByLabel("最迟客户交期", { exact: true }).fill("2026-10-30");
  await dialog.getByLabel("最迟客户交期", { exact: true }).press("Enter");
  await dialog.getByLabel("承接事业部", { exact: true }).click();
  await page.locator(".kdos-organization-option").filter({ hasText: "合成测试事业部" }).click();
  for (const label of ["品项名称", "下单日期", "新旧款"]) {
    await expect(dialog.locator(".ant-form-item", { has: dialog.getByLabel(label, { exact: true }) }).locator(".ant-form-item-required")).toHaveCount(0);
  }
  await dialog.getByRole("button", { name: /确\s*定|OK/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ customerCode: "SYN-C", orderNumber: "SYN-SO", itemCode: "SYN-I", latestCustomerDueDate: "2026-10-30", divisionId });
  for (const key of ["itemName", "orderDate", "modelAge"]) expect(writes[0]![key] ?? "").toBe("");
});
