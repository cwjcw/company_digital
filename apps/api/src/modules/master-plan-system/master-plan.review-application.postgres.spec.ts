import { fieldsFor,MASTER_PLAN_RESOURCE_MAP } from './master-plan.config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../../auth';
import { MasterPlanController } from './master-plan.controller';
import { ReviewDueDateController } from './review-due-date.controller';
import { MasterPlanLifecycleService } from './master-plan.lifecycle.service';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DataSource } from 'typeorm';
import { discoverMigrationFiles, phaseAMigrationFiles } from '../../migration-files';
import { MasterPlanApplicationService } from './master-plan.application.service';
import { MasterPlanSyncService } from './master-plan.sync.service';
import { MasterPlanDemandLinkService } from './master-plan.demand-link.service';
import { MasterPlanDemandQuantityService } from './master-plan.demand-quantity.service';
import { MasterPlanReviewApplicationService } from './master-plan.review-application.service';
import { ReviewDueDateApplicationService } from './review-due-date.application.service';
import { ReviewDueDateImportApplicationService } from './review-due-date-import.application.service';
import { MpsPlanLifecycle1722920120000 } from '../../migrations/1722920120000-MpsPlanLifecycle';
import type { MasterPlanActor } from './master-plan.types';
import { MasterPlanQueryService } from './master-plan.query.service';
import { MasterPlanOrderProgressService } from './master-plan.order-progress.service';
const integration = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET ? describe : describe.skip;
const tenant = 'REVIEW-R3-SYNTHETIC', user = '0199c000-0000-7000-8000-000000000001', division = '0199c000-0000-7000-8000-000000000002';
const actor = (): MasterPlanActor => ({ tenantId: tenant, userId: user, username: '合成评审用户', isSystemAdmin: true, permissions: ['*'], tableDataScopes: [], source: 'web', requestId: randomUUID() });
integration('round3: isolated full-chain + independent release B + optional120', () => {
    let db: DataSource, app: MasterPlanApplicationService, sync: MasterPlanSyncService, links: MasterPlanDemandLinkService, review: ReviewDueDateApplicationService, svc: MasterPlanReviewApplicationService, quantity: MasterPlanDemandQuantityService;
    const directory = { listEnabled: async () => [{ id: division, name: '事业三部', path: ['凯南', '事业三部'], pathLabel: '凯南/事业三部' }], resolve: () => ({ id: division, name: '事业三部' }) };
    const run = (k: string) => sync.run(tenant, k, 'MANUAL', user, '合成用户', randomUUID());
    async function fixture(q = 100, amounts = [60, 40]) {
        const item = 'SYN-' + randomUUID();
        const source = await app.create('mps-order-allocations', { divisionId: division, orderNumber: 'SYN-R3', itemCode: item, itemName: '合成品项', customerCode: 'SYN-CUSTOMER', allocatedQuantity: q, orderStatus: '已审核', orderDate: '2026-11-01' }, actor());
        const [parent] = await db.query('SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND item_code=$2', [tenant, item]);
        const bases = [];
        for (const qty of amounts)
            bases.push(await app.create('mps-base-plans', { divisionId: division, orderNumber: 'SYN-R3', itemCode: item, itemName: '合成品项', plannedQuantity: qty, latestCustomerDueDate: '2026-12-20', latestReviewDueDate: '2026-12-01', productAttribute: '五金', surfaceNature: '烤漆', manufacturingMethod: '自制' }, actor()));
        const r = await review.manualCreate({ divisionId: division, orderNumber: 'SYN-R3', batchNumber: '01', drawingNumber: item, inspectionTimeName: '合成品项', quantity: String(q), dueDate: '2026-12-20', inboundDate: '2026-12-10', commandId: randomUUID() }, actor());
        return { item, source, parent, bases, r };
    }
    async function prepare(f: any, ids: string[]) { const info = await svc.info(f.r.id, actor()); return { expectedReviewVersion: info.reviewVersion, targets: info.candidates.filter(c => ids.includes(c.id)).map(c => ({ baseId: c.id, expectedVersion: c.version })) }; }
    async function apply(f: any, ids: string[]) { const request = await prepare(f, ids), p = await svc.preview(f.r.id, request, actor()); expect(p.blockers).toEqual([]); const body = { ...request, previewHash: p.previewHash, idempotencyKey: randomUUID(), reason: '合成评审批次确认' }; return { body, result: await svc.confirm(f.r.id, body, actor()) }; }
    const rows = (table: string, where: string, params: unknown[]) => db.query(`SELECT * FROM ${table} WHERE ${where} ORDER BY id`, params);
    beforeAll(async () => {
        const socket = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!;
        if (!socket.endsWith('/test/mps_sync_reliability/pg_socket'))
            throw Error('Only isolated socket');
        const common = { type: 'postgres' as const, host: socket, username: 'postgres', entities: [], logging: false as const };
        const admin = new DataSource({ ...common, database: 'postgres' });
        await admin.initialize();
        try {
            await admin.query('DROP DATABASE IF EXISTS mps_review_round3_test WITH (FORCE)');
            await admin.query('CREATE DATABASE mps_review_round3_test');
        }
        finally {
            await admin.destroy();
        }
        const dir = path.join(__dirname, '../../migrations');
        db = new DataSource({ ...common, database: 'mps_review_round3_test', migrations: discoverMigrationFiles(dir).filter(f => Number(path.basename(f).slice(0, 13)) < 1722920118000) });
        await db.initialize();
        await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        expect(await db.runMigrations({ transaction: 'all' })).toHaveLength(117);
        const a = new DataSource({ ...db.options, migrations: phaseAMigrationFiles(dir) });
        await a.initialize();
        try {
            expect((await a.runMigrations()).map(r => r.name)).toEqual(['MpsSyncLeases1722920118000', 'MpsExecutionFactProtection1722920119000']);
        }
        finally {
            await a.destroy();
        }
        const env = { ...process.env, DATABASE_HOST: socket, DATABASE_PORT: '5432', DATABASE_USER: 'postgres', DATABASE_NAME: 'mps_review_round3_test', DATABASE_PASSWORD: '' };
        for (let i = 0; i < 2; i++) {
            const p = spawnSync(process.execPath, [path.join(__dirname, '../../..', 'dist/migrate-unified-core.js')], { env, encoding: 'utf8', timeout: 180000 });
            expect(p.status).toBe(0);
            const result = JSON.parse(p.stdout.trim().split('\n').at(-1)!);
            expect(result.applied).toEqual(i === 0 ? ['MpsDemandLinks1722920121000', 'MpsReviewBatchApplications1722920122000'] : []);
        }
        expect((await db.query('SELECT count(*)::int n FROM migrations WHERE timestamp=1722920120000'))[0].n).toBe(0);
        await db.query("INSERT INTO users(id,tenant_id,username,display_name,password_hash)VALUES($1,$2,'synthetic-review-r3','合成用户','invalid-synthetic-hash')", [user, tenant]);
        await db.query("INSERT INTO organization_units(id,name,level)VALUES($1,'事业三部',1)", [division]);
        for (const k of ['erp-orders', 'plan-projections', 'shipping-to-base', 'base-to-weekly', 'inbound-allocation', 'execution-rollup'])
            await db.query("INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)VALUES($1,$2,'合成任务',true,30,$3,$3)ON CONFLICT DO NOTHING", [tenant, k, user]);
        sync = new MasterPlanSyncService(db);
        app = new MasterPlanApplicationService(db, { processOutbox: async () => 0, refreshWeeklyExecution: sync.refreshWeeklyExecution.bind(sync) } as never);
        links = new MasterPlanDemandLinkService(db);
        quantity = new MasterPlanDemandQuantityService(db, links, app);
        review = new ReviewDueDateApplicationService(db, directory as never);
        svc = new MasterPlanReviewApplicationService(db, links);
    }, 180000);
    afterAll(async () => { if (db?.isInitialized)
        await db.destroy(); });
    it('releaseB has121/122 without120, API capability available and explicit candidates only', async () => { expect(await svc.availability(actor())).toEqual({ schemaReady: true, canApply: true }); const f = await fixture(); const info = await svc.info(f.r.id, actor()); expect(info.candidates).toHaveLength(2); expect(info.demandId).toBe(f.parent.id); expect(info.reviewDate).toBe('2026-12-10'); expect(info.candidates.every(b => b.deliveryNumber !== '01')).toBe(true); await expect(svc.preview(f.r.id, { expectedReviewVersion: 1, targets: [] }, actor())).rejects.toMatchObject({ status: 400 }); });
    it('new API starts without120 and exposes review capability and real application HTTP routes', async () => {
        process.env.KDOS_DEFAULT_TENANT_CODE = tenant;
        process.env.JWT_ACCESS_SECRET = 'isolated-round3-signing';
        const f = await fixture();
        const providers: Record<string, unknown> = { MasterPlanApplicationService: app, MasterPlanSyncService: sync, MasterPlanDemandLinkService: links, MasterPlanDemandQuantityService: quantity, MasterPlanLifecycleService: new MasterPlanLifecycleService(db), MasterPlanReviewApplicationService: svc, MasterPlanQueryService: new MasterPlanQueryService(db, directory as never), ReviewDueDateApplicationService: review };
        const tokens = [...new Set([...Reflect.getMetadata('design:paramtypes', MasterPlanController), ...Reflect.getMetadata('design:paramtypes', ReviewDueDateController)])];
        const mod = await Test.createTestingModule({ controllers: [MasterPlanController, ReviewDueDateController], providers: tokens.map((token: any) => ({ provide: token, useValue: providers[token.name] ?? {} })) }).overrideGuard(AuthGuard).useValue({ canActivate: (ctx: any) => { ctx.switchToHttp().getRequest().user = { sub: user, isSystemAdmin: true, permissions: ['*'], tableDataScopes: [] }; return true; } }).compile();
        const http = mod.createNestApplication({ logger: false });
        await http.init();
        try {
            const meta = await request(http.getHttpServer()).get('/master-plan-system/resources/mps-review-due-dates/meta');
            expect(meta.status).toBe(200);
            expect(meta.body.reviewApplications).toEqual({ schemaReady: true, canApply: true });
            const info = await request(http.getHttpServer()).get(`/master-plan-system/review-due-dates/${f.r.id}/applications`);
            expect(info.status).toBe(200);
            expect(info.body.demandId).toBe(f.parent.id);
            const p = await request(http.getHttpServer()).post(`/master-plan-system/review-due-dates/${f.r.id}/applications/preview`).send(await prepare(f, [f.bases[0].id]));
            expect(p.status).toBe(201);
            expect(p.body.allowed).toBe(true);
        }
        finally {
            await http.close();
        }
    });
    it('normal source→demand→base→weekly→tasks→real report and production progress', async () => {
        const f = await fixture(100, []);
        expect((await run('plan-projections')).status).toBe('SUCCESS');
        expect((await run('shipping-to-base')).status).toBe('SUCCESS');
        const [b] = await db.query('SELECT * FROM mps_base_plans WHERE monthly_plan_id=$1', [f.parent.id]);
        expect(b.monthly_plan_id).toBe(f.parent.id);
        await app.update('mps-base-plans', b.id, { expectedVersion: b.version, latestReviewDueDate: '2026-12-01', latestCustomerDueDate: '2026-12-20', productAttribute: '五金', surfaceNature: '烤漆', manufacturingMethod: '自制' }, actor());
        expect((await run('base-to-weekly')).status).toBe('SUCCESS');
        const [w] = await db.query('SELECT * FROM mps_weekly_plans WHERE base_plan_id=$1', [b.id]);
        expect((await db.query('SELECT count(*)::int n FROM mps_weekly_process_plans WHERE weekly_plan_id=$1', [w.id]))[0].n).toBe(10);
        await app.create('mps-process-reports', { weeklyPlanId: w.id, processCode: 'cutting', productionDate: '2026-11-06', productionQuantity: 3 }, actor());
        expect((await run('execution-rollup')).status).toBe('SUCCESS');
        const report = (await db.query('SELECT * FROM mps_process_reports WHERE weekly_plan_id=$1', [w.id]))[0];
        expect(report.weekly_plan_id).toBe(w.id);
        expect(report.order_number).toBe('SYN-R3');
        const progress = await new MasterPlanOrderProgressService(db, new MasterPlanQueryService(db, directory as never)).page({ itemCodes: [f.item] }, actor(), 'items');
        expect(progress.rows).toHaveLength(1);
        expect(progress.rows[0]).toMatchObject({ cuttingReportedQuantity: '3.0000', requiredQuantity: '100.0000' });
    });
    it('review v1 only affects B1; locked structure, reports, B2 base/week/tasks entirely unchanged; v2 pending and immutable old application', async () => {
        const f = await fixture();
        await run('base-to-weekly');
        const [w1] = await db.query('SELECT * FROM mps_weekly_plans WHERE base_plan_id=$1', [f.bases[0].id]), [w2] = await db.query('SELECT * FROM mps_weekly_plans WHERE base_plan_id=$1', [f.bases[1].id]);
        await app.create('mps-process-reports', { weeklyPlanId: w1.id, processCode: 'cutting', productionDate: '2026-11-06', productionQuantity: 5 }, actor());
        const facts = await rows('mps_process_reports', 'weekly_plan_id=$1', [w1.id]), structure = await db.query('SELECT id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans WHERE weekly_plan_id=$1 ORDER BY id', [w1.id]);
        // Deliberate legal manual weekly override in unselected B2 must survive a scoped event.
        await db.query("UPDATE mps_weekly_plans SET latest_review_due_date='2026-12-02' WHERE id=$1", [w2.id]);
        const b2 = await rows('mps_base_plans', 'id=$1', [f.bases[1].id]), otherWeek = await rows('mps_weekly_plans', 'id=$1', [w2.id]), otherTasks = await rows('mps_weekly_process_plans', 'weekly_plan_id=$1', [w2.id]);
        const { body, result } = await apply(f, [f.bases[0].id]);
        expect(result.syncStatus).toBe('PENDING');
        expect(await svc.confirm(f.r.id, body, actor())).toMatchObject({ repeated: true, applicationIds: result.applicationIds });
        await db.query("UPDATE mps_reconciliation_outbox SET next_attempt_at=now()+interval '1 day' WHERE id<>$1", [result.outboxId]);
        await sync.processOutbox();
        expect(await svc.status(f.r.id, result.outboxId!, actor())).toMatchObject({ status: 'SUCCESS' });
        expect(await rows('mps_base_plans', 'id=$1', [f.bases[1].id])).toEqual(b2);
        expect(await rows('mps_weekly_plans', 'id=$1', [w2.id])).toEqual(otherWeek);
        expect(await rows('mps_weekly_process_plans', 'weekly_plan_id=$1', [w2.id])).toEqual(otherTasks);
        expect(await rows('mps_process_reports', 'weekly_plan_id=$1', [w1.id])).toEqual(facts);
        expect(await db.query('SELECT id,process_code,sequence,cycle_days,execution_enabled FROM mps_weekly_process_plans WHERE weekly_plan_id=$1 ORDER BY id', [w1.id])).toEqual(structure);
        const first = await rows('mps_review_base_plan_links', 'review_id=$1', [f.r.id]);
        const info = await svc.info(f.r.id, actor());
        await review.manualEdit(f.r.id, { expectedVersion: info.reviewVersion, commandId: randomUUID(), inboundDate: '2026-12-15' }, actor());
        expect((await svc.info(f.r.id, actor())).candidates[0].pending).toBe(true);
        expect((await db.query('SELECT latest_review_due_date::text d,latest_customer_due_date::text c FROM mps_base_plans WHERE id=$1', [f.bases[0].id]))[0]).toEqual({ d: '2026-12-10', c: '2026-12-20' });
        await apply(f, [f.bases[0].id]);
        const history = await rows('mps_review_base_plan_links', 'review_id=$1', [f.r.id]);
        expect(history).toHaveLength(2);
        expect(history[0]).toEqual(first[0]);
        expect((await svc.info(f.r.id, actor())).history.map(h => h.reviewVersion).sort()).toEqual([1, 2]);
    });
    it('multi-batch demand increase20 stays explicit; application never modifies quantity or reports', async () => {
        const f = await fixture();
        await run('base-to-weekly');
        const weeks = await rows('mps_weekly_plans', 'base_plan_id=ANY($1::uuid[])', [f.bases.map(b => b.id)]);
        for (const w of weeks)
            await app.create('mps-process-reports', { weeklyPlanId: w.id, processCode: 'cutting', productionDate: '2026-11-06', productionQuantity: 2 }, actor());
        const factsBefore = await rows('mps_process_reports', 'weekly_plan_id=ANY($1::uuid[])', [weeks.map((w: any) => w.id)]);
        await app.update('mps-order-allocations', f.source.id, { expectedVersion: f.source.version, allocatedQuantity: 120 }, actor());
        await run('plan-projections');
        expect((await quantity.read(f.parent.id, actor())).unallocated).toBe('20.0000');
        const s = await quantity.read(f.parent.id, actor()), r = { operation: 'INCREASE' as const, quantity: '20', targetId: f.bases[0].id, expectedDemandVersion: s.demandVersion, expectedVersions: Object.fromEntries(s.batches.map(b => [b.id, b.version])) }, p = await quantity.preview(f.parent.id, r, actor());
        await quantity.confirm(f.parent.id, { ...r, previewHash: p.previewHash, idempotencyKey: randomUUID(), reason: '合成明确增加20' }, actor());
        await apply(f, [f.bases[1].id]);
        expect((await quantity.read(f.parent.id, actor())).batches.map(b => b.quantity).sort()).toEqual(['40.0000', '80.0000']);
        expect(await rows('mps_process_reports', 'weekly_plan_id=ANY($1::uuid[])', [weeks.map((w: any) => w.id)])).toEqual(factsBefore);
    });
    it('two explicit targets, separate application evidence and one durable scope; same version repeat never duplicates', async () => { const f = await fixture(); const { result } = await apply(f, f.bases.map(b => b.id)); expect(result.applicationIds).toHaveLength(2); const [o] = await db.query('SELECT scope_json FROM mps_reconciliation_outbox WHERE id=$1', [result.outboxId]); expect(o.scope_json.basePlanIds.sort()).toEqual(f.bases.map(b => b.id).sort()); expect((await apply(f, f.bases.map(b => b.id))).result).toMatchObject({ outboxId: null, syncStatus: 'NO_CHANGE' }); expect(await rows('mps_review_base_plan_links', 'review_id=$1', [f.r.id])).toHaveLength(2); });
    it('immutable evidence/identity and Excel stable-ID update; no broadcast or rebuilding', async () => {
        const f = await fixture();
        await apply(f, [f.bases[0].id]);
        await expect(db.query('DELETE FROM mps_review_base_plan_links WHERE review_id=$1', [f.r.id])).rejects.toMatchObject({ code: '23514' });
        await expect(db.query("UPDATE mps_review_base_plan_links SET applied_date='2026-12-30' WHERE review_id=$1", [f.r.id])).rejects.toMatchObject({ code: '23514' });
        await expect(review.manualEdit(f.r.id, { expectedVersion: 1, commandId: randomUUID(), batchNumber: '02' }, actor())).rejects.toMatchObject({ status: 409 });
        const imports = new ReviewDueDateImportApplicationService(directory as never, db);
        const before = await rows('mps_base_plans', 'monthly_plan_id=$1', [f.parent.id]);
        await db.transaction(m => imports.confirm([{ row: 2, id: f.r.id, expectedVersion: 1, values: { inboundDate: '2026-12-18' } }] as never, 'STANDARD', 'a'.repeat(64), randomUUID(), actor(), m));
        expect((await svc.info(f.r.id, actor())).reviewVersion).toBe(2);
        expect(await rows('mps_base_plans', 'monthly_plan_id=$1', [f.parent.id])).toEqual(before);
    });
    it('stale preview, cross-demand selection, permission loss and cross-tenant are rejected atomically', async () => { const f = await fixture(), g = await fixture(), request = await prepare(f, [f.bases[0].id]), p = await svc.preview(f.r.id, request, actor()); await review.manualEdit(f.r.id, { expectedVersion: 1, commandId: randomUUID(), quantity: '99' }, actor()); await expect(svc.confirm(f.r.id, { ...request, previewHash: p.previewHash, idempotencyKey: randomUUID(), reason: 'stale' }, actor())).rejects.toMatchObject({ status: 409 }); await expect(svc.preview(f.r.id, { expectedReviewVersion: 2, targets: [{ baseId: g.bases[0].id, expectedVersion: 1 }] }, actor())).rejects.toMatchObject({ status: 403 }); await expect(svc.info(f.r.id, { ...actor(), tenantId: 'OTHER-SYNTHETIC' })).rejects.toMatchObject({ status: 404 }); await expect(svc.info(f.r.id, { ...actor(), isSystemAdmin: false, permissions: [] })).rejects.toMatchObject({ status: 403 }); expect(await rows('mps_review_base_plan_links', 'review_id=$1', [f.r.id])).toEqual([]); });
    it('competing workers cannot duplicate applications or silently replace another review owner', async () => { const f = await fixture(), r = await prepare(f, [f.bases[0].id]), p = await svc.preview(f.r.id, r, actor()); const results = await Promise.allSettled([1, 2].map(() => svc.confirm(f.r.id, { ...r, previewHash: p.previewHash, idempotencyKey: randomUUID(), reason: 'concurrent' }, actor()))); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(await rows('mps_review_base_plan_links', 'review_id=$1', [f.r.id])).toHaveLength(1); const other = await review.manualCreate({ divisionId: division, orderNumber: 'SYN-R3', batchNumber: '02', drawingNumber: f.item, quantity: '100', dueDate: '2026-12-20', inboundDate: '2026-12-12', commandId: randomUUID() }, actor()); expect((await svc.preview(other.id, { expectedReviewVersion: 1, targets: [{ baseId: f.bases[0].id, expectedVersion: (await rows('mps_base_plans', 'id=$1', [f.bases[0].id]))[0].version }] }, actor())).allowed).toBe(false); });
    it('missing demand and null latest date never fall back to batch numbers, dueDate or warehouse date', async () => { const r = await review.manualCreate({ divisionId: division, orderNumber: 'SYN-UNLINKED', batchNumber: '001', drawingNumber: 'SYN-NO-PARENT', quantity: '10', dueDate: '2026-12-20', commandId: randomUUID() }, actor()); expect(await svc.info(r.id, actor())).toMatchObject({ demandId: null, reviewDate: null, candidates: [], canApply: false }); });
    it('malformed scoped events fail and never become full-tenant runs', async () => { await expect(sync.run(tenant, 'base-to-weekly', 'MANUAL', user, 'synthetic', randomUUID(), { basePlanIds: [] })).rejects.toMatchObject({ status: 409 });await expect(sync.run(tenant,'base-to-weekly','MANUAL',user,'synthetic',randomUUID(),{basePlanIds:['-'.repeat(36)]})).rejects.toMatchObject({status:409}); });
    it('scoped admission failure is BLOCKED, not SUCCESS; safe retry really runs after repair', async () => {
        const f = await fixture();
        await db.query('UPDATE mps_base_plans SET product_attribute=NULL WHERE id=$1', [f.bases[0].id]);
        const { result } = await apply(f, [f.bases[0].id]);
        await db.query("UPDATE mps_reconciliation_outbox SET next_attempt_at=now()+interval '1 day' WHERE id<>$1", [result.outboxId]);
        await sync.processOutbox();
        expect(await svc.status(f.r.id, result.outboxId!, actor())).toMatchObject({ status: 'FAILED',last_error:expect.stringContaining('BLOCKED') });
        await db.query("UPDATE mps_base_plans SET product_attribute='五金' WHERE id=$1", [f.bases[0].id]);
        await db.query('UPDATE mps_reconciliation_outbox SET next_attempt_at=now() WHERE id=$1', [result.outboxId]);
        await sync.processOutbox();
        expect(await svc.status(f.r.id, result.outboxId!, actor())).toMatchObject({ status: 'SUCCESS' });
        expect(await rows('mps_weekly_plans', 'base_plan_id=$1', [f.bases[0].id])).toHaveLength(1);
    });
    it('NONE, other division, hidden target field and read-only actors never obtain or apply candidates', async () => {
        const f = await fixture(), permissions=['mps-review-due-dates','mps-base-plans','mps-monthly-plans'].flatMap(r=>[...['read','update'].map(k=>`${r}:*:${k}`),...fieldsFor(MASTER_PLAN_RESOURCE_MAP.get(r as never)!).flatMap(f=>['read','update'].map(k=>`${r}:${f.key}:${k}`))]), nonAdmin = { ...actor(), isSystemAdmin: false,permissions,tableDataScopes:['mps-review-due-dates','mps-base-plans','mps-monthly-plans'].map(resource=>({resource,scope:'ALL'})) };
        await expect(svc.info(f.r.id, { ...nonAdmin, tableDataScopes: [{ resource: 'mps-review-due-dates', scope: 'NONE' }] })).rejects.toMatchObject({ status: 404 });
        await expect(svc.info(f.r.id, { ...nonAdmin, tableDataScopes: [{ resource: 'mps-review-due-dates', scope: 'CUSTOM', rules: [{ fieldKey: 'divisionId', operator: 'EQ', value: randomUUID() }] }] })).rejects.toMatchObject({ status: 404 });
        await expect(svc.info(f.r.id, { ...nonAdmin, permissions: ['mps-review-due-dates:*:read', 'mps-base-plans:*:read', 'mps-monthly-plans:*:read'] })).rejects.toMatchObject({ status: 403 });
        const fieldActor = { ...nonAdmin, permissions: permissions.filter(p => p !== 'mps-base-plans:latestReviewDueDate:update') };
        await expect(svc.info(f.r.id, fieldActor)).rejects.toMatchObject({ status: 403 });
    });
    it('updated dates must still satisfy both read and update data scopes',async()=>{
        const f=await fixture(),permissions=['mps-review-due-dates','mps-base-plans','mps-monthly-plans'].flatMap(r=>[...['read','update'].map(k=>`${r}:*:${k}`),...fieldsFor(MASTER_PLAN_RESOURCE_MAP.get(r as never)!).flatMap(f=>['read','update'].map(k=>`${r}:${f.key}:${k}`))]);
        const employee={...actor(),isSystemAdmin:false,permissions,tableDataScopes:[{resource:'mps-review-due-dates',scope:'ALL'},{resource:'mps-monthly-plans',scope:'ALL'},{resource:'mps-base-plans',scope:'CUSTOM',rules:[{fieldKey:'latestReviewDueDate',operator:'LT',value:'2026-12-05'}]}]};
        expect((await svc.info(f.r.id,employee)).candidates).toHaveLength(2);await expect(svc.preview(f.r.id,await prepare(f,[f.bases[0].id]),employee)).rejects.toMatchObject({status:403});expect(await rows('mps_review_base_plan_links','review_id=$1',[f.r.id])).toEqual([]);
    });
    it('audit failure rolls back selected dates, applications and queue atomically', async () => {
        const f = await fixture(), r = await prepare(f, [f.bases[0].id]), p = await svc.preview(f.r.id, r, actor()), before = await rows('mps_base_plans', 'monthly_plan_id=$1', [f.parent.id]);
        await db.query("CREATE FUNCTION synthetic_reject_review_audit() RETURNS trigger AS $$ BEGIN IF NEW.action='review.batch_applied' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF;RETURN NEW;END;$$ LANGUAGE plpgsql;CREATE TRIGGER synthetic_review_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION synthetic_reject_review_audit()");
        try {
            await expect(svc.confirm(f.r.id, { ...r, previewHash: p.previewHash, idempotencyKey: randomUUID(), reason: 'synthetic rollback' }, actor())).rejects.toThrow();
        }
        finally {
            await db.query('DROP TRIGGER synthetic_review_audit ON audit_logs;DROP FUNCTION synthetic_reject_review_audit()');
        }
        expect(await rows('mps_base_plans', 'monthly_plan_id=$1', [f.parent.id])).toEqual(before);
        expect(await rows('mps_review_base_plan_links', 'review_id=$1', [f.r.id])).toEqual([]);
        expect(await rows('mps_reconciliation_outbox', "record_id=$1 AND resource='mps-review-due-dates'", [f.r.id])).toEqual([]);
    });
    it('late120 DDL is compatible, legacy cannot apply even with lifecycle writes enabled', async () => { const f = await fixture(); const migration = new DataSource({ ...db.options, migrations: [MpsPlanLifecycle1722920120000] }); await migration.initialize(); try {
        expect((await migration.runMigrations()).map(r => r.name)).toEqual(['MpsPlanLifecycle1722920120000']);
    }
    finally {
        await migration.destroy();
    } process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED = 'true'; expect((await svc.preview(f.r.id, await prepare(f, [f.bases[0].id]), actor())).allowed).toBe(false); delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED; const blocked = spawnSync(process.execPath, [path.join(__dirname, '../../..', 'dist/migrate-unified-core.js')], { env: { ...process.env, DATABASE_HOST: process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!, DATABASE_PORT: '5432', DATABASE_USER: 'postgres', DATABASE_NAME: 'mps_review_round3_test', DATABASE_PASSWORD: '' }, encoding: 'utf8' }); expect(blocked.status).toBe(1); });
    it('release B failure is transactionally recoverable;122 also installs after120 in a different database', async () => {
        const common = { type: 'postgres' as const, host: process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!, username: 'postgres', entities: [], logging: false as const };
        const admin = new DataSource({ ...common, database: 'postgres' });
        await admin.initialize();
        try {
            await admin.query('DROP DATABASE IF EXISTS mps_review_recovery_test WITH (FORCE)');
            await admin.query('CREATE DATABASE mps_review_recovery_test');
        }
        finally {
            await admin.destroy();
        }
        const other = new DataSource({ ...common, database: 'mps_review_recovery_test', migrations: discoverMigrationFiles(path.join(__dirname, '../../migrations')).filter(f => Number(path.basename(f).slice(0, 13)) <= 1722920119000) });
        await other.initialize();
        try {
            await other.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
            expect(await other.runMigrations({ transaction: 'all' })).toHaveLength(119);
            await other.query("CREATE FUNCTION mps_guard_review_application() RETURNS trigger AS $$ BEGIN RETURN NEW;END;$$ LANGUAGE plpgsql");
            const cli = () => spawnSync(process.execPath, [path.join(__dirname, '../../..', 'dist/migrate-unified-core.js')], { env: { ...process.env, DATABASE_HOST: common.host, DATABASE_PORT: '5432', DATABASE_USER: 'postgres', DATABASE_NAME: 'mps_review_recovery_test', DATABASE_PASSWORD: '' }, encoding: 'utf8' });
            expect(cli().status).toBe(1);
            expect((await other.query('SELECT count(*)::int n FROM migrations'))[0].n).toBe(119);
            expect((await other.query("SELECT to_regclass('mps_review_base_plan_links') ready"))[0].ready).toBeNull();
            expect((await other.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='mps_base_plans' AND column_name='monthly_plan_id'"))[0].n).toBe(0);
            await other.query('DROP FUNCTION mps_guard_review_application()');
            expect(cli().status).toBe(0);expect((await other.query('SELECT count(*)::int n FROM migrations'))[0].n).toBe(121);
            // Independent reverse-order schema, not a destructive downgrade of the recovered database.
            const admin2=new DataSource({...common,database:'postgres'});await admin2.initialize();try{await admin2.query('DROP DATABASE IF EXISTS mps_review_after120_test WITH (FORCE)');await admin2.query('CREATE DATABASE mps_review_after120_test');}finally{await admin2.destroy();}
            const reverse=new DataSource({...common,database:'mps_review_after120_test',migrations:discoverMigrationFiles(path.join(__dirname,'../../migrations')).filter(f=>Number(path.basename(f).slice(0,13))<=1722920120000)});await reverse.initialize();try{await reverse.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');expect(await reverse.runMigrations({transaction:'all'})).toHaveLength(120);}finally{await reverse.destroy();}
            // Different ordering: optional120 first, then actual121 and122. Only synthetic DB.
            const later = new DataSource({ ...common, database: 'mps_review_after120_test', migrations: discoverMigrationFiles(path.join(__dirname, '../../migrations')).filter(f => Number(path.basename(f).slice(0, 13)) >= 1722920121000) });
            await later.initialize();
            try {
                expect((await later.runMigrations({ transaction: 'all' })).map(r => r.name)).toEqual(['MpsDemandLinks1722920121000', 'MpsReviewBatchApplications1722920122000', 'MpsDemandLinkServiceAuth1722920122500']);
                expect(await new MasterPlanReviewApplicationService(later,new MasterPlanDemandLinkService(later)).availability(actor())).toMatchObject({schemaReady:true});
            }
            finally {
                await later.destroy();
            }
            expect(await new MasterPlanReviewApplicationService(other, new MasterPlanDemandLinkService(other)).availability(actor())).toMatchObject({ schemaReady: true });
        }
        finally {
            await other.destroy();
        }
    }, 180000);
});
