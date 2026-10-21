import { test, expect, type Page } from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const event = { eventType: 'finance.monthly.daily_summary', label: '财务月度数据每日汇总', moduleCode: 'finance', module: '财务中心', resource: 'finance-e10-monthly', resourceLabel: '月度数据', condition: '每天08:30汇总当月', recipientRules: ['FIXED_USERS'], recipientLabels: { FIXED_USERS: '组织架构 / 角色 / 员工' }, variables: ['yearMonth'] };
async function setup(page: Page) {
  const user = { sub: 'synthetic-admin', username: 'synthetic', permissions: ['*'], isSystemAdmin: true, moduleAdminCodes: [], mustChangePassword: false };
  let rule: any = { id: 'finance-fixture', name: event.label, eventType: event.eventType, resource: event.resource, resourceLabel: event.resourceLabel, module: event.module, recipientRule: 'FIXED_USERS', recipientTargets: [], enabled: false, config: { template: '模板{yearMonth}', custom: 'preserve' }, version: 1 };
  let conflict = false; let forbidden = false; const patches: any[] = []; const sends: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''); let data: any = [];
    if (/\/test$|\/retry$|\/claim$/.test(path)) { sends.push(path); await route.abort(); return; }
    if (path === '/auth/me') data = user;
    else if (path === '/notifications/events') data = [event];
    else if (path === '/notifications/recipient-options') data = { organizations: [{ id: 'org', name: '测试组织', pathLabel: '测试组织', enabled: true, parentId: null }], roles: [{ id: 'role', name: '测试角色' }], users: [{ id: 'employee', displayName: '测试员工', username: 'fixture', enabled: true }] };
    else if (request.method() === 'PATCH') {
      const body = request.postDataJSON(); patches.push(body);
      if (forbidden || conflict || body.enabled && !rule.recipientTargets.length) { const status = forbidden ? 403 : conflict ? 409 : 400; await route.fulfill({ status, json: { message: forbidden ? '当前管理员无权管理该模块的消息规则' : conflict ? '规则已被其他用户修改，请刷新后重试' : '未配置有效接收人，请先编辑接收对象', ...(status === 400 ? { code: 'NOTIFICATION_RECIPIENTS_REQUIRED' } : {}) } }); return; }
      rule = { ...rule, ...body, config: { ...rule.config, template: body.template ?? rule.config.template }, version: rule.version + 1 }; data = rule;
    } else if (path === '/notifications/rules/finance-fixture') data = rule;
    else if (path === '/notifications/rules') data = [rule];
    await route.fulfill({ json: data });
  });
  await page.addInitScript(u => { localStorage.setItem('accessToken', 'synthetic'); localStorage.setItem('sessionUser', JSON.stringify(u)); }, user);
  await page.goto('/system/notifications'); await expect(page.getByRole('button', { name: /编辑/ })).toBeVisible();
  return { row: () => rule, patches, sends, conflict: (value: boolean) => { conflict = value; }, forbidden: (value: boolean) => { forbidden = value; }, externalUpdate: () => { rule = { ...rule, name: '其他管理员保存', version: rule.version + 1 }; } };
}

test('mixed organization, role and employee selections survive save and reopen; state toggles preserve config', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await page.getByRole('button', { name: '编辑接收人' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('.ant-tree-checkbox').click();
  await dialog.getByRole('tab', { name: /角色/ }).click(); await dialog.getByRole('checkbox', { name: '测试角色' }).check();
  await dialog.getByRole('tab', { name: /员工/ }).click(); await dialog.getByRole('checkbox', { name: /测试员工/ }).check();
  await dialog.getByRole('button', { name: /保\s*存/ }).click(); await expect(dialog).toHaveCount(0);
  expect(state.row().recipientTargets).toHaveLength(3);
  for (const target of ['组织：测试组织', '角色：测试角色', '员工：测试员工']) await expect(page.getByRole('row').filter({ hasText: event.label }).getByText(new RegExp(target))).toBeVisible();
  await page.getByRole('button', { name: /编辑/ }).click(); dialog = page.getByRole('dialog');
  await expect(dialog.locator('.ant-tree-checkbox-checked')).toHaveCount(1);
  await dialog.getByRole('tab', { name: /角色/ }).click(); await expect(dialog.getByRole('checkbox', { name: '测试角色' })).toBeChecked();
  await dialog.getByRole('tab', { name: /员工/ }).click(); await expect(dialog.getByRole('checkbox', { name: /测试员工/ })).toBeChecked();
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  const config = structuredClone(state.row().config);
  await page.getByRole('button', { name: '启用', exact: true }).click(); await expect(page.getByRole('button', { name: '停用', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停用', exact: true }).click(); await expect(page.getByRole('button', { name: '启用', exact: true })).toBeVisible();
  expect(state.row().recipientTargets).toHaveLength(3); expect(state.row().config).toEqual(config);
  expect(state.patches.slice(-2).map(body => Object.keys(body).sort())).toEqual([['enabled', 'expectedVersion'], ['enabled', 'expectedVersion']]); expect(state.sends).toEqual([]);
  await page.getByRole('button', { name: /编辑/ }).click(); dialog = page.getByRole('dialog');
  await dialog.locator('.ant-tree-checkbox').click(); await dialog.getByRole('tab', { name: /角色/ }).click(); await dialog.getByRole('checkbox', { name: '测试角色' }).uncheck();
  await dialog.getByRole('tab', { name: /员工/ }).click(); await dialog.getByRole('checkbox', { name: /测试员工/ }).uncheck();
  await dialog.getByRole('button', { name: /保\s*存/ }).click(); await expect(dialog).toHaveCount(0); expect(state.row().recipientTargets).toEqual([]);
});

test('save permission error is explicit; stale version can reload and retry', async ({ page }) => {
  const state = await setup(page); await page.getByRole('button', { name: /编辑/ }).click();
  state.forbidden(true); await page.getByRole('dialog').getByRole('button', { name: /保\s*存/ }).click(); await expect(page.getByRole('dialog')).toContainText('当前管理员无权管理');
  state.forbidden(false); state.conflict(true); state.externalUpdate(); await page.getByRole('dialog').getByRole('button', { name: /保\s*存/ }).click();
  await page.getByRole('button', { name: '刷新后重试' }).click(); await expect(page.getByRole('dialog').getByRole('textbox', { name: /规则名称/ })).toHaveValue('其他管理员保存');
  state.conflict(false); await page.getByRole('dialog').getByRole('button', { name: /保\s*存/ }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.sends).toEqual([]);
});
