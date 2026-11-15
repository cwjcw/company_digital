import { useState } from "react";
import { Alert, Button, Card, Checkbox, DatePicker, Input, Select, Space, Tag, Tooltip } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { mpsDivisionOrderProgressColumns, mpsDivisionOrderProgressEndpoint, mpsDivisionOrderProgressFieldKeys, mpsDivisionOrderProgressResource, type MpsDivisionOrderProgressPage, type MpsDivisionOrderProgressRow } from "@kdos/contracts";
import { api } from "../../api";
import { hasSessionResourcePermission, KdosDataTable } from "../../shared/KdosDataTable";
import { downloadApiFile } from "../../shared/legacy-ui";
import "./master-plan-division-order-progress.css";

type Filters={search:string;orderDateFrom?:string;orderDateTo?:string;shippingDateFrom?:string;shippingDateTo?:string;reviewDueFrom?:string;reviewDueTo?:string;incomplete:boolean;processCode?:string;processStatus?:string};
const initial:Filters={search:"",incomplete:false};
type Query={page:number;pageSize:number;sortField?:string;sortOrder?:string};
const initialQuery:Query={page:1,pageSize:100};
const numberText=(value:unknown)=>value==null||value===""?"—":Number(value).toLocaleString("zh-CN",{minimumFractionDigits:1,maximumFractionDigits:1});
const dateText=(value:unknown)=>value?dayjs(String(value)).format("YYYY-MM-DD"):"—";
const dateRange=(value:[Dayjs|null,Dayjs|null]|null)=>({from:value?.[0]?.format("YYYY-MM-DD"),to:value?.[1]?.format("YYYY-MM-DD")});
const queryParams=(filters:Filters,query:Query)=>new URLSearchParams(Object.entries({...filters,...query}).filter(([,v])=>v!==undefined&&v!==null&&v!=="").map(([k,v])=>[k,String(v)]));

