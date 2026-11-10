import { expect, test, type Page } from '@playwright/test';

const username = process.env.KNP_E2E_USERNAME ?? 'admin';
const password = process.env.KNP_E2E_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('accessToken')))).toBe(true);
}

test('production R&D BOM report dates, alignment, tabs and duplicate heading', async ({ page }) => {
  test.skip(!password, 'No local read-only browser credential configured');
  await login(page);
  await page.goto('/rd/bom-report');
  await expect(page.getByRole('heading', { name: 'BOM报表' })).toBeVisible();
  await expect(page.getByText('订单BOM报表', { exact: true })).toHaveCount(0);
  const views = [
    ['订单BOM明细', ['下单日期', '客户交期', 'BOM审核日期']],
    ['订单BOM汇总', ['下单日期']],
    ['事业部BOM统计', []]
  ] as const;
  for (const [tab, dateFields] of views) {
    await page.getByRole('tab', { name: tab }).click();
    const table = page.locator('.ant-table').first();
    await expect(table.locator('thead th').first()).toBeVisible();
    const headerAlignment = await table.locator('thead th').evaluateAll(nodes => nodes.flatMap(node => {
      const label = node.querySelector<HTMLElement>('.kdos-column-title-label');
      if (!label) return [];
      const cell = node.getBoundingClientRect(), text = label.getBoundingClientRect();
      return [{ cellAlign: getComputedStyle(node).textAlign, labelAlign: getComputedStyle(label).textAlign, centerOffset: Math.abs((cell.left + cell.right) / 2 - (text.left + text.right) / 2) }];
    }));
    expect(headerAlignment.length).toBeGreaterThan(0);
    expect(headerAlignment.every(item => item.cellAlign === 'center' && item.labelAlign === 'center' && item.centerOffset < 2)).toBe(true);
    expect(await table.locator('tbody td').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).textAlign === 'center'))).toBe(true);
    const headers = await table.locator('thead th').allTextContents();
    for (const field of dateFields) {
      const index = headers.findIndex(header => header.includes(field));
      expect(index).toBeGreaterThanOrEqual(0);
      const values = await table.locator(`tbody tr td:nth-child(${index + 1})`).allTextContents();
      expect(values.every(value => !/\d{2}:\d{2}:\d{2}/.test(value))).toBe(true);
      expect(values.every(value => value.trim() === '' || /^\d{4}-\d{2}-\d{2}$/.test(value.trim()))).toBe(true);
    }
  }
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
