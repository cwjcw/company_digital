import { ReviewDueDateApplicationService } from './review-due-date.application.service';
import type { MasterPlanActor } from './master-plan.types';

const tenant='KAINAN',user='0199ea00-0000-7000-8000-000000000001',division='0199ea00-0000-7000-8000-000000000002';
const actor:MasterPlanActor={tenantId:tenant,userId:user,username:'JSON importer',isSystemAdmin:true,permissions:[],tableDataScopes:[],requestId:'json-import-test',source:'web'};
const input=(row:number,overrides:Record<string,unknown>={})=>({row,values:{divisionId:division,orderNumber:`ORDER-${row}`,batchNumber:'B-1/1',drawingNumber:`ITEM-${row}`,quantity:'12.50',orderDate:'2026-11-09',productReviewDueDate:'2026-12-01',...overrides}});

function fixture(){
  let stored:{hash:string;response:any}|undefined;
  let inserted=0;
  const manager={query:jest.fn(async(sql:string,params:unknown[]=[]):Promise<any[]>=>{
    if(sql.includes('SELECT id FROM users'))return [{id:user}];
    if(sql.includes('SELECT request_hash,response_json FROM idempotency_keys'))return stored?[{request_hash:stored.hash,response_json:stored.response}]:[];
    if(sql.includes('SELECT 1 FROM jsonb_populate_record'))return [{ok:true}];
    if(sql.includes('SELECT 1 FROM mps_review_due_dates'))return [];
    if(sql.includes('INSERT INTO mps_review_due_dates'))return [{id:`0199ea00-0000-7000-8000-${String(++inserted).padStart(12,'0')}`,version:1}];
    if(sql.includes('INSERT INTO idempotency_keys')){stored={hash:String(params[1]),response:JSON.parse(String(params[2]))};return [];}
    return [];
  })};
  const db={transaction:jest.fn(async<T>(work:(m:typeof manager)=>Promise<T>)=>work(manager))};
  const directory={listEnabled:jest.fn().mockResolvedValue([{id:division,name:'事业一部',path:['凯南','事业一部'],pathLabel:'凯南/事业一部'}]),resolve:jest.fn((_value:unknown,options:any[])=>options[0])};
  return {app:new ReviewDueDateApplicationService(db as never,directory as never),manager,db,directory,get inserted(){return inserted;}};
}

describe('Review due-date JSON bulk import',()=>{
  it('creates rows atomically and returns the stored result for an identical retry',async()=>{
    const f=fixture(),body={commandId:user,rows:[input(1),input(2)]};
    const first=await f.app.bulkImport(body,actor),retry=await f.app.bulkImport(body,actor);
    expect(first).toMatchObject({total:2,succeeded:2,failed:0,atomic:true,repeated:false,records:[{row:1},{row:2}]});
    expect(retry).toMatchObject({succeeded:2,repeated:true});expect(f.inserted).toBe(2);
  });
  it('returns all row errors and inserts nothing for missing required fields, invalid date, or duplicate business key',async()=>{
    const f=fixture(),body={commandId:user,rows:[input(1,{productReviewDueDate:'2026-02-30'}),input(2,{quantity:undefined}),input(3,{orderNumber:'DUP',drawingNumber:'DUP-ITEM'}),input(4,{orderNumber:'DUP',drawingNumber:'DUP-ITEM'})]};
    const result=await f.app.bulkImport(body,actor);
    expect(result).toMatchObject({total:4,succeeded:0,failed:4,atomic:true});expect(result.errors).toHaveLength(4);expect(f.inserted).toBe(0);
    expect(result.errors.map((x:{row:number})=>x.row)).toEqual([1,2,3,4]);
  });
  it('requires import and create authorization and enforces the 500-row cap before opening a transaction',async()=>{
    const f=fixture(),large={commandId:user,rows:Array.from({length:501},(_,i)=>input(i+1))};
    await expect(f.app.bulkImport(large,actor)).rejects.toMatchObject({status:400});
    await expect(f.app.bulkImport({commandId:user,rows:[input(1)]},{...actor,isSystemAdmin:false,permissions:[]})).rejects.toMatchObject({status:403});
    expect(f.db.transaction).not.toHaveBeenCalled();
  });
});
