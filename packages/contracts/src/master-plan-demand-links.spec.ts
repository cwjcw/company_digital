import { describe,it,expect } from 'vitest';
import { mpsDemandLinkCapability,mpsDemandLinkResources,tableResourceRegistry,tablePermissionFieldsFor } from './index';
describe('stable demand identity contract',()=>{
  it('registers an independent planning command without an independent demand table',()=>{
    expect(tableResourceRegistry.find(r=>r.code===mpsDemandLinkCapability.code)).toMatchObject({moduleCode:'planning'});
    expect(tablePermissionFieldsFor(mpsDemandLinkCapability.code)).toEqual([]);
  });
  it('exposes only the three missing edges, keeping downstream stable IDs',()=>{
    expect(mpsDemandLinkResources).toEqual(['mps-order-allocations','mps-base-plans','mps-review-due-dates']);
  });
  it('does not make parent UUIDs ordinary editable/importable table fields',()=>{
    for(const resource of mpsDemandLinkResources)expect(tablePermissionFieldsFor(resource).filter(f=>f.editable).map(f=>f.key)).not.toContain('monthlyPlanId');
  });
});
