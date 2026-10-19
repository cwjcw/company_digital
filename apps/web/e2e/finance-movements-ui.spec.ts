import {test,expect} from '@playwright/test';
import * as ns from '@kdos/contracts';
const {financeMovementResources}=(ns as any).default??ns;
test.use({trace:'off',screenshot:'off',video:'off'});
async function setup(page:any,read=true){
 const user={sub:'0199e000-0000-7000-8000-000000000001',username:'synthetic',permissions:read?['*']:[],mustChangePassword:false};const requests:any[]=[];
 await page.route('**/api/v1/**',async(route:any)=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');requests.push({path:p,params:u.searchParams,body:req.postData()});let value:any=[];
  if(p.startsWith('/table-exports/')&&p!=='/table-exports/capabilities'){await route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('synthetic-download')});return;}
  if(p==='/auth/me')value=user;
  else if(p==='/table-filters/resources')value=financeMovementResources.map((code:string)=>({code,status:'REGISTERED_AND_FILTERABLE'}));
  else if(p==='/table-exports/capabilities')value=financeMovementResources.map((code:string)=>({code,supported:true,allowed:read}));
  else if(p==='/finance/e10-movements/runs')value={rows:[],canRefresh:read};
  else if(p==='/table-filters/candidates')value=[{value:'SYN-CUSTOMER',label:'SYN-CUSTOMER'}];
  else if(p==='/table-filters/rows'){
   const r=u.searchParams.get('resource');value={rows:[{id:'0199e000-0000-7000-8000-000000000002',yearMonth:'2025-02',customerCode:'SYN-CUSTOMER',departmentCategory:'业务一部',orderNo:'SYN-ORDER',effectiveAt:'2025-02-01T02:00:00Z',amountBefore:'100',amountAfter:'80',changeAmount:'-20',rawChange:'-20',orderTotal:'80',baseAmount:'100',increaseAmount:'0',decreaseAmount:'-20',included:r==='finance-e10-changes',timeBasis:'APPROVAL',changeKind:'REVISION'}],total:150,page:1,pageSize:100};
  }
  await route.fulfill({json:value});
 });
 await page.addInitScript((u:any)=>{localStorage.setItem('accessToken','synthetic');localStorage.setItem('sessionUser',JSON.stringify(u));},user);return requests;
}
test('monthly, department and customer analysis use independent server queries',async({page})=>{
 const requests=await setup(page);await page.goto('/finance/orders/movements');await expect(page.getByRole('tab',{name:'月度发生额'})).toBeVisible();await expect(page.getByText('接单发生额',{exact:true}).first()).toBeVisible();
 for(const [tab,r] of [['事业部分析','finance-e10-movement-departments'],['客户分析','finance-e10-movement-customers']]){await page.getByRole('tab',{name:tab}).click();await expect.poll(()=>requests.some(x=>x.path==='/table-filters/rows'&&x.params.get('resource')===r)).toBe(true);}
 expect(await page.getByText(/历史完整性|完整性评分|历史缺口/).count()).toBe(0);
 await expect(page.getByText('SYN-CUSTOMER',{exact:true}).first()).toBeVisible();
});
test('ledger keeps source and effective amounts separate and exports through the standard service',async({page})=>{
 const requests=await setup(page);await page.goto('/finance/orders/changes');await expect(page.getByText('SYN-ORDER',{exact:true})).toBeVisible();for(const label of ['变更前有效金额','变更后有效金额','有效金额差额','源金额差额','计入发生额'])await expect(page.getByText(label,{exact:true}).first()).toBeAttached();
 await expect(page.getByText('2025-02-01 10:00:00',{exact:true})).toBeVisible();const button=page.getByRole('button',{name:/导出/});await expect(button).toBeVisible();const download=page.waitForEvent('download');await button.click();expect((await download).suggestedFilename()).toBe('finance-e10-changes.xlsx');expect(requests.some(x=>x.path==='/table-exports/finance-e10-changes'&&x.params.has('context'))).toBe(true);expect(requests.some(x=>x.params.get('pageSize')==='100')).toBeTruthy();
});
test('no access means no finance data request',async({page})=>{const requests=await setup(page,false);await page.goto('/finance/orders/movements');await expect(page.getByText('当前权限组不能查看订单金额变更统计')).toBeVisible();expect(requests.some(x=>x.path==='/table-filters/rows')).toBe(false);});
