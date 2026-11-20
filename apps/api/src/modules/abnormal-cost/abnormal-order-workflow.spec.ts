import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const workflow=JSON.parse(readFileSync(path.resolve(__dirname,'../../../../../automation/n8n/abnormal-cost-orders-daily.json'),'utf8'));
const code=workflow.nodes.find((n:{type:string})=>n.type==='n8n-nodes-base.code').parameters.jsCode;
const check=(r:unknown)=>vm.runInNewContext(`(function(){${code}})()`,{$input:{first:()=>({json:r})}});
const result={status:'SUCCESS',runId:'019a0000-0000-7000-8000-000000000001',sources:['e10-main','tplus-kainan','tplus-kejia'].map(source=>({source,status:'SUCCESS',read:5,validLines:5})),metrics:Object.fromEntries(['read','validLines','beforeDedup','crossConflicts','total','added','updated','invalidated'].map(k=>[k,1]))};
describe('Abnormal order n8n scheduler',()=>{
 it('has one daily Shanghai automatic trigger, a controlled timeout and no direct database writes',()=>{const schedules=workflow.nodes.filter((n:{type:string})=>n.type==='n8n-nodes-base.scheduleTrigger');expect(schedules).toHaveLength(1);expect(schedules[0].parameters.rule.interval[0].expression).toBe('30 2 * * *');expect(workflow.settings).toMatchObject({timezone:'Asia/Shanghai',executionTimeout:1500});const cmd=workflow.nodes.find((n:{type:string})=>n.type==='n8n-nodes-base.ssh').parameters.command;expect(cmd).toContain('1200s');expect(cmd).toContain('REPORT_FAILURE');});
 it('accepts only an explicit successful exit with all three verified source counts',()=>{expect(check({code:0,stdout:JSON.stringify(result)})).toHaveLength(1);for(const patch of [{code:null},{code:''},{code:1},{stdout:JSON.stringify({...result,sources:result.sources.slice(1)})},{stdout:JSON.stringify({...result,status:'FAILED'})},{stdout:JSON.stringify({...result,metrics:{total:0}})}])expect(()=>check({code:0,stdout:JSON.stringify(result),...patch})).toThrow();});
});
