import { test, expect, chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const columns = [
  { key: "number", label: "项目编号", align: "left", width: 12 },
  { key: "name", label: "项目名称", align: "left", width: 20 },
  { key: "remark", label: "备注", align: "left", width: 22 }
];
async function mount(page: Page, rows = 120, viewKey = "ACTUAL") {
  await page.route("**/api/v1/table-prints/**", route => {
    const body = route.request().postDataJSON() ?? {};
    const selected = body.rangeType === "SELECTED";
    const records = Array.from({ length: selected ? 1 : rows }, (_, index) => ({ number: `SYN-${String(index).padStart(4, "0")}`, name: `合成测试项目 ${index}`, remark: "测试换行与分页。".repeat(8) }));
    return route.fulfill({ json: route.request().url().includes("manifest") ? {
      resource: "projects", title: "项目管理", columns, total: records.length, confirmThreshold: 300, largeWarningThreshold: 3000
    } : { resource: "projects", title: "项目管理", columns, headerGroups: [{ label: "项目", columns: ["number", "name"] }], rows: records,
      meta: { total: records.length, printedCount: records.length, requestedCount: selected ? 1 : undefined, rangeType: selected ? "SELECTED" : "FILTERED", orientation: "portrait", filtered: true, searched: true, printedAt: "2026-10-30T00:00:00Z", printedBy: "打印验收员" }
    } });
  });
  await page.goto("/");
  await page.evaluate(async ({ viewKey }) => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "synthetic-user", tenantId: "synthetic-tenant" }));
    // Exercise the real shared entrypoint in Vite; all business responses are synthetic.
    const path = "/src/shared/table-print.tsx";
    const { renderPrint } = await import(/* @vite-ignore */ path);
    await renderPrint({ resource: "projects", rangeType: "FILTERED", columnKeys: ["number", "name"], viewKey });
  }, { viewKey });
  await expect(page.getByRole("dialog", { name: "打印设置与预览" })).toBeVisible();
}
const paper = (page: Page) => page.locator('.kdos-print-pages .kdos-print-paper');
const ready = (page: Page) => expect(page.getByRole("button", { name: "本次打印", exact: true })).toBeEnabled();
test("shared field selection, drag ordering, exact and dragged mm widths, A4/A3/rotation, overflow and scoped preferences", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 }); await mount(page, 10); await ready(page);
  const fields = page.getByRole("list", { name: "打印字段" });
  await expect(paper(page).locator('thead tr').last().locator('th')).toHaveText(["项目编号", "项目名称"]);
  await fields.getByRole('checkbox', { name: '备注', exact: true }).check();
  await fields.locator('[data-field-key=name]').dragTo(fields.locator('[data-field-key=number]'));
  await ready(page); await expect(paper(page).locator('thead tr').last().locator('th')).toHaveText(["项目名称", "项目编号", "备注"]);
  await page.getByLabel('纸张大小', { exact: true }).selectOption('A3');
  await page.getByLabel('打印方向', { exact: true }).selectOption('landscape');
  await page.getByLabel('项目名称列宽（毫米）').fill('80'); await ready(page);
  const handle = page.getByRole('button', { name: '调整项目名称打印列宽' }); const rect = await handle.boundingBox();
  await page.mouse.move(rect!.x + 3, rect!.y + 5); await page.mouse.down(); await page.mouse.move(rect!.x + 40.8, rect!.y + 5, { steps: 5 }); await page.mouse.up();
  await ready(page); expect(Number(await page.getByLabel('项目名称列宽（毫米）').inputValue())).toBeCloseTo(90, 0);
  expect(await paper(page).evaluate(e => e.getBoundingClientRect().width)).toBeCloseTo(420 * 96 / 25.4, 0);
  await page.getByLabel('项目名称列宽（毫米）').fill('500'); await expect(page.getByRole('alert')).toContainText('超过可用宽度');
  await expect(page.getByRole('button', { name: '本次打印', exact: true })).toBeDisabled();
  await page.getByLabel('列宽适配', { exact: true }).selectOption('fit'); await ready(page);
  await page.getByRole('button', { name: '保存为我的默认配置' }).click(); await expect(page.getByRole('status')).toContainText('已保存');
  const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('kdos-print-v1:'))));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(async () => { const path='/src/shared/table-print.tsx'; const {renderPrint}=await import(/* @vite-ignore */ path); await renderPrint({resource:'projects',rangeType:'FILTERED',columnKeys:['number','name'],viewKey:'ACTUAL'}); });
  await expect(page.getByLabel('纸张大小', { exact: true })).toHaveValue('A3'); await expect(page.getByLabel('打印方向', { exact: true })).toHaveValue('landscape'); await ready(page);
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(page.getByLabel('纸张大小', { exact: true })).toHaveValue('A4');
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('kdos-print-v1:'))))).toEqual(saved);
});

