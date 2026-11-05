import { describe, expect, it } from 'vitest';
import { masterPlanResourceDefinitions, mpsLifecycleCapabilities, mpsLifecycleOperations, mpsLifecycleResources, mpsPlanLifecycleStatuses,
  tablePermissionFieldsFor, tableResourcePermissionActionLabels, tableResourceRegistry, tableFilterResourceCapabilities, tablePrintResourceCapabilities, tableExcelResourceCapabilities } from './index';

describe('MPS lifecycle contracts',()=>{
  it('has exactly four lifecycle states independent of progress/quantity',()=>{
    expect(mpsPlanLifecycleStatuses).toEqual(['ACTIVE','ON_HOLD','CANCELLED','LEGACY_RETAINED']);
    for(const resource of mpsLifecycleResources){
      const field=tablePermissionFieldsFor(resource).find(f=>f.key==='lifecycleStatus');
      expect(field?.editable).toBe(false);expect(field?.options?.map(o=>o.value)).toEqual(mpsPlanLifecycleStatuses);
    }
  });
  it('registers independent capabilities using standard update without creating duplicate business tables',()=>{
    for(const c of mpsLifecycleCapabilities){
      expect(tableResourceRegistry.find(r=>r.code===c.code)?.moduleCode).toBe('planning');
      expect(tablePermissionFieldsFor(c.code)).toEqual([]);
      expect(masterPlanResourceDefinitions.some(r=>(r.code as string)===c.code)).toBe(false);
      expect(tableResourcePermissionActionLabels[c.code]?.update).toBe(c.label);
      for(const capabilities of [tableFilterResourceCapabilities,tablePrintResourceCapabilities,tableExcelResourceCapabilities])expect(capabilities[c.code]?.status).toBe('NOT_APPLICABLE');
    }
    expect(mpsLifecycleOperations.CANCEL.capability).not.toBe(mpsLifecycleOperations.CANCEL_REMAINING.capability);
  });
});
