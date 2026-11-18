import { expect, test } from '@playwright/test';
// Real SPA/shared tables, synthetic HTTP fixtures; every API write is intercepted.
test.use({trace:'off',screenshot:'off',video:'off',actionTimeout:10000});
const admin='019a0000-0000-7000-8000-000000000001',department='019a0000-0000-7000-8000-000000000002',category='019a0000-0000-7000-8000-000000000003',attachment='019a0000-0000-7000-8000-000000000004';
const options={users:[{id:admin,name:'合成管理员',username:'fixture-admin',enabled:true,position:'课长'}],departments:[{id:department,name:'合成事业部',pathLabel:'合成事业部'}],categories:[{id:category,category_name:'合成品质'}],severities:[{id:'019a0000-0000-7000-8000-000000000005',severity_name:'一般',amount_min:'0.00',amount_max:'1000.00'}],systemAdminId:admin};
test('workflow navigation and submitted request retain linked identities without requiring allocation ratios',async({page})=>{
  const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};
  const errors:string[]=[],commands:any[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(u=>{localStorage.setItem('accessToken','synthetic-fixture');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:user});
    if(path==='/abnormal-cost/options')return route.fulfill({json:options});
    if(path==='/auth/preferences/table-config')return route.fulfill({json:{config:null}});
    if(path==='/table-filters/resources')return route.fulfill({json:['abnormal-categories','incident-severity-levels','abnormal-responsibility-requests','abnormal-responsibility-judgments'].map(code=>({code,filterableFields:[]}))});
    if(path==='/table-exports/capabilities')return route.fulfill({json:[{code:'abnormal-responsibility-requests',supported:true,allowed:true}]});
    if(path==='/table-filters/rows')return route.fulfill({json:{rows:[],total:0,page:1,pageSize:100}});
    if(path==='/abnormal-cost/attachments')return route.fulfill({json:{id:attachment,name:'abnormal.xlsx',parsed_rows:[{订单号:'SYN-ORDER',品号:'SYN-ITEM',品名:'合成品名',订单数量:'10',异常数量:'1'}]}});
    if(path==='/abnormal-cost/requests'&&request.method()==='POST'){commands.push(request.postDataJSON());return route.fulfill({json:{id:admin,version:1,abnormal_no:'YC261118SYN001'}});}
    if(request.method()!=='GET')return route.abort();return route.fulfill({json:[]});
  });
  await page.goto('/workflow/abnormal-cost/requests');
  await page.getByRole('menuitem',{name:'流程审批',exact:true}).click();await expect(page.getByText('异常费用',{exact:true})).toBeVisible();await page.getByText('异常费用',{exact:true}).click();await expect(page.getByRole('menuitem',{name:/发起异常责任判定/})).toBeVisible();await expect(page.getByRole('button',{name:/高级筛选/})).toBeVisible();
  await page.getByRole('button',{name:/新增/}).click();const dialog=page.getByRole('dialog',{name:'新增',exact:true});
  await dialog.getByLabel('客户',{exact:true}).fill('SYN-CUSTOMER');await dialog.getByLabel('订单号',{exact:true}).fill('SYN-ORDER');
  await dialog.getByLabel('事业部',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('合成事业部',{exact:true}).click();
  await dialog.getByLabel('异常描述',{exact:true}).fill('合成异常');await dialog.getByLabel('预估金额',{exact:true}).fill('100');await dialog.getByLabel('预估金额',{exact:true}).blur();
  await expect(dialog.getByLabel('核定金额',{exact:true})).toHaveValue('100.00');
  const judgmentFields=dialog.locator('.abnormal-request-judgment-table tbody tr').first().getByRole('combobox');
  await judgmentFields.nth(0).click();await page.locator('.ant-select-dropdown:visible').getByText('合成品质',{exact:true}).click();
  await judgmentFields.nth(1).click();await page.locator('.ant-select-dropdown:visible').getByText('合成事业部',{exact:true}).click();
  await judgmentFields.nth(2).click();await page.locator('.ant-select-dropdown:visible').getByText('合成管理员（fixture-admin）',{exact:true}).click();
  await dialog.locator('input[type=file]').first().setInputFiles({name:'abnormal.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic fixture upload')});
  await expect(dialog.getByText('已校验1行，预览前20行')).toBeVisible();await dialog.getByRole('button',{name:/^提\s*交$/}).click();await expect(dialog).toHaveCount(0);
  expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({customer_code:'SYN-CUSTOMER',detail_attachment:attachment,responsibility_judgments:[{category_id:category,judgment_department_id:department,judge_user_id:admin}]});expect(commands[0].responsibility_judgments[0].responsibility_allocations).toBeUndefined();expect(errors).toEqual([]);
});

