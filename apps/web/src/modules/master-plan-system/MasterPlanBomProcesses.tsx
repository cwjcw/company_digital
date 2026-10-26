import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Select, Space, Spin, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { standardProcesses } from '@tracker/shared';
import { mpsExternalProcessMappingResource as mappingResource, mpsOrderProgressResource as resource, type BomChildFact, type BomProcessBinding, type MpsBomProcessView, type MpsProgressRow } from '@kdos/contracts';
import { api } from '../../api';
import { KdosDataTable, hasSessionResourcePermission } from '../../shared/KdosDataTable';
import { downloadApiFile } from '../../shared/legacy-ui';
import { mpsMetric } from './master-plan-dashboard.utils';

type Props={item:MpsProgressRow;session:string;user:Parameters<typeof hasSessionResourcePermission>[0]};
export function MasterPlanBomProcesses({item,session,user}:Props) {
  const {message}=App.useApp(),client=useQueryClient();
  const [drafts,setDrafts]=useState<Record<string,string>>({}),[saving,setSaving]=useState<string[]>([]),[exporting,setExporting]=useState<string>();
  const busy=useRef(new Set<string>());
  const url='/master-plan-system/order-progress/bom-process?'+new URLSearchParams({orderId:String(item.orderId),itemId:item.id});
  const key=[resource,session,'bom',item.orderId,item.id];
  const query=useQuery({queryKey:key,queryFn:()=>api<MpsBomProcessView>(url),retry:false,staleTime:120_000});
  const view=query.data;
  const save=async(binding:BomProcessBinding)=>{
    if(!view||busy.current.has(binding.sourceCode))return;
    const selected=drafts[binding.sourceCode]??(binding.state==='IGNORED'?'__IGNORE__':binding.processCode??'');
    if(!selected){void message.warning('请选择对应的KDOS工序，或明确选择不参与内部报工');return;}
    busy.current.add(binding.sourceCode);setSaving([...busy.current]);
    try {
      const values={mappingMode:selected==='__IGNORE__'?'IGNORE':'MATCH',processCode:selected==='__IGNORE__'?null:selected,enabled:true};
      if(binding.id)await api(`/master-plan-system/resources/${mappingResource}/${binding.id}`,{method:'PATCH',body:JSON.stringify({...values,expectedVersion:binding.version})});
      else await api(`/master-plan-system/resources/${mappingResource}`,{method:'POST',body:JSON.stringify({...values,divisionId:view.divisionId,sourceKey:'tplus-kejia',sourceProcessCode:binding.sourceCode,sourceProcessName:binding.sourceName})});
      void message.success('事业部工序绑定已保存');
      setDrafts(current=>{const next={...current};delete next[binding.sourceCode];return next;});
      await client.invalidateQueries({queryKey:[resource,session,'bom']});
    } catch(error){void message.error((error as Error).message);}
    finally{busy.current.delete(binding.sourceCode);setSaving([...busy.current]);}
  };
  const exportTable=async(tableKey:string)=>{
    if(exporting)return;setExporting(tableKey);
    try{await downloadApiFile(url.replace('/bom-process?','/bom-process/export/'+tableKey+'?'),`mps_bom_${tableKey}.xlsx`);}
    catch(error){void message.error((error as Error).message);}finally{setExporting(undefined);}
  };
  const exportButton=(tableKey:string)=>view?.canExport?<Button loading={exporting===tableKey} disabled={!!exporting} onClick={()=>void exportTable(tableKey)}>导出本表</Button>:null;
  if(query.isLoading)return <Spin tip="读取一级BOM与工艺来源"><div style={{minHeight:100}}/></Spin>;
  if(query.error)return <Alert type="error" showIcon message={(query.error as Error).message} action={<Button aria-label="重试" onClick={()=>void query.refetch()}>重试</Button>}/>;
  if(!view)return null;
  if(!view.supported)return <Alert type="info" showIcon message={view.message}/>;
  const childColumns:ColumnsType<BomChildFact>=[
    {title:'一级子件品号',dataIndex:'itemCode',width:190}, {title:'子件名称',dataIndex:'itemName',width:230},
    {title:'主BOM版本',dataIndex:'bomVersion',width:110}, {title:'来源路线',dataIndex:'routeName',width:230,render:v=>v??'—'},
    {title:'工序来源',dataIndex:'source',width:200}, {title:'来源工序',key:'processes',width:280,render:(_,row)=>row.processes.map(p=>p.name).join(' → ')|| (row.state==='AMBIGUOUS'?'来源存在歧义':'无工序配置')}
  ];
  const bindingColumns:ColumnsType<BomProcessBinding>=[
    {title:'ERP工序',dataIndex:'sourceName',width:160}, {title:'ERP编码',dataIndex:'sourceCode',width:120},
    {title:'引用子件',dataIndex:'childCodes',width:260,render:(codes:string[])=>codes.join('、')},
    {title:'KDOS工序',dataIndex:'processName',width:320,render:(_,row)=>{
      const canWrite=view.canConfigure&&row.canWrite!==false&&hasSessionResourcePermission(user,mappingResource,row.id?'update':'create');
      if(!canWrite)return row.processName??(row.state==='IGNORED'?'不参与内部报工':'待绑定');
      return <Space wrap><Select aria-label={`${row.sourceName}对应KDOS工序`} style={{width:175}} placeholder="请选择对应工序"
        value={drafts[row.sourceCode]??(row.state==='IGNORED'?'__IGNORE__':row.processCode??undefined)}
        options={[...standardProcesses].sort((a,b)=>a.order-b.order).map(p=>({value:p.code as string,label:p.name})).concat([{value:'__IGNORE__',label:'不参与内部报工'}])}
        onChange={value=>setDrafts(current=>({...current,[row.sourceCode]:value}))}/>
        <Button loading={saving.includes(row.sourceCode)} onClick={()=>void save(row)}>保存绑定</Button></Space>;
    }},
    {title:'绑定状态',dataIndex:'state',width:120,render:value=><Tag color={value==='MATCHED'?'success':value==='UNMAPPED'?'warning':undefined}>{value==='MATCHED'?'已绑定':value==='IGNORED'?'不参与内部报工':'待绑定'}</Tag>}
  ];
  const labels:Record<string,string>={processName:'KDOS工序',requiredQuantity:'月计划需求',reportedQuantity:'累计实际报工',productionProgress:'生产进度',status:'工序状态',lastReportDate:'最近报工日期'};
  const progressColumns=view.progressFields.map(field=>({key:field,dataIndex:field,title:labels[field]??field,width:160,render:(value:unknown)=>field==='productionProgress'?mpsMetric(value,'productionProgress'):field.endsWith('Quantity')?mpsMetric(value,'Quantity'):String(value??'—')}));
  return <Space direction="vertical" size="middle" style={{width:'100%'}}>
    <Alert type="info" showIcon message={`${view.divisionName} · 一级BOM ${view.facts?.bomVersion??'—'} · 仅展开一级`}
      description="将一级子件来源工序绑定到本事业部已有KDOS工序，去重后查看本产品现有报工。不会修改已开工计划或将成品报工复制给子件。"/>
    {view.message&&<Alert type="warning" showIcon message={view.message}/>}
    {view.unmappedCount>0&&<Alert type="warning" showIcon message={`有 ${view.unmappedCount} 个来源工序待绑定，当前仅展示已绑定工序的进度`}/>}
    <Card size="small" title="一级子件与来源工艺" extra={exportButton('children')}>
      <KdosDataTable<BomChildFact> resource={resource} viewKey="bom-children" simple systemFields={false} rowKey="id" dataSource={view.facts?.children??[]} columns={childColumns} scroll={{x:1340}} pagination={{pageSize:25}}/>
    </Card>
    <Card size="small" title={`${view.divisionName}工序对应`} extra={<Space>{view.canConfigure&&<Typography.Link href={`/master-plan-system/${mappingResource}`} target="_blank" rel="noreferrer">维护映射表</Typography.Link>}{exportButton('bindings')}</Space>}>
      <KdosDataTable<BomProcessBinding> resource={resource} viewKey="bom-bindings" simple systemFields={false} rowKey="sourceCode" dataSource={view.bindings} columns={bindingColumns} scroll={{x:1080}} pagination={{pageSize:25}}/>
    </Card>
    <Card size="small" title="本产品对应的KDOS工序与现有报工" extra={exportButton('progress')}>
      <KdosDataTable<Record<string,string|number|null>> resource={resource} viewKey="bom-progress" simple systemFields={false} rowKey="processCode" dataSource={view.progress} columns={progressColumns} scroll={{x:progressColumns.length*160}} pagination={{pageSize:25}} locale={{emptyText:'暂无已绑定工序；请先维护事业部对应关系'}}/>
    </Card>
    <Typography.Text type="secondary">来源观察时间：{view.facts?.observedAt?new Date(view.facts.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—'}。相同KDOS工序只读取一次产品报工汇总；配置歧义或未取到路线不代表生产已完成。</Typography.Text>
    <Button loading={query.isFetching} onClick={()=>void query.refetch()}>重新检查工艺匹配</Button>
  </Space>;
}
