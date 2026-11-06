import { expect, it } from 'vitest';
import { mpsQuantityOperations, type MpsQuantityRequest } from './master-plan-demand-quantity';
it('quantity commands use existing demand/batch identities and an explicit decimal request',()=>{
 expect(mpsQuantityOperations).toEqual(['INCREASE','NEW','REDUCE','SPLIT','MERGE']);
 const r:MpsQuantityRequest={operation:'INCREASE',quantity:'0.0001',targetId:'synthetic-batch',expectedDemandVersion:2,expectedVersions:{'synthetic-batch':3}};
 expect(r.quantity).toBe('0.0001');expect(r.expectedVersions['synthetic-batch']).toBe(3);
});
