import {test,expect} from '@playwright/test';
import * as contractNamespace from '@kdos/contracts';
const {financeOrderFields,financeMonthlyFields,financeOrderResources,tablePermissionFieldsFor}=(contractNamespace as any).default??contractNamespace;
test.use({trace:'off',screenshot:'off',video:'off'});
async function setup(page:any,role='admin'){
 const permissions=role==='admin'?['*']:role==='viewer'?financeOrderResources.flatMap(r=>[`${r}:*:read`,...tablePermissionFieldsFor(r).map(f=>`${r}:${f.key}:read`)]):[];
 const user={sub:'0199e000-0000-7000-8000-000000000001',username:'synthetic',permissions,mustChangePassword:false};
 const requests:any[]=[];
 await page.route('**/api/v1/**',async(route:any)=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/api/v1','');requests.push({path:p,search:url.search,body:req.postData()});let value:any=[];
  if(p==='/auth/me')value=user;
  else if(p==='/table-filters/resources')value=financeOrderResources.map(code=>({code,status:'REGISTERED_AND_FILTERABLE'}));
  else if(p==='/table-exports/capabilities')value=financeOrderResources.map(code=>({code,allowed:false}));
  else if(p==='/finance/e10-orders/revision')value={revision:'synthetic-v1'};
  else if(p==='/finance/e10-movements/runs')value={rows:[],canRefresh:false};
  else if(p==='/finance/e10-orders/runs')value={rows:[],canInspectExceptions:role==='admin'};
  else if(p==='/table-filters/rows'){const monthly=url.searchParams.get('resource')==='finance-e10-monthly';value={rows:[{id:'0199e000-0000-7000-8000-000000000002',...Object.fromEntries((monthly?financeMonthlyFields:financeOrderFields).map(f=>[f.key,f.type==='number'?'1.00':f.type==='date'?'2025-01-01':f.type==='boolean'?true:f.key==='customerCode'?'SYN-001-A':'合成测试']))}],total:1,page:1,pageSize:100};}
  else if(p==='/finance/e10-orders/dashboard')value={totals:{amount:'100.30',orders:2,average:'50.15',pendingAmount:'0',pendingCustomers:0,pendingOrders:0},channels:[{category:'内销',amount:'100.30',share:'1.00000000'},{category:'外销',amount:'0.00',share:'0'},{category:'待分类',amount:'0.00',share:'0'}],departments:['业务一部','业务二部','业务三部','业务四部','待分类'].map((category,i)=>({category,amount:i?'0.00':'100.30',share:i?'0':'1'})),months:Array.from({length:12},(_,i)=>({month:'2025-'+String(i+1).padStart(2,'0'),amount:i?'0.00':'100.30',wan:i?'0.000000':'0.010030'})),matrix:[{departmentCategory:'业务一部',salesChannel:'内销',amount:'100.30'}],quality:{excludedOrders:0}};
  else if(p==='/finance/e10-orders/ranking')value={rows:[{id:'0199e000-0000-7000-8000-000000000003',customerCode:'SYN-RANK-A',orderTotal:'100.30'}],total:1};
  await route.fulfill({json:value});
 });
 await page.addInitScript((u:any)=>{localStorage.setItem('accessToken','synthetic');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
 return requests;
}
test('three finance pages retain Chinese headers and no spreadsheet upload',async({page})=>{
 const requests=await setup(page);await page.goto('/finance/orders/system-export');await expect(page.getByText('销售订单统计',{exact:true})).toBeVisible();await expect(page.getByText('SYN-001-A',{exact:true})).toBeVisible();for(const f of financeOrderFields)await expect(page.getByText(f.label,{exact:true}).first()).toBeAttached();await expect(page.locator('input[type=file]')).toHaveCount(0);await expect(page.getByRole('button',{name:'刷新E10数据'})).toBeVisible();
 await page.goto('/finance/orders/monthly');await expect(page.getByText('本月发生额',{exact:true}).first()).toBeVisible();for(const f of financeMonthlyFields)await expect(page.getByText(f.label,{exact:true}).first()).toBeAttached();expect(requests.some(r=>r.search.includes('finance-e10-monthly'))).toBeTruthy();
 await page.goto('/finance/orders/dashboard');for(const text of ['期间占比','期间合计','期间累计接单发生额','接单发生额/元','接单发生额/万元'])await expect(page.getByText(text,{exact:true}).first()).toBeAttached();await expect(page.locator('canvas')).toHaveCount(3);
});
test('dashboard drilldown carries customer and selected period',async({page})=>{const requests=await setup(page);await page.goto('/finance/orders/dashboard');await page.getByText('SYN-RANK-A',{exact:true}).click();await expect(page).toHaveURL(/\/finance\/orders\/monthly\?.*customerCode=SYN-RANK-A/);await expect.poll(()=>requests.some(r=>r.path==='/table-filters/rows'&&decodeURIComponent(r.search).includes('SYN-RANK-A'))).toBe(true);});
test('viewer can read all three views but cannot refresh',async({page})=>{await setup(page,'viewer');await page.goto('/finance/orders/system-export');await expect(page.getByText('SYN-001-A',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'刷新E10数据'})).toHaveCount(0);});
test('unauthorized users see no finance portal or order queries',async({page})=>{const requests=await setup(page,'none');await page.goto('/');await expect(page.getByText('财务中心',{exact:true})).toHaveCount(0);await page.goto('/finance/orders/monthly');await expect(page.getByText('当前权限组不能查看销售订单数据')).toBeVisible();expect(requests.some(r=>r.path==='/table-filters/rows')).toBe(false);});
test('report layout remains readable on desktop and mobile',async({page})=>{await setup(page);for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.goto('/finance/orders/dashboard');await expect(page.getByText('平均订单发生额',{exact:true})).toBeVisible();await expect(page.locator('canvas')).toHaveCount(3);const layout=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth,overflows:Array.from(document.querySelectorAll('div')).filter(e=>e.getBoundingClientRect().right>window.innerWidth+2).slice(0,12).map(e=>({className:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))}));expect(layout.scroll,JSON.stringify(layout)).toBeLessThanOrEqual(width+2);}});
test('dashboard sends one preference-aware ranking request and refreshes once for a new source revision',async({page})=>{
 const requests=await setup(page);await page.goto('/finance/orders/dashboard');await expect(page.getByText('SYN-RANK-A',{exact:true})).toBeVisible();await page.waitForTimeout(600);
 const count=(path:string)=>requests.filter(r=>r.path.endsWith(path)).length;
 expect(count('/ranking')).toBe(1);expect(count('/dashboard')).toBe(1);expect(JSON.parse(requests.find(r=>r.path.endsWith('/ranking')).body)).toMatchObject({pageSize:100,filterGroup:{logic:'AND'}});
 await page.route('**/api/v1/finance/e10-orders/revision',async route=>{await route.fulfill({json:{revision:'synthetic-v2'}});});
 await page.getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>count('/dashboard')).toBe(2);await expect.poll(()=>count('/ranking')).toBe(2);await page.waitForTimeout(500);expect(count('/dashboard')).toBe(2);expect(count('/ranking')).toBe(2);expect(requests.some(r=>r.path.endsWith('/refresh'))).toBe(false);
});