test('request form adapts its columns to the modal content width and keeps its action bar available',async({page})=>{
  const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(u=>{localStorage.setItem('accessToken','synthetic-fixture');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:user});if(path==='/abnormal-cost/options')return route.fulfill({json:options});
    if(path==='/auth/preferences/table-config')return route.fulfill({json:{config:null}});
    if(path==='/table-filters/rows')return route.fulfill({json:{rows:[],total:0,page:1,pageSize:100}});
    if(path==='/table-filters/resources')return route.fulfill({json:['abnormal-responsibility-requests'].map(code=>({code,filterableFields:[]}))});
    if(path==='/table-exports/capabilities')return route.fulfill({json:[{code:'abnormal-responsibility-requests',supported:true,allowed:true}]});
    if(route.request().method()!=='GET')return route.abort();return route.fulfill({json:[]});
  });
  await page.goto('/workflow/abnormal-cost/requests');await page.getByRole('button',{name:/新增/}).click();
  const dialog=page.getByRole('dialog',{name:'新增',exact:true}),grid=dialog.locator('.abnormal-request-info-grid'),attachments=dialog.locator('.abnormal-request-attachment-grid');
  await expect(dialog.locator('input[readonly]').first()).toHaveValue('提交后自动生成');
  const columns=async(locator:typeof grid)=>locator.evaluate(el=>getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
  await expect.poll(()=>columns(grid)).toBe(4);await expect.poll(()=>columns(attachments)).toBe(2);
  await expect(dialog.locator('.abnormal-request-description')).toHaveCSS('grid-column-end','-1');
  await expect(dialog.locator('.ant-modal-header')).toBeVisible();await expect(dialog.locator('.ant-modal-footer')).toBeVisible();
  await page.setViewportSize({width:900,height:800});await expect.poll(()=>columns(grid)).toBe(2);await expect.poll(()=>columns(attachments)).toBe(2);
  await page.setViewportSize({width:640,height:700});await expect.poll(()=>columns(grid)).toBe(1);await expect.poll(()=>columns(attachments)).toBe(1);
  await expect(dialog.getByRole('button',{name:/^提\s*交$/})).toBeVisible();
});

test('a notification detail target survives login and opens the authorized judgment',async({page})=>{
  const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};
  const judgmentId='019a0000-0000-7000-8000-000000000099',path=`/workflow/abnormal-cost/judgments/${judgmentId}`;
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url()),apiPath=url.pathname.replace('/api/v1','');
    if(apiPath==='/auth/login')return route.fulfill({json:{accessToken:'synthetic-fixture',refreshToken:'synthetic-refresh',user}});
    if(apiPath==='/auth/me')return route.fulfill({json:user});
    if(apiPath==='/abnormal-cost/options')return route.fulfill({json:options});
    if(apiPath==='/auth/preferences/table-config')return route.fulfill({json:{config:null}});
    if(apiPath==='/table-filters/rows')return route.fulfill({json:{rows:[],total:0,page:1,pageSize:100}});
    if(apiPath===`/abnormal-cost/resources/abnormal-responsibility-judgments/${judgmentId}`)return route.fulfill({json:{id:judgmentId,version:1,judgment_no:'YC261118SYN00101',category_id:category,judgment_department_id:department,judge_user_id:admin,expense_bearing_ratio:null,abnormal_request_link:`/workflow/abnormal-cost/requests/${admin}`,responsibility_allocations:[],judgment_evidence:[],judgment_status:'PENDING'}});
    return route.fulfill({json:[]});
  });
  await page.goto(path);await page.getByLabel('用户名',{exact:true}).fill('fixture-admin');await page.getByLabel('密码',{exact:true}).fill('synthetic-fixture-password');await page.getByRole('button',{name:/^登\s*录$/}).click();
  await expect(page).toHaveURL(new RegExp(`/workflow/abnormal-cost/judgments/${judgmentId}$`));await expect(page.getByRole('heading',{name:'YC261118SYN00101',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'查看异常信息'})).toHaveAttribute('target','_blank');
});


test('request table exposes working templates and preview-confirm import without bypassing the standard toolbar',async({page})=>{
  const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};let confirms=0;
  await page.addInitScript(u=>{localStorage.setItem('accessToken','synthetic-fixture');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:user});if(path==='/abnormal-cost/options')return route.fulfill({json:options});
    if(path==='/auth/preferences/table-config')return route.fulfill({json:{config:null}});
    if(path==='/table-filters/rows')return route.fulfill({json:{rows:[],total:0,page:1,pageSize:100}});
    if(path.endsWith('/template'))return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('synthetic-download-fixture')});
    if(path.endsWith('/import-preview'))return route.fulfill({json:{previewId:attachment,total:1,rows:[{row:2,values:{customer_code:'SYN-CUSTOMER'}}],errors:[]}});
    if(path.endsWith('/import-confirm')){confirms++;return route.fulfill({json:{created:1,updated:0,total:1}});}
    if(route.request().method()!=='GET')return route.abort();return route.fulfill({json:[]});
  });
  await page.goto('/workflow/abnormal-cost/requests');await expect(page.getByRole('button',{name:'准备导入附件',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'下载导入模板',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByText('新增数据模板',{exact:true}).click();expect((await downloading).suggestedFilename()).toBe('abnormal_import_template.xlsx');
  await page.locator('input[type=file]').first().setInputFiles({name:'request-import.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic-upload-fixture')});
  const preview=page.getByRole('dialog',{name:'导入预览',exact:true});await expect(preview.getByText('共1行')).toBeVisible();await preview.getByRole('button',{name:'确认导入',exact:true}).click();await expect(preview).toHaveCount(0);expect(confirms).toBe(1);
});
