import { useState } from "react";
import { Alert, Card, Checkbox, DatePicker, Select, Space, Tag, Tooltip } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { mpsDivisionOrderProgressColumns, mpsDivisionOrderProgressEndpoint, mpsDivisionOrderProgressFieldKeys, mpsDivisionOrderProgressResource, tablePermissionFieldsFor, type MpsDivisionOrderProgressPage, type MpsDivisionOrderProgressRow } from "@kdos/contracts";
import { api } from "../../api";
import { hasSessionResourcePermission, KdosDataTable, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import type { AdvancedFilterGroup, AdvancedFilterSection } from "../../shared/advanced-filter";
import "./master-plan-division-order-progress.css";

type Filters={orderDateFrom?:string;orderDateTo?:string;shippingDateFrom?:string;shippingDateTo?:string;reviewDueFrom?:string;reviewDueTo?:string;incomplete:boolean;processCode?:string;processStatus?:string};
const initial:Filters={incomplete:false};
type Query={page:number;pageSize:number;search?:string;filterGroup?:AdvancedFilterGroup;sortField?:string;sortOrder?:string};
const initialQuery:Query={page:1,pageSize:kdosDefaultPageSize,sortField:"orderDate",sortOrder:"desc"};
const numberText=(value:unknown)=>value==null||value===""?"—":Number(value).toLocaleString("zh-CN",{minimumFractionDigits:1,maximumFractionDigits:1});
const dateText=(value:unknown)=>value?dayjs(String(value)).format("YYYY-MM-DD"):"—";
const dateRange=(value:[Dayjs|null,Dayjs|null]|null)=>({from:value?.[0]?.format("YYYY-MM-DD"),to:value?.[1]?.format("YYYY-MM-DD")});
const queryParams=(filters:Filters,query:Query)=>new URLSearchParams(Object.entries({...filters,...query}).filter(([,v])=>v!==undefined&&v!==null&&v!=="").map(([k,v])=>[k,k==="filterGroup"?JSON.stringify(v):String(v)]));
const contextFilters=(filters:Filters)=>Object.fromEntries(Object.entries(filters).filter(([,value])=>value!==undefined&&value!==null&&value!=="").map(([key,value])=>[key,String(value)]));

export function MasterPlanDivisionOrderProgress(){
  const user=JSON.parse(localStorage.getItem("sessionUser")??"{}"),session=JSON.stringify(user),canRead=hasSessionResourcePermission(user,mpsDivisionOrderProgressResource,"read");
  const [draft,setDraft]=useState<Filters>(initial),[filters,setFilters]=useState<Filters>(initial),[query,setQuery]=useState<Query>(initialQuery);
  const result=useQuery({queryKey:[mpsDivisionOrderProgressResource,session,filters,query],queryFn:()=>api<MpsDivisionOrderProgressPage>(`${mpsDivisionOrderProgressEndpoint}?${queryParams(filters,query)}`),enabled:canRead,retry:false,staleTime:60_000,placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[1]===session?previous:undefined});
  if(!canRead)return <Alert type="error" showIcon message="没有事业部订单生产进度报表查看权限"/>;
  const columns:ColumnsType<MpsDivisionOrderProgressRow>=mpsDivisionOrderProgressColumns.map(([key,title],index)=>{
    const numeric=mpsDivisionOrderProgressFieldKeys.includes(key as never)&&/Quantity$|orderQuantity/.test(key);
    const render=(value:unknown,row:MpsDivisionOrderProgressRow)=>{
      if(key==="orderDate"||key==="expectedShippingDate"||key==="reviewDueDate"){
        const text=dateText(value);
        return key==="reviewDueDate"&&row.reviewDueTooltip?<Tooltip title={`其他有效未完成基础计划交期：${row.reviewDueTooltip}`}>{text}</Tooltip>:text;
      }
      if(key==="drawing")return value==="Y"?<Tag color="green">Y</Tag>:"N";
      if(key==="materialReady")return <Tooltip title={row.materialReadyHint}>N</Tooltip>;
      if(key==="cutting")return <Tooltip title={row.cuttingHint}>N</Tooltip>;
      if(key==="inboundQuantity"&&!row.inboundVerified)return <Tooltip title="入库来源未能通过ERP状态或订单稳定关联校验">未核验</Tooltip>;
      if(numeric){const complete=key==="weldingQuantity"?row.weldingComplete:key==="blankQuantity"?row.blankComplete:key==="surfaceTreatmentQuantity"?row.surfaceTreatmentComplete:key==="packagingQuantity"?row.packagingComplete:key==="inboundQuantity"?row.inboundComplete:undefined;
        return <span className={`mps-division-progress-number ${complete===true?"is-complete":""}`}>{numberText(value)}</span>;}
      return String(value??"—");
    };
    return {key,dataIndex:key,title,width:index<4?160:145,fixed:index<4?"left":undefined,align:"center",sorter:!['drawing','materialReady','cutting'].includes(key),render};
  });
  const setRange=(field:"order"|"shipping"|"review",value:[Dayjs|null,Dayjs|null]|null)=>{
    const range=dateRange(value),keys=field==="order"?["orderDateFrom","orderDateTo"]:field==="shipping"?["shippingDateFrom","shippingDateTo"]:["reviewDueFrom","reviewDueTo"];
    setDraft(current=>({...current,[keys[0]!]:range.from,[keys[1]!]:range.to}));
  };
  const section:AdvancedFilterSection={content:<Space wrap>
    <DatePicker.RangePicker allowClear placeholder={["下单起日","下单止日"]} value={draft.orderDateFrom&&draft.orderDateTo?[dayjs(draft.orderDateFrom),dayjs(draft.orderDateTo)]:null} onChange={value=>setRange("order",value)}/>
    <DatePicker.RangePicker allowClear placeholder={["预计发货起日","预计发货止日"]} value={draft.shippingDateFrom&&draft.shippingDateTo?[dayjs(draft.shippingDateFrom),dayjs(draft.shippingDateTo)]:null} onChange={value=>setRange("shipping",value)}/>
    <DatePicker.RangePicker allowClear placeholder={["评审交期起日","评审交期止日"]} value={draft.reviewDueFrom&&draft.reviewDueTo?[dayjs(draft.reviewDueFrom),dayjs(draft.reviewDueTo)]:null} onChange={value=>setRange("review",value)}/>
    <Checkbox checked={draft.incomplete} onChange={e=>setDraft(current=>({...current,incomplete:e.target.checked}))}>未完成</Checkbox>
    <Select allowClear placeholder="工序完成状态" style={{width:180}} value={draft.processCode&&draft.processStatus?`${draft.processCode}:${draft.processStatus}`:undefined} options={["welding","blank","surfaceTreatment","packaging"].flatMap(code=>[{value:`${code}:incomplete`,label:`${({welding:"焊接",blank:"毛坯",surfaceTreatment:"表面处理",packaging:"包装"} as Record<string,string>)[code]}未完成`},{value:`${code}:complete`,label:`${({welding:"焊接",blank:"毛坯",surfaceTreatment:"表面处理",packaging:"包装"} as Record<string,string>)[code]}已完成`}])} onChange={value=>{const [processCode,processStatus]=String(value??":").split(":");setDraft(current=>({...current,processCode:processCode||undefined,processStatus:processStatus||undefined}))}}/>
  </Space>,activeCount:Number(Boolean(filters.orderDateFrom||filters.orderDateTo))+Number(Boolean(filters.shippingDateFrom||filters.shippingDateTo))+Number(Boolean(filters.reviewDueFrom||filters.reviewDueTo))+Number(filters.incomplete)+Number(Boolean(filters.processCode&&filters.processStatus)),onOpen:()=>{},onApply:()=>{setFilters({...draft});setQuery(current=>({...current,page:1}))},onReset:()=>{setDraft(initial);setFilters(initial);setQuery(initialQuery)}};
  const advancedFields=tablePermissionFieldsFor(mpsDivisionOrderProgressResource).filter(field=>["orderQuantity","reviewDueDate","weldingQuantity","blankQuantity","surfaceTreatmentQuantity","packagingQuantity","inboundQuantity"].includes(field.key));
  return <div className="mps-division-order-progress">
    {result.error&&<Alert type="error" showIcon message={(result.error as Error).message}/>}
    <Card title="事业四部订单生产进度">
      <KdosDataTable<MpsDivisionOrderProgressRow> resource={mpsDivisionOrderProgressResource} viewKey="fourth-division-progress" systemFields={false} rowKey="id" loading={result.isFetching} dataSource={result.data?.rows??[]} columns={columns} scroll={{x:2500}} pagination={{pageSize:query.pageSize}} locale={{emptyText:"暂无匹配订单品项"}} searchPlaceholder="客户代码、订单号、品号或品名" searchValue={query.search??""} onSearchValueChange={search=>setQuery(current=>({...current,page:1,search}))} initialSort={{field:"orderDate",order:"desc"}} advancedFilterFields={advancedFields} advancedFilterSection={section} printContext={contextFilters(filters)} serverData={{resetKey:JSON.stringify(filters),total:result.data?.total??0,onQueryChange:q=>setQuery(current=>({...current,page:q.page,pageSize:q.pageSize,search:q.search,filterGroup:q.filterGroup,sortField:q.sortField,sortOrder:q.sortOrder}))}}/>
    </Card>
  </div>;
}
