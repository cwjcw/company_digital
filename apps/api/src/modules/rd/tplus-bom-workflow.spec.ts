import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
const workflow=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../../automation/n8n/tplus-bom-reconcile-daily.json'),'utf8'));
const code=workflow.nodes.find((n:any)=>n.type==='n8n-nodes-base.code').parameters.jsCode;
const run=(r:any)=>runInNewContext(`(function(){${code}})()`,{$input:{first:()=>({json:r})}});
describe('T+ n8n reconciliation exit validation',()=>{
 it('uses one Shanghai schedule and a sequential command without message nodes',()=>{
  expect(workflow.settings.timezone).toBe('Asia/Shanghai');
  expect(workflow.nodes.filter((n:any)=>n.type==='n8n-nodes-base.scheduleTrigger')).toHaveLength(1);
  expect(workflow.nodes.map((n:any)=>n.type)).toEqual(['n8n-nodes-base.scheduleTrigger','n8n-nodes-base.ssh','n8n-nodes-base.code','n8n-nodes-base.executeWorkflowTrigger']);
 });
 it('fails nonzero exits, incomplete success and false generation switches',()=>{
  expect(()=>run({code:1,stdout:'{}'})).toThrow('EXIT_FAILED');
  expect(()=>run({code:0,stdout:'{}'})).toThrow('RESULT_FAILED');
  const result={status:'SUCCESS',mode:'RECONCILE',sources:['tplus-kejia','tplus-kainan'].map(source=>({source,status:'SUCCESS',activeGeneration:'g',scanned:3,valid:2,sourceVerified:true}))};
  expect(run({code:0,stdout:JSON.stringify(result)})[0].json.status).toBe('SUCCESS');
  delete (result.sources[1] as any).activeGeneration;
  expect(()=>run({code:0,stdout:JSON.stringify(result)})).toThrow('GENERATION_NOT_VERIFIED');
 });
});
