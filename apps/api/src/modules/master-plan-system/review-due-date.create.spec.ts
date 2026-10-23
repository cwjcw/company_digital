import { ReviewDueDateApplicationService } from './review-due-date.application.service';
import { ReviewDueDateController } from './review-due-date.controller';
import { reviewDueCreateCapabilities } from './review-due-date.query.service';
import { MASTER_PLAN_RESOURCE_MAP } from './master-plan.config';
import { reviewDueDateCreateFields } from '@kdos/contracts';
import type { MasterPlanActor } from './master-plan.types';
const resource='mps-review-due-dates',id='0199ea00-0000-7000-8000-000000000001';
const actor:MasterPlanActor={tenantId:'KAINAN',userId:id,username:'Synthetic creator',permissions:[resource+':*:create',...reviewDueDateCreateFields.map(f=>`${resource}:${f.key}:read`)],tableDataScopes:[{resource,scope:'ALL',actions:['create']}],requestId:'test',source:'web'};
const input={orderNumber:'O-1/2',batchNumber:'B-2/2',drawingNumber:'D-1/3',inboundDate:'2026-11-10',quantity:'0.000000000000000001',commandId:id};
describe('Review due date dedicated create boundary',()=>{
 it('keeps generic create false while advertising the dedicated create fields for granted actors',()=>{
  expect(MASTER_PLAN_RESOURCE_MAP.get(resource)?.create).toBe(false);expect(reviewDueCreateCapabilities(actor)).toMatchObject({create:true,createFields:reviewDueDateCreateFields});
  expect(reviewDueCreateCapabilities({...actor,permissions:actor.permissions.filter(p=>p!==resource+':*:create')})).toEqual({create:false,createFields:[]});
  expect(reviewDueCreateCapabilities({...actor,tableDataScopes:[]})).toEqual({create:false,createFields:[]});
  expect(reviewDueCreateCapabilities({...actor,tableDataScopes:[{resource,scope:'CUSTOM',rules:[{fieldKey:'bogus',operator:'EQ',value:'guessed'}]}]}).create).toBe(false);
 });
 it('requires resource create and required field filling grants, with no update grant needed',async()=>{
  const db={transaction:jest.fn()},app=new ReviewDueDateApplicationService(db as never,{} as never);
  await expect(app.manualCreate(input,{...actor,permissions:[]})).rejects.toMatchObject({status:403});
  await expect(app.manualCreate(input,{...actor,permissions:actor.permissions.filter(p=>p!==resource+':quantity:read')})).rejects.toMatchObject({status:403});
  expect(db.transaction).not.toHaveBeenCalled();
  expect(reviewDueCreateCapabilities(actor).create).toBe(true);
 });
 it.each(['id','tenantId','version','expectedVersion','lastChangedAt','lastSyncedAt','sourceOrderNumber','createdBy','updatedAt'])('rejects client system/identity field %s',async key=>{
  const db={transaction:jest.fn()},app=new ReviewDueDateApplicationService(db as never,{} as never);
  await expect(app.manualCreate({...input,[key]:'forged'},actor)).rejects.toMatchObject({status:400});expect(db.transaction).not.toHaveBeenCalled();
 });
 it('never accepts an administrator identity from the request body',async()=>{
  const app={manualCreate:jest.fn().mockResolvedValue({id,version:1})},controller=new ReviewDueDateController({} as never,app as never);
  await controller.manualCreate(input,{user:{sub:id,displayName:'Real authenticated operator',permissions:actor.permissions},requestId:'http-request'} as never);
  expect(app.manualCreate).toHaveBeenCalledWith(input,expect.objectContaining({userId:id,username:'Real authenticated operator',isSystemAdmin:false,source:'web'}));
 });
});
