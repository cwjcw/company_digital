import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PmcRdProgressCalculator, summarize } from './pmc-rd-progress.calculator';
import { guid, timestamp, sourceInstant, type SourceBundle } from './pmc-rd-progress.types';
const cases = JSON.parse(readFileSync(path.resolve(__dirname,'../../../../../data-operations/e10/fixtures/pmc-rd-progress.json'),'utf8')) as Array<{name:string;facts:SourceBundle;expected:Record<string,unknown>}>;
const mappings: Record<string,string>={rdStatus:'rdStatus',designBomStatus:'designBomStatus',routingStatus:'routingStatus',reasonCode:'reasonCode',reasonText:'reasonText',bomId:'bomId',bomVersion:'bomVersion',bomECode:'bomECode',bomApproveStatus:'bomApproveStatus',validBomDetailCount:'validBomDetailCount',routingId:'itemRoutingId',routingCode:'routingCode',routingApproveStatus:'routingApproveStatus',validOperationCount:'validOperationCount',routingSource:'routingSource',rdLastModifiedAt:'rdLastModifiedAt'};
describe('PMC研发进度 Phase 3共用Oracle场景',()=>{
  test.each(cases)('$name',({facts,expected})=>{
    const [actual]=new PmcRdProgressCalculator().calculate(facts);
    for (const [key,oracleKey] of Object.entries(mappings)) expect(key === 'rdLastModifiedAt' ? timestamp(actual![key]) : actual![key]).toEqual(key === 'rdLastModifiedAt' ? timestamp(expected[oracleKey]) : expected[oracleKey]);
  });
  it('CLOSE原始值保留但不影响研发判定',()=>{const facts=structuredClone(cases.find(c=>c.name==='COMPLETE')!.facts);facts.orders[0]!.order_close_raw='1';expect(new PmcRdProgressCalculator().calculate(facts)[0]).toMatchObject({rdStatus:'COMPLETE',orderCloseRaw:'1'});});
  it('规范化零GUID与保留微秒和上海时区',()=>{expect(guid('00000000-0000-0000-0000-000000000000')).toBeNull();expect(guid('6FEE95FC-CD25-46A3-AC94-1BE37EFEB273')).toBe('6fee95fc-cd25-46a3-ac94-1be37efeb273');expect(timestamp('2026-10-06T12:00:00.000978')).toBe('2026-10-06 12:00:00.000978');expect(sourceInstant('2026-10-06 12:00:00.000978')).toBe('2026-10-06T12:00:00.000978+08:00');});
  it('完成可以倒退为待工艺和设计进行中',()=>{const calc=new PmcRdProgressCalculator();expect(calc.calculate(cases.find(c=>c.name==='COMPLETE')!.facts)[0]!.rdStatus).toBe('COMPLETE');expect(calc.calculate(cases.find(c=>c.name==='WAITING_ROUTING')!.facts)[0]!.rdStatus).toBe('WAITING_ROUTING');expect(calc.calculate(cases.find(c=>c.name==='BOM_NOT_APPROVED_N')!.facts)[0]!.rdStatus).toBe('DESIGN_IN_PROGRESS');});
  it('排除不适用品项、路线控制0的分母并将异常计入未完成',()=>{
    const summary=summarize([{rdStatus:'COMPLETE',designBomStatus:'COMPLETE',routingStatus:'COMPLETE',routingControl:'1'},{rdStatus:'NOT_APPLICABLE',designBomStatus:'NOT_APPLICABLE',routingStatus:'NOT_APPLICABLE',routingControl:'0'},{rdStatus:'ABNORMAL',designBomStatus:'ABNORMAL',routingStatus:'ABNORMAL',routingControl:'0'}]);
    expect(summary).toMatchObject({applicableItemCount:2,completeItemCount:1,incompleteItemCount:1,abnormalItemCount:1,overallCompletionRate:'50.00',designBomCompletionRate:'50.00',routingCompletionRate:'100.00',orderRdStatus:'ABNORMAL'});expect(summary.statusCounts.DESIGN_IN_PROGRESS).toBe(0);
  });
  test.each([['NOT_APPLICABLE','NOT_APPLICABLE'],['COMPLETE','COMPLETE'],['WAITING_ROUTING','IN_PROGRESS'],['ABNORMAL','ABNORMAL']])('订单全是%s时为%s',(rdStatus,expected)=>{expect(summarize([{rdStatus}]).orderRdStatus).toBe(expected);});
});
