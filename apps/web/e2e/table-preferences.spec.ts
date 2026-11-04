import { expect, test, type Page } from "@playwright/test";

const user = { sub: "synthetic-preference-user", tenantId: "KAINAN", username: "synthetic", displayName: "隔离配置验收", permissions: ["*"], isSystemAdmin: true, roles: [], moduleAdminCodes: [], mustChangePassword: false };
const legacy = { version: 1, visibleFieldKeys: ["equipmentCode", "createdAt"], orderedFieldKeys: ["equipmentCode", "createdAt"], columnWidths: { createdAt: 175 }, pinnedFieldKeys: [] };

async function setup(page: Page, useLegacy: boolean) {
  const state = { getStatus: 200, putStatus: useLegacy ? 400 : 200, gets: 0, puts: 0,
    config: useLegacy ? null : { ...legacy, visibleFieldKeys: ["equipmentCode", "equipmentName"], orderedFieldKeys: ["equipmentCode", "equipmentName"] } as unknown };
  await page.addInitScript(({ user, useLegacy }) => {
    localStorage.setItem("accessToken", "synthetic-intercepted-token");
    localStorage.setItem("sessionUser", JSON.stringify(user));
    if (useLegacy) {
      localStorage.setItem("kdos-form-view:KAINAN:synthetic-preference-user:equipment-register", JSON.stringify(["equipmentCode", "createdAt"]));
      localStorage.setItem("kdos-form-column-widths:KAINAN:synthetic-preference-user:equipment-register", JSON.stringify({ createdAt: 175 }));
    }
  }, { user, useLegacy });
  await page.route("**/socket.io/**", route => route.abort());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    if (path === "/auth/preferences/table-config") {
      if (route.request().method() === "GET") {
        state.gets++;
        return route.fulfill({ status: state.getStatus, json: state.getStatus === 200 ? { config: state.config } : { message: "临时配置服务异常" } });
      }
      state.puts++;
      if (state.putStatus !== 200) return route.fulfill({ status: state.putStatus, json: { message: "系统审计字段不可由客户端赋值：createdAt" } });
      state.config = route.request().postDataJSON().config;
      return route.fulfill({ json: { config: state.config } });
    }
    const json = path === "/auth/me" ? user : path === "/equipment/assets" ? { rows: [{ id: "synthetic-asset", equipmentCode: "SYN-EQ-001", equipmentName: "隔离设备", createdAt: "2026-11-04T01:00:00Z" }], total: 1 }
      : path === "/equipment/options" ? { equipment: [], users: [], organizations: [] } : [];
    return route.fulfill({ json });
  });
  await page.goto("/equipment-register");
  await expect(page.getByText("SYN-EQ-001", { exact: true })).toBeVisible();
  return state;
}

test("legacy migration HTTP 400 retains the layout and retries successfully without reporting a GET/network failure", async ({ page }) => {
  const state = await setup(page, true);
  await expect(page.getByRole("alert")).toContainText("旧版个人布局同步失败");
  await expect(page.getByRole("alert")).toContainText("HTTP 400");
  await expect(page.getByRole("columnheader", { name: "创建时间" })).toBeVisible();
  expect(state.puts).toBe(1);
  const initialGets = state.gets;
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  expect(state.gets).toBe(initialGets);
  state.putStatus = 200;
  await page.getByRole("button", { name: "重新加载个人设置" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.puts).toBe(2);
  expect(state.config).toEqual(legacy);
  expect(await page.evaluate(() => localStorage.getItem("kdos-form-column-widths:KAINAN:synthetic-preference-user:equipment-register"))).toContain("createdAt");
});

test("background HTTP 503 and recovery preserve the user's unsaved field draft", async ({ page }) => {
  const state = await setup(page, false);
  await page.getByRole("button", { name: /字段显示/ }).click();
  await page.getByRole("checkbox", { name: "设备名称", exact: true }).uncheck();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  state.getStatus = 503;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect(page.getByRole("alert")).toContainText("HTTP 503", { timeout: 12_000 });
  await expect(page.getByRole("columnheader", { name: "设备名称" })).toHaveCount(0);
  state.getStatus = 200;
  await page.getByRole("button", { name: "重新加载个人设置" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "设备名称" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /字段显示.*未保存/ })).toBeVisible();
  expect(state.puts).toBe(0);
});
