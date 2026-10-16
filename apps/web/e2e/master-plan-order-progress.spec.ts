import { expect, test, type Page } from "@playwright/test";
import contracts from "@kdos/contracts";
const {tablePermissionFieldsFor}=contracts,resource="mps-order-progress-dashboard",root="/master-plan-system/order-progress",division="0199bb00-0000-7000-8000-000000000001",orderId="0199bb00-0000-7000-8000-000000000010",itemId="0199bb00-0000-7000-8000-000000000020";
const fields=tablePermissionFieldsFor(resource).map(f=>f.key);
async function mount(page:Page,mode="data",permissions=["*"]){
  const user={sub:"synthetic-order-progress",username:"synthetic",permissions,isSystemAdmin:permissions.includes("*"),tableDataScopes:[]};
  await page.addInitScript(u=>{localStorage.setItem('accessToken','synthetic-intercepted-token');localStorage.setItem('sessionUser',JSON.stringify(u))},user);
  await page.route('**/api/v1/**',async route=>{
    const u=new URL(route.request().url()),p=u.pathname,pageNo=Number(u.searchParams.get('page')||1),size=Number(u.searchParams.get('pageSize')||100);
    if(p.endsWith('/auth/me'))return route.fulfill({json:user});
    if(p.endsWith(root+'/meta'))return route.fulfill({json:{visibleFields:fields,canExport:mode!=="no-export"}});
    if(p.endsWith(root+'/candidates')){const field=u.searchParams.get('field');return route.fulfill({json:{options:field==='divisionId'?[{value:division,label:'合成事业部'}]:field==='orderNumber'?[{value:'SYN-ORDER',label:'SYN-ORDER'},{value:'SYN-SECOND',label:'SYN-SECOND'}]:field==='itemCode'?[{value:'SYN-ITEM',label:'SYN-ITEM · 合成品名'}]:[{value:'SYN-CUSTOMER',label:'合成客户'}],hasMore:false}})}
    if(p.endsWith(root+'/orders')){if(mode==='error')return route.fulfill({status:500,json:{message:'合成查询失败'}});if(mode==='loading')await new Promise(r=>setTimeout(r,700));const total=mode==='empty'?0:mode==='paging'?125:1;return route.fulfill({json:{rows:Array.from({length:Math.max(0,Math.min(size,total-(pageNo-1)*size))},(_,i)=>({id:i===0&&pageNo===1?orderId:`synthetic-order-${i+pageNo*size}`,divisionId:division,divisionName:'合成事业部',customerCode:'SYN-CUSTOMER',orderNumber:i===0&&pageNo===1?'SYN-ORDER':`SYN-ORDER-${i+pageNo*size}`,orderDate:'2026-10-15',deliveryDate:'2026-10-20',orderRequiredQuantity:'500',orderCompletedQuantity:'125',orderPendingQuantity:'375',orderCompletionRate:'.25',unfinishedItemCount:3,coverageStatus:'已建立月计划'})),total,page:pageNo,pageSize:size,visibleFields:fields}})}
    if(p.endsWith(root+'/items')){const total=mode==='paging'?135:3;return route.fulfill({json:{rows:Array.from({length:Math.max(0,Math.min(size,total-(pageNo-1)*size))},(_,i)=>({id:i===0?itemId:`synthetic-item-${pageNo*size+i}`,orderId,divisionId:division,divisionName:'合成事业部',orderNumber:'SYN-ORDER',itemCode:i===0?'SYN-ITEM':`SYN-ITEM-${pageNo*size+i}`,itemName:'合成品名',sourceKind:i===0?'月计划':'订单分配',planStatus:i===0?'已建立月计划':'尚未建立月计划',requiredQuantity:i===0?'500':null,dispatchedWeeklyQuantity:i===0?'300':null,cumulativeInboundQuantity:i===0?'125':null,pendingQuantity:i===0?'375':null,itemCompletionRate:i===0?'.25':null,technicalStatus:i===0?'延期':null,hardwareStatus:i===0?'已完成':null,woodStatus:null,outsourcingStatus:null,cuttingRequiredQuantity:i===0?'500':null,cuttingReportedQuantity:i===0?'255':null,cuttingProductionProgress:i===0?'.51':null,cuttingStatus:i===0?'已完成':null,packagingRequiredQuantity:i===0?'500':null,packagingReportedQuantity:i===0?'525':null,packagingProductionProgress:i===0?'1.05':null,packagingStatus:i===0?'延期':null})),total,page:pageNo,pageSize:size,visibleFields:fields}})}
    if(p.includes(root+'/detail/'))return route.fulfill({json:{rows:[{id:'synthetic-weekly-1',deliveryNumber:'001',plannedQuantity:'200'},{id:'synthetic-weekly-2',deliveryNumber:'002',plannedQuantity:'100'}],total:2,page:1,pageSize:100,visibleFields:['deliveryNumber','plannedQuantity']}});
    if(p.includes(root+'/export/'))return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'content-disposition':`attachment; filename="mps_${p.endsWith('/orders')?'order':'item'}_progress_20261016.xlsx"`},body:Buffer.from('synthetic-download')});
    return route.fulfill({json:[]});
  });await page.goto('/master-plan-order-progress');
}
const expand=async(page:Page)=>{await page.getByText('SYN-ORDER',{exact:true}).first().waitFor();await page.locator('.mps-order-progress button.ant-table-row-expand-icon').first().click();await expect(page.getByRole('button',{name:'SYN-ITEM',exact:true})).toBeVisible()};
for(const width of [1366,1920])test(`desktop ${width}: lazy matrix, fixed identities, horizontal scroll, compact rows and single vertical scroll`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:900});let items=0;page.on('request',r=>{if(r.url().includes(root+'/items'))items++});await mount(page);await expect(page.getByText('订单进度',{exact:true})).toBeVisible();expect(items).toBe(0);await expand(page);expect(items).toBe(1);
  await expect(page.locator('.mps-order-progress').getByText('在制订单进度',{exact:true})).toHaveCount(0);
  const child=page.locator('.mps-order-items .ant-table-body');await child.evaluate(e=>{e.scrollLeft=e.scrollWidth});await expect(page.getByText('105%',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'SYN-ITEM',exact:true})).toBeVisible();
  const nested=await page.locator('.mps-order-progress').evaluate(root=>Array.from(root.querySelectorAll('*')).filter(e=>{const s=getComputedStyle(e);return ['auto','scroll'].includes(s.overflowY)&&e.scrollHeight>e.clientHeight+3}).map(e=>e.className));expect(nested).toEqual([]);
  const height=await page.locator('.mps-order-items tbody tr.ant-table-row').first().evaluate(e=>e.getBoundingClientRect().height);expect(height).toBeLessThanOrEqual(38);expect(errors).toEqual([]);await page.screenshot({path:info.outputPath(`order-matrix-${width}.png`),fullPage:true});
});
test('source quantities, state independence, no fabricated preparation percentages; exact detail includes both delivery batches',async({page})=>{
  await mount(page);await expand(page);await page.getByRole('button',{name:'SYN-ITEM',exact:true}).click();await expect(page.getByRole('dialog').getByText('001',{exact:true})).toBeVisible();await expect(page.getByRole('dialog').getByText('002',{exact:true})).toBeVisible();await page.locator('.ant-drawer-close').click();
  await expect(page.locator('.mps-order-items').getByText('尚未建立月计划',{exact:true})).toHaveCount(2);await expect(page.locator('.mps-order-items').getByText('不适用',{exact:true})).toHaveCount(0);
});
test('top remote multiselect cascades into order/item queries and both independent exports',async({page})=>{
  const requests:string[]=[];page.on('request',r=>{if(r.url().includes(root))requests.push(r.url())});await mount(page);
  const orders=page.getByRole('combobox',{name:'订单号',exact:true});await orders.focus();await orders.press('ArrowDown');await page.getByText('SYN-ORDER',{exact:true}).last().click();
  await expect.poll(()=>requests.some(x=>{const u=new URL(x);return u.pathname.endsWith('/orders')&&u.searchParams.get('orderNumbers')==='["SYN-ORDER"]'})).toBe(true);
  await expand(page);const lastItem=new URL(requests.filter(x=>new URL(x).pathname.endsWith('/items')).at(-1)!);expect(lastItem.searchParams.get('orderNumbers')).toBe('["SYN-ORDER"]');
  for(const label of ['导出订单进度汇总','导出品号生产进度明细']){const download=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).first().click();expect((await download).suggestedFilename()).toMatch(/^mps_(order|item)_progress_\d{8}\.xlsx$/)}
  const exports=requests.filter(x=>x.includes('/export/')).map(x=>new URL(x));expect(exports).toHaveLength(2);for(const u of exports){expect(u.searchParams.get('orderNumbers')).toBe('["SYN-ORDER"]');expect(u.searchParams.get('onlyUnfinishedOrders')).toBe('true');expect(u.searchParams.has('orderId')).toBe(false)}
});
test('order and item paging remain independent; collapse keeps applied scope',async({page})=>{
  const requests:string[]=[];page.on('request',r=>{if(r.url().includes(root))requests.push(r.url())});await mount(page,'paging');await expand(page);
  await page.locator('.mps-order-items .ant-pagination-item-2').click();await expect.poll(()=>requests.some(x=>{const u=new URL(x);return u.pathname.endsWith('/items')&&u.searchParams.get('page')==='2'})).toBe(true);
  expect(new URL(requests.filter(x=>new URL(x).pathname.endsWith('/orders')).at(-1)!).searchParams.get('page')).toBe('1');await page.locator('.mps-order-progress button.ant-table-row-expand-icon').first().click();
  const parentPagination=page.locator('.mps-order-progress > .ant-card > .ant-card-body > .kdos-data-table-shell .ant-pagination').last();await parentPagination.locator('.ant-pagination-item-2').click();await expect.poll(()=>requests.some(x=>{const u=new URL(x);return u.pathname.endsWith('/orders')&&u.searchParams.get('page')==='2'})).toBe(true);
});
test('resized identity column persists after refresh under tenant/user/resource/view scope',async({page})=>{
  await mount(page);const handle=page.getByTestId('kdos-column-resizer-orderNumber').first();const box=await handle.boundingBox();expect(box).not.toBeNull();await page.mouse.move(box!.x+2,box!.y+box!.height/2);await page.mouse.down();await page.mouse.move(box!.x+82,box!.y+box!.height/2);await page.mouse.up();
  const before=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('width')&&k.includes('mps-order-progress'))));expect(Object.keys(before).length).toBeGreaterThan(0);await page.getByRole('button',{name:'刷新',exact:true}).click();expect(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('width')&&k.includes('mps-order-progress'))))).toEqual(before);
});
test('no export hides every matrix export; old overview read cannot enter new route',async({page})=>{
  await mount(page,'no-export',[`${resource}:*:read`]);await expect(page.getByText('订单进度',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/导出订单|导出品号/})).toHaveCount(0);
});
test('no independent read redirects without loading dashboard data',async({page})=>{let calls=0;page.on('request',r=>{if(r.url().includes(root))calls++});await mount(page,'data',['mps-overview-dashboard:*:read']);await expect(page).toHaveURL(/\/$/);expect(calls).toBe(0)});
test('empty, error and loading states remain explicit',async({page})=>{
  await mount(page,'error');await expect(page.getByText('合成查询失败')).toBeVisible();await page.unroute('**/api/v1/**');await mount(page,'empty');await expect(page.getByText('暂无匹配订单')).toBeVisible();
  await page.unroute('**/api/v1/**');await mount(page,'loading');await expect(page.locator('.mps-order-progress .ant-spin-spinning').first()).toBeVisible();await expect(page.getByText('SYN-ORDER',{exact:true}).first()).toBeVisible();
});
