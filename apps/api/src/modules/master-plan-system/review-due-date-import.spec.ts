import { ReviewDueDateImportApplicationService } from './review-due-date-import.application.service';
import { MasterPlanApplicationService } from './master-plan.application.service';
import { reviewDueImportCapabilities } from './review-due-date.query.service';
import { hasMasterPlanPermission, type MasterPlanActor } from './master-plan.types';
import { reviewDueDateCreateFields } from '@kdos/contracts';
const resource='mps-review-due-dates',actor:MasterPlanActor={tenantId:'KAINAN',userId:'0199ea00-0000-7000-8000-000000000001',username:'Synthetic importer',source:'web',requestId:'test',permissions:[resource+':*:import',...reviewDueDateCreateFields.map(f=>`${resource}:${f.key}:read`)],tableDataScopes:[{resource,scope:'ALL',actions:['import']}]};
describe('review due dedicated import boundary',()=>{
 it('registers import while preserving all unrelated blocked mutations',()=>{expect(hasMasterPlanPermission(actor,resource,'import')).toBe(true);for(const action of ['delete','copy','batch_update','batch_print'])expect(hasMasterPlanPermission({...actor,permissions:['*']},resource,action)).toBe(false);});
 it('exposes import-only template metadata without granting resource read/create/update',()=>{expect(reviewDueImportCapabilities(actor)).toMatchObject({import:true,template:true,templateFields:reviewDueDateCreateFields});for(const action of ['read','create','update'])expect(hasMasterPlanPermission(actor,resource,action)).toBe(false);});
 it('keeps template access distinct from import and filters all ungranted field structures',()=>{const reader={...actor,permissions:[resource+':*:read',resource+':quantity:read']};expect(reviewDueImportCapabilities(reader)).toMatchObject({import:false,template:true});expect(reviewDueImportCapabilities(reader).templateFields.map(f=>f.key)).toEqual(['quantity']);expect(reviewDueImportCapabilities({...actor,permissions:[]}).template).toBe(false);});
 it('rejects direct generic import commands so dates cannot bypass history',async()=>{const service=new MasterPlanApplicationService({} as never,{} as never);await expect(service.importUpdates(resource,[], 'synthetic',actor)).rejects.toMatchObject({status:403});});
 it('requires resource import before touching storage or trusting preview data',async()=>{const m={query:jest.fn()},service=new ReviewDueDateImportApplicationService();await expect(service.authorize({...actor,permissions:[]},m as never)).rejects.toMatchObject({status:403});expect(m.query).not.toHaveBeenCalled();});
});
