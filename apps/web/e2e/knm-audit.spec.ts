import { expect, test } from "@playwright/test";
test("audit monthly/weekly process groups", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名").fill("__knm_uat");
  await page.getByLabel("密码").fill(process.env.KNM_P ?? "");
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
  for (const resource of ["mps-monthly-plans", "mps-weekly-plans"]) {
    await page.goto(`/master-plan-system/${resource}`);
    await page.waitForTimeout(3500);
    const headers = await page.locator(".ant-table-thead th").allInnerTexts();
    const names = ["下料", "机加", "折弯", "点焊", "焊接", "木作", "研磨", "毛坯", "表面处理", "包装"];
    const found = names.filter((n) => headers.includes(n));
    console.log(`${resource}: 表头数=${headers.length} 工序一级名称命中=${found.length}/${names.length} -> ${found.join(",")}`);
    console.log(`  异常列(每工序): ${headers.filter((h) => h === "异常").length} 个“异常”表头`);
  }
});
