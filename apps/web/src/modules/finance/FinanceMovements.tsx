import { useEffect,useMemo,useRef,useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { Alert,Button,DatePicker,Modal,Select,Space,Table,Tabs,message } from 'antd';
import dayjs from 'dayjs';
import { financeMovementFields,financeDepartmentOptions } from '@kdos/contracts';
import { api } from '../../api';
import { KdosDataTable,hasResourcePermission,hasFieldPermission,kdosDefaultPageSize } from '../../shared/KdosDataTable';
import type { AdvancedFilterGroup } from '../../shared/advanced-filter';
type Row=Record<string,any>;
type Query={page:number;pageSize:number;search:string;filters:Record<string,string>;filterGroup?:AdvancedFilterGroup;sortField?:string;sortOrder?:'asc'|'desc'};
const initial:Query={page:1,pageSize:kdosDefaultPageSize,search:'',filters:{}};
const yesterday=()=>dayjs(new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})).subtract(1,'day');
const formatTime=(v:unknown)=>v?new Date(String(v)).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).replace(',',''):'—';
export function FinanceMovements({changes=false}:{changes?:boolean}){
 const [tab,setTab]=useState(()=>['finance-e10-movements','finance-e10-movement-departments','finance-e10-movement-customers'].find(r=>hasResourcePermission(r,'read'))??'finance-e10-movements');const resource=changes?'finance-e10-changes':tab;const canRead=hasResourcePermission(resource,'read');
 const session=localStorage.getItem('sessionUser')??'';const client=useQueryClient();
 const [query,setQuery]=useState<Query>(initial),[period,setPeriod]=useState<'DAY'|'MONTH'|'YEAR'|'CUSTOM'>('DAY'),[value,setValue]=useState(yesterday().format('YYYY-MM-DD')),[range,setRange]=useState<[string,string]>([yesterday().format('YYYY-MM-DD'),yesterday().format('YYYY-MM-DD')]);
 const [department,setDepartment]=useState<string>(),[customer,setCustomer]=useState<string>(),[term,setTerm]=useState(''),[searchTerm,setSearchTerm]=useState('');
 const [logs,setLogs]=useState(false),[mode,setMode]=useState<'FULL'|'INCREMENTAL'>('INCREMENTAL'),[starting,setStarting]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>setSearchTerm(term),250);return()=>clearTimeout(timer);},[term]);
 const context=useMemo(()=>{
  const start=period==='CUSTOM'?range[0]:dayjs(value).startOf(period==='YEAR'?'year':period==='MONTH'?'month':'day').format('YYYY-MM-DD');
  const end=period==='CUSTOM'?range[1]:dayjs(value).endOf(period==='YEAR'?'year':period==='MONTH'?'month':'day').format('YYYY-MM-DD');
  return {dateFrom:start,dateTo:end,...(department?{departmentCategory:department}:{}),...(customer?{customerCode:customer}:{})};
 },[period,value,range,department,customer]);
 const params=new URLSearchParams({resource,page:String(query.page),pageSize:String(query.pageSize),context:JSON.stringify(context)});
 if(query.search)params.set('search',query.search);if(query.filterGroup)params.set('filterGroup',JSON.stringify(query.filterGroup));if(query.sortField)params.set('sortField',query.sortField);if(query.sortOrder)params.set('sortOrder',query.sortOrder);
 const result=useQuery({queryKey:['finance-movements',session,resource,params.toString()],queryFn:()=>api<{rows:Row[];total:number}>(`/table-filters/rows?${params}`),enabled:canRead,staleTime:60_000,placeholderData:p=>p});
 const customerResource=changes?'finance-e10-changes':'finance-e10-movement-customers';
 const options=useQuery({queryKey:['finance-movement-options',session,customerResource,searchTerm,context.dateFrom,context.dateTo,department],queryFn:()=>api<Array<{value:string;label:string}>>('/table-filters/candidates?'+new URLSearchParams({resource:customerResource,field:'customerCode',search:searchTerm,context:JSON.stringify({...context,customerCode:undefined}),limit:'100'})),enabled:canRead&&hasResourcePermission(customerResource,'read')&&hasFieldPermission(customerResource,'customerCode','read'),staleTime:60_000});
 const runs=useQuery({queryKey:['finance-movement-runs',session],queryFn:()=>api<{rows:Row[];canRefresh:boolean}>('/finance/e10-movements/runs'),enabled:canRead&&hasResourcePermission('finance-e10-changes','read'),refetchInterval:q=>q.state.data?.rows.some(r=>r.status==='RUNNING')?2000:false});
 const previous=useRef(runs.data?.rows[0]?.status);
 useEffect(()=>{const status=runs.data?.rows[0]?.status;if(previous.current==='RUNNING'&&status==='SUCCESS')for(const key of ['finance-movements','finance-movement-options','finance-orders','finance-dashboard','finance-ranking'])void client.invalidateQueries({queryKey:[key]});previous.current=status;},[runs.data,client]);
 const resetPage=()=>setQuery(q=>({...q,page:1}));
 const refresh=async()=>{setStarting(true);try{await api('/finance/e10-movements/refresh',{method:'POST',body:JSON.stringify({mode})});message.success('台账读取已开始');await client.invalidateQueries({queryKey:['finance-movement-runs']});}catch(e){message.error((e as Error).message);}finally{setStarting(false);}};
 const fields=financeMovementFields(resource).filter(f=>f.printable!==false);const last=runs.data?.rows[0];
 if(!canRead&&!(!changes&&['finance-e10-movement-departments','finance-e10-movement-customers'].some(r=>hasResourcePermission(r,'read'))))return <Alert type="warning" message="当前权限组不能查看订单金额变更统计"/>;
 const visibleTabs=([['finance-e10-movements','月度发生额'],['finance-e10-movement-departments','事业部分析'],['finance-e10-movement-customers','客户分析']] as const).filter(([r])=>hasResourcePermission(r,'read'));
 return <div style={{maxWidth:1560,marginInline:'auto',minWidth:0}}>
  {!changes&&<Tabs activeKey={resource} onChange={r=>{setTab(r);setQuery(initial);}} items={visibleTabs.map(([key,label])=>({key,label}))}/>}
  {result.error&&<Alert type="error" message={result.error.message}/>}{last?.errorSummary&&<Alert type="error" message={last.errorSummary}/>}
  {canRead&&<KdosDataTable<Row> key={resource} resource={resource} rowKey="id" columns={fields.map(f=>({title:f.label,dataIndex:f.key,width:f.type==='datetime'?180:150,render:(v:unknown)=>v==null?'—':f.type==='datetime'?formatTime(v):f.type==='number'?Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):f.type==='dictionary'?f.options?.find(o=>o.value===v)?.label??String(v):typeof v==='boolean'?(v?'是':'否'):String(v)}))} dataSource={result.data?.rows} loading={result.isLoading} serverData={{total:result.data?.total??0,onQueryChange:setQuery}} printContext={context} scroll={{x:'max-content'}} toolbar={<Space wrap>
   <Select aria-label="日期周期" value={period} onChange={v=>{setPeriod(v);resetPage();}} options={[{value:'DAY',label:'按日'},{value:'MONTH',label:'按月'},{value:'YEAR',label:'按年'},{value:'CUSTOM',label:'自定义'}]}/>
   {period==='CUSTOM'?<DatePicker.RangePicker aria-label="发生日期范围" allowClear={false} value={[dayjs(range[0]),dayjs(range[1])]} onChange={v=>{if(v?.[0]&&v[1])setRange([v[0].format('YYYY-MM-DD'),v[1].format('YYYY-MM-DD')]);resetPage();}}/>:<DatePicker aria-label="发生日期" allowClear={false} picker={period==='MONTH'?'month':period==='YEAR'?'year':'date'} value={dayjs(value)} onChange={v=>{if(v)setValue(v.format('YYYY-MM-DD'));resetPage();}}/>}
   {hasFieldPermission(resource,'departmentCategory','read')&&<Select aria-label="事业部" allowClear placeholder="全部事业部" style={{width:140}} options={[...financeDepartmentOptions,{value:'待分类',label:'待分类'}]} value={department} onChange={v=>{setDepartment(v);setCustomer(undefined);resetPage();}}/>}
   {hasResourcePermission(customerResource,'read')&&hasFieldPermission(customerResource,'customerCode','read')&&<Select aria-label="客户" allowClear showSearch filterOption={false} placeholder="全部客户" style={{width:170}} value={customer} onSearch={setTerm} onChange={v=>{setCustomer(v);resetPage();}} options={options.data} loading={options.isFetching}/>}
   <Button onClick={()=>{setPeriod('DAY');setValue(yesterday().format('YYYY-MM-DD'));setRange([yesterday().format('YYYY-MM-DD'),yesterday().format('YYYY-MM-DD')]);setDepartment(undefined);setCustomer(undefined);setQuery(initial);}}>清空筛选</Button>
   <Button onClick={()=>void client.invalidateQueries({queryKey:['finance-movements']})}>刷新</Button>
   {runs.data?.canRefresh&&<><Select aria-label="台账读取模式" value={mode} onChange={setMode} options={[{value:'INCREMENTAL',label:'增量读取'},{value:'FULL',label:'历史重读'}]}/><Button loading={starting||last?.status==='RUNNING'} onClick={()=>void refresh()}>同步台账</Button><Button onClick={()=>setLogs(true)}>读取批次</Button></>}
  </Space>}/>}
  <Modal title="台账读取批次" open={logs} onCancel={()=>setLogs(false)} footer={null} width={900}><Table rowKey="id" pagination={false} dataSource={runs.data?.rows} columns={[{title:'开始时间',dataIndex:'startedAt',render:formatTime},{title:'状态',dataIndex:'status',render:(v:string)=>({RUNNING:'读取中',SUCCESS:'成功',FAILED:'失败'}[v]??v)},{title:'变更记录',dataIndex:'changedCount'},{title:'结果',dataIndex:'errorSummary'}]}/></Modal>
 </div>;
}
