import { expect, test } from "@playwright/test";

// Exercise the real page and shared table, with synthetic API fixtures only.
// No production account, password, or authorization grant is written.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 10_000 });

for (const width of [1366, 1920]) test(`member password reset remains reachable at ${width}px with saved column preferences`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const administrator = { sub: "fixture-admin", username: "fixture-admin", displayName: "测试管理员", isSystemAdmin: true, permissions: ["*"], moduleAdminCodes: [], mustChangePassword: false };
  const member = { id: "fixture-member", username: "fixture001", displayName: "测试成员", enabled: true, version: 3, departmentPaths: [], roleIds: [], roles: [] };
  const commands: unknown[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    if (path === "/auth/me") return route.fulfill({ json: administrator });
    if (path === "/admin/users/fixture-member/reset-password") {
      commands.push(request.postDataJSON());
      return route.fulfill({ json: { id: member.id, reset: true, mustChangePassword: true, version: ++member.version } });
    }
    if (request.method() !== "GET") return route.abort();
    if (path === "/admin/users") return route.fulfill({ json: url.searchParams.has("options") ? [member] : { rows: [member], total: 1, page: 1, pageSize: 50 } });
    if (path === "/auth/preferences/table-config") return route.fulfill({ json: { config: { visibleFieldKeys: ["displayName"], orderedFieldKeys: ["displayName"] } } });
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(user => {
    localStorage.setItem("accessToken", "synthetic-fixture");
    localStorage.setItem("sessionUser", JSON.stringify(user));
  }, administrator);
  await page.goto("/users");
  const action = page.getByRole("button", { name: "操作-测试成员" });
  await expect(action).toBeInViewport();
  await action.click();
  await page.getByRole("menuitem", { name: "重置密码" }).click();
  let dialog = page.getByRole("dialog", { name: "重置密码" });
  await expect(dialog).toContainText("fixture001");
  await dialog.getByRole("button", { name: /取\s*消/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(commands).toEqual([]);
  await action.click();
  await page.getByRole("menuitem", { name: /编辑/ }).click();
  await page.locator(".employee-edit-drawer").getByRole("button", { name: "重置密码", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "重置密码" });
  await dialog.getByRole("button", { name: "确认重置" }).click();
  await expect(dialog).toHaveCount(0);
  expect(commands).toEqual([{ expectedVersion: 3 }]);
  expect(errors).toEqual([]);
});
