import { expect, test } from "@playwright/test";
import { tablePermissionFieldsFor } from "@kdos/contracts";
test.use({ trace: "off", screenshot: "off", video: "off" });
const resource = "finance-customer-mappings";
for (const role of ["admin", "editor", "viewer", "none"] as const) {
    test(`Finance center ${role} navigation, classification permissions and server filters`, async ({ page }) => {
        const read = role !== "none", edit = role === "admin" || role === "editor";
        const user = { sub: "0199e000-0000-7000-8000-000000000001", username: "fixture", displayName: "界面测试", permissions: role === "admin" ? ["*"] : read ? [`${resource}:*:read`, ...tablePermissionFieldsFor(resource).map(f => `${resource}:${f.key}:read`), ...(edit ? [`${resource}:*:update`, `${resource}:departmentCategory:update`, `${resource}:salesChannel:update`] : [])] : [], mustChangePassword: false };
        const requests: string[] = [], writes: unknown[] = [];
        await page.route("**/api/v1/**", async (route) => {
            const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
            let value: unknown = [];
            if (path === "/auth/me")
                value = user;
            else if (path === "/table-filters/resources")
                value = [{ code: resource, status: "REGISTERED_AND_FILTERABLE" }];
            else if (path === "/table-exports/capabilities")
                value = [{ code: resource, allowed: false }];
            else if (path === "/table-prints/capabilities")
                value = [];
            else if (path.includes("/summary"))
                value = { total: 138, pending: 0, lastSync: null };
            else if (path === "/table-filters/rows") {
                requests.push(url.search);
                value = { rows: [{ id: "0199e000-0000-7000-8000-000000000002", version: 1, customerCode: "A140", departmentCategory: "业务一部", salesChannel: "内销" }], total: 138, page: 1, pageSize: 100 };
            }
            else if (path.startsWith("/finance/customer-mappings/") && request.method() === "PATCH") {
                writes.push(request.postDataJSON());
                value = { id: "0199e000-0000-7000-8000-000000000002", version: 2 };
            }
            await route.fulfill({ json: value });
        });
        await page.addInitScript(u => { localStorage.setItem("accessToken", "fixture-token"); localStorage.setItem("sessionUser", JSON.stringify(u)); }, user);
        await page.goto("/");
        if (read)
            await expect(page.getByText("财务中心", { exact: true })).toBeVisible();
        else
            await expect(page.getByText("财务中心", { exact: true })).toHaveCount(0);
        await page.goto("/finance/base-data/customer-mappings");
        if (!read) {
            await expect(page.getByText("当前权限组不能查看客户对应表")).toBeVisible();
            expect(requests).toHaveLength(0);
            return;
        }
        await expect(page.getByText("基础数据", { exact: true })).toBeVisible();
        await expect(page.getByText("财务管理", { exact: true })).toHaveCount(0);
        await expect(page.getByText("A140", { exact: true })).toBeVisible();
        if (edit) {
            await page.locator('.ant-table-row').filter({ hasText: 'A140' }).dblclick();
            await expect(page.getByRole("dialog")).toBeVisible();
            await expect(page.getByRole("dialog").getByLabel("客户编号", { exact: true })).toBeDisabled();
            await page.getByRole("button", { name: /保\s*存/ }).click();
            await expect(page.getByRole("dialog")).toHaveCount(0);
            expect(writes).toEqual([{ expectedVersion: 1, departmentCategory: "业务一部", salesChannel: "内销" }]);
        }
        else {
            await expect(page.getByRole("button", { name: "修改分类" })).toHaveCount(0);
            await page.locator('.ant-table-row').filter({ hasText: 'A140' }).dblclick();
            await expect(page.getByRole("dialog")).toHaveCount(0);
        }
        await page.getByRole("switch", { name: "仅查看待分类" }).click();
        await expect.poll(() => requests.some(v => decodeURIComponent(v).includes("is_empty"))).toBe(true);
        await page.getByPlaceholder("搜索当前表格").fill("A140");
        await page.getByPlaceholder("搜索当前表格").press("Enter");
        await expect.poll(() => requests.some(v => v.includes("search=A140"))).toBe(true);
    });
}
