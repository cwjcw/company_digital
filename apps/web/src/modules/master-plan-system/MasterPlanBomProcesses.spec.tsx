import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { MasterPlanBomProcesses } from './MasterPlanBomProcesses';
import { api } from '../../api';
import { downloadApiFile } from '../../shared/legacy-ui';
import type { MpsBomProcessView } from '@kdos/contracts';
vi.mock('../../api',()=>({api:vi.fn()}));
vi.mock('../../shared/legacy-ui',()=>({downloadApiFile:vi.fn(async()=>undefined)}));
vi.mock('../../shared/KdosDataTable',()=>({
 hasSessionResourcePermission:(user:any,_r:string,action:string)=>user.isSystemAdmin||user.permissions?.includes(action),
 KdosDataTable:({dataSource,columns}:any)=><table><thead><tr>{columns.map((c:any)=><th key={c.key??c.dataIndex}>{c.title}</th>)}</tr></thead><tbody>{dataSource.map((r:any,i:number)=><tr key={r.id??r.sourceCode??r.processCode??i}>{columns.map((c:any)=><td key={c.key??c.dataIndex}>{c.render?c.render(r[c.dataIndex],r):String(r[c.dataIndex]??'')}</td>)}</tr>)}</tbody></table>
}));
const item={id:'monthly',orderId:'order',itemCode:'ROOT',itemName:'成品'};
let data:MpsBomProcessView,fail=false,hold:(()=>void)|undefined;
const base=():MpsBomProcessView=>({supported:true,message:'',divisionId:'division-four',divisionName:'事业四部',facts:{sourceKey:'tplus-kejia',sourceDatabase:'UFTData418971_000003',observedAt:'2026-01-01T00:00:00Z',orderNumber:'SYN',itemCode:'ROOT',orderLineId:'42',state:'READY',message:'',bomId:'77',bomVersion:'01',catalog:[],children:[]},bindings:[{sourceCode:'S1',sourceName:'来源工序',childCodes:['CHILD'],processCode:null,processName:null,state:'UNMAPPED'}],progress:[],progressFields:['processName','reportedQuantity','productionProgress'],unmappedCount:1,canConfigure:true,canExport:true});
function mount(user:any={isSystemAdmin:true}){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<App><QueryClientProvider client={client}><MasterPlanBomProcesses item={item} session="fixture" user={user}/></QueryClientProvider></App>)}
async function choose(){fireEvent.mouseDown(screen.getByRole('combobox',{name:'来源工序对应KDOS工序'}));const options=await screen.findAllByText('焊接');fireEvent.click(options.find(el=>el.classList.contains('ant-select-item-option-content'))??options[0]!);}
beforeEach(()=>{data=base();fail=false;hold=undefined;vi.clearAllMocks();vi.mocked(api).mockImplementation(async(_url,init)=>{if(init?.method){if(fail)throw new Error('映射保存失败');if(hold===undefined)await new Promise<void>(resolve=>{hold=resolve});return {} as any;}return data as any});});
afterEach(()=>cleanup());
describe('事业部工序绑定界面',()=>{
 it('读取按具体订单/品项定位；未绑定有明确提示',async()=>{mount();expect(await screen.findByText('有 1 个来源工序待绑定，当前仅展示已绑定工序的进度')).toBeInTheDocument();expect(vi.mocked(api).mock.calls[0]?.[0]).toContain('orderId=order&itemId=monthly');});
 it('选择后保存携带事业部和来源；快速连点仅创建一次',async()=>{mount();await screen.findByRole('combobox',{name:'来源工序对应KDOS工序'});await choose();const b=screen.getByRole('button',{name:'保存绑定'});fireEvent.click(b);fireEvent.click(b);await waitFor(()=>expect(vi.mocked(api).mock.calls.filter(([,i])=>i?.method==='POST')).toHaveLength(1));const [,init]=vi.mocked(api).mock.calls.find(([,i])=>i?.method==='POST')!;expect(JSON.parse(String(init!.body))).toMatchObject({divisionId:'division-four',sourceKey:'tplus-kejia',sourceProcessCode:'S1',mappingMode:'MATCH',processCode:'welding'});hold?.();expect(await screen.findByText('事业部工序绑定已保存')).toBeInTheDocument();});
 it('已有映射更新携带expectedVersion；服务端错误可见',async()=>{data.bindings[0]={...data.bindings[0]!,id:'mapping',version:3,mappingMode:'MATCH',processCode:'welding',processName:'焊接',state:'MATCHED'};fail=true;mount();fireEvent.click(await screen.findByRole('button',{name:'保存绑定'}));expect(await screen.findByText('映射保存失败')).toBeInTheDocument();const [url,init]=vi.mocked(api).mock.calls.find(([,i])=>i?.method==='PATCH')!;expect(url).toContain('/mapping');expect(JSON.parse(String(init!.body)).expectedVersion).toBe(3);});
 it('只读权限不显示绑定编辑控件；无导出权限隐藏按钮',async()=>{data.canConfigure=false;data.canExport=false;mount({permissions:['read']});await screen.findAllByText('待绑定');expect(screen.queryByRole('combobox')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'保存绑定'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'导出本表'})).not.toBeInTheDocument();});
 it('各表导出使用服务端接口，包含具体父记录',async()=>{mount();const buttons=await screen.findAllByRole('button',{name:'导出本表'});fireEvent.click(buttons[0]!);await waitFor(()=>expect(downloadApiFile).toHaveBeenCalledWith('/master-plan-system/order-progress/bom-process/export/children?orderId=order&itemId=monthly','mps_bom_children.xlsx'));});
 it('进度保持真实报工和百分比，未凭状态封顶或另做子件任务',async()=>{data.bindings=[];data.unmappedCount=0;data.progress=[{processCode:'welding',processName:'焊接',reportedQuantity:'525',productionProgress:'1.05'}];mount();expect(await screen.findByText('105%')).toBeInTheDocument();expect(screen.getByText('525')).toBeInTheDocument();expect(screen.queryByRole('button',{name:/创建.*任务/})).not.toBeInTheDocument();});
 it('来源读取失败有明确提示和重试',async()=>{vi.mocked(api).mockRejectedValue(new Error('来源读取失败'));mount();expect(await screen.findByText('来源读取失败')).toBeInTheDocument();expect(screen.getByRole('button',{name:'重试'})).toBeInTheDocument();});
});