test("real Chrome pagination and native PDF contain every row once, repeated headers, exact paper sizes and no horizontal split", async ({ page, context }, info) => {
  await mount(page, 120); await ready(page);
  await page.getByRole('list', {name:'打印字段'}).getByRole('checkbox', {name:'备注',exact:true}).check(); await ready(page);
  const navigation = page.locator('.kdos-print-page-navigation'); await expect(navigation).toContainText(/第 1 \/ [2-9]/);
  await page.evaluate(() => {
    window.print = () => {
      const css = [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; } }).join('\n');
      (window as unknown as { printCapture: unknown }).printCapture = { html: document.querySelector('.kdos-print-portal')!.outerHTML, css,
        pages: document.querySelectorAll('.kdos-print-pages .kdos-print-paper').length,
        rows: document.querySelectorAll('.kdos-print-pages tbody tr').length,
        widths: [...document.querySelectorAll('.kdos-print-pages col')].map(col => (col as HTMLElement).style.width) };
    };
  });
  await page.getByRole('button',{name:'本次打印',exact:true}).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { printCapture?: unknown }).printCapture))).toBe(true);
  const capture = await page.evaluate(() => (window as unknown as { printCapture: { html: string; css: string; pages: number; rows: number; widths: string[] } }).printCapture);
  expect(capture.rows).toBe(120); expect(capture.pages).toBeGreaterThan(1); expect(capture.widths.every(width => width.endsWith('mm'))).toBe(true);
  const pdfPage = await context.newPage(); await pdfPage.setContent(`<style>${capture.css}</style>${capture.html}`);
  const pdfPath = info.outputPath('a4-portrait.pdf'); await pdfPage.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  const details = execFileSync('pdfinfo', [pdfPath], {encoding:'utf8'}); const size = details.match(/Page size:\s+([\d.]+) x ([\d.]+)/)!; expect(Number(size[1])).toBeCloseTo(210 * 72 / 25.4, 0); expect(Number(size[2])).toBeCloseTo(297 * 72 / 25.4, 0);
  const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {encoding:'utf8'});
  expect(Number(details.match(/Pages:\s+(\d+)/)?.[1])).toBe(capture.pages);
  for(let index=0; index<120; index++) expect(text.match(new RegExp(`SYN-${String(index).padStart(4,'0')}`, 'g'))).toHaveLength(1);
  expect(text.match(/项目编号/g)).toHaveLength(capture.pages);
  expect(text).toContain('打印人：打印验收员'); expect(text).toContain('2026-10-30 08:00:00');
  expect(readFileSync(pdfPath).length).toBeGreaterThan(1000); await pdfPage.close();
});


for (const [size, orientation, width, height] of [["A4", "landscape", 297, 210], ["A3", "portrait", 297, 420], ["A3", "landscape", 420, 297]] as const) {
  test(`native PDF ${size} ${orientation} preserves preview mm widths and all pages`, async ({ page, context }, info) => {
    await mount(page, 60); await page.getByLabel("纸张大小", { exact: true }).selectOption(size);
    await page.getByLabel("打印方向", { exact: true }).selectOption(orientation); await ready(page);
    const before = await paper(page).locator("col").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.width));
    await page.evaluate(() => { window.print = () => {
      const css = [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; } }).join("\n");
      (window as unknown as { capture: unknown }).capture = { html: document.querySelector(".kdos-print-portal")!.outerHTML, css,
        pages: document.querySelectorAll(".kdos-print-pages .kdos-print-paper").length,
        widths: [...document.querySelectorAll(".kdos-print-pages col")].slice(0, 2).map(col => (col as HTMLElement).style.width) };
    }; });
    await page.getByRole("button", { name: "本次打印", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { capture?: unknown }).capture))).toBe(true);
    const capture = await page.evaluate(() => (window as unknown as { capture: {html: string; css: string; pages: number; widths: string[]} }).capture);
    expect(capture.widths).toEqual(before);
    const pdfPage = await context.newPage(); await pdfPage.setContent(`<style>${capture.css}</style>${capture.html}`);
    const pdfPath = info.outputPath(`${size}-${orientation}.pdf`); await pdfPage.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    const details = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" }); const dimensions = details.match(/Page size:\s+([\d.]+) x ([\d.]+)/)!;
    expect(Math.abs(Number(dimensions[1]) - width * 72 / 25.4)).toBeLessThan(1); expect(Math.abs(Number(dimensions[2]) - height * 72 / 25.4)).toBeLessThan(1);
    expect(Number(details.match(/Pages:\s+(\d+)/)?.[1])).toBe(capture.pages);
    const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
    for (let index=0; index<60; index++) expect(text.match(new RegExp(`SYN-${String(index).padStart(4,"0")}`, "g"))).toHaveLength(1);
    await pdfPage.close();
  });
}

test("headed Chrome opens its native print preview with the configured A3 landscape document", async ({ baseURL }) => {
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--enable-print-browser"] });
  try {
    const context = await browser.newContext({ baseURL }); const page = await context.newPage();
    await mount(page, 15);
    await page.getByLabel("纸张大小", { exact: true }).selectOption("A3");
    await page.getByLabel("打印方向", { exact: true }).selectOption("landscape"); await ready(page);
    const cdp = await browser.newBrowserCDPSession();
    await page.getByRole("button", { name: "本次打印", exact: true }).click({ noWaitAfter: true });
    await expect.poll(async () => (await cdp.send("Target.getTargets")).targetInfos.some(target => target.url.startsWith("chrome://print")), { timeout: 20000 }).toBe(true);
  } finally { await browser.close(); }
});
