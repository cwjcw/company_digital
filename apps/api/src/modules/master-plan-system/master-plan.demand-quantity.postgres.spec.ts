import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { entities, Role, Permission, PermissionGroupSubject } from '../../entities';
import { TablePermissionGroupApplicationService } from '../admin/table-permission-group.application.service';
import { discoverMigrationFiles } from '../../migration-files';
import { MasterPlanDemandQuantityService } from './master-plan.demand-quantity.service';
import { MasterPlanDemandLinkService } from './master-plan.demand-link.service';
import { MasterPlanApplicationService } from './master-plan.application.service';
import { MasterPlanSyncService } from './master-plan.sync.service';
import type { MasterPlanActor } from './master-plan.types';
import type { MpsQuantityOperation, MpsQuantityRequest } from '@kdos/contracts';
import { MpsPlanLifecycle1722920120000 } from '../../migrations/1722920120000-MpsPlanLifecycle';
import { reconcileMonthlyBasePlans } from './master-plan.monthly-base';
const integration = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET ? describe : describe.skip;
const tenant = 'QUANTITY-SYNTHETIC', user = '0199bf00-0000-7000-8000-000000000001', division = '0199bf00-0000-7000-8000-000000000002';
const actor = (): MasterPlanActor => ({ tenantId: tenant, userId: user, username: '合成数量用户', permissions: ['*'], tableDataScopes: [], isSystemAdmin: true, requestId: randomUUID(), source: 'web' });
integration('round2 real isolated PG quantity commands (119+121 without120, then late120)', () => {
    let db: DataSource, app: MasterPlanApplicationService, sync: MasterPlanSyncService, svc: MasterPlanDemandQuantityService;
    const run = (key: string) => sync.run(tenant, key, 'MANUAL', user, '合成用户', randomUUID());
    async function fixture(required = 100, quantities = [60, 40]) {
        const item = `SYN-${randomUUID()}`;
        await app.create('mps-order-allocations', { divisionId: division, orderNumber: 'SYN-ORDER', itemCode: item, itemName: '合成品项', customerCode: 'SYN-CUSTOMER', allocatedQuantity: required, orderStatus: '已审核', orderDate: '2026-11-01' }, actor());
        const bases = [];
        for (const q of quantities)
            bases.push(await app.create('mps-base-plans', { divisionId: division, orderNumber: 'SYN-ORDER', itemCode: item, itemName: '合成品项', plannedQuantity: q, latestCustomerDueDate: '2026-12-20', latestReviewDueDate: '2026-12-01', productAttribute: '五金', surfaceNature: '烤漆', manufacturingMethod: '自制' }, actor()));
        const [parent] = await db.query('SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND item_code=$2', [tenant, item]);
        return { item, parent, bases };
    }
    async function request(id: string, operation: MpsQuantityOperation, quantity: string, sourceId?: string, targetId?: string) { const s = await svc.read(id, actor()); return { operation, quantity, sourceId, targetId, expectedDemandVersion: s.demandVersion, expectedVersions: Object.fromEntries(s.batches.map(b => [b.id, b.version])) } satisfies MpsQuantityRequest; }
    async function execute(id: string, r: MpsQuantityRequest) { const preview = await svc.preview(id, r, actor()); expect(preview.blockers).toEqual([]); expect(preview.allowed).toBe(true); const body = { ...r, previewHash: preview.previewHash, idempotencyKey: randomUUID(), reason: '合成数量核对确认' }; return { body, result: await svc.confirm(id, body, actor()) }; }
    beforeAll(async () => {
        const socket = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!;
        if (!socket.endsWith('/test/mps_sync_reliability/pg_socket'))
            throw Error('Only isolated network-none socket');
        const common = { type: 'postgres' as const, host: socket, username: 'postgres', entities, logging: false as const };
        const admin = new DataSource({ ...common, database: 'postgres' });
        await admin.initialize();
        try {
            await admin.query('DROP DATABASE IF EXISTS mps_quantity_round2_test WITH (FORCE)');
            await admin.query('CREATE DATABASE mps_quantity_round2_test');
        }
        finally {
            await admin.destroy();
        }
        db = new DataSource({ ...common, database: 'mps_quantity_round2_test', migrations: discoverMigrationFiles(path.join(__dirname, '../../migrations')).filter(f => !path.basename(f).startsWith('1722920120000')) });
        await db.initialize();
        await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await db.runMigrations({ transaction: 'all' });
        await db.query("INSERT INTO users(id,tenant_id,username,display_name,password_hash)VALUES($1,$2,'synthetic-quantity','合成用户','invalid-synthetic-hash')", [user, tenant]);
        await db.query("INSERT INTO organization_units(id,name,level)VALUES($1,'事业三部',1)", [division]);
        for (const key of ['erp-orders', 'plan-projections', 'shipping-to-base', 'base-to-weekly', 'inbound-allocation', 'execution-rollup'])
            await db.query("INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,created_by,updated_by)VALUES($1,$2,'合成任务',true,30,$3,$3)ON CONFLICT DO NOTHING", [tenant, key, user]);
        sync = new MasterPlanSyncService(db);
        app = new MasterPlanApplicationService(db, { processOutbox: async () => 0, refreshWeeklyExecution: sync.refreshWeeklyExecution.bind(sync) } as never);
        svc = new MasterPlanDemandQuantityService(db, new MasterPlanDemandLinkService(db), app);
    }, 180000);
    afterAll(async () => { if (db?.isInitialized)
        await db.destroy(); });
    it('100=60+40 exact gap zero, all IDs confirmed', async () => { const f = await fixture(); expect(await svc.read(f.parent.id, actor())).toMatchObject({ required: '100.0000', allocated: '100.0000', unallocated: '0.0000', trusted: true }); });
    it('120 preserves original60+40, explicit20 existing and durable queue, idempotent replay', async () => { const f = await fixture(120); const before = await svc.read(f.parent.id, actor()); expect(before.unallocated).toBe('20.0000'); const r = await request(f.parent.id, 'INCREASE', '20', undefined, f.bases[0].id); const { body, result } = await execute(f.parent.id, r); expect(result.syncStatus).toBe('PENDING'); expect(await svc.confirm(f.parent.id, body, actor())).toMatchObject({ repeated: true, batchIds: result.batchIds }); expect((await svc.read(f.parent.id, actor())).unallocated).toBe('0.0000'); expect((await svc.read(f.parent.id, actor())).batches.map(b => b.quantity).sort()).toEqual(['40.0000', '80.0000']); expect(await svc.status(f.parent.id, result.outboxId, actor())).toMatchObject({ status: 'PENDING' }); });
    it('120 explicitly adds independent20, no repeated batch', async () => { const f = await fixture(120); const { body } = await execute(f.parent.id, await request(f.parent.id, 'NEW', '20', f.bases[0].id)); await svc.confirm(f.parent.id, body, actor()); const s = await svc.read(f.parent.id, actor()); expect(s.batches).toHaveLength(3); expect(s.unallocated).toBe('0.0000'); expect(s.batches.map(b => b.quantity).sort()).toEqual(['20.0000', '40.0000', '60.0000']); });
    it('80 shows20 excess; explicit unexecuted reduction preserves original batch', async () => { const f = await fixture(80); expect((await svc.read(f.parent.id, actor())).overallocated).toBe('20.0000'); await execute(f.parent.id, await request(f.parent.id, 'REDUCE', '20', f.bases[0].id)); expect((await svc.read(f.parent.id, actor())).overallocated).toBe('0.0000'); });
    it('partial safe split and merge preserve IDs, history and total100', async () => { const f = await fixture(); await execute(f.parent.id, await request(f.parent.id, 'SPLIT', '20', f.bases[0].id)); let s = await svc.read(f.parent.id, actor()); expect(s.batches).toHaveLength(3); expect(s.allocated).toBe('100.0000'); await execute(f.parent.id, await request(f.parent.id, 'MERGE', '10', f.bases[1].id, f.bases[0].id)); s = await svc.read(f.parent.id, actor()); expect(s.batches).toHaveLength(3); expect(s.batches.find(b => b.id === f.bases[1].id)?.quantity).toBe('30.0000'); expect(s.allocated).toBe('100.0000'); });
    it('rejects removing entire source, stale preview, key mutation and over-allocation', async () => { const f = await fixture(120); const r = await request(f.parent.id, 'INCREASE', '20', undefined, f.bases[0].id), p = await svc.preview(f.parent.id, r, actor()); await app.update('mps-base-plans', f.bases[0].id, { expectedVersion: f.bases[0].version, plannedQuantity: 61 }, actor()); await expect(svc.confirm(f.parent.id, { ...r, previewHash: p.previewHash, idempotencyKey: randomUUID(), reason: 'stale' }, actor())).rejects.toMatchObject({ status: 409 }); expect((await svc.preview(f.parent.id, await request(f.parent.id, 'SPLIT', '40', f.bases[1].id), actor())).allowed).toBe(false); expect((await svc.preview(f.parent.id, await request(f.parent.id, 'INCREASE', '21', undefined, f.bases[1].id), actor())).allowed).toBe(false); });
    it('same preview concurrent20 cannot double allocate', async () => { const f = await fixture(120); const r = await request(f.parent.id, 'INCREASE', '20', undefined, f.bases[0].id), p = await svc.preview(f.parent.id, r, actor()); const results = await Promise.allSettled([1, 2].map(() => svc.confirm(f.parent.id, { ...r, previewHash: p.previewHash, idempotencyKey: randomUUID(), reason: 'concurrent' }, actor()))); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect((await svc.read(f.parent.id, actor())).allocated).toBe('120.0000'); });
    it('new unallocated demand can create its first batch with ordinary typed fields; unknown properties are rejected',async()=>{
      const f=await fixture(20,[]);const r={...await request(f.parent.id,'NEW','20'),newBatchValues:{latestCustomerDueDate:'2026-12-20',latestReviewDueDate:'2026-12-01',productAttribute:'五金',surfaceNature:'烤漆',manufacturingMethod:'自制'}};
      await execute(f.parent.id,r);expect(await svc.read(f.parent.id,actor())).toMatchObject({allocated:'20.0000',unallocated:'0.0000'});
      expect(()=>app.quantityBatchContext({deliveryNumber:'999'},actor())).toThrow('仅允许');expect(()=>app.quantityBatchContext({latestReviewDueDate:'2026-02-30'},actor())).toThrow('日期格式无效');
    });
    it('100 demand increases to120 via official source edit, projections preserve60+40 and explicit20 sync preserves actual reports', async()=>{
        const f=await fixture();const [a]=await db.query('SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND item_code=$2',[tenant,f.item]);
        await app.update('mps-order-allocations',a.id,{expectedVersion:a.version,allocatedQuantity:120},actor());
        expect((await run('plan-projections')).status).toBe('SUCCESS');expect((await run('shipping-to-base')).status).toBe('SUCCESS');
        expect((await svc.read(f.parent.id,actor())).batches.map(b=>b.quantity).sort()).toEqual(['40.0000','60.0000']);
        await run('base-to-weekly');const [w]=await db.query('SELECT * FROM mps_weekly_plans WHERE base_plan_id=$1',[f.bases[0].id]);
        await app.create('mps-process-reports',{weeklyPlanId:w.id,processCode:'cutting',productionDate:'2026-11-06',productionQuantity:3},actor());
        const before=await db.query('SELECT * FROM mps_process_reports WHERE weekly_plan_id=$1 ORDER BY id',[w.id]);
        await execute(f.parent.id,await request(f.parent.id,'INCREASE','20',undefined,f.bases[0].id));
        expect((await run('base-to-weekly')).status).toBe('SUCCESS');
        expect(await db.query('SELECT * FROM mps_process_reports WHERE weekly_plan_id=$1 ORDER BY id',[w.id])).toEqual(before);
        expect((await db.query('SELECT planned_quantity::text q FROM mps_weekly_plans WHERE id=$1',[w.id]))[0].q).toBe('80.0000');
    });
    it('quantity outbox reports downstream failure and verified retry independently from saved command',async()=>{
        const f=await fixture(120);const {result}=await execute(f.parent.id,await request(f.parent.id,'INCREASE','20',undefined,f.bases[0].id));
        // Prior queued synthetic commands are already tested independently; isolate this consumer event by due time.
        await db.query("UPDATE mps_reconciliation_outbox SET next_attempt_at=now()+interval '1 day' WHERE tenant_id=$1 AND id<>$2::uuid",[tenant,result.outboxId]);
        await db.query("UPDATE mps_sync_configs SET enabled=false WHERE tenant_id=$1 AND sync_key='base-to-weekly'",[tenant]);await sync.processOutbox();
        expect((await svc.status(f.parent.id,result.outboxId,actor())).status).not.toBe('SUCCESS');
        await db.query("UPDATE mps_sync_configs SET enabled=true WHERE tenant_id=$1 AND sync_key='base-to-weekly'",[tenant]);await db.query("UPDATE mps_reconciliation_outbox SET next_attempt_at=now() WHERE id=$1",[result.outboxId]);await sync.processOutbox();
        expect(await svc.status(f.parent.id,result.outboxId,actor())).toMatchObject({status:'SUCCESS'});
        expect((await db.query('SELECT count(*)::int n FROM mps_weekly_plans WHERE base_plan_id=ANY($1::uuid[])',[f.bases.map(b=>b.id)]))[0].n).toBe(2);
    });
    it('unknown historical NULL relation is pending, not zero; readonly and tenant/scope protected', async () => { const f = await fixture(); await db.query('INSERT INTO mps_base_plans(tenant_id,division_id,order_number,item_code,delivery_number,planned_quantity,created_by,updated_by)VALUES($1,$2,$3,$4,\'099\',10,$5,$5)', [tenant, division, 'SYN-ORDER', f.item, user]); expect(await svc.read(f.parent.id, actor())).toMatchObject({ trusted: false, unallocated: null, relationStatus: 'PENDING' }); await expect(svc.read(f.parent.id, { ...actor(), tenantId: 'OTHER-SYNTHETIC' })).rejects.toMatchObject({ status: 404 }); await expect(svc.read(f.parent.id, { ...actor(), isSystemAdmin: false, permissions: [], tableDataScopes: [] })).rejects.toMatchObject({ status: 403 }); });
    it('real reports and process lock block reductions and unsafe merge, quantities/audits unchanged', async () => { const f = await fixture(80); await run('base-to-weekly'); const [w] = await db.query('SELECT * FROM mps_weekly_plans WHERE base_plan_id=$1', [f.bases[0].id]); await app.create('mps-process-reports', { weeklyPlanId: w.id, processCode: 'cutting', productionDate: '2026-11-06', productionQuantity: 3 }, actor()); const before = await db.query('SELECT * FROM mps_process_reports WHERE weekly_plan_id=$1 ORDER BY id', [w.id]); expect((await svc.preview(f.parent.id, await request(f.parent.id, 'REDUCE', '20', f.bases[0].id), actor())).blockers.join()).toContain('工艺锁'); expect((await svc.preview(f.parent.id, await request(f.parent.id, 'MERGE', '10', f.bases[1].id, f.bases[0].id), actor())).allowed).toBe(false); expect(await db.query('SELECT * FROM mps_process_reports WHERE weekly_plan_id=$1 ORDER BY id', [w.id])).toEqual(before); });
    it('explicit single-batch quantity ownership survives monthly-to-base repeated sync', async () => { const f = await fixture(120, [100]); await execute(f.parent.id, await request(f.parent.id, 'INCREASE', '20', undefined, f.bases[0].id)); await db.query('UPDATE mps_monthly_plans SET required_quantity=130 WHERE id=$1', [f.parent.id]); await db.transaction(m => reconcileMonthlyBasePlans(m, tenant, user, '合成用户', [f.parent.id])); expect((await svc.read(f.parent.id, actor())).allocated).toBe('120.0000'); });
    async function inbound(item: string, qty: string) {
        const source = randomUUID();
        await db.query(`INSERT INTO erp_staging_raw_records(tenant_id,source_system,source_database,source_table,source_id,record_type,order_number,item_code,customer_code,quantity,status_code,is_cancelled,order_link_stable,raw_payload,content_hash)VALUES($1,'T+','UFTData418971_000003','ST_RDRecord_b',$2,'INBOUND_LINE','SYN-ORDER',$3,'SYN-CUSTOMER',$4,'189',false,true,'{}','synthetic')`, [tenant, source, item, qty]);
        await db.query(`INSERT INTO finished_goods_inbound(sales_order_number,document_number,inventory_code,relation_info,source_system,source_database,source_key,received_quantity)VALUES('SYN-ORDER',$1,$2,'synthetic','T+','UFTData418971_000003',$1,$3)`, [source, item, qty]);
    }
    it('verified single-batch finished-goods fact counted once across repeated reads, process sums irrelevant', async () => { const f = await fixture(100, [100]); await inbound(f.item, '20'); const a = await svc.read(f.parent.id, actor()), b = await svc.read(f.parent.id, actor()); expect(a).toMatchObject({ trusted: true, fulfilled: '20.0000', remainingReserved: '80.0000', unallocated: '0.0000' }); expect(b).toEqual(a); });
    it('multiple batches with inbound require attribution, never trust FIFO allocations', async () => { const f = await fixture(120); await inbound(f.item, '20'); const s = await svc.read(f.parent.id, actor()); expect(s).toMatchObject({ trusted: false, unallocated: null }); expect(s.blockers.join()).toContain('履约归属待确认'); expect((await svc.preview(f.parent.id, await request(f.parent.id, 'INCREASE', '20', undefined, f.bases[0].id), actor())).allowed).toBe(false); });
    it('cross-division scopes deny both reads and updates, own create scope remains enforced', async () => { const f = await fixture(); const narrow = { ...actor(), isSystemAdmin: false, permissions: ['mps-monthly-plans:*:read', 'mps-base-plans:*:read', 'mps-base-plans:*:update', ...['orderNumber', 'itemCode', 'divisionId', 'requiredQuantity', 'cumulativeInboundQuantity'].map(k => `mps-monthly-plans:${k}:read`), ...['orderNumber', 'itemCode', 'divisionId', 'plannedQuantity'].map(k => `mps-base-plans:${k}:read`), 'mps-base-plans:plannedQuantity:update'], tableDataScopes: [{ resource: 'mps-monthly-plans', scope: 'ALL' }, { resource: 'mps-base-plans', scope: 'CUSTOM', rules: [{ fieldKey: 'divisionId', operator: 'EQ', value: randomUUID() }] }] }; await expect(svc.read(f.parent.id, narrow)).rejects.toMatchObject({ status: 404 }); await expect(svc.read(f.parent.id, { ...narrow, tableDataScopes: [{ resource: 'mps-monthly-plans', scope: 'ALL' }, { resource: 'mps-base-plans', scope: 'NONE' }] })).rejects.toMatchObject({ status: 404 }); });
    it('generic permissions: create-only PATCH restricts stale readonly grants, preserves legal fields/members/scope, audits; malicious grants rollback', async () => {
        const role = await db.manager.save(Role, { name: '__synthetic_quantity_permissions', permissionGroupResource: 'mps-base-plans', permissionGroupType: 'CUSTOM', permissionGroupDisplayName: '合成事业四部', permissionGroupEnabled: true, permissionGroupScope: 'ALL', permissionGroupConditionMatch: 'ALL', permissionGroupDataRules: [], createdBy: user, updatedBy: user });
        for (const p of [{ fieldKey: '*', read: true, create: true, update: true }, { fieldKey: 'deliveryNumber', read: true, update: true }, { fieldKey: 'plannedQuantity', read: true, update: true }])
            await db.manager.save(Permission, { roleId: role.id, resource: 'mps-base-plans', ...p });
        const subjectBefore=await db.manager.save(PermissionGroupSubject, { roleId: role.id, subjectType: 'USER', subjectId: user, createdBy: user, updatedBy: user });
        const service = new TablePermissionGroupApplicationService(db), a = { userId: user, name: '合成权限管理员', requestId: randomUUID() };
        const changed = await service.update(role.id, { version: role.version, actions: ['read', 'update'] }, a);
        expect((await db.manager.findBy(Permission, { roleId: role.id })).map(p => [p.fieldKey, p.create, p.read, p.update]).sort()).toEqual([['*', false, true, true], ['deliveryNumber', false, true, false], ['plannedQuantity', false, true, true]].sort());
        expect(await db.manager.countBy(PermissionGroupSubject, { roleId: role.id })).toBe(1);
        expect(changed.permissionGroupScope).toBe('ALL');
        const again=await service.update(role.id,{version:changed.version,subjects:[{type:'USER',id:user}]},a);expect(await db.manager.findOneByOrFail(PermissionGroupSubject,{id:subjectBefore.id})).toEqual(subjectBefore);
        expect((await db.query("SELECT count(*)::int count FROM audit_logs WHERE record_id=$1 AND action='table_permission_group.legacy_fields_restricted'", [role.id]))[0].count).toBe(1);
        await expect(service.update(role.id, { version: again.version, fields: [{ fieldKey: 'deliveryNumber', visible: true, editable: true }] }, a)).rejects.toMatchObject({ status: 400 });
        await expect(service.update(role.id, { version: role.version, actions: ['read'] }, a)).rejects.toMatchObject({ status: 409 });
        expect((await db.manager.findOneByOrFail(Role, { id: role.id })).version).toBe(again.version);
    });
    it('late120 preserves121 and blocks legacy demand; writes flag cannot bypass', async () => { const f = await fixture(); const q = db.createQueryRunner(); try {
        await new MpsPlanLifecycle1722920120000().up(q);
    }
    finally {
        await q.release();
    } process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED = 'true'; expect(await svc.read(f.parent.id, actor())).toMatchObject({ status: 'LEGACY_RETAINED', trusted: false, unallocated: null }); expect((await svc.preview(f.parent.id, await request(f.parent.id, 'INCREASE', '1', undefined, f.bases[0].id), actor())).allowed).toBe(false); delete process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED; });
});
