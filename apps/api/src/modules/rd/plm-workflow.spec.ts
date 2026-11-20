import fs from 'node:fs';
import path from 'node:path';
const w=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../../automation/n8n/plm-project-progress-half-hourly.json'),'utf8'));
const check=new Function('$input',w.nodes.find((n:any)=>n.type.endsWith('.code')).parameters.jsCode);
const valid={status:'SUCCESS',source:'A1-PLM',interfaces:2,snapshotId:'01999999-0000-7000-8000-000000000001',systemCount:141,detailCount:53,milestoneCount:172,taskCount:1139};
describe('PLM n8n command result verification',()=>{
 it('has exactly one automatic half-hourly trigger and the existing controlled SSH command',()=>{const triggers=w.nodes.filter((n:any)=>n.type.endsWith('scheduleTrigger'));expect(triggers).toHaveLength(1);expect(triggers[0].parameters.rule.interval[0].expression).toBe('*/30 * * * *');expect(w.settings.timezone).toBe('Asia/Shanghai');expect(w.nodes.find((n:any)=>n.type.endsWith('.ssh')).parameters.command).toContain('timeout');});
 it('requires a real zero exit and complete positive generation evidence',()=>{expect(check({first:()=>({json:{code:0,stdout:JSON.stringify(valid)}})})).toEqual([{json:valid}]);for(const code of [null,undefined,1,-1])expect(()=>check({first:()=>({json:{code,stdout:JSON.stringify(valid)}})})).toThrow();for(const patch of [{status:'FAILED'},{snapshotId:null},{interfaces:1},{detailCount:142}])expect(()=>check({first:()=>({json:{code:0,stdout:JSON.stringify({...valid,...patch})}})})).toThrow();});
});
