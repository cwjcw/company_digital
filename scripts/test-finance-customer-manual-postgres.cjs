#!/usr/bin/env node
/** Synthetic integration tests only; the socket guard prevents use of the production database. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), r = createRequire(root + '/apps/api/package.json');
const { DataSource } = r('typeorm'), { Client } = r('pg'), Excel = r('exceljs');
const { entities } = r('./dist/entities');
const { FinanceApplicationService } = r('./dist/modules/finance/finance.application.service');
const { FinanceRepository } = r('./dist/modules/finance/finance.repository');
const { FinanceQueryService } = r('./dist/modules/finance/finance.query.service');
const { FinanceController } = r('./dist/modules/finance/finance.controller');
const { FinanceFilterSourceProvider } = r('./dist/modules/finance/finance.filter-sources');
const { TableFilterRegistry } = r('./dist/common/filtering/table-filter.registry');
const { TableFilterController } = r('./dist/common/filtering/table-filter.controller');
const { FieldCandidateService } = r('./dist/common/filtering/field-candidate.service');
const { OrganizationDirectoryService } = r('./dist/modules/organization-directory/organization-directory.service');
const { TablePrintService } = r('./dist/common/printing/table-print.service');
const { TableExportController } = r('./dist/common/printing/table-export.controller');
const { AuthGuard } = r('./dist/auth'), { Test } = r('@nestjs/testing');
const { financeCustomerMinimumSourceDate, tablePermissionFieldsFor } = r('@kdos/contracts');
const host = process.env.FINANCE_MANUAL_TEST_POSTGRES_HOST;
if (!host?.startsWith('/tmp/kdos-finance-customer-pg-')) throw Error('Disposable finance-customer PostgreSQL socket required');
const resource = 'finance-customer-mappings', name = 'finance_manual_' + Date.now();
const uid = n => '0199ea00-0000-7000-8000-' + String(n).padStart(12, '0');
const actor = { tenantId: 'KAINAN', userId: uid(1), username: 'Synthetic finance operator', permissions: ['*'], isSystemAdmin: true, tableDataScopes: [], moduleAdminCodes: [], source: 'web', requestId: 'synthetic-manual' };
const fields = tablePermissionFieldsFor(resource).map(f => `${resource}:${f.key}:read`);
const reader = { ...actor, isSystemAdmin: false, permissions: [`${resource}:*:read`, ...fields], tableDataScopes: [{ resource, scope: 'ALL', actions: ['read'] }] };
const creator = { ...reader, permissions: [...reader.permissions, `${resource}:*:create`], tableDataScopes: [{ resource, scope: 'ALL', actions: ['read', 'create'] }] };
const input = { customerCode: 'SYNTHETIC-1/2', departmentCategory: '业务二部', salesChannel: '外销' };
const checks = [], control = new Client({ host, user: 'knplan', database: 'postgres' });
let db, http, service, repository, registry, queries, exporter, base, browser;
const check = async (label, fn) => { await fn(); checks.push(label); console.log('PASS ' + label); };
const sourceRow = customerCode => ({ customerCode, createdAtSource: financeCustomerMinimumSourceDate + 'T00:00:00' });
const ingest = (code, runKey) => service.ingest({ source: 'E10_SYNC', runKey, rows: [sourceRow(code)] }, actor);
const row = async (code, tenant = 'KAINAN') => (await db.query('SELECT * FROM finance_customer_mappings WHERE tenant_id=$1 AND customer_code=$2', [tenant, code]))[0];
const request = async (url, identity = 'admin', body, method = body ? 'POST' : 'GET') => {
    const result = await fetch(base + '/api/v1' + url, { method, headers: { 'x-test-actor': identity, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { result, body: result.headers.get('content-type')?.includes('json') ? await result.json() : Buffer.from(await result.arrayBuffer()) };
};
(async () => {
    await control.connect(); await control.query(`CREATE DATABASE ${name}`);
    db = new DataSource({ type: 'postgres', host, username: 'knplan', database: name, entities, migrations: [root + '/apps/api/dist/migrations/*.js'], logging: false });
    await db.initialize(); await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    const allMigrations = [...db.migrations];
    db.migrations = allMigrations.filter(m => m.name !== 'FinanceCustomerManualSource1722920103000');
    await db.runMigrations();
    for (const [n, tenant, enabled] of [[1, 'KAINAN', true], [2, 'OTHER', true], [3, 'KAINAN', false]])
        await db.query("INSERT INTO users(id,username,display_name,password_hash,tenant_id,enabled) VALUES($1,$2,$2,'unused',$3,$4)", [uid(n), 'synthetic-finance-' + n, tenant, enabled]);
    repository = new FinanceRepository(db); service = new FinanceApplicationService(repository); queries = new FinanceQueryService(repository);
    await service.ingest({ source: 'INITIAL_IMPORT', runKey: 'synthetic-seed', rows: [{ customerCode: 'SYNTHETIC-SEED', departmentCategory: '业务一部', salesChannel: '内销' }] }, actor);
    await ingest('SYNTHETIC-E10', 'synthetic-old-sync');
    await check('forward source migration preserves all old rows and constraints; import-run sources remain unchanged', async () => {
        const before = await db.query('SELECT * FROM finance_customer_mappings ORDER BY id');
        db.migrations = allMigrations; assert.equal((await db.runMigrations()).length, 1);
        assert.deepEqual(await db.query('SELECT * FROM finance_customer_mappings ORDER BY id'), before);
        const [runCheck] = await db.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='finance_customer_sync_runs'::regclass AND conname='finance_customer_sync_runs_source_check'");
        assert(!runCheck.definition.includes('MANUAL'));
    });
    let first;
    await check('manual creation trims edges, preserves suffixes, stores MANUAL/UUIDv7/operator/time/version and a complete audit', async () => {
        first = await service.createManual({ ...input, customerCode: '  ' + input.customerCode + '  ' }, actor);
        const saved = await row(input.customerCode); assert.equal(first.id[14], '7'); assert.equal(first.version, 1);
        assert.equal(saved.source, 'MANUAL'); assert.equal(saved.created_by, actor.userId); assert.equal(saved.updated_by, actor.userId);
        assert(saved.created_at && saved.updated_at); assert.equal(saved.department_category, input.departmentCategory);
        const [audit] = await db.query('SELECT actor_id,source,before_json,after_json FROM audit_logs WHERE record_id=$1 AND action=$2', [first.id, 'finance.customer.created']);
        assert.equal(audit.actor_id, actor.userId); assert.equal(audit.source, 'web'); assert.equal(audit.before_json, null);
        assert.equal(audit.after_json.source, 'MANUAL'); assert.equal(audit.after_json.customerCode, input.customerCode);
    });
    await check('duplicate and eight concurrent creates return a conflict without overwriting or duplicating customers/audits', async () => {
        const before = await row(input.customerCode);
        await assert.rejects(service.createManual({ ...input, salesChannel: '内销' }, actor), e => e.getStatus() === 409 && e.getResponse().code === 'FINANCE_CUSTOMER_EXISTS');
        assert.deepEqual(await row(input.customerCode), before);
        const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.createManual({ ...input, customerCode: 'SYNTHETIC-CONCURRENT' }, actor)));
        assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
        assert(results.filter(x => x.status === 'rejected').every(x => x.reason.getStatus() === 409));
        const record = await row('SYNTHETIC-CONCURRENT');
        assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE record_id=$1 AND action='finance.customer.created'", [record.id]))[0].n, 1);
    });
    await check('same code is independent across tenants; foreign and disabled operators are denied', async () => {
        await service.createManual(input, { ...actor, tenantId: 'OTHER', userId: uid(2) });
        assert((await row(input.customerCode, 'OTHER')).id !== first.id);
        for (const userId of [uid(2), uid(3)]) await assert.rejects(service.createManual({ ...input, customerCode: 'SYNTHETIC-FORBIDDEN' }, { ...actor, userId }), /操作人无效/);
        assert.equal(await row('SYNTHETIC-FORBIDDEN'), undefined);
    });
    await check('create requires an explicit action scope; OWN/NONE work and CUSTOM checks the proposed classification', async () => {
        await assert.rejects(service.createManual({ ...input, customerCode: 'SYNTHETIC-NOSCOPE' }, { ...creator, tableDataScopes: reader.tableDataScopes }), /数据范围/);
        for (const scope of ['OWN', 'NONE']) {
            const scoped = { ...creator, tableDataScopes: [{ resource, scope, actions: ['create'] }] };
            await service.createManual({ ...input, customerCode: 'SYNTHETIC-' + scope }, scoped);
        }
        const custom = { ...creator, tableDataScopes: [{ resource, scope: 'CUSTOM', actions: ['create'], rules: [{ fieldKey: 'departmentCategory', operator: 'EQ', value: '业务二部' }] }] };
        await assert.rejects(service.createManual({ ...input, departmentCategory: '业务一部' }, custom), /数据范围/);
        await service.createManual({ ...input, customerCode: 'SYNTHETIC-SCOPED' }, custom);
        const unknown = { ...custom, tableDataScopes: [{ ...custom.tableDataScopes[0], rules: [...custom.tableDataScopes[0].rules, { fieldKey: 'divisionId', operator: 'EQ', value: 'UNKNOWN' }] }] };
        await assert.rejects(service.createManual({ ...input, customerCode: 'SYNTHETIC-UNKNOWN-SCOPE' }, unknown), /数据范围/);
    });
    await check('audit failures roll back the customer row and produce no partial creation', async () => {
        const broken = new FinanceApplicationService({ transaction: (tenant, fn) => repository.transaction(tenant, async manager => {
            manager.save = async () => { throw Error('synthetic audit failure'); }; return fn(manager);
        }) });
        await assert.rejects(broken.createManual({ ...input, customerCode: 'SYNTHETIC-ROLLBACK' }, actor), /synthetic audit failure/);
        assert.equal(await row('SYNTHETIC-ROLLBACK'), undefined);
    });
    await check('scheduled E10 replay preserves every manual classification/source/version/audit and never creates duplicates', async () => {
        const before = await row(input.customerCode), result = await ingest(input.customerCode, 'synthetic-manual-sync');
        assert.equal(result.created, 0); assert.equal(result.skipped, 1); assert.deepEqual(await row(input.customerCode), before);
        assert.equal((await ingest(input.customerCode, 'synthetic-manual-sync')).repeated, true);
        const results = await Promise.allSettled([service.createManual({ ...input, customerCode: 'SYNTHETIC-RACE' }, actor), ingest('SYNTHETIC-RACE', 'synthetic-race')]);
        const saved = await row('SYNTHETIC-RACE'); assert(saved);
        assert.equal((await db.query("SELECT count(*)::int n FROM finance_customer_mappings WHERE customer_code='SYNTHETIC-RACE'"))[0].n, 1);
        if (saved.source === 'MANUAL') assert.equal(saved.sales_channel, input.salesChannel);
        else { assert.equal(saved.source, 'E10_SYNC'); assert.equal(saved.sales_channel, null); assert.equal(results[0].status, 'rejected'); }
        await assert.rejects(service.ingest({ source: 'MANUAL', runKey: 'invalid-source', rows: [] }, actor), /来源无效/);
    });
    registry = new TableFilterRegistry(); new FinanceFilterSourceProvider(registry, repository).onModuleInit();
    exporter = new TablePrintService(registry, db);
    const identities = { admin: actor, creator, reader, foreign: { ...actor, userId: uid(2) }, hidden: { ...creator, permissions: creator.permissions.filter(p => p !== `${resource}:salesChannel:read`) } };
    const module = await Test.createTestingModule({ controllers: [FinanceController, TableFilterController, TableExportController], providers: [
        { provide: FinanceApplicationService, useValue: service }, { provide: FinanceQueryService, useValue: queries },
        { provide: TableFilterRegistry, useValue: registry }, { provide: DataSource, useValue: db },
        { provide: FieldCandidateService, useValue: new FieldCandidateService(db) },
        { provide: OrganizationDirectoryService, useValue: new OrganizationDirectoryService(db.getRepository(r('./dist/entities').OrganizationUnit)) },
        { provide: TablePrintService, useValue: exporter }
    ] }).overrideGuard(AuthGuard).useValue({ canActivate(context) {
        const req = context.switchToHttp().getRequest(), selected = identities[req.headers['x-test-actor'] ?? 'reader'];
        if (!selected) return false;
        req.user = { ...selected, sub: selected.userId, displayName: selected.username }; req.requestId = 'synthetic-http'; return true;
    } }).compile();
    http = module.createNestApplication({ logger: false }); http.setGlobalPrefix('api/v1'); await http.listen(0, '127.0.0.1'); base = await http.getUrl();
    await check('real HTTP manual route returns 201/400/403/409 and does not expose hidden record fields', async () => {
        assert.equal((await request('/finance/customer-mappings/manual', 'reader', input)).result.status, 403);
        assert.equal((await request('/finance/customer-mappings/manual', 'hidden', input)).result.status, 403);
        assert.equal((await request('/finance/customer-mappings/manual', 'foreign', input)).result.status, 403);
        assert.equal((await request('/finance/customer-mappings/manual', 'admin', { ...input, tenantId: 'OTHER' })).result.status, 400);
        assert.equal((await request('/finance/customer-mappings/manual', 'admin', input)).result.status, 409);
        const made = await request('/finance/customer-mappings/manual', 'creator', { ...input, customerCode: 'SYNTHETIC-HTTP' });
        assert.equal(made.result.status, 201); assert.deepEqual(Object.keys(made.body).sort(), ['id', 'version']);
        const blank = await request('/finance/customer-mappings/manual', 'admin', { customerCode: ' ' }); assert.equal(blank.result.status, 400);
    });
    await check('list and customer summary immediately include created rows; tenant/fields/OWN scopes remain enforced', async () => {
        const summary = await request('/finance/customer-mappings/summary');
        assert.equal(summary.result.status, 200);
        const list = await request('/table-filters/rows?resource=' + resource + '&search=SYNTHETIC-HTTP');
        assert.equal(list.result.status, 200); assert.equal(list.body.total, 1); assert.equal(list.body.rows[0].customerCode, 'SYNTHETIC-HTTP');
        assert.equal(summary.body.total, (await db.query("SELECT count(*)::int n FROM finance_customer_mappings WHERE tenant_id='KAINAN'"))[0].n);
        assert.equal((await queries.summary({ ...reader, tableDataScopes: [{ resource, scope: 'OWN', actions: ['read'] }] })).total, summary.body.total);
    });
    await check('full Excel exports every matching page in the same order/filter, without UUID/source, and intersects read/export scopes', async () => {
        for (let n = 0; n < 215; n++) await service.createManual({ ...input, customerCode: 'EXPORT-' + String(n).padStart(3, '0'), departmentCategory: n < 210 ? '业务二部' : '业务三部' }, actor);
        const filter = { logic: 'AND', rules: [{ field: 'departmentCategory', operator: 'eq', value: '业务二部' }] };
        const parameters = new URLSearchParams({ search: 'EXPORT-', filterGroup: JSON.stringify(filter), sortField: 'customerCode', sortOrder: 'desc' });
        const response = await request('/table-exports/' + resource + '?' + parameters), workbook = new Excel.Workbook();
        assert.equal(response.result.status, 200); await workbook.xlsx.load(response.body);
        const sheet = workbook.worksheets[0]; assert.equal(sheet.rowCount, 211); assert.equal(sheet.columnCount, 3);
        assert.deepEqual(sheet.getRow(1).values.slice(1), ['客户编号', '部门类别', '内外区分']);
        const expected = (await db.query("SELECT customer_code FROM finance_customer_mappings WHERE tenant_id='KAINAN' AND customer_code LIKE 'EXPORT-%' AND department_category='业务二部' ORDER BY customer_code DESC")).map(x => x.customer_code);
        assert.deepEqual(sheet.getColumn(1).values.slice(2), expected);
        assert.equal((await request('/table-exports/' + resource, 'reader')).result.status, 403);
        // This row matches export's department, but is outside read's code prefix.
        // It must never be included merely because the user has export permission.
        await service.createManual({ ...input, customerCode: 'OUTSIDE-READ', departmentCategory: '业务三部' }, actor);
        const allowed = { ...reader, permissions: [...reader.permissions.filter(p => p !== `${resource}:salesChannel:read`), `${resource}:*:export`], tableDataScopes: [
            { resource, scope: 'CUSTOM', actions: ['read'], rules: [{ fieldKey: 'customerCode', operator: 'STARTS_WITH', value: 'EXPORT-' }] },
            { resource, scope: 'CUSTOM', actions: ['export'], rules: [{ fieldKey: 'departmentCategory', operator: 'EQ', value: '业务三部' }] }
        ] };
        const restricted = new Excel.Workbook(); await restricted.xlsx.load(await exporter.exportXlsx(resource, {}, allowed));
        assert.equal(restricted.worksheets[0].rowCount, 6); assert.equal(restricted.worksheets[0].columnCount, 2);
    });
    if (process.env.FINANCE_MANUAL_BROWSER_BASE) {
        await check('actual Chrome creates against the isolated HTTP API and reloads rows/counts; production receives no writes', async () => {
            const { chromium, expect } = createRequire(root + '/apps/web/package.json')('@playwright/test');
            browser = await chromium.launch({ channel: 'chrome', headless: true });
            const session = { ...actor, id: actor.userId, displayName: actor.username, roles: [], mustChangePassword: false };
            const context = await browser.newContext({ baseURL: process.env.FINANCE_MANUAL_BROWSER_BASE, viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
            await context.addInitScript(user => { localStorage.setItem('accessToken', 'synthetic-isolated-session'); localStorage.setItem('sessionUser', JSON.stringify(user)); }, session);
            await context.route('**/api/v1/**', async route => {
                const req = route.request(), url = new URL(req.url());
                if (url.pathname === '/api/v1/auth/me') return route.fulfill({ json: session });
                if (url.pathname === '/api/v1/directory/users') return route.fulfill({ json: [{ id: actor.userId, displayName: actor.username, username: actor.username, enabled: true }] });
                if (/^\/api\/v1\/(finance\/customer-mappings|table-filters|table-exports)/.test(url.pathname)) {
                    const result = await fetch(base + url.pathname + url.search, { method: req.method(), headers: { 'x-test-actor': 'admin', 'content-type': 'application/json' }, body: req.postData() ?? undefined });
                    return route.fulfill({ status: result.status, contentType: result.headers.get('content-type') ?? 'application/json', body: Buffer.from(await result.arrayBuffer()) });
                }
                return route.fulfill({ status: req.method() === 'GET' ? 200 : 403, json: [] });
            });
            const page = await context.newPage(); await page.goto('/finance/base-data/customer-mappings');
            const before = (await queries.summary(actor)).total;
            await expect(page.getByText('客户总数 ' + before, { exact: true })).toBeVisible();
            await page.getByRole('button', { name: '新增客户', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: '新增客户' });
            await dialog.getByRole('button', { name: /^新\s*增$/ }).click();
            await expect(dialog.getByText('客户编号必填', { exact: true })).toBeVisible();
            await dialog.getByRole('textbox', { name: '客户编号' }).fill('  SYNTHETIC-CHROME  ');
            await dialog.getByRole('combobox', { name: '部门类别' }).click();
            await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^业务二部$/ }).click();
            await dialog.getByRole('combobox', { name: '内外区分' }).click();
            await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^外销$/ }).click();
            const [created] = await Promise.all([page.waitForResponse(x => x.url().endsWith('/finance/customer-mappings/manual') && x.request().method() === 'POST'), dialog.getByRole('button', { name: /^新\s*增$/ }).click()]);
            assert.equal(created.status(), 201); await expect(dialog).not.toBeVisible();
            await expect(page.getByText('客户总数 ' + (before + 1), { exact: true })).toBeVisible();
            const search = page.getByPlaceholder('搜索当前表格'); await search.fill('SYNTHETIC-CHROME'); await search.press('Enter');
            await expect(page.getByRole('cell', { name: 'SYNTHETIC-CHROME', exact: true })).toBeVisible();
            const saved = await row('SYNTHETIC-CHROME'); assert.equal(saved.source, 'MANUAL'); assert.equal(saved.department_category, '业务二部'); assert.equal(saved.sales_channel, '外销');
            await page.reload(); await page.getByRole('button', { name: '新增客户', exact: true }).click();
            await page.getByRole('dialog', { name: '新增客户' }).getByRole('textbox', { name: '客户编号' }).fill('SYNTHETIC-CHROME');
            await page.getByRole('dialog', { name: '新增客户' }).getByRole('button', { name: /^新\s*增$/ }).click();
            await expect(page.getByText('客户编号已存在，请返回列表修改已有客户分类', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: '返回列表修改', exact: true }).click();
            await expect(page.getByRole('dialog', { name: '新增客户' })).not.toBeVisible();
            await browser.close(); browser = null;
        });
    }
    console.log(JSON.stringify({ passed: checks.length, checks }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
    if (browser) await browser.close();
    if (http) await http.close();
    if (db?.isInitialized) await db.destroy();
    if (control._connected) { await control.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await control.end(); }
});
