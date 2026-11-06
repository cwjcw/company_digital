import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { tablePermissionFieldsFor, type TableResourceCode } from '@kdos/contracts';
import { entities, User, Role, Permission, PermissionGroupSubject, AuditLog } from '../../entities';
import { discoverMigrationFiles } from '../../migration-files';
import { TablePermissionGroupApplicationService } from './table-permission-group.application.service';

const integration = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET ? describe : describe.skip;
integration('permission action PATCH: real isolated PostgreSQL without Migration120', () => {
  let db: DataSource, app: TablePermissionGroupApplicationService;
  const user = randomUUID();
  const actor = { userId: user, name: '合成权限管理员', requestId: 'synthetic-permission-request' };
  beforeAll(async () => {
    const socket = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET!;
    if (!socket.endsWith('/test/mps_sync_reliability/pg_socket')) throw Error('Isolated socket required');
    const common = { type: 'postgres' as const, host: socket, username: 'postgres', logging: false as const };
    const control = new DataSource({ ...common, database: 'postgres' });
    await control.initialize();
    try {
      await control.query('DROP DATABASE IF EXISTS permission_patch_test WITH (FORCE)');
      await control.query('CREATE DATABASE permission_patch_test');
    } finally { await control.destroy(); }
    db = new DataSource({ ...common, database: 'permission_patch_test', entities,
      migrations: discoverMigrationFiles(path.join(__dirname, '../../migrations')).filter(f => Number(path.basename(f).slice(0, 13)) <= 1722920117000) });
    await db.initialize();
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    expect(await db.runMigrations({ transaction: 'all' })).toHaveLength(117);
    await db.manager.save(User, { id: user, tenantId: 'PERMISSION-SYNTHETIC', username: 'synthetic-permissions', displayName: '合成用户', passwordHash: 'invalid-hash' });
    app = new TablePermissionGroupApplicationService(db);
  }, 180000);
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });
  const snapshot = async (id: string) => ({
    role: await db.manager.findOneByOrFail(Role, { id }),
    permissions: await db.manager.find(Permission, { where: { roleId: id }, order: { fieldKey: 'ASC' } }),
    subjects: await db.manager.find(PermissionGroupSubject, { where: { roleId: id }, order: { id: 'ASC' } })
  });
  const create = async (resource: TableResourceCode = 'mps-base-plans') => {
    const editable = tablePermissionFieldsFor(resource).find(f => f.editable && f.key !== 'deliveryNumber')!;
    const role = await app.create({ resource, groupType: 'CUSTOM', displayName: '合成组-' + randomUUID(),
      actions: ['read', 'create', 'update', 'export'], fields: [
        { fieldKey: 'orderNumber', visible: true, editable: false },
        { fieldKey: editable.key, visible: true, editable: true },
        { fieldKey: 'lifecycleStatus', visible: true, editable: false }
      ], dataMatch: 'ALL', dataRules: [{ fieldKey: 'orderNumber', operator: 'EQ', value: 'SYN-ORDER' }], subjects: [{ type: 'USER', id: user }] }, actor);
    return { role, editable };
  };
  it.each(['mps-monthly-plans', 'mps-base-plans', 'mps-weekly-plans'] as const)('%s only changes create and preserves lawful field IDs, scope, members and other groups', async resource => {
    const { role } = await create(resource), other = await create(resource);
    const before = await snapshot(role.id), otherBefore = await snapshot(other.role.id);
    await app.update(role.id, { version: before.role.version, actions: ['read', 'update', 'export'] }, actor);
    const after = await snapshot(role.id);
    expect(after.role.id).toBe(role.id);
    expect(after.role.version).toBe(before.role.version + 1);
    expect(after.role.permissionGroupDataRules).toEqual(before.role.permissionGroupDataRules);
    expect(after.role.permissionGroupScope).toBe('CUSTOM');
    expect(after.subjects).toEqual(before.subjects);
    expect(after.permissions.filter(p => p.fieldKey !== '*')).toEqual(before.permissions.filter(p => p.fieldKey !== '*'));
    const operation = after.permissions.find(p => p.fieldKey === '*')!;
    expect(operation.id).toBe(before.permissions.find(p => p.fieldKey === '*')!.id);
    expect(operation).toMatchObject({ read: true, create: false, update: true, export: true });
    expect(await snapshot(other.role.id)).toEqual(otherBefore);
    expect(await db.manager.findOneBy(AuditLog, { recordId: role.id, action: 'table_permission_group.updated' })).not.toBeNull();
    expect((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='mps_base_plans' AND column_name='lifecycle_status'"))[0].n).toBe(0);
  });
  it('tightens stored unknown/readonly grants with audit without changing legitimate fields or data rules', async () => {
    const { role } = await create();
    await db.manager.save(Permission, [
      { roleId: role.id, resource: 'mps-base-plans', fieldKey: 'retiredSyntheticField', read: true, update: true },
      { roleId: role.id, resource: 'mps-base-plans', fieldKey: 'deliveryNumber', read: true, update: true }
    ]);
    const before = await snapshot(role.id);
    const result = await app.update(role.id, { version: before.role.version, actions: ['read', 'update'] }, actor);
    const after = await snapshot(role.id);
    expect(result.restrictedFieldKeys.sort()).toEqual(['deliveryNumber', 'retiredSyntheticField']);
    expect(after.permissions.find(p => p.fieldKey === 'retiredSyntheticField')).toBeUndefined();
    expect(after.permissions.find(p => p.fieldKey === 'deliveryNumber')).toMatchObject({ id: before.permissions.find(p => p.fieldKey === 'deliveryNumber')!.id, read: true, update: false });
    expect(after.role.permissionGroupDataRules).toEqual(before.role.permissionGroupDataRules);
    expect(after.subjects).toEqual(before.subjects);
    expect(await db.manager.findOneBy(AuditLog, { recordId: role.id, action: 'table_permission_group.legacy_fields_restricted' })).not.toBeNull();
  });
  it.each(['retiredSyntheticField', 'lifecycleStatus', 'deliveryNumber'])('rejects explicit illegal grants for %s and rolls back', async fieldKey => {
    const { role } = await create(), before = await snapshot(role.id);
    await expect(app.update(role.id, { version: before.role.version, fields: [{ fieldKey, visible: true, editable: true }] }, actor)).rejects.toMatchObject({ status: 400 });
    expect(await snapshot(role.id)).toEqual(before);
  });
  it('rejects stale version before writes', async () => {
    const { role } = await create(), before = await snapshot(role.id);
    await expect(app.update(role.id, { version: before.role.version - 1, actions: ['read'] }, actor)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(role.id)).toEqual(before);
  });
  it('keeps preset permissions immutable when an action PATCH is attempted', async () => {
    const role = await app.create({ resource: 'mps-base-plans', groupType: 'VIEW_ALL', subjects: [{ type: 'USER', id: user }] }, actor);
    const before = await snapshot(role.id);
    await app.update(role.id, { version: before.role.version, actions: ['create'] }, actor);
    const after = await snapshot(role.id);
    expect(after.permissions).toEqual(before.permissions);
    expect(after.subjects).toEqual(before.subjects);
    expect(after.role.permissionGroupScope).toBe(before.role.permissionGroupScope);
  });
  it('rolls back operation and version if final audit fails', async () => {
    const { role } = await create(), before = await snapshot(role.id);
    await db.query(`CREATE FUNCTION reject_permission_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='table_permission_group.updated' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END$$;
      CREATE TRIGGER reject_permission_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_permission_test_audit()`);
    try {
      await expect(app.update(role.id, { version: before.role.version, actions: ['read'] }, actor)).rejects.toThrow('synthetic audit failure');
      expect(await snapshot(role.id)).toEqual(before);
    } finally { await db.query('DROP TRIGGER reject_permission_test_audit ON audit_logs; DROP FUNCTION reject_permission_test_audit()'); }
  });
});
