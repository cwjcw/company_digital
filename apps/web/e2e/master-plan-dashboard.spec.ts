import { expect, test, type Page } from "@playwright/test";
import { standardProcesses } from "@tracker/shared";
import { tablePermissionFieldsFor, type MpsDashboardData } from "@kdos/contracts";
const resource = "mps-overview-dashboard";
const divisionId = "0199d000-0000-7000-8000-000000000010";
function fixture(): MpsDashboardData {
  return { visibleFields: tablePermissionFieldsFor(resource).map(f=>f.key), generatedAt: "2026-10-15T01:00:00Z", trendStart: "2026-10-08", trendEnd: "2026-10-14", orders: { orderCount: 1, unfinishedOrderCount: 1, orderRequiredQuantity: "500", orderCompletedQuantity: "300", orderPendingQuantity: "200", orderCompletionRate: ".6" }, plans: { requiredQuantity: "500", dispatchedWeeklyQuantity: "300", dispatchRate: ".6", cumulativeInboundQuantity: "300", pendingQuantity: "200", inboundRate: ".6", overdueCount: 1, exceptionCount: 1 }, readiness: [{ status: "待完善", count: 1, ratio: "1" }], auxiliary: [{ key: "technical", states: [{ status: "延期", count: 1 }] }], processes: [...standardProcesses].sort((a,b)=>a.order-b.order).map(p=>({...p,values:{requiredQuantity:"500",reportedQuantity:"525",productionProgress:"1.05"},states:[{status:"已完成",count:1}]})), trend: Array.from({length:7},(_,i)=>({productionDate:`2026-10-${String(i+8).padStart(2,"0")}`,...Object.fromEntries(standardProcesses.map(p=>[`${p.code}ReportedQuantity`,String(p.order+10)]))})), divisions: [{ divisionId, divisionName: "合成事业部", requiredQuantity: "500", dispatchedWeeklyQuantity: "300", dispatchRate: ".6", cumulativeInboundQuantity: "300", inboundRate: ".6", pendingQuantity: "200", overdueCount: 1, exceptionCount: 1 }], risks: { rows: [{ id: "fixture-risk", resource: "mps-monthly-plans", divisionId, divisionName: "合成事业部", orderNumber: "SYN-ORDER", itemCode: "SYN-ITEM", riskType: "生产异常", exceptionSummary: "人工测试异常" }], total: 1, page: 1, pageSize: 20 } };
}
async function mount(page: Page, permissions=["*"], mode="data") {
  const user = { sub: "synthetic-dashboard-user", username: "synthetic", permissions, isSystemAdmin: permissions.includes("*"), tableDataScopes: [] };
  await page.addInitScript(u=>{localStorage.setItem("accessToken","synthetic-intercepted-token");localStorage.setItem("sessionUser",JSON.stringify(u));},user);
  await page.route("**/api/v1/**",async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith("/auth/me"))return route.fulfill({json:user});
    if(url.pathname.endsWith("/dashboard/candidates"))return route.fulfill({json:{options:url.searchParams.get("field")==="divisionId"?[{value:divisionId,label:"合成事业部"}]:url.searchParams.get("field")==="orderNumber"?[{value:"SYN-ORDER",label:"SYN-ORDER"},{value:"SYN-SECOND",label:"SYN-SECOND"}]:url.searchParams.get("field")==="itemCode"?[{value:"SYN-ITEM",label:"SYN-ITEM · 合成品名"}]:[{value:"SYN-CUSTOMER",label:"合成客户"}],hasMore:false}});
    if(url.pathname.endsWith("/dashboard/export"))return route.fulfill({contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",headers:{"content-disposition":`attachment; filename="mps_${url.searchParams.get("tableKey")!.replaceAll("-","_")}_20261015.xlsx"`},body:Buffer.from("synthetic-download")});
    if(url.pathname.endsWith("/dashboard/table"))return route.fulfill({json:{rows:[],total:0,page:1,pageSize:100,visibleFields:fixture().visibleFields}});
    if(url.pathname.includes("/master-plan-system/resources/")||url.pathname.endsWith("/dashboard/drill")){
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
  await page.getByRole('combobox',{name:'订单号',exact:true}).click();const searched=page.waitForRequest(r=>r.url().includes('dashboard?')&&decodeURIComponent(r.url()).includes('orderNumbers=["SYN-ORDER"]'));await page.locator('.ant-select-item-option-content').getByText('SYN-ORDER',{exact:true}).click();await searched;await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'清空筛选',exact:true}).click();await expect(page.getByRole('combobox',{name:'订单号',exact:true})).toHaveValue('');await expect(page.getByRole('combobox',{name:'事业部',exact:true})).toHaveValue('');
  const refreshed=page.waitForRequest(r=>r.url().includes('dashboard?')&&!r.url().includes('divisionId=')&&!r.url().includes('orderNumbers='));await page.getByRole('button',{name:/刷新数据/}).click();await refreshed;
  const drill=page.waitForRequest(r=>r.url().includes('/dashboard/drill?')&&r.url().includes('resourceCode=mps-monthly-plans')&&decodeURIComponent(r.url()).includes('SYN-ORDER'));await page.getByRole('button',{name:'SYN-ORDER',exact:true}).click();await drill;await expect(page.getByRole('dialog')).toContainText('SYN-ITEM');
});
test('chart click opens formal permission-checked basic plan drawer',async({page})=>{
  await mount(page);const chart=page.getByRole('img',{name:'计划准备状态分布'});await chart.scrollIntoViewIfNeeded();await expect(chart.locator('canvas')).toBeVisible();
  const request=page.waitForRequest(r=>r.url().includes('/dashboard/drill?')&&r.url().includes('resourceCode=mps-base-plans'));const box=await chart.boundingBox();await chart.click({position:{x:box!.width/2,y:110}});await request;await expect(page.getByRole('dialog')).toBeVisible();
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
  const drillNext=page.waitForRequest(r=>r.url().includes('/dashboard/drill?')&&r.url().includes('resourceCode=mps-monthly-plans')&&new URL(r.url()).searchParams.get('page')==='2');await drawer.locator('.ant-pagination-item-2').click();await drillNext;await expect(drawer.getByText('SYN-ITEM-101',{exact:true})).toBeVisible();await expect(drawer.locator('.ant-pagination-item-active')).toHaveText('2');
});

