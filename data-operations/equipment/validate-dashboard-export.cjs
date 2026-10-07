/* Real PostgreSQL acceptance. All synthetic data is in connection-local TEMP tables; always rolled back. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const apiRoot = process.env.EQUIPMENT_API_ROOT || path.resolve(__dirname, '../../apps/api');
const load = name => require(path.join(apiRoot, 'dist', name));
const ds = load('data-source').default;
const { EquipmentQueryService } = load('modules/equipment/equipment.query.service');
const { EquipmentExportService } = load('modules/equipment/equipment-export.service');
const ExcelJS = require(path.join(apiRoot, 'node_modules/exceljs'));
const { equipmentDashboardExportTables, equipmentDashboardExportDefinitions } = require(path.join(apiRoot, 'node_modules/@kdos/contracts'));
const uuid = number => `0199e000-0000-7000-8000-${String(number).padStart(12, '0')}`;
const input = { periodType: 'day', period: '2026-10-06' };
const actor = { tenantId: 'EQUIPMENT_EXPORT_ACCEPTANCE', userId: null, username: 'acceptance', isSystemAdmin: true, permissions: ['*'], tableDataScopes: [], requestId: 'temp-table-acceptance' };
(async () => {
  await ds.initialize(); const runner = ds.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  try {
    await runner.query(`
      CREATE TEMP TABLE equipment_assets(id uuid,tenant_id text,active boolean,monitored boolean,division_organization_unit_id uuid,division_name_snapshot text,usage_department_organization_unit_id uuid,usage_department_name_snapshot text,equipment_code text,equipment_name text,created_by uuid) ON COMMIT DROP;
      CREATE TEMP TABLE equipment_status_reports(id uuid,tenant_id text,equipment_id uuid,active boolean,report_date date,updated_at timestamptz,planned_runtime_minutes integer,runtime_minutes integer,fault_minutes integer) ON COMMIT DROP;
      CREATE TEMP TABLE equipment_responsibles(tenant_id text,equipment_id uuid,user_id uuid) ON COMMIT DROP;
      CREATE TEMP TABLE users(id uuid,display_name text) ON COMMIT DROP;
    `);
    const q = new EquipmentQueryService({ query: runner.query.bind(runner) });
    const exports = new EquipmentExportService(q, { recordDashboardExport: async () => {} });
    const createAssets = async count => {
      for (let index = 0; index < count; index++) await runner.query('INSERT INTO equipment_assets VALUES($1,$2,true,true,$3,$4,$5,$6,$7,$8,NULL)', [uuid(index + 1), actor.tenantId, uuid(index < count / 2 ? 10001 : 10002), index < count / 2 ? '事业一部' : '事业二部', uuid(20001 + (index < count / 2 ? 0 : 2) + (index % 5 >= 3 ? 1 : 0)), index % 5 >= 3 ? '木作车间' : '五金车间', String(index + 1).padStart(5, '0'), `设备${index + 1}`]);
    };
    const report = async index => runner.query('INSERT INTO equipment_status_reports VALUES($1,$2,$3,true,$4,now(),480,$5,0)', [uuid(30000 + index), actor.tenantId, uuid(index + 1), input.period, index === 0 ? 0 : 240]);
    await createAssets(10); for (const index of [0, 1, 2, 3, 5, 6, 7]) await report(index);
    await runner.query('INSERT INTO users VALUES($1,$2)', [uuid(40000), '责任人甲']);
    await runner.query('INSERT INTO equipment_responsibles VALUES($1,$2,$3)', [actor.tenantId, uuid(5), uuid(40000)]);
    // Different tenant, inactive asset, non-monitored asset and inactive report must not affect the count.
    await runner.query('INSERT INTO equipment_assets SELECT $1,$2,true,true,$3,$4,$5,$6,$7,$8,NULL', [uuid(50000), 'OTHER_TENANT', uuid(10001), '事业一部', uuid(20001), '五金车间', 'OTHER', '其他租户设备']);
    await runner.query('INSERT INTO equipment_assets SELECT $1,tenant_id,false,monitored,division_organization_unit_id,division_name_snapshot,usage_department_organization_unit_id,usage_department_name_snapshot,$2,equipment_name,created_by FROM equipment_assets WHERE id=$3', [uuid(50001), 'INACTIVE', uuid(1)]);
    await runner.query('INSERT INTO equipment_assets SELECT $1,tenant_id,true,false,division_organization_unit_id,division_name_snapshot,usage_department_organization_unit_id,usage_department_name_snapshot,$2,equipment_name,created_by FROM equipment_assets WHERE id=$3', [uuid(50002), 'UNMONITORED', uuid(1)]);
    await runner.query('INSERT INTO equipment_status_reports VALUES($1,$2,$3,false,$4,now(),480,240,0)', [uuid(50003), actor.tenantId, uuid(5), input.period]);
    const verify = async (filters, expected) => { const data = await q.dashboard({ ...input, ...filters }, actor); assert.equal(data.operationsMonitoring.yesterday.unfilledEquipmentCount, expected); assert.equal(data.unreportedEquipmentRows.length, expected); assert.equal(data.divisionRows.reduce((n, row) => n + row.unreportedCount, 0), expected); return data; };
    const initial = await verify({}, 3); assert.equal(initial.operationsMonitoring.yesterday.expectedEquipmentCount, 10); assert.equal(initial.operationsMonitoring.yesterday.filledEquipmentCount, 7); assert.equal(initial.unreportedEquipmentRows[0].responsibleUsers[0].displayName, '责任人甲');
    await verify({ divisionId: uuid(10001) }, 1); await verify({ departmentId: [uuid(20002)] }, 1);
    await verify({ period: '2026-10-05' }, 10);
    const monthly = await q.dashboard({ periodType: 'month', period: '2026-10' }, actor); assert.equal(monthly.unreportedEquipmentRows.length, 10); assert.equal(monthly.operationsMonitoring.yesterday.unfilledEquipmentCount, 10);
    assert.equal((await exports.dashboardExport('unreported', { periodType: 'month', period: '2026-10' }, actor)).filename, 'equipment_unreported_2026-10-31.xlsx');
    const scope = (action, division) => ({ resource: 'equipment-dashboard', scope: division ? 'CUSTOM' : 'ALL', actions: [action], rules: division ? [{ fieldKey: 'divisionId', operator: 'EQ', value: division }] : [] });
    const restricted = { ...actor, isSystemAdmin: false, permissions: ['equipment-dashboard:*:read', 'equipment-dashboard:*:export', ...equipmentDashboardExportDefinitions.unreported.columns.map(col => `equipment-dashboard:${col.permissionField}:read`)], tableDataScopes: [scope('read', uuid(10002)), scope('export')] };
    const limited = await q.dashboard(input, restricted, 'export'); assert.equal(limited.unreportedEquipmentRows.length, 2); assert(limited.unreportedEquipmentRows.every(row => row.divisionName === '事业二部'));
    const narrower = { ...restricted, tableDataScopes: [scope('read'), scope('export', uuid(10001))] }; assert.equal((await q.dashboard(input, narrower, 'export')).unreportedEquipmentRows.length, 1);
    await assert.rejects(exports.dashboardExport('unreported', input, { ...restricted, permissions: ['equipment-dashboard:*:read'] }), /权限/);
    const filterBook = new ExcelJS.Workbook(); await filterBook.xlsx.load((await exports.dashboardExport('unreported', { ...input, divisionId: uuid(10001), departmentId: [uuid(20002)] }, actor)).buffer); assert.equal(filterBook.worksheets[0].rowCount, 2);
    for (const index of [4, 8, 9]) await report(index); await verify({}, 0); await assert.rejects(exports.dashboardExport('unreported', input, actor), /暂无可导出数据/);
    await runner.query('TRUNCATE equipment_assets,equipment_status_reports,equipment_responsibles,users'); await createAssets(100); for (let index = 0; index < 7; index++) await report(index);
    const counts = {};
    for (const table of equipmentDashboardExportTables) {
      const result = await exports.dashboardExport(table, { ...input, page: 1, pageSize: 20 }, actor);
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.buffer); const sheet = workbook.worksheets[0];
      assert.deepEqual(sheet.getRow(1).values.slice(1), equipmentDashboardExportDefinitions[table].columns.map(col => col.label));
      assert.match(result.filename, /^equipment_[a-z_]+_2026-10-06\.xlsx$/); counts[table] = sheet.rowCount - 1;
    }
    assert.equal(counts.utilization_detail, 100); assert.equal(counts.unreported, 93);
    const output = { status: 'PASS', checks: ['10 expected/7 reported/3 details', 'zero-runtime is reported', 'all reported/empty export', 'division filter', 'department filter', 'date/month end filter', 'tenant/active/monitored', 'live responsibility', 'read and export scope intersection', 'export permission', 'six xlsx headers and filenames', 'pageSize20/total100/export100'], counts };
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(output, null, 2), { mode: 0o600 }); console.log(JSON.stringify(output));
  } finally { await runner.rollbackTransaction(); await runner.release(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { if (ds.isInitialized) await ds.destroy(); });
