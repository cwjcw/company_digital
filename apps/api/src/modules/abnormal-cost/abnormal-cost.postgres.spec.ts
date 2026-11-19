import { DataSource, type QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { tablePermissionFieldsFor } from '@kdos/contracts';
import { AbnormalCost1722920132000 } from '../../migrations/1722920132000-AbnormalCost';
import { NotificationInfrastructure1722920067000 } from '../../migrations/1722920067000-NotificationInfrastructure';
import { NotificationRoutingAndRecipientDeliveries1722920068000 } from '../../migrations/1722920068000-NotificationRoutingAndRecipientDeliveries';
import { NotificationGroupWebhookRouting1722920113000 } from '../../migrations/1722920113000-NotificationGroupWebhookRouting';
import { NotificationService } from '../notifications/notification.service';
import { AbnormalCostApplicationService } from './abnormal-cost.application.service';
import { AbnormalCostGraphSpreadsheetService } from './abnormal-cost.graph-spreadsheet.service';
import { AbnormalCostSpreadsheetService } from './abnormal-cost.spreadsheet.service';
import { AbnormalCostFilterSources } from './abnormal-cost.filter-sources';
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { TableFilterController } from '../../common/filtering/table-filter.controller';
import { TablePrintService } from '../../common/printing/table-print.service';
import { detailWorkbookTemplate } from './abnormal-cost.domain';
import type { AbnormalActor, CostRow } from './abnormal-cost.policy';

const socket=process.env.KDOS_ABNORMAL_TEST_SOCKET;
(socket?describe:describe.skip)('Abnormal cost isolated PostgreSQL workflow',()=>{
  let db:DataSource,app:AbnormalCostApplicationService,sheets:AbnormalCostSpreadsheetService,notifications:NotificationService;
  const tenant='ABNORMAL_TEST',admin=randomUUID(),judge=randomUUID(),other=randomUUID(),department=randomUUID();
  const actor:AbnormalActor={tenantId:tenant,userId:admin,permissions:['*'],isSystemAdmin:true,displayName:'合成管理员',requestId:'test-abnormal'};
  const storage={put:jest.fn(async ({key}:{key:string})=>({key:`.private/${key}`})),delete:jest.fn(),get:jest.fn(async()=>({body:Buffer.from('fixture')}))};
  let category:string,detail:string;
  beforeAll(async()=>{
    if(!socket?.startsWith('/tmp/kdos-abnormal-pg/'))throw new Error('Only explicitly isolated unix socket is accepted');
    const schema=`abnormal_${randomUUID().replace(/-/g,'')}`;
    db=new DataSource({type:'postgres',host:socket,username:'postgres',database:'abnormal_test',extra:{max:12,options:`-c search_path=${schema},public`}});await db.initialize();await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE users(id uuid PRIMARY KEY,tenant_id text,username text,display_name text,enabled boolean NOT NULL DEFAULT true,wechat_user_id text,position text);
      CREATE TABLE organization_units(id uuid PRIMARY KEY,name text,enabled boolean DEFAULT true);
      CREATE TABLE administrator_grants(tenant_id text,user_id uuid,system_admin boolean);
      CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text,actor_id uuid,actor_name text,resource text,record_id text,action text,before_json jsonb,after_json jsonb,request_id text,source text,created_by uuid,updated_by text,created_at timestamptz DEFAULT now());`);
    await db.query(`INSERT INTO users VALUES($1,$4,'admin','合成管理员',true,'wx-admin','总经理'),($2,$4,'judge','合成判定人',true,'wx-judge','课长'),($3,$4,'other','合成他人',true,'wx-other','员工')`,[admin,judge,other,tenant]);
    await db.query('INSERT INTO organization_units(id,name) VALUES($1,\'合成部门\')',[department]);await db.query('INSERT INTO administrator_grants VALUES($1,$2,true)',[tenant,admin]);
    const runner={query:(sql:string,params?:unknown[])=>db.query(sql,params)} as QueryRunner;
    await new NotificationInfrastructure1722920067000().up(runner);await new NotificationRoutingAndRecipientDeliveries1722920068000().up(runner);await db.query("ALTER TABLE notification_delivery_logs ADD COLUMN component varchar(32) NOT NULL DEFAULT 'text',ADD COLUMN attachment_id uuid");await new NotificationGroupWebhookRouting1722920113000().up(runner);await new AbnormalCost1722920132000().up(runner);
    notifications=new NotificationService(db);app=new AbnormalCostApplicationService(db,notifications,storage as never);sheets=new AbnormalCostSpreadsheetService(app,new AbnormalCostGraphSpreadsheetService(app,{listEnabled:async()=>[{id:department,name:'合成部门',pathLabel:'合成部门'}]} as never));
  },30000);
  beforeEach(async()=>{
    await db.query('TRUNCATE abnormal_cost_import_previews,abnormal_cost_commands,abnormal_cost_counters,abnormal_responsibility_judgments,abnormal_responsibility_requests,abnormal_cost_attachments,abnormal_categories,incident_severity_levels,audit_logs,notification_outbox CASCADE');
    category=(await app.saveBasic('abnormal-categories',null,{category_name:'品质',remark:''},actor)).id;
    await app.saveBasic('incident-severity-levels',null,{amount_min:'0.00',amount_max:'1000.00',severity_name:'一般'},actor);
    const book=new ExcelJS.Workbook();await book.xlsx.load(await detailWorkbookTemplate() as never);book.worksheets[0].addRow(['SYN-ORDER','SYN-ITEM','合成品名',10,1,'']);
    detail=(await app.upload({originalname:'details.xlsx',buffer:Buffer.from(await book.xlsx.writeBuffer()),mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'} as Express.Multer.File,'DETAIL',actor)).id;
  });
  afterAll(async()=>{if(db?.isInitialized)await db.destroy();});
  const body=()=>({customer_code:'SYN-CUSTOMER',order_no:'SYN-ORDER',division_id:department,initiator_id:admin,abnormal_description:'合成异常',estimated_amount:'100.00',confirmed_amount:'100.00',detail_attachment:detail,other_attachments:[],responsibility_judgments:[{category_id:category,judgment_department_id:department,judge_user_id:judge,expense_bearing_ratio:null}]});
  const create=(key:string=randomUUID())=>app.createRequest(body(),key,actor);
  const allocations=(responsibility='100.0',adjusted='100.0')=>[{personnel_type:'公司',company_description:'公司',responsible_user_id:other,personnel_level:'总经理',responsibility_ratio:responsibility,adjusted_ratio:adjusted}];
  it('creates a parent and unjudged linked children atomically with stable numbers, detail data, audit and outbox',async()=>{
    const r=await create('atomic');expect(r.abnormal_no).toMatch(/^YC\d{6}SYN-CUSTOMER001$/);expect(r.judgments[0].judgment_no).toBe(`${r.abnormal_no}01`);
    const child=(await db.query('SELECT * FROM abnormal_responsibility_judgments'))[0];expect(child).toMatchObject({request_id:r.id,expense_bearing_ratio:null,judgment_status:'PENDING',responsibility_allocations:[]});
    expect((await db.query('SELECT * FROM abnormal_cost_attachments'))[0].parsed_rows).toHaveLength(1);expect(await db.query('SELECT * FROM notification_outbox')).toHaveLength(1);
    expect((await create('atomic')).repeated).toBe(true);expect(await db.query('SELECT * FROM abnormal_responsibility_requests')).toHaveLength(1);expect(await db.query('SELECT * FROM notification_outbox')).toHaveLength(1);
    expect((await app.detail('abnormal-responsibility-requests',r.id,actor)).responsibility_judgments).toHaveLength(1);
    const claims=await notifications.claimForDispatcher(tenant,'isolated-dispatcher');expect(claims).toHaveLength(1);expect(claims[0].content).toContain(r.abnormal_no);expect(claims[0].content).toContain('品质');expect(claims[0].content).toContain('/workflow/abnormal-cost/judgments/');expect(claims[0].recipients[0]).toMatchObject({userId:judge,wechatUserId:'wx-judge'});
  });
  it('creates one independent judgment per submitted responsibility row, preserving duplicate categories and nullable ratios',async()=>{
    const base=body();const rows=[
      {category_id:category,judgment_department_id:department,judge_user_id:judge,expense_bearing_ratio:'60'},
      {category_id:category,judgment_department_id:department,judge_user_id:judge,expense_bearing_ratio:'40'},
      {category_id:category,judgment_department_id:department,judge_user_id:judge,expense_bearing_ratio:null}
    ];
    const parent=await app.createRequest({...base,responsibility_judgments:rows},'three-judgments',actor);
    const children=await db.query('SELECT id,request_id,judgment_no,category_id,judgment_department_id,judge_user_id,expense_bearing_ratio,judgment_status FROM abnormal_responsibility_judgments WHERE tenant_id=$1 AND request_id=$2::uuid ORDER BY judgment_no',[tenant,parent.id]);
    expect(children).toHaveLength(3);
    expect(children.map((row:CostRow)=>row.judgment_no)).toEqual([`${parent.abnormal_no}01`,`${parent.abnormal_no}02`,`${parent.abnormal_no}03`]);
    expect(children.every((row:CostRow)=>row.request_id===parent.id&&row.category_id===category&&row.judgment_department_id===department&&row.judge_user_id===judge&&row.judgment_status==='PENDING')).toBe(true);
    expect(children.map((row:CostRow)=>row.expense_bearing_ratio)).toEqual([60,40,null]);
    expect(await db.query("SELECT id FROM notification_outbox WHERE tenant_id=$1 AND event_type='workflow.abnormal.judgment_assigned'",[tenant])).toHaveLength(3);
  });
  it('allocates unique three-digit numbers under concurrent requests and rejects exhausted counters without partial rows',async()=>{
    const created=await Promise.all(Array.from({length:8},()=>create()));expect(new Set(created.map(r=>r.abnormal_no)).size).toBe(8);expect(created.every(r=>/\d{3}$/.test(r.abnormal_no))).toBe(true);
    await db.query('UPDATE abnormal_cost_counters SET last_number=999');await expect(create()).rejects.toThrow('三位异常编号已耗尽');expect(await db.query('SELECT * FROM abnormal_responsibility_requests')).toHaveLength(8);
  });
  it('rejects bad references and missing children with no orphan request, number or notification',async()=>{
    await expect(app.createRequest({...body(),responsibility_judgments:[]},'empty',actor)).rejects.toThrow('至少配置');
    await expect(app.createRequest({...body(),responsibility_judgments:[{category_id:randomUUID(),judgment_department_id:department,judge_user_id:judge}]},'bad-ref',actor)).rejects.toThrow('类别无效');
    expect(await db.query('SELECT * FROM abnormal_responsibility_requests')).toHaveLength(0);expect(await db.query('SELECT * FROM abnormal_cost_counters')).toHaveLength(0);expect(await db.query('SELECT * FROM notification_outbox')).toHaveLength(0);
  });
  it('matches closed intervals and serializes overlapping interval creation',async()=>{
    await expect(app.saveBasic('incident-severity-levels',null,{amount_min:'1000',amount_max:'2000',severity_name:'严重'},actor)).rejects.toThrow('重叠');
    const results=await Promise.allSettled([app.saveBasic('incident-severity-levels',null,{amount_min:'1000.01',amount_max:'2000',severity_name:'重大'},actor),app.saveBasic('incident-severity-levels',null,{amount_min:'1500',amount_max:'2500',severity_name:'特大'},actor)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    await expect(app.createRequest({...body(),confirmed_amount:'3000'},'nomatch',actor)).rejects.toThrow('完善事故级别');
    await expect(app.createRequest({...body(),estimated_amount:0},'zero',actor)).rejects.toThrow('金额必须大于0');
  });
  it('completes and revises a judgment with exact sums, system-admin company default, versioning and audit',async()=>{
    const r=await create(),child=r.judgments[0];
    await expect(app.updateJudgment(child.id,{expectedVersion:1,complete:true,responsibility_allocations:allocations('99.9')},actor)).rejects.toThrow('责任比例合计应为100%');
    await expect(app.updateJudgment(child.id,{expectedVersion:1,complete:true,responsibility_allocations:allocations('100.0','99.9')},actor)).rejects.toThrow('申诉后责任比例合计应为100%');
    const result=await app.updateJudgment(child.id,{expectedVersion:1,complete:true,responsibility_allocations:allocations()},actor);expect(result.judgment_status).toBe('COMPLETED');
    const saved=await app.detail('abnormal-responsibility-judgments',child.id,actor);expect(saved.responsibility_allocations[0].responsible_user_id).toBe(admin);expect(saved.abnormal_request_link).toContain(r.id);
    await expect(app.updateJudgment(child.id,{expectedVersion:1,responsibility_reason:'旧版本'},actor)).rejects.toThrow('记录已修改');
    await app.updateJudgment(child.id,{expectedVersion:2,responsibility_reason:'线下复核说明',responsibility_allocations:saved.responsibility_allocations},actor);
    expect(await db.query("SELECT * FROM audit_logs WHERE action='abnormal.judgment.updated'")).toHaveLength(2);
    await expect(app.remove('abnormal-responsibility-requests',r.id,1,actor)).rejects.toThrow('不能删除异常单');
  });
  it('protects deletion, field permissions, tenant boundaries and assigned judge data scopes',async()=>{
    const r=await create(),child=r.judgments[0];
    const permissions=['read','update','import'].map(action=>`${'abnormal-responsibility-judgments'}:*:${action}`).concat(tablePermissionFieldsFor('abnormal-responsibility-judgments').flatMap(f=>[`abnormal-responsibility-judgments:${f.key}:read`,`abnormal-responsibility-judgments:${f.key}:update`]));
    const assigned:AbnormalActor={...actor,userId:judge,isSystemAdmin:false,permissions,tableDataScopes:[{resource:'abnormal-responsibility-judgments',scope:'CUSTOM',rules:[{fieldKey:'judge_user_id',operator:'EQ',value:'CURRENT_USER'}]}]};
    expect((await app.detail('abnormal-responsibility-judgments',child.id,assigned)).id).toBe(child.id);
    await expect(app.detail('abnormal-responsibility-judgments',child.id,{...assigned,userId:other})).rejects.toThrow('无权操作');
    await expect(app.detail('abnormal-responsibility-requests',r.id,assigned)).rejects.toThrow('没有此表');
    await expect(app.detail('abnormal-responsibility-judgments',child.id,{...actor,tenantId:'OTHER'})).rejects.toThrow('无权操作');
    await expect(app.remove('abnormal-responsibility-judgments',child.id,1,assigned)).rejects.toThrow('没有此表');
    await expect(app.remove('abnormal-categories',category,1,actor)).rejects.toThrow('已被引用');
    await expect(app.remove('abnormal-responsibility-judgments',child.id,1,actor)).rejects.toThrow('至少保留');
    await app.updateJudgment(child.id,{expectedVersion:1,complete:true,responsibility_allocations:allocations()},assigned);
  });
  it('grants an assigned judge access only to their own judgment without a global permission grant',async()=>{
    const r=await app.createRequest({...body(),responsibility_judgments:[
      {category_id:category,judgment_department_id:department,judge_user_id:judge},
      {category_id:category,judgment_department_id:department,judge_user_id:other}
    ]},'assignment-scope',actor);
    const assigned:AbnormalActor={...actor,userId:judge,isSystemAdmin:false,permissions:[]};
    expect((await app.detail('abnormal-responsibility-judgments',r.judgments[0].id,assigned)).id).toBe(r.judgments[0].id);
    await expect(app.detail('abnormal-responsibility-judgments',r.judgments[1].id,assigned)).rejects.toThrow('无权操作');
    const registry=new TableFilterRegistry();new AbnormalCostFilterSources(registry,db,app).onModuleInit();
    const controller=new TableFilterController({} as never,registry,{} as never,db),previous=process.env.KDOS_DEFAULT_TENANT_CODE;process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
    try{
      const listed=await controller.rows({resource:'abnormal-responsibility-judgments',page:'1',pageSize:'50'},{user:{sub:judge,permissions:[]}} as never);
      expect(listed.total).toBe(1);expect(listed.rows).toHaveLength(1);expect(listed.rows[0]).toMatchObject({id:r.judgments[0].id,judge_user_id:judge});
      const otherListed=await controller.rows({resource:'abnormal-responsibility-judgments',page:'1',pageSize:'50'},{user:{sub:other,permissions:[]}} as never);
      expect(otherListed.total).toBe(1);expect(otherListed.rows[0]).toMatchObject({id:r.judgments[1].id,judge_user_id:other});
    }finally{if(previous==null)delete process.env.KDOS_DEFAULT_TENANT_CODE;else process.env.KDOS_DEFAULT_TENANT_CODE=previous;}
    await expect(app.detail('abnormal-responsibility-requests',r.id,assigned)).rejects.toThrow('没有此表');
    await expect(app.updateJudgment(r.judgments[0].id,{expectedVersion:1,judge_user_id:other},assigned)).rejects.toThrow('只能维护本人记录');
    await expect(app.remove('abnormal-responsibility-judgments',r.judgments[0].id,1,assigned)).rejects.toThrow('没有此表');
    const completed=await app.updateJudgment(r.judgments[0].id,{expectedVersion:1,complete:true,responsibility_allocations:allocations()},assigned);
    expect(completed.judgment_status).toBe('COMPLETED');
    expect((await app.detail('abnormal-responsibility-judgments',r.judgments[0].id,assigned)).responsibility_allocations).toHaveLength(1);
  });
  it('blocks forged attachments and deletion of persisted allocation rows without delete permission',async()=>{
    const r=await create(),id=r.judgments[0].id;
    await expect(app.attachment('abnormal-responsibility-requests',r.id,randomUUID(),actor)).rejects.toThrow('无附件读取权限');
    await expect(app.createRequest({...body(),detail_attachment:randomUUID()},'bad-attachment',actor)).rejects.toThrow('附件不存在');
    await app.updateJudgment(id,{expectedVersion:1,responsibility_allocations:allocations()},actor);
    const scoped:AbnormalActor={...actor,isSystemAdmin:false,permissions:[`abnormal-responsibility-judgments:*:update`,...tablePermissionFieldsFor('abnormal-responsibility-judgments').flatMap(f=>[`abnormal-responsibility-judgments:${f.key}:read`,`abnormal-responsibility-judgments:${f.key}:update`])],tableDataScopes:[{resource:'abnormal-responsibility-judgments',scope:'ALL'}]};
    await expect(app.updateJudgment(id,{expectedVersion:2,responsibility_allocations:[]},scoped)).rejects.toThrow('没有此表');
  });
  it('imports basic Excel via validated preview, atomic confirm and repeat-confirm idempotence',async()=>{
    const book=new ExcelJS.Workbook();await book.xlsx.load(await sheets.template('abnormal-categories','CREATE',{},actor) as never);book.worksheets[0].addRow(['','','交付','导入备注']);
    const preview=await sheets.preview('abnormal-categories',Buffer.from(await book.xlsx.writeBuffer()),actor);expect(preview.errors).toEqual([]);expect((await db.query('SELECT * FROM abnormal_categories'))).toHaveLength(1);
    expect(await sheets.confirm('abnormal-categories',preview.previewId,actor)).toMatchObject({created:1,updated:0});expect((await sheets.confirm('abnormal-categories',preview.previewId,actor)).repeated).toBe(true);
    const updated=new ExcelJS.Workbook();await updated.xlsx.load(await sheets.template('abnormal-categories','UPDATE',{},actor) as never);updated.worksheets[0].getCell('D2').value='更新备注';
    const change=await sheets.preview('abnormal-categories',Buffer.from(await updated.xlsx.writeBuffer()),actor);expect(change.errors).toEqual([]);await sheets.confirm('abnormal-categories',change.previewId,actor);
    expect((await db.query('SELECT remark FROM abnormal_categories ORDER BY created_at DESC LIMIT 1'))[0].remark).toBe('更新备注');
  });
  it('keeps child sequence gaps, updates request severity, and refuses fractional expense ratios',async()=>{
    const r=await create();
    const second=await app.addJudgment(r.id,{category_id:category,judgment_department_id:department,judge_user_id:judge,expense_bearing_ratio:'60'},'second',actor);
    await expect(app.addJudgment(r.id,{category_id:category,judgment_department_id:department,judge_user_id:judge,expense_bearing_ratio:'60.5'},'invalid-percent',actor)).rejects.toThrow('承担费用比例');
    await app.remove('abnormal-responsibility-judgments',second.id,1,actor);
    const third=await app.addJudgment(r.id,{category_id:category,judgment_department_id:department,judge_user_id:judge},'third',actor);expect(third.judgment_no).toBe(`${r.abnormal_no}03`);
    const severity=await app.saveBasic('incident-severity-levels',null,{amount_min:'1000.01',amount_max:'2000.00',severity_name:'重大'},actor);
    const current=await app.detail('abnormal-responsibility-requests',r.id,actor);await app.updateRequest(r.id,{expectedVersion:current.version,confirmed_amount:'1500.00'},actor);
    expect((await app.detail('abnormal-responsibility-requests',r.id,actor)).severity_level_id).toBe(severity.id);
  });
  it('synchronizes pristine request children atomically and idempotently while preserving child identity and protecting started work',async()=>{
    const r=await create(),initial=await app.detail('abnormal-responsibility-requests',r.id,actor),child=initial.responsibility_judgments[0];
    const second={category_id:category,judgment_department_id:department,judge_user_id:judge,expense_bearing_ratio:'60'};
    const change={expectedVersion:initial.version,abnormal_description:'编辑后的异常说明',responsibility_judgments:[{id:child.id,version:child.version,category_id:category,judgment_department_id:department,judge_user_id:judge,expense_bearing_ratio:'40'},second]};
    const saved=await app.updateRequest(r.id,change,actor,undefined,'request-edit-key');expect(saved.version).toBe(initial.version+1);
    expect((await app.updateRequest(r.id,change,actor,undefined,'request-edit-key') as CostRow).repeated).toBe(true);
    let all=await db.query('SELECT id,judgment_no,version,expense_bearing_ratio,deleted_at FROM abnormal_responsibility_judgments WHERE tenant_id=$1 AND request_id=$2::uuid ORDER BY judgment_no',[tenant,r.id]);
    expect(all).toHaveLength(2);expect(all[0]).toMatchObject({id:child.id,judgment_no:child.judgment_no,expense_bearing_ratio:40});expect(all[1].judgment_no).toBe(`${r.abnormal_no}02`);
    expect(await db.query("SELECT id FROM notification_outbox WHERE event_type='workflow.abnormal.judgment_assigned'")).toHaveLength(2);
    const latest=await app.detail('abnormal-responsibility-requests',r.id,actor),kept=latest.responsibility_judgments[0];
    await app.updateRequest(r.id,{expectedVersion:latest.version,responsibility_judgments:[{id:kept.id,version:kept.version,category_id:kept.category_id,judgment_department_id:kept.judgment_department_id,judge_user_id:kept.judge_user_id,expense_bearing_ratio:kept.expense_bearing_ratio}]},actor,undefined,'request-edit-remove');
    all=await db.query('SELECT id,deleted_at FROM abnormal_responsibility_judgments WHERE tenant_id=$1 AND request_id=$2::uuid ORDER BY judgment_no',[tenant,r.id]);expect(all[1].deleted_at).not.toBeNull();expect(all[0].id).toBe(child.id);
    await app.addJudgment(r.id,second,'add-before-start',actor);
    const current=await app.detail('abnormal-responsibility-requests',r.id,actor),started=current.responsibility_judgments[0],pristine=current.responsibility_judgments[1];
    await app.updateJudgment(started.id,{expectedVersion:started.version,responsibility_reason:'已开始处理'},actor);
    const afterStart=await app.detail('abnormal-responsibility-requests',r.id,actor);
    await expect(app.updateRequest(r.id,{expectedVersion:afterStart.version,responsibility_judgments:[{id:pristine.id,version:pristine.version,category_id:pristine.category_id,judgment_department_id:pristine.judgment_department_id,judge_user_id:pristine.judge_user_id}]},actor,undefined,'remove-started')).rejects.toThrow('已开始或已完成');
    expect((await app.detail('abnormal-responsibility-requests',r.id,actor)).responsibility_judgments[0].responsibility_reason).toBe('已开始处理');
  });
  it('quarantines an undeliverable judge with an explicit recoverable failure log',async()=>{
    await create();await db.query('UPDATE users SET wechat_user_id=NULL WHERE id=$1',[judge]);
    expect(await notifications.claimForDispatcher(tenant,'missing-wechat')).toEqual([]);
    const [failure]=await db.query('SELECT status,last_error FROM notification_outbox');expect(failure).toMatchObject({status:'FAILED',last_error:'ABNORMAL_JUDGE_NOT_DELIVERABLE'});
    expect(await db.query("SELECT * FROM notification_delivery_logs WHERE errcode='ABNORMAL_JUDGE_NOT_DELIVERABLE'")).toHaveLength(1);
    await db.query("UPDATE users SET wechat_user_id='wx-judge' WHERE id=$1",[judge]);
    await db.query("UPDATE notification_outbox SET status='PENDING',next_retry_at=now()");expect(await notifications.claimForDispatcher(tenant,'retry-judge')).toHaveLength(1);
  });
  it('uses one server filter, stable sort and full-set total across pages and export',async()=>{
    await Promise.all(Array.from({length:51},()=>create()));
    const registry=new TableFilterRegistry();new AbnormalCostFilterSources(registry,db,app).onModuleInit();
    const controller=new TableFilterController({} as never,registry,{} as never,db),previous=process.env.KDOS_DEFAULT_TENANT_CODE;process.env.KDOS_DEFAULT_TENANT_CODE=tenant;
    try{
      const query={resource:'abnormal-responsibility-requests',page:'1',pageSize:'50',sortField:'abnormal_no',sortOrder:'asc',filterGroup:JSON.stringify({logic:'AND',rules:[{field:'confirmed_amount',operator:'gte',value:'100.00'}]})},request={user:{sub:admin,permissions:['*'],isSystemAdmin:true}} as never;
      const first=await controller.rows(query,request),second=await controller.rows({...query,page:'2'},request);expect(first.total).toBe(51);expect(second.total).toBe(51);expect(first.rows).toHaveLength(50);expect(second.rows).toHaveLength(1);expect(first.rows[0].id).not.toBe(second.rows[0].id);
      const file=await new TablePrintService(registry,db).exportXlsx('abnormal-responsibility-requests',{rangeType:'FILTERED',columnKeys:['abnormal_no','confirmed_amount'],filterGroup:query.filterGroup,sortField:query.sortField,sortOrder:query.sortOrder},actor),book=new ExcelJS.Workbook();await book.xlsx.load(file as never);expect(book.worksheets[0].rowCount).toBe(52);expect(book.worksheets[0].getCell('A2').text).toBe(first.rows[0].abnormal_no);
    }finally{if(previous==null)delete process.env.KDOS_DEFAULT_TENANT_CODE;else process.env.KDOS_DEFAULT_TENANT_CODE=previous;}
  });
  it('uses the shared filtered export with relation display values rather than UUIDs',async()=>{
    const r=await create(),registry=new TableFilterRegistry();new AbnormalCostFilterSources(registry,db,app).onModuleInit();
    const file=await new TablePrintService(registry,db).exportXlsx('abnormal-responsibility-judgments',{rangeType:'FILTERED',columnKeys:['judgment_no','category_id'],filterGroup:JSON.stringify({logic:'AND',rules:[{field:'judgment_no',operator:'eq',value:r.judgments[0].judgment_no}]})},actor);
    const book=new ExcelJS.Workbook();await book.xlsx.load(file as never);expect(book.worksheets[0].getCell('B2').text).toBe('品质');expect(book.worksheets[0].rowCount).toBe(2);
  });
  const excelRow=(book:ExcelJS.Workbook,values:CostRow,index=2)=>{const sheet=book.worksheets[0];sheet.getRow(1).eachCell((cell,column)=>{if(cell.text in values)sheet.getRow(index).getCell(column).value=values[cell.text];});};
  const graphBook=async(code:'abnormal-responsibility-requests'|'abnormal-responsibility-judgments',mode='CREATE',query:CostRow={})=>{const book=new ExcelJS.Workbook();await book.xlsx.load(await sheets.template(code,mode,query,actor) as never);return book;};
  const mainExcel=()=>({'客户':'SYN-EXCEL','订单号':'SYN-ORDER','事业部':'合成部门','发起人':'admin','异常描述':'Excel合成异常','预估金额':'100.00','明细附件':'details.xlsx','责任划分':JSON.stringify([{'异常类别':'品质','判定部门':'合成部门','判定人':'judge','承担费用比例':null}])});
  it('imports complete request graphs with business labels, validated attachment names and file-level idempotence',async()=>{
    const book=await graphBook('abnormal-responsibility-requests');excelRow(book,mainExcel());const file=Buffer.from(await book.xlsx.writeBuffer());
    const preview=await sheets.preview('abnormal-responsibility-requests',file,actor);expect(preview.errors).toEqual([]);expect(await db.query('SELECT * FROM abnormal_responsibility_requests')).toHaveLength(0);expect(await db.query('SELECT * FROM notification_outbox')).toHaveLength(0);expect(await db.query('SELECT * FROM abnormal_cost_counters')).toHaveLength(0);
    const simultaneous=await sheets.preview('abnormal-responsibility-requests',file,actor);expect(simultaneous.errors).toEqual([]);const confirmed=await Promise.all([sheets.confirm('abnormal-responsibility-requests',preview.previewId,actor),sheets.confirm('abnormal-responsibility-requests',simultaneous.previewId,actor)]);expect(confirmed.reduce((sum,r)=>sum+r.created,0)).toBe(1);expect((await sheets.confirm('abnormal-responsibility-requests',preview.previewId,actor)).repeated).toBe(true);
    const again=await sheets.preview('abnormal-responsibility-requests',file,actor);expect(again.errors).toEqual([]);expect(await sheets.confirm('abnormal-responsibility-requests',again.previewId,actor)).toMatchObject({created:0,repeated:1});
    expect(await db.query('SELECT * FROM abnormal_responsibility_requests')).toHaveLength(1);expect(await db.query('SELECT * FROM abnormal_responsibility_judgments')).toHaveLength(1);expect(await db.query('SELECT * FROM notification_outbox')).toHaveLength(1);
    const update=await graphBook('abnormal-responsibility-requests','UPDATE');expect(update.worksheets[0].getRow(2).values?.toString()).toContain('合成部门');expect(update.worksheets[0].getRow(2).values?.toString()).toContain('details.xlsx');expect(update.worksheets[0].getRow(1).values?.toString()).not.toContain('责任划分');
  });
  it('accepts mixed graph creates and updates, and rolls the entire confirm back on a concurrent stale version',async()=>{
    const old=await create(),book=await graphBook('abnormal-responsibility-requests');excelRow(book,mainExcel());excelRow(book,{'记录ID':old.id,'版本':old.version,'异常描述':'更新说明'},3);
    const preview=await sheets.preview('abnormal-responsibility-requests',Buffer.from(await book.xlsx.writeBuffer()),actor);expect(preview.errors).toEqual([]);expect(await sheets.confirm('abnormal-responsibility-requests',preview.previewId,actor)).toMatchObject({created:1,updated:1});
    const stale=await graphBook('abnormal-responsibility-requests');excelRow(stale,{...mainExcel(),'客户':'SYN-ROLLBACK'});excelRow(stale,{'记录ID':old.id,'版本':2,'异常描述':'并发说明'},3);const pending=await sheets.preview('abnormal-responsibility-requests',Buffer.from(await stale.xlsx.writeBuffer()),actor);expect(pending.errors).toEqual([]);
    await app.updateRequest(old.id,{expectedVersion:2,abnormal_description:'其他操作者更新'},actor);await expect(sheets.confirm('abnormal-responsibility-requests',pending.previewId,actor)).rejects.toThrow('记录已修改');expect(await db.query('SELECT * FROM abnormal_responsibility_requests')).toHaveLength(2);expect(await db.query('SELECT * FROM notification_outbox')).toHaveLength(2);expect(await db.query("SELECT * FROM abnormal_cost_counters WHERE customer_code='SYN-ROLLBACK'")).toHaveLength(0);
  });
  it('imports child configurations against a real parent and preserves allocation identities through business JSON templates',async()=>{
    const parent=await create(),book=await graphBook('abnormal-responsibility-judgments');excelRow(book,{'主表异常单号':parent.abnormal_no,'异常类别':'品质','判定部门':'合成部门','判定人':'judge','承担费用比例':'60'});const preview=await sheets.preview('abnormal-responsibility-judgments',Buffer.from(await book.xlsx.writeBuffer()),actor);expect(preview.errors).toEqual([]);await sheets.confirm('abnormal-responsibility-judgments',preview.previewId,actor);
    const children=await db.query('SELECT * FROM abnormal_responsibility_judgments ORDER BY judgment_no');expect(children).toHaveLength(2);expect(children[1].judgment_no).toBe(`${parent.abnormal_no}02`);expect(children[0].id).toBe(parent.judgments[0].id);
    const update=await graphBook('abnormal-responsibility-judgments','UPDATE',{requestId:parent.id});let index=0;update.worksheets[0].eachRow((row,i)=>{if(row.getCell(1).text===children[1].id)index=i;});expect(index).toBeGreaterThan(1);
    excelRow(update,{'责任划分':JSON.stringify([{'人员类型':'公司','公司说明':'公司','人员层级':'总经理','责任比例':'100.0','申诉后责任比例':'100.0'}])},index);const change=await sheets.preview('abnormal-responsibility-judgments',Buffer.from(await update.xlsx.writeBuffer()),actor);expect(change.errors).toEqual([]);await sheets.confirm('abnormal-responsibility-judgments',change.previewId,actor);
    const current=await app.detail('abnormal-responsibility-judgments',children[1].id,actor);expect(current.judgment_status).toBe('PENDING');expect(current.responsibility_allocations[0].responsible_user_id).toBe(admin);
    const retained=await graphBook('abnormal-responsibility-judgments','UPDATE',{requestId:parent.id});const keep=await sheets.preview('abnormal-responsibility-judgments',Buffer.from(await retained.xlsx.writeBuffer()),actor);expect(keep.errors).toEqual([]);await sheets.confirm('abnormal-responsibility-judgments',keep.previewId,actor);expect((await app.detail('abnormal-responsibility-judgments',children[1].id,actor)).responsibility_allocations[0].id).toBe(current.responsibility_allocations[0].id);
  });
  it('rejects graph UUID references, missing validated files, invalid allocations and revoked import access without partial data',async()=>{
    await expect(sheets.preview('abnormal-responsibility-requests',Buffer.from([0x88,0x7d,0x1c,0xe4]),actor)).rejects.toThrow('该文件被加密,请解密后再导入.');
    const book=await graphBook('abnormal-responsibility-requests');excelRow(book,{...mainExcel(),'发起人':admin});const invalid=await sheets.preview('abnormal-responsibility-requests',Buffer.from(await book.xlsx.writeBuffer()),actor);expect(invalid.errors[0].reason).toContain('不接受内部UUID');expect(invalid.previewId).toBeUndefined();
    excelRow(book,{...mainExcel(),'明细附件':'not-uploaded.xlsx'});expect((await sheets.preview('abnormal-responsibility-requests',Buffer.from(await book.xlsx.writeBuffer()),actor)).errors[0].reason).toContain('未准备');
    excelRow(book,mainExcel());const valid=await sheets.preview('abnormal-responsibility-requests',Buffer.from(await book.xlsx.writeBuffer()),actor);await expect(sheets.confirm('abnormal-responsibility-requests',valid.previewId,{...actor,isSystemAdmin:false,permissions:[]})).rejects.toThrow('没有此表');expect(await db.query('SELECT * FROM abnormal_responsibility_requests')).toHaveLength(0);
    const parent=await create();await expect(app.updateJudgment(parent.judgments[0].id,{expectedVersion:1,responsibility_allocations:{}},actor)).rejects.toThrow('责任划分必须为数组');await expect(app.updateJudgment(parent.judgments[0].id,{expectedVersion:1,responsibility_allocations:[null]},actor)).rejects.toThrow('第1行责任划分无效');
  });

});