test('REV1 multiselect/date candidates cascade and four independent English Excel downloads retain scope',async({page})=>{
  const requests:URL[]=[];page.on('request',r=>{if(r.url().includes('/master-plan-system/dashboard'))requests.push(new URL(r.url()));});await mount(page);
  const choose=async(name:string,label:string)=>{const control=page.getByRole('combobox',{name,exact:true});await control.focus();if(await control.getAttribute('aria-expanded')!=='true')await control.press('ArrowDown');await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(label,{exact:true}).click();await control.press('Escape');await expect(control).toHaveAttribute('aria-expanded','false');};
  await expect(page.getByRole('combobox',{name:'日期周期',exact:true})).toHaveCount(0);
  await choose('事业部','合成事业部');await choose('客户','合成客户');await choose('订单号','SYN-ORDER');await choose('订单号','SYN-SECOND');await choose('品号','SYN-ITEM · 合成品名');
  await choose('日期类型','交付日期');await choose('日期周期','按月');const date=page.getByRole('textbox',{name:'日期值',exact:true});await date.fill('2026-10');await date.press('Enter');await page.keyboard.press('Escape');
  await expect.poll(()=>requests.some(u=>u.pathname.endsWith('/dashboard/candidates')&&u.searchParams.get('field')==='itemCode'&&u.searchParams.get('dateType')==='DELIVERY'&&u.searchParams.get('dateValue')==='2026-10'&&u.searchParams.get('orderNumbers')==='["SYN-ORDER","SYN-SECOND"]')).toBe(true);
  await expect(page.getByText('最近7天生产报工趋势（2026-10-08 ～ 2026-10-14）',{exact:true})).toBeVisible();
  for(const [title,key] of [['事业部计划与执行汇总','division-summary'],['计划待完善明细','plan-readiness'],['工序执行明细','process-execution'],['风险与异常','risk-exception']]){
    const card=page.locator('.ant-card').filter({has:page.locator('.ant-card-head-title').getByText(title!,{exact:true})});const downloadPromise=page.waitForEvent('download');await card.getByRole('button',{name:'导出',exact:true}).click();const download=await downloadPromise;
    expect(download.suggestedFilename()).toMatch(new RegExp('^mps_'+key!.replaceAll('-','_')+'_\\d{8}\\.xlsx$'));
    const url=requests.findLast(u=>u.pathname.endsWith('/dashboard/export')&&u.searchParams.get('tableKey')===key)!;expect(url.searchParams.get('divisionId')).toBe(divisionId);expect(url.searchParams.get('customerCode')).toBe('SYN-CUSTOMER');expect(JSON.parse(url.searchParams.get('orderNumbers')!)).toEqual(['SYN-ORDER','SYN-SECOND']);expect(JSON.parse(url.searchParams.get('itemCodes')!)).toEqual(['SYN-ITEM']);expect(url.searchParams.get('dateType')).toBe('DELIVERY');expect(url.searchParams.get('dateValue')).toBe('2026-10');
  }
  await page.getByRole('button',{name:'清空筛选',exact:true}).click();await expect(page.getByRole('combobox',{name:'日期周期',exact:true})).toHaveCount(0);
});
test('REV1 dashboard read without export hides every table export',async({page})=>{await mount(page,['mps-overview-dashboard:*:read']);await expect(page.getByText('订单概况',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'导出',exact:true})).toHaveCount(0);});
