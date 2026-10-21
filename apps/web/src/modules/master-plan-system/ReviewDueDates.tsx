import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Drawer, Table } from 'antd';
import { reviewDueDateFields, reviewDueDateExportFilename, reviewDueDateResource as RESOURCE, type ReviewDueDateHistoryRow } from '@kdos/contracts';
import { api } from '../../api';
import { KdosDataTable, hasResourcePermission, kdosDefaultPageSize } from '../../shared/KdosDataTable';
import type { AdvancedFilterGroup } from '../../shared/advanced-filter';
type Query={page:number;pageSize:number;search:string;filterGroup?:AdvancedFilterGroup;sortField?:string;sortOrder?:'asc'|'desc'};
type Row=Record<string,unknown>&{id:string};
const time=(v:unknown)=>v?new Date(String(v)).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}):'—';
export function ReviewDueDates(){
  const [query,setQuery]=useState<Query>({page:1,pageSize:kdosDefaultPageSize,search:''});
  const [selected,setSelected]=useState<Row|null>(null),[historyPage,setHistoryPage]=useState(1);
  const session=localStorage.getItem('sessionUser')??'',canRead=hasResourcePermission(RESOURCE,'read');
  const params=new URLSearchParams({page:String(query.page),pageSize:String(query.pageSize),search:query.search});
  if(query.filterGroup)params.set('filterGroup',JSON.stringify(query.filterGroup));
  if(query.sortField)params.set('sortField',query.sortField);if(query.sortOrder)params.set('sortOrder',query.sortOrder);
  const meta=useQuery({queryKey:['review-due-meta',session],queryFn:()=>api<{fields:Array<{key:string}>}>(`/master-plan-system/resources/${RESOURCE}/meta`),enabled:canRead});
  const rows=useQuery({queryKey:['review-due-rows',session,params.toString()],queryFn:()=>api<{rows:Row[];total:number}>(`/master-plan-system/resources/${RESOURCE}?${params}`),enabled:canRead});
  const history=useQuery({queryKey:['review-due-history',session,selected?.id,historyPage],queryFn:()=>api<{rows:ReviewDueDateHistoryRow[];total:number}>(`/master-plan-system/review-due-dates/${selected!.id}/history?page=${historyPage}&pageSize=100`),enabled:canRead&&!!selected});
  if(!canRead)return <Alert type="warning" message="当前权限组没有评审交期表查看权限"/>;
  const visible=new Set(meta.data?.fields.map(f=>f.key)??[]);
  const canHistory=['inboundDate','previousInboundDate','changeCount','lastChangedAt'].every(k=>visible.has(k));
  return <Card title="评审交期表">
    {(rows.error||meta.error)&&<Alert type="error" message={(rows.error??meta.error)?.message}/>}
    <KdosDataTable<Row> resource={RESOURCE} rowKey="id" systemFields={false} editable={false}
      exportFilename={reviewDueDateExportFilename} loading={rows.isLoading||meta.isLoading} dataSource={rows.data?.rows??[]}
      columns={[...reviewDueDateFields.filter(f=>visible.has(f.key)).map(f=>({title:f.label,dataIndex:f.key,key:f.key,width:f.key==='drawingNumber'?200:160,render:(v:unknown)=>f.type==='datetime'?time(v):v==null?'—':String(v)})),
        ...(canHistory?[{title:'操作',key:'__history',width:110,render:(_:unknown,row:Row)=><Button type="link" onClick={()=>{setSelected(row);setHistoryPage(1);}}>变更历史</Button>}]:[])]}
      serverData={{total:rows.data?.total??0,onQueryChange:setQuery}} scroll={{x:'max-content'}}/>
    <Drawer title="变更历史" width={980} open={!!selected} onClose={()=>setSelected(null)}>
      {history.error&&<Alert type="error" message={history.error.message}/>}
      <Table<ReviewDueDateHistoryRow> rowKey="id" size="small" loading={history.isLoading} dataSource={history.data?.rows??[]} locale={{emptyText:'暂无变更记录'}}
        pagination={{current:historyPage,pageSize:100,total:history.data?.total??0,onChange:setHistoryPage,showSizeChanger:false}}
        columns={[{title:'变更时间',dataIndex:'changedAt',render:time},{title:'原入库时间',dataIndex:'oldInboundDate'},
          {title:'新入库时间',dataIndex:'newInboundDate'},{title:'提前/推迟天数',dataIndex:'changeDays',render:(v:number)=>`${v<0?'提前':'推迟'}${Math.abs(v)}天`},
          {title:'变更来源',dataIndex:'sourceKind',render:(v:string)=>({SYNC:'同步',IMPORT:'导入',MANUAL:'人工'}[v]??v)},
          {title:'操作人或同步批次',key:'source',render:(_,row)=>row.sourceKind==='SYNC'?row.sourceBatchId:row.changedByName??row.sourceBatchId}]}/>
    </Drawer>
  </Card>;
}
