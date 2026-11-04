import { expect, test, type Page } from "@playwright/test";
import { reviewDueDateFields } from "@kdos/contracts";

async function setup(page: Page, canEdit: boolean) {
  const user = { sub: "synthetic-edit-button-user", tenantId: "KAINAN", username: "synthetic", displayName: "隔离按钮验收",
    permissions: canEdit ? ["*"] : ["mps-review-due-dates:*:read", ...reviewDueDateFields.map(field => `mps-review-due-dates:${field.key}:read`)], isSystemAdmin: canEdit, roles: [], moduleAdminCodes: [], mustChangePassword: false };
  let writes = 0;
  await page.addInitScript(user => {
    localStorage.setItem("accessToken", "synthetic-intercepted-token");
    localStorage.setItem("sessionUser", JSON.stringify(user));
  }, user);
  await page.route("**/socket.io/**", route => route.abort());
  await page.route("**/api/v1/**", route => {
    if (route.request().method() !== "GET") writes++;
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    const json = path === "/auth/me" ? user
      : path === "/auth/preferences/table-config" ? { config: null }
      : path === "/master-plan-system/resources/mps-review-due-dates/meta" ? { fields: reviewDueDateFields, actions: { update: true } }
      : path === "/master-plan-system/resources/mps-review-due-dates" ? { rows: [{ id: "synthetic-row", version: 1, canUpdate: true, orderNumber: "SYN-ORDER-001", quantity: "12" }], total: 1 } : [];
    return route.fulfill({ json });
  });
  await page.goto("/master-plan-system/mps-review-due-dates");
  await expect(page.getByText("SYN-ORDER-001", { exact: true })).toBeVisible();
  return () => writes;
}

test("shared edit toggle uses theme outline/solid, short text, icons and full accessible instructions", async ({ page }, testInfo) => {
  const writes = await setup(page, true);
  const edit = page.getByRole("button", { name: "进入编辑模式", exact: true });
  await expect(edit).toHaveText("编辑");
  await expect(edit).toHaveAttribute("aria-pressed", "false");
  await expect(edit.locator('[aria-label="edit"]')).toBeVisible();
  // Wait for Ant Design's theme styling and state transition to settle.
  await expect(edit).toHaveCSS("color", "rgb(23, 107, 135)");
  await expect(edit).toHaveCSS("border-color", "rgb(23, 107, 135)");
  await expect(edit).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await edit.hover();
  await expect(page.getByRole("tooltip")).toHaveText("进入编辑模式");
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("edit-outlined.png") });
  await edit.click();
  const exit = page.getByRole("button", { name: "退出编辑模式", exact: true });
  await expect(exit).toHaveText("退出");
  await expect(exit).toHaveAttribute("aria-pressed", "true");
  await expect(exit.locator('[aria-label="logout"]')).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(exit).toHaveCSS("background-color", "rgb(23, 107, 135)");
  await expect(exit).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator('[data-resource="mps-review-due-dates"]')).toHaveAttribute("data-edit-mode", "editing");
  await page.screenshot({ path: testInfo.outputPath("exit-solid.png") });
  await exit.click();
  await expect(page.locator('[data-resource="mps-review-due-dates"]')).toHaveAttribute("data-edit-mode", "readonly");
  await expect(edit).toHaveText("编辑");
  expect(writes()).toBe(0);
});

test("readonly employee has no edit or exit button", async ({ page }) => {
  await setup(page, false);
  await expect(page.getByRole("button", { name: /进入编辑模式|退出编辑模式/ })).toHaveCount(0);
  await expect(page.locator('[data-resource="mps-review-due-dates"]')).toHaveAttribute("data-edit-mode", "readonly");
});