export function MasterPlanDivisionOrderProgress(){
  const user=JSON.parse(localStorage.getItem("sessionUser")??"{}"),session=JSON.stringify(user),canRead=hasSessionResourcePermission(user,mpsDivisionOrderProgressResource,"read");
  const [draft,setDraft]=useState<Filters>(initial),[filters,setFilters]=useState<Filters>(initial),[query,setQuery]=useState<Query>(initialQuery);
  const meta=useQuery({queryKey:[mpsDivisionOrderProgressResource,session,"meta"],queryFn:()=>api<{columns:ReadonlyArray<readonly[string,string]>;canExport:boolean}>(`${mpsDivisionOrderProgressEndpoint}/meta`),enabled:canRead,retry:false});
  const result=useQuery({queryKey:[mpsDivisionOrderProgressResource,session,filters,query],queryFn:()=>api<MpsDivisionOrderProgressPage>(`${mpsDivisionOrderProgressEndpoint}?${queryParams(filters,query)}`),enabled:canRead&&!!meta.data,retry:false});
  if(!canRead)return <Alert type="error" showIcon message="没有事业部订单生产进度报表查看权限"/>;
  const columns:ColumnsType<MpsDivisionOrderProgressRow>=mpsDivisionOrderProgressColumns.map(([key,title],index)=>{
    const numeric=mpsDivisionOrderProgressFieldKeys.includes(key as never)&&/Quantity$|orderQuantity/.test(key);
    const render=(value:unknown,row:MpsDivisionOrderProgressRow)=>{
      if(key==="orderDate"||key==="expectedShippingDate"||key==="reviewDueDate"){
        const text=dateText(value);return key==="reviewDueDate"&&row.reviewDueTooltip?<Tooltip title={`其他有效未完成基础计划交期：${row.reviewDueTooltip}`}>{text}</Tooltip>:text;
      }
      if(key==="drawing")return value==="Y"?<Tag color="green">Y</Tag>:value==="N"?"N":<Tooltip title="BOM来源暂不可用或品号未能与E10物料身份匹配">未核验</Tooltip>;
      if(key==="materialReady")return <Tooltip title={row.materialReadyHint}>N</Tooltip>;
      if(key==="cutting")return <Tooltip title={row.cuttingHint}>N</Tooltip>;
      if(key==="inboundQuantity"&&!row.inboundVerified)return <Tooltip title="入库来源未能通过ERP状态或订单稳定关联校验">未核验</Tooltip>;
      if(numeric){const complete=key==="weldingQuantity"?row.weldingComplete:key==="blankQuantity"?row.blankComplete:key==="surfaceTreatmentQuantity"?row.surfaceTreatmentComplete:key==="packagingQuantity"?row.packagingComplete:key==="inboundQuantity"?row.inboundComplete:undefined;
        return <span className={`mps-division-progress-number ${complete===true?"is-complete":""}`}>{numberText(value)}</span>;}
      return String(value??"—");
    };
    return {key,dataIndex:key,title,width:index<4?160:145,fixed:index<4?"left":undefined,align:numeric?"right":undefined,sorter:!['drawing','materialReady','cutting'].includes(key),render};
  });
  const setRange=(field:"order"|"shipping"|"review",value:[Dayjs|null,Dayjs|null]|null)=>{
    const range=dateRange(value),keys=field==="order"?["orderDateFrom","orderDateTo"]:field==="shipping"?["shippingDateFrom","shippingDateTo"]:["reviewDueFrom","reviewDueTo"];
    setDraft(current=>({...current,[keys[0]!]:range.from,[keys[1]!]:range.to}));
  };
  return <div className="mps-division-order-progress">
    {meta.error&&<Alert type="error" showIcon message={(meta.error as Error).message}/>}
    {result.error&&<Alert type="error" showIcon message={(result.error as Error).message}/>}
    {result.data&&<Alert type="info" showIcon message={`事业四部有效订单品项 ${result.data.total.toLocaleString()} 条；无法关联基础计划 ${result.data.diagnostics.basePlanUnlinked} 条；基础计划未维护评审交期 ${result.data.diagnostics.baseDueDateMissing} 条；无法稳定关联入库来源 ${result.data.diagnostics.inboundUnverified} 条；无法关联主记录的工序事实 ${result.data.diagnostics.processUnlinked} 条。`} />}
    {result.data?.diagnostics.bomUnverified&&<Alert type="warning" showIcon message="部分图纸状态未能核验；未核验状态以空值展示，不计为无BOM。"/>}
    <Card title="事业四部订单生产进度">
      <Space className="mps-division-order-progress-filters" wrap>
        <Input.Search allowClear placeholder="客户代码、订单号、品号或品名" value={draft.search} onChange={e=>setDraft({...draft,search:e.target.value})} onSearch={()=>{setFilters({...draft});setQuery(initialQuery)}} style={{width:280}}/>
        <DatePicker.RangePicker allowClear value={draft.orderDateFrom&&draft.orderDateTo?[dayjs(draft.orderDateFrom),dayjs(draft.orderDateTo)]:null} onChange={value=>setRange("order",value)}/>
        <DatePicker.RangePicker allowClear placeholder={["预计发货起日","预计发货止日"]} value={draft.shippingDateFrom&&draft.shippingDateTo?[dayjs(draft.shippingDateFrom),dayjs(draft.shippingDateTo)]:null} onChange={value=>setRange("shipping",value)}/>
        <DatePicker.RangePicker allowClear placeholder={["评审交期起日","评审交期止日"]} value={draft.reviewDueFrom&&draft.reviewDueTo?[dayjs(draft.reviewDueFrom),dayjs(draft.reviewDueTo)]:null} onChange={value=>setRange("review",value)}/>
        <Checkbox checked={draft.incomplete} onChange={e=>setDraft({...draft,incomplete:e.target.checked})}>未完成</Checkbox>
        <Select allowClear placeholder="工序完成状态" style={{width:160}} value={draft.processCode&&draft.processStatus?`${draft.processCode}:${draft.processStatus}`:undefined} options={["welding","blank","surfaceTreatment","packaging"].flatMap(code=>[{value:`${code}:incomplete`,label:`${({welding:"焊接",blank:"毛坯",surfaceTreatment:"表面处理",packaging:"包装"} as Record<string,string>)[code]}未完成`},{value:`${code}:complete`,label:`${({welding:"焊接",blank:"毛坯",surfaceTreatment:"表面处理",packaging:"包装"} as Record<string,string>)[code]}已完成`}])} onChange={value=>{const [processCode,processStatus]=String(value??":").split(":");setDraft({...draft,processCode:processCode||undefined,processStatus:processStatus||undefined})}}/>
        <Button type="primary" onClick={()=>{setFilters({...draft});setQuery(initialQuery)}}>查询</Button>
        <Button onClick={()=>{setDraft(initial);setFilters(initial);setQuery(initialQuery)}}>重置</Button>
        {meta.data?.canExport&&<Button onClick={()=>downloadApiFile(`${mpsDivisionOrderProgressEndpoint}/export?${queryParams(filters,{...query,page:1,pageSize:500})}`,"pmc_division_four_production_progress.xlsx")}>导出本表</Button>}
      </Space>
      <KdosDataTable<MpsDivisionOrderProgressRow> resource={mpsDivisionOrderProgressResource} viewKey="fourth-division-progress" simple systemFields={false} rowKey="id" loading={result.isFetching} dataSource={result.data?.rows??[]} columns={columns} scroll={{x:2500}} pagination={{pageSize:query.pageSize}} locale={{emptyText:"暂无匹配订单品项"}} serverData={{resetKey:JSON.stringify(filters),total:result.data?.total??0,onQueryChange:q=>{if(q.page!==query.page||q.pageSize!==query.pageSize||q.sortField!==query.sortField||q.sortOrder!==query.sortOrder)setQuery({page:q.page,pageSize:q.pageSize,sortField:q.sortField,sortOrder:q.sortOrder})}}}/>
    </Card>
  </div>;
}
