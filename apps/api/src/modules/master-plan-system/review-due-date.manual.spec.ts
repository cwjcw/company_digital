import { ReviewDueDateApplicationService } from './review-due-date.application.service';
import { ReviewDueDateController } from './review-due-date.controller';
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from './master-plan.types';
import { reviewDueDateFields } from '@kdos/contracts';
const resource='mps-review-due-dates';
const actor:MasterPlanActor={tenantId:'KAINAN',userId:'0199ea00-0000-7000-8000-000000000001',username:'Synthetic reader',permissions:[`${resource}:*:read`],tableDataScopes:[],requestId:'test',source:'web'};
describe('Review due date manual edit boundary',()=>{
  it('enables nine business fields and denies audit updates even for administrators',()=>{
    expect(reviewDueDateFields.filter(f=>f.editable).map(f=>f.key)).toEqual(['divisionId','orderNumber','batchNumber','drawingNumber','inspectionTimeName','inboundDate','quantity','changeCount','previousInboundDate']);
    for(const field of reviewDueDateFields.filter(f=>!f.editable))expect(hasMasterPlanFieldPermission({...actor,isSystemAdmin:true},resource,field.key,'update')).toBe(false);
    expect(hasMasterPlanPermission({...actor,isSystemAdmin:true},resource,'update')).toBe(true);
    for(const action of ['delete','batch_update','copy'])expect(hasMasterPlanPermission({...actor,isSystemAdmin:true},resource,action)).toBe(false);
  });
  it('rejects missing action and field grants before opening any database transaction',async()=>{
    const db={transaction:jest.fn()},app=new ReviewDueDateApplicationService(db as never,{} as never),body={expectedVersion:1,commandId:actor.userId,quantity:'1'};
    await expect(app.manualEdit(actor.userId!,body,actor)).rejects.toMatchObject({status:403});
    await expect(app.manualEdit(actor.userId!,body,{...actor,permissions:[...actor.permissions,resource+':*:update']})).rejects.toMatchObject({status:403});
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it.each(['orderDate','productReviewDueDate','lastChangedAt','lastSyncedAt','id','tenantId','sourceOrderNumber','createdBy','version'])('rejects client system/identity field %s',async field=>{
    const db={transaction:jest.fn()},app=new ReviewDueDateApplicationService(db as never,{} as never);
    await expect(app.manualEdit(actor.userId!,{[field]:1,expectedVersion:1,commandId:actor.userId},{...actor,isSystemAdmin:true})).rejects.toMatchObject({status:400});
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('uses only the authenticated subject as operator, ignoring forged body authority',async()=>{
    const app={manualEdit:jest.fn().mockResolvedValue({})},controller=new ReviewDueDateController({} as never,app as never);
    const req={user:{sub:actor.userId,displayName:'Real test login',permissions:[resource+':*:update'],tableDataScopes:[]},requestId:'real-request'};
    await controller.manualEdit(actor.userId!,{quantity:'2'},req as never);
    expect(app.manualEdit).toHaveBeenCalledWith(actor.userId,{quantity:'2'},expect.objectContaining({userId:actor.userId,username:'Real test login',source:'web',isSystemAdmin:false}));
  });
});
