import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { PmcRdProgressReader } from './pmc-rd-progress.reader';
jest.mock('node:child_process',()=>({spawn:jest.fn()}));
function childOf(data: string,code=0) {const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:jest.fn()});(spawn as jest.Mock).mockReturnValueOnce(child);child.stdin.on('finish',()=>{const bytes=Buffer.from(data);for(let index=0;index<bytes.length;index++)child.stdout.write(bytes.subarray(index,index+1));child.stdout.end();setImmediate(()=>child.emit('close',code));});return child;}
describe('PMC只读事实适配器传输',()=>{
  it('UTF8跨字节分块保持中文完整且微秒游标不经Date',async()=>{const facts={sourceSnapshotAt:'2026-10-07 12:00:00.000978',orders:[{item_name:'研发中文物料'}],candidateLineIds:['id'],watermark:{sources:{ITEM:{at:'2026-10-07 12:00:00.000978',id:'id'}}}};const child=childOf(JSON.stringify(facts));const before={snapshotAt:'2026-10-06 12:00:00.000978',sources:{}};expect(await new PmcRdProgressReader().read('INCREMENTAL',before)).toEqual(facts);expect(child.kill).not.toHaveBeenCalled();});
  it('事实契约或源进程失败拒绝同步',async()=>{childOf('{}');await expect(new PmcRdProgressReader().read('FULL',null)).rejects.toThrow('事实契约');childOf('',1);await expect(new PmcRdProgressReader().read('FULL',null)).rejects.toThrow('只读读取失败');});
});
