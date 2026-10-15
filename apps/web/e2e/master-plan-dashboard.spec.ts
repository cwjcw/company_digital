import { expect, test, type Page } from "@playwright/test";
import { standardProcesses } from "@tracker/shared";
import { tablePermissionFieldsFor, type MpsDashboardData } from "@kdos/contracts";
const resource = "mps-overview-dashboard";
const divisionId = "0199d000-0000-7000-8000-000000000010";
function fixture(): MpsDashboardData {
  return { visibleFields: tablePermissionFieldsFor(resource).map(f=>f.key), generatedAt: "2026-10-15T01:00:00Z", trendStart: "2026-10-08", trendEnd: "2026-10-14", orders: { orderCount: 1, unfinishedOrderCount: 1, orderRequiredQuantity: "500", orderCompletedQuantity: "300", orderPendingQuantity: "200", orderCompletionRate: ".6" }, plans: { requiredQuantity: "500", dispatchedWeeklyQuantity: "300", dispatchRate: ".6", cumulativeInboundQuantity: "300", pendingQuantity: "200", inboundRate: ".6", overdueCount: 1, exceptionCount: 1 }, readiness: [{ status: "待完善", count: 1, ratio: "1" }], auxiliary: [{ key: "technical", states: [{ status: "延期", count: 1 }] }], processes: [...standardProcesses].sort((a,b)=>a.order-b.order).map(p=>({...p,values:{requiredQuantity:"500",reportedQuantity:"525",productionProgress:"1.05"},states:[{status:"已完成",count:1}]})), trend: Array.from({length:7},(_,i)=>({productionDate:`2026-10-${String(i+8).padStart(2,"0")}`,[`${standardProcesses[0]!.code}ReportedQuantity`]:'10'})), divisions: [{ divisionId, divisionName: "合成事业部", requiredQuantity: "500", dispatchedWeeklyQuantity: "300", dispatchRate: ".6", cumulativeInboundQuantity: "300", inboundRate: ".6", pendingQuantity: "200", overdueCount: 1, exceptionCount: 1 }], risks: { rows: [{ id: "fixture-risk", resource: "mps-monthly-plans", divisionId, divisionName: "合成事业部", orderNumber: "SYN-ORDER", itemCode: "SYN-ITEM", riskType: "生产异常", exceptionSummary: "人工测试异常" }], total: 1, page: 1, pageSize: 20 } };
}
async function mount(page: Page, permissions=["*"], mode="data") {
  const user = { sub: "synthetic-dashboard-user", username: "synthetic", permissions, isSystemAdmin: permissions.includes("*"), tableDataScopes: [] };
  await page.addInitScript(u=>{localStorage.setItem("accessToken","synthetic-intercepted-token");localStorage.setItem("sessionUser",JSON.stringify(u));},user);
  await page.route("**/api/v1/**",async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith("/auth/me"))return route.fulfill({json:user});
    if(url.pathname.endsWith("/dashboard/candidates"))return route.fulfill({json:{options:url.searchParams.get("field")==="divisionId"?[{value:divisionId,label:"合成事业部"}]:[{value:"SYN-CUSTOMER",label:"合成客户"}],hasMore:false}});
    if(url.pathname.includes("/master-plan-system/resources/")){
      if(url.pathname.endsWith("/meta"))return route.fulfill({json:{fields:[{key:"orderNumber",label:"订单号"},{key:"itemCode",label:"品号"}]}});
      const pageNo=Number(url.searchParams.get("page")||1),size=Number(url.searchParams.get("pageSize")||100);
      return route.fulfill({json:mode==="drillPaging"?{rows:Array.from({length:Math.min(size,125-(pageNo-1)*size)},(_,i)=>({id:`fixture-${(pageNo-1)*size+i+1}`,orderNumber:"SYN-ORDER",itemCode:`SYN-ITEM-${(pageNo-1)*size+i+1}`})),total:125}:{rows:[{id:"fixture",orderNumber:"SYN-ORDER",itemCode:"SYN-ITEM"}],total:1}});
    }
    if(url.pathname.endsWith("/master-plan-system/dashboard")){
      if(mode==="error")return route.fulfill({status:500,json:{message:"合成查询错误"}});
      if(mode==="loading")await new Promise(resolve=>setTimeout(resolve,600));
      const data=fixture();if(mode==="paging"){const pageNo=Number(url.searchParams.get("page")||1),size=Number(url.searchParams.get("pageSize")||100);data.risks={rows:Array.from({length:Math.min(size,125-(pageNo-1)*size)},(_,i)=>({...data.risks.rows[0]!,id:`risk-${(pageNo-1)*size+i+1}`,orderNumber:`SYN-ORDER-${(pageNo-1)*size+i+1}`})),total:125,page:pageNo,pageSize:size};}if(mode==="empty"){data.orders={};data.plans={};data.readiness=[];data.trend=[];data.divisions=[];data.risks={rows:[],total:0,page:1,pageSize:20};data.processes=data.processes.map(p=>({...p,values:{productionProgress:null},states:[]}));}
      return route.fulfill({json:data});
    }
    return route.fulfill({json:[]});
  });
  await page.goto("/master-plan-dashboard");
}
for(const width of [1366,1440,1920])test(`desktop ${width}: real charts resize, single page scroll, no repeated title`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});await mount(page);
  await expect(page.getByText("订单概况",{exact:true})).toBeVisible();
  await expect(page.locator('.mps-dashboard').getByText("主计划综合大屏",{exact:true})).toHaveCount(0);
  await expect(page.locator('.mps-dashboard').getByText(/统计日期|本页面用于|实时掌握/)).toHaveCount(0);
  await expect(page.locator('.mps-dashboard .kdos-chart canvas')).toHaveCount(5);
  await expect(page.getByText("105%",{exact:true})).toHaveCount(standardProcesses.length);
  for(const p of standardProcesses)await expect(page.locator('.mps-dashboard').getByRole("cell",{name:p.name,exact:true})).toBeVisible();
  expect(await page.locator('.mps-dashboard').evaluate(el=>Array.from(el.querySelectorAll('*')).filter(e=>{const s=getComputedStyle(e);return ['auto','scroll'].includes(s.overflowY)&&e.scrollHeight>e.clientHeight+2&&e.clientHeight>30}).map(e=>e.className))).toEqual([]);
  await page.setViewportSize({width:width-80,height:900});await expect.poll(async()=>page.getByRole('img',{name:'标准工序生产进度'}).locator('canvas').evaluate(c=>c.clientWidth)).toBeGreaterThan(500);
  await page.locator('.mps-dashboard').screenshot({path:testInfo.outputPath(`mps-dashboard-${width}.png`)});
});
test('division filter updates one shared payload, clear/search/refresh and formal risk drill',async({page})=>{
  await mount(page);await expect(page.getByText("订单概况",{exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'事业部',exact:true}).click();
  const filtered=page.waitForRequest(r=>r.url().includes('/master-plan-system/dashboard?')&&r.url().includes(`divisionId=${divisionId}`));await page.getByText('合成事业部',{exact:true}).last().click();await filtered;
  await page.getByRole('searchbox',{name:'订单号',exact:true}).fill('SYN-ORDER');const searched=page.waitForRequest(r=>r.url().includes('dashboard?')&&r.url().includes('orderNumber=SYN-ORDER'));await page.getByRole('searchbox',{name:'订单号',exact:true}).press('Enter');await searched;
  await page.getByRole('button',{name:'清空筛选',exact:true}).click();await expect(page.getByRole('searchbox',{name:'订单号',exact:true})).toHaveValue('');await expect(page.getByRole('combobox',{name:'事业部',exact:true})).toHaveValue('');
  const refreshed=page.waitForRequest(r=>r.url().includes('dashboard?')&&!r.url().includes('divisionId=')&&!r.url().includes('orderNumber='));await page.getByRole('button',{name:/刷新数据/}).click();await refreshed;
  const drill=page.waitForRequest(r=>r.url().includes('/resources/mps-monthly-plans?')&&decodeURIComponent(r.url()).includes('SYN-ORDER'));await page.getByRole('button',{name:'SYN-ORDER',exact:true}).click();await drill;await expect(page.getByRole('dialog')).toContainText('SYN-ITEM');
});
test('chart click opens formal permission-checked basic plan drawer',async({page})=>{
  await mount(page);const chart=page.getByRole('img',{name:'计划准备状态分布'});await chart.scrollIntoViewIfNeeded();await expect(chart.locator('canvas')).toBeVisible();
  const request=page.waitForRequest(r=>r.url().includes('/resources/mps-base-plans?'));const box=await chart.boundingBox();await chart.click({position:{x:box!.width/2,y:110}});await request;await expect(page.getByRole('dialog')).toBeVisible();
});
test('empty and errors visible; loading does not fabricate data',async({page})=>{
  await mount(page,['*'],'empty');await expect(page.getByText('订单概况',{exact:true})).toBeVisible();await expect(page.getByRole('img',{name:'标准工序生产进度'})).toContainText('暂无数据');
  await page.unrouteAll();await mount(page,['*'],'error');await expect(page.getByText('合成查询错误',{exact:true})).toBeVisible();
});
test('initial loading indicator is visible until response arrives',async({page})=>{await mount(page,['*'],'loading');await expect(page.getByLabel('加载中',{exact:true})).toBeVisible();await expect(page.getByText('订单概况',{exact:true})).toBeVisible();});
test('no own read: route redirects and navigation leaf is absent, no dashboard request',async({page})=>{
  let count=0;page.on('request',r=>{if(r.url().includes('/master-plan-system/dashboard'))count++;});await mount(page,['mps-monthly-plans:*:read']);await expect(page).toHaveURL(/\/$/);expect(count).toBe(0);await expect(page.getByRole('menuitem',{name:'主计划综合大屏',exact:true})).toHaveCount(0);
});

test('risk and formal drill use canonical server paging and retain page2 after response',async({page})=>{
  await mount(page,['*'],'paging');const risk=page.locator('#mps-risks');await expect(risk.getByRole('button',{name:'SYN-ORDER-1',exact:true})).toBeVisible();
  const next=page.waitForRequest(r=>{const u=new URL(r.url());return u.pathname.endsWith('/master-plan-system/dashboard')&&u.searchParams.get('page')==='2'&&u.searchParams.get('pageSize')==='100';});await risk.locator('.ant-pagination-item-2').click();await next;
  await expect(risk.getByRole('button',{name:'SYN-ORDER-101',exact:true})).toBeVisible();await expect(risk.locator('.ant-pagination-item-active')).toHaveText('2');await page.waitForTimeout(500);await expect(risk.locator('.ant-pagination-item-active')).toHaveText('2');
  await page.unrouteAll();await mount(page,['*'],'drillPaging');await page.getByRole('button',{name:'SYN-ORDER',exact:true}).click();const drawer=page.getByRole('dialog');await expect(drawer.getByText('SYN-ITEM-1',{exact:true})).toBeVisible();
  const drillNext=page.waitForRequest(r=>r.url().includes('/resources/mps-monthly-plans?')&&new URL(r.url()).searchParams.get('page')==='2');await drawer.locator('.ant-pagination-item-2').click();await drillNext;await expect(drawer.getByText('SYN-ITEM-101',{exact:true})).toBeVisible();await expect(drawer.locator('.ant-pagination-item-active')).toHaveText('2');
});
