import { expect, test } from '@playwright/test';
// Real SPA/shared tables, synthetic HTTP fixtures; every API write is intercepted.
test.use({trace:'off',screenshot:'off',video:'off',actionTimeout:10000});
const admin='019a0000-0000-7000-8000-000000000001',department='019a0000-0000-7000-8000-000000000002',category='019a0000-0000-7000-8000-000000000003',attachment='019a0000-0000-7000-8000-000000000004';
const options={users:[{id:admin,name:'合成管理员',username:'fixture-admin',enabled:true,position:'课长'}],departments:[{id:department,name:'合成事业部',pathLabel:'合成事业部'}],categories:[{id:category,category_name:'合成品质'}],severities:[{id:'019a0000-0000-7000-8000-000000000005',severity_name:'一般',amount_min:'0.00',amount_max:'1000.00'}],expenseCategories:[{major_category:'粉末报废',sub_category:'回收粉'},{major_category:'粉末报废',sub_category:'呆滞废粉'},{major_category:'异常工时',sub_category:'内部原因'}],systemAdminId:admin};
test('workflow navigation and submitted request retain linked identities without requiring allocation ratios',async({page})=>{
  const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};
  const errors:string[]=[],commands:any[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(u=>{localStorage.setItem('accessToken','synthetic-fixture');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1','');
    if(path==='/auth/me')return route.fulfill({json:user});
    if(path==='/abnormal-cost/order-options')return route.fulfill({json:{options:url.searchParams.has('orderNo')?[{value:'SYN-ITEM',label:'SYN-ITEM · 合成品名'}]:[{value:'SYN-ORDER',label:'SYN-ORDER'}],hasMore:false}});
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
  await expect(dialog.getByLabel('异常数量',{exact:true})).toHaveValue('0');
  await dialog.getByLabel('客户',{exact:true}).fill('SYN-CUSTOMER');await dialog.getByLabel('异常大类',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('粉末报废',{exact:true}).click();
  await dialog.getByLabel('异常二级分类',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('呆滞废粉',{exact:true}).click();await page.keyboard.press('Escape');
  await dialog.getByLabel('订单号',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('SYN-ORDER',{exact:true}).click();
  await dialog.getByLabel('品号',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('SYN-ITEM · 合成品名',{exact:true}).click();await page.keyboard.press('Escape');
  await dialog.getByLabel('事业部',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('合成事业部',{exact:true}).click();
  await dialog.getByLabel('异常描述',{exact:true}).fill('合成异常');await dialog.getByLabel('预估金额',{exact:true}).fill('100');await dialog.getByLabel('预估金额',{exact:true}).blur();
  await expect(dialog.getByLabel('核定金额',{exact:true})).toHaveValue('100.00');
  const judgmentFields=dialog.locator('.abnormal-request-judgment-table tbody tr').first().getByRole('combobox');
  await judgmentFields.nth(0).click();await page.locator('.ant-select-dropdown:visible').getByText('合成品质',{exact:true}).click();
  await judgmentFields.nth(1).click();await page.locator('.ant-select-dropdown:visible').getByText('合成事业部',{exact:true}).click();
  await judgmentFields.nth(2).click();await page.locator('.ant-select-dropdown:visible').getByText('合成管理员（fixture-admin）',{exact:true}).click();
  await expect(dialog.getByText('下载明细附件模板')).toHaveCount(0);await dialog.getByRole('button',{name:/^提\s*交$/}).click();await expect(dialog).toHaveCount(0);
  expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({customer_code:'SYN-CUSTOMER',item_codes:['SYN-ITEM'],abnormal_quantity:0,major_category:'粉末报废',sub_categories:['呆滞废粉'],responsibility_judgments:[{category_id:category,judgment_department_id:department,judge_user_id:admin}]});expect(commands[0].responsibility_judgments[0].responsibility_allocations).toBeUndefined();expect(errors).toEqual([]);
});

test('request form adapts its columns to the modal content width and keeps its action bar available',async({page})=>{
  const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(u=>{localStorage.setItem('accessToken','synthetic-fixture');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');
    if(path==='/abnormal-cost/order-options')return route.fulfill({json:{options:[{value:'SYN-ORDER',label:'SYN-ORDER'}],hasMore:false}});
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
  const assertActionsInViewport=async()=>{const rect=await dialog.locator('.ant-modal-footer').boundingBox();expect(rect).not.toBeNull();expect(rect!.y).toBeGreaterThanOrEqual(0);expect(rect!.y+rect!.height).toBeLessThanOrEqual(page.viewportSize()!.height-8);};
  const columns=async(locator:typeof grid)=>locator.evaluate(el=>getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
  await expect.poll(()=>columns(grid)).toBe(4);await expect.poll(()=>columns(attachments)).toBe(2);await assertActionsInViewport();
  await expect(dialog.locator('.abnormal-request-description')).toHaveCSS('grid-column-end','-1');
  await expect(dialog.locator('.ant-modal-header')).toBeVisible();await expect(dialog.locator('.ant-modal-footer')).toBeVisible();
  await page.setViewportSize({width:900,height:800});await expect.poll(()=>columns(grid)).toBe(2);await expect.poll(()=>columns(attachments)).toBe(2);await assertActionsInViewport();
  await page.setViewportSize({width:640,height:700});await expect.poll(()=>columns(grid)).toBe(1);await expect.poll(()=>columns(attachments)).toBe(1);await assertActionsInViewport();
  await expect(dialog.getByRole('button',{name:/^提\s*交$/})).toBeVisible();
});

test('request and judgment rows open fresh edit forms and preserve linked child identity on save',async({page})=>{
  const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};
  const requestId='019a0000-0000-7000-8000-000000000020',childId='019a0000-0000-7000-8000-000000000021',judgmentId='019a0000-0000-7000-8000-000000000022';
  const requestRecord:any={id:requestId,version:1,abnormal_no:'YC261118SYN001',customer_code:'SYN-CUSTOMER',order_no:'SYN-ORDER',item_codes:['SYN-ITEM'],abnormal_quantity:2,major_category:'粉末报废',sub_categories:['呆滞废粉'],division_id:department,initiator_id:admin,abnormal_description:'原描述',estimated_amount:'100.00',confirmed_amount:'100.00',severity_level_id:options.severities[0].id,detail_attachment:[{id:attachment,name:'abnormal.xlsx',purpose:'DETAIL'}],other_attachments:[],responsibility_judgments:[{id:childId,version:1,judgment_no:'YC261118SYN00101',category_id:category,judgment_department_id:department,judge_user_id:admin,expense_bearing_ratio:null,judgment_status:'PENDING',responsibility_allocations:[],responsibility_reason:'',judgment_evidence:[]}]};
  const judgmentRecord:any={id:judgmentId,version:1,judgment_no:'YC261118SYN00102',category_id:category,judgment_department_id:department,judge_user_id:admin,expense_bearing_ratio:null,abnormal_request_link:'/workflow/abnormal-cost/requests/'+requestId,responsibility_allocations:[],responsibility_reason:'原判定理由',judgment_evidence:[],judgment_status:'PENDING'};
  const saved:any[]=[];
  await page.setViewportSize({width:1440,height:900});await page.addInitScript(u=>{localStorage.setItem('accessToken','synthetic-fixture');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1','');
    if(path==='/abnormal-cost/order-options')return route.fulfill({json:{options:[{value:'SYN-ORDER',label:'SYN-ORDER'}],hasMore:false}});
    if(path==='/auth/me')return route.fulfill({json:user});if(path==='/abnormal-cost/options')return route.fulfill({json:options});
    if(path==='/auth/preferences/table-config')return route.fulfill({json:{config:null}});
    if(path==='/table-filters/resources')return route.fulfill({json:['abnormal-responsibility-requests','abnormal-responsibility-judgments'].map(code=>({code,filterableFields:[]}))});
    if(path==='/table-exports/capabilities')return route.fulfill({json:[]});
    if(path==='/table-filters/rows'){
      const resource=url.searchParams.get('resource');const row=resource==='abnormal-responsibility-requests'?{...requestRecord,...saved[0]?.requestData}:resource==='abnormal-responsibility-judgments'?judgmentRecord:null;
      return route.fulfill({json:{rows:row?[{id:row.id,version:row.version,abnormal_no:row.abnormal_no,judgment_no:row.judgment_no,category_id:row.category_id,category_name:'合成品质'}]:[],total:row?1:0,page:1,pageSize:100}});
    }
    if(path===`/abnormal-cost/resources/abnormal-responsibility-requests/${requestId}`)return route.fulfill({json:{...requestRecord,...saved[0]?.requestData}});
    if(path===`/abnormal-cost/resources/abnormal-responsibility-judgments/${judgmentId}`)return route.fulfill({json:judgmentRecord});
    if(path===`/abnormal-cost/requests/${requestId}`&&request.method()==='PATCH'){
      const body=request.postDataJSON();saved[0]={requestData:{version:2,abnormal_description:body.abnormal_description},body};return route.fulfill({json:{id:requestId,version:2}});
    }
    if(path===`/abnormal-cost/judgments/${judgmentId}`&&request.method()==='PATCH'){
      saved.push({judgmentBody:request.postDataJSON()});return route.fulfill({json:{id:judgmentId,version:2,judgment_status:'PENDING'}});
    }
    if(request.method()!=='GET')return route.abort();return route.fulfill({json:[]});
  });
  await page.goto('/workflow/abnormal-cost/requests');await page.getByRole('button',{name:'编辑',exact:false}).first().click();
  const requestDialog=page.getByRole('dialog',{name:'编辑',exact:true});await expect(requestDialog.getByLabel('异常描述',{exact:true})).toHaveValue('原描述');
  await expect(requestDialog.locator('.abnormal-request-judgment-table .ant-select-selection-item')).toHaveText(['合成品质','合成事业部','合成管理员（fixture-admin）']);
  await requestDialog.getByLabel('异常描述',{exact:true}).fill('修改后异常描述');await requestDialog.locator('.abnormal-request-judgment-table input[role="spinbutton"]').fill('60');
  await requestDialog.getByRole('button',{name:/保\s*存/}).click();await expect(requestDialog).toHaveCount(0);
  expect(saved[0]?.body.responsibility_judgments).toHaveLength(1);expect(saved[0]?.body.responsibility_judgments[0]).toMatchObject({id:childId,version:1,expense_bearing_ratio:'60'});
  await page.getByRole('button',{name:'编辑',exact:false}).first().click();const reopenedRequest=page.getByRole('dialog',{name:'编辑',exact:true});await expect(reopenedRequest.getByLabel('异常描述',{exact:true})).toHaveValue('修改后异常描述');
  await reopenedRequest.locator('.abnormal-request-judgment-table input[role="spinbutton"]').fill('70');await reopenedRequest.getByRole('button',{name:/取\s*消/}).click();
  const discard=page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true});await discard.getByRole('button',{name:/继续编辑/}).click();await expect(reopenedRequest.locator('.abnormal-request-judgment-table input[role="spinbutton"]')).toHaveValue('70');
  await reopenedRequest.getByRole('button',{name:/取\s*消/}).click();await page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true}).getByRole('button',{name:/放弃修改/}).click();await expect(reopenedRequest).toHaveCount(0);
  await page.goto('/workflow/abnormal-cost/judgments');await page.getByRole('button',{name:'编辑',exact:false}).first().click();
  const judgmentDialog=page.getByRole('dialog',{name:'编辑',exact:true}),grid=judgmentDialog.locator('.abnormal-judgment-info-grid');
  await expect(judgmentDialog.getByLabel('责任划分理由',{exact:true})).toHaveValue('原判定理由');
  const columns=async()=>grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
  await expect.poll(columns).toBe(4);await page.setViewportSize({width:900,height:800});await expect.poll(columns).toBe(2);await page.setViewportSize({width:640,height:700});await expect.poll(columns).toBe(1);
  await judgmentDialog.getByLabel('责任划分理由',{exact:true}).fill('修改后责任说明');await judgmentDialog.getByRole('button',{name:'保存判定草稿',exact:true}).click();
  expect(saved.some(row=>row.judgmentBody?.responsibility_reason==='修改后责任说明')).toBe(true);
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
  await expect(page).toHaveURL(new RegExp(`/workflow/abnormal-cost/judgments/${judgmentId}$`));await expect(page.getByLabel('子表单号',{exact:true})).toHaveValue('YC261118SYN00101');
  await expect(page.getByLabel('异常信息',{exact:true})).toHaveValue(`/workflow/abnormal-cost/requests/${admin}`);
});


test('request table exposes working templates and preview-confirm import without bypassing the standard toolbar',async({page})=>{
  const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};let confirms=0;
  await page.addInitScript(u=>{localStorage.setItem('accessToken','synthetic-fixture');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/v1','');
    if(path==='/abnormal-cost/order-options')return route.fulfill({json:{options:[{value:'SYN-ORDER',label:'SYN-ORDER'}],hasMore:false}});
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

test('virtual order follows exact category selection and long responsibility labels support hover/focus without page overflow',async({page})=>{
 const user={sub:admin,username:'fixture-admin',displayName:'合成管理员',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:[],mustChangePassword:false};
 const fullPath='凯南 / 营销中心 / 跨事业部客户服务与异常费用责任判定业务管理部门';
 await page.setViewportSize({width:1440,height:900});await page.addInitScript(u=>{localStorage.setItem('accessToken','fixture');localStorage.setItem('sessionUser',JSON.stringify(u));},user);
 await page.route('**/api/v1/**',async route=>{
  const u=new URL(route.request().url()),p=u.pathname.replace('/api/v1','');
  if(p==='/auth/me')return route.fulfill({json:user});
  if(p==='/abnormal-cost/options')return route.fulfill({json:{...options,departments:[{id:department,name:'长部门',pathLabel:fullPath}]}});
  if(p==='/auth/preferences/table-config')return route.fulfill({json:{config:null}});
  if(p==='/table-filters/rows')return route.fulfill({json:{rows:[],total:0,page:1,pageSize:100}});
  if(p==='/abnormal-cost/order-options'){
   const allowed=u.searchParams.get('majorCategory')==='粉末报废'&&u.searchParams.get('subCategories')==='["回收粉"]';
   return route.fulfill({json:{options:allowed?(u.searchParams.has('orderNo')?[{value:'虚拟品号',label:'虚拟品号 · 虚拟品名'}]:[{value:'虚拟订单',label:'虚拟订单'}]):[],hasMore:false}});
  }
  return route.fulfill({json:[]});
 });
 await page.goto('/workflow/abnormal-cost/requests');await page.getByRole('button',{name:/新增/}).click();const dialog=page.getByRole('dialog',{name:'新增',exact:true});
 await dialog.getByLabel('异常大类',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('粉末报废',{exact:true}).click();
 await dialog.getByLabel('异常二级分类',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('回收粉',{exact:true}).click();await page.keyboard.press('Escape');
 await dialog.getByLabel('订单号',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('虚拟订单',{exact:true}).click();
 await dialog.getByLabel('品号',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('虚拟品号 · 虚拟品名',{exact:true}).click();await page.keyboard.press('Escape');
 await dialog.getByLabel('异常二级分类',{exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText('呆滞废粉',{exact:true}).click();await page.keyboard.press('Escape');
 await expect(dialog.getByLabel('订单号',{exact:true})).toHaveValue('');await expect(dialog.locator('.ant-select-selection-item').filter({hasText:'虚拟品号'})).toHaveCount(0);
 const dept=dialog.locator('.abnormal-request-judgment-table tbody td').nth(2);await dept.getByRole('combobox').click();await page.locator('.ant-select-dropdown:visible').getByText(fullPath,{exact:true}).click();
 const selected=dept.locator('.abnormal-select-label').first();await selected.hover();await expect(page.getByRole('tooltip').getByText(fullPath,{exact:true})).toBeVisible();await selected.focus();await expect(page.getByRole('tooltip').getByText(fullPath,{exact:true})).toBeVisible();
 expect(await dept.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(300);
 await page.setViewportSize({width:640,height:700});await expect.poll(()=>dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth;})).toBe(true);
 // The existing KDOS desktop shell has body min-width:1180px. The modal must not add any further page overflow.
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=Math.max(window.innerWidth,parseFloat(getComputedStyle(document.body).minWidth)||0))).toBe(true);await expect(dialog.getByRole('button',{name:/^提\s*交$/})).toBeVisible();
});
