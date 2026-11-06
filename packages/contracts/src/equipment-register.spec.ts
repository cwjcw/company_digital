import {describe,it,expect} from 'vitest';
import {tablePermissionFieldsFor} from './index';
import {equipmentDashboardExportDefinitions} from './equipment-dashboard';
describe('equipment stable field identities',()=>{
 it('retains immutable equipmentCode and the real editable business fields',()=>{const fields=tablePermissionFieldsFor('equipment-register');expect(fields.find(f=>f.key==='equipmentCode')?.editable).toBe(false);for(const key of ['divisionId','usageDepartmentId','equipmentName','purchaseDate','plannedStartupMinutes','monitored','responsibleUserIds'])expect(fields.find(f=>f.key===key)?.editable).toBe(true);});
 it('dashboard business names use organization identity permissions for both export tables',()=>{const fields=tablePermissionFieldsFor('equipment-dashboard');for(const table of ['division_reporting','department_reporting'] as const){for(const column of equipmentDashboardExportDefinitions[table].columns){expect(fields.some(f=>f.key===column.permissionField)).toBe(true);}expect(equipmentDashboardExportDefinitions[table].columns.find(f=>f.key==='division')?.permissionField).toBe('divisionId');}expect(equipmentDashboardExportDefinitions.department_reporting.columns.find(f=>f.key==='department')?.permissionField).toBe('departmentId');expect(fields.some(f=>['division','department'].includes(f.key))).toBe(false);});
});