test('occurrence calendar and exact order drill carry month filters and complete history',async({page})=>{const requests=await setup(page);await page.goto('/finance/orders/monthly?monthFrom=2025-12&monthTo=2026-02');const link=page.locator('.ant-table-tbody a[href^="/finance/orders/changes?monthlyRecordId="]').first();await expect(link).toBeVisible();const rowRequest=requests.find(r=>r.path==='/table-filters/rows'&&r.search.includes('finance-e10-monthly'));const period=JSON.parse(new URLSearchParams(rowRequest.search).get('context')!);expect(period).toEqual({monthFrom:'2025-12',monthTo:'2026-02'});const group=JSON.parse(new URLSearchParams(rowRequest.search).get('filterGroup')!);expect(JSON.stringify(group)).not.toContain('orderDate');await page.getByPlaceholder('开始发生月').click();await expect(page.locator('.ant-picker-dropdown:visible .ant-picker-month-panel').first()).toBeVisible();await page.keyboard.press('Escape');await link.click();await expect(page).toHaveURL(/monthlyRecordId=/);await expect(page.getByRole('button',{name:'解除订单限定'})).toBeVisible();await expect.poll(()=>requests.some(r=>{if(r.path!=='/table-filters/rows'||!r.search.includes('finance-e10-changes'))return false;const c=JSON.parse(new URLSearchParams(r.search).get('context')!);return Boolean(c.monthlyRecordId)&&!c.dateFrom&&!c.dateTo;})).toBe(true);});
