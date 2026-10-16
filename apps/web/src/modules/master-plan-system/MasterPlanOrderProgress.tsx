import { orderProgressUrl } from "./master-plan-order-progress.utils";
import { useState, type Key } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Drawer, Empty, Progress, Space, Spin, Tabs, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { standardProcesses } from "@tracker/shared";
import { mpsOrderProgressResource as resource, mpsOrderProgressOrderColumns, mpsOrderProgressItemColumns, type MpsDashboardFilters, type MpsOrderProgressFilters, type MpsProgressPage, type MpsProgressRow } from "@kdos/contracts";
import { api } from "../../api";
import { KdosDataTable, TablePermissionButton, hasSessionResourcePermission, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import { downloadApiFile } from "../../shared/legacy-ui";
import { MpsDateFilter, MpsRemoteSelect } from "./MasterPlanDashboardFilters";
import { mpsMetric } from "./master-plan-dashboard.utils";
import "./master-plan-order-progress.css";

type Query={page:number;pageSize:number;sortField?:string;sortOrder?:string};
const blankQuery=():Query=>({page:1,pageSize:kdosDefaultPageSize});

const params=(query:Query)=>Object.fromEntries(Object.entries(query).filter(([,v])=>v!=null).map(([k,v])=>[k,String(v)]));
function initialFilters():MpsOrderProgressFilters {return {dateType:"ORDER",datePeriod:"DAY",dateValue:new Date(Date.now()-86400000).toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}),onlyUnfinishedOrders:true,onlyUnfinishedItems:true};}
function ExportButton({kind,filters,query,allowed,label}:{kind:"orders"|"items";filters:MpsOrderProgressFilters;query?:Query;allowed:boolean;label?:string}){
  const [busy,setBusy]=useState(false);if(!allowed)return null;
  return <Button aria-label={label??(kind==="orders"?"导出订单进度汇总":"导出品号生产进度明细")} loading={busy} disabled={busy} onClick={()=>{if(busy)return;setBusy(true);void downloadApiFile(orderProgressUrl(filters,`/export/${kind}`,query?params(query):{}),`mps_${kind==="orders"?"order":"item"}_progress_${new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}).replaceAll("-","")}.xlsx`).catch(e=>message.error((e as Error).message)).finally(()=>setBusy(false));}}>{label??`导出${kind==="orders"?"订单汇总":"品号明细"}`}</Button>;
}
function State({value,missing="无记录"}:{value:unknown;missing?:string}){return <Tag color={value==="延期"?"error":value==="已完成"||value==="已入库"?"success":undefined}>{String(value??missing)}</Tag>;}
export function ProcessCell({row,code,fields}:{row:MpsProgressRow;code:string;fields:string[]}){
  const status=fields.includes(code+"Status")?row[code+"Status"]:undefined,showProgress=fields.includes(code+"ProductionProgress"),value=row[code+"ProductionProgress"];
  const details=[fields.includes(code+"RequiredQuantity")?`月计划需求：${mpsMetric(row[code+"RequiredQuantity"],"Quantity")}`:null,fields.includes(code+"ReportedQuantity")?`累计实际报工：${mpsMetric(row[code+"ReportedQuantity"],"Quantity")}`:null,fields.includes(code+"LastReportDate")?`最近报工：${row[code+"LastReportDate"]??"无记录"}`:null].filter(Boolean).join("；");
  return <Tooltip title={details||undefined}><div className="mps-order-process">
    {showProgress&&value!=null?<><Progress percent={Math.max(0,Math.min(100,Number(value)*100))} showInfo={false} size="small" status={status==="延期"?"exception":Number(value)>=1?"success":"normal"}/><span className="mps-order-percentage">{mpsMetric(value,"productionProgress")}</span></>:showProgress?<span>—</span>:null}
    {fields.includes(code+"Status")&&<span className={status==="延期"?"mps-order-late":"mps-order-status"}>{String(status??(row.sourceKind&&row.sourceKind!=="月计划"?"暂无关联数据":"无工序任务"))}{fields.includes(code+"ReportedQuantity")&&row[code+"ReportedQuantity"]!=null&&Number(row[code+"ReportedQuantity"])===0?" · 未报工":""}</span>}
  </div></Tooltip>;
}
function ItemTable({order,filters,session,canExport,onOpen}:{order:MpsProgressRow;filters:MpsOrderProgressFilters;session:string;canExport:boolean;onOpen:(row:MpsProgressRow)=>void}){
  const [query,setQuery]=useState<Query>(blankQuery);
  const result=useQuery({queryKey:[resource,session,"items",order.id,filters,query],queryFn:()=>api<MpsProgressPage>(orderProgressUrl(filters,"/items",{...params(query),orderId:order.id})),staleTime:60_000,retry:false});
  const fields=result.data?.visibleFields??[];
  const columns:ColumnsType<MpsProgressRow>=mpsOrderProgressItemColumns.filter(([k])=>fields.includes(k)).map(([key,title])=>({key,title,dataIndex:key,width:["itemName","exceptionSummary"].includes(key)?220:135,fixed:["orderNumber","itemCode","itemName"].includes(key)?"left" as const:undefined,ellipsis:true,sorter:true,
    render:(value:unknown,row)=>key==="itemCode"?<Button type="link" className="mps-item-link" onClick={()=>onOpen(row)}>{String(value??"—")}</Button>:key==="divisionId"?String(row.divisionName??"—"):/^(technical|hardware|wood|outsourcing)Status$/.test(key)?<State value={value}/>:key==="planStatus"?<State value={value} missing="暂无数据"/>:/Quantity$|Rate$/.test(key)?mpsMetric(value,key):String(value??"—")}));
  for(const p of [...standardProcesses].sort((a,b)=>a.order-b.order))if(fields.some(k=>[p.code+"Status",p.code+"ProductionProgress",p.code+"ReportedQuantity"].includes(k)))columns.push({key:p.code+"ProductionProgress",title:p.name,width:160,render:(_,row)=><ProcessCell row={row} code={p.code} fields={fields}/>});
  return <div className="mps-order-items" aria-label={`${String(order.orderNumber??"订单")}品号明细`}>
    <div className="mps-order-table-toolbar"><span>品号明细</span><ExportButton kind="items" filters={{...filters,orderNumbers:[String(order.orderNumber)]}} allowed={canExport} label="导出本订单品号"/></div>
    {result.error&&<Alert type="error" showIcon message={(result.error as Error).message}/>}
    <KdosDataTable<MpsProgressRow> resource={resource} viewKey="items" simple systemFields={false} rowKey="id" loading={result.isFetching} dataSource={result.data?.rows??[]} columns={columns} scroll={{x:columns.reduce((n,c)=>n+Number(c.width??150),0)}} serverData={{total:result.data?.total??0,onQueryChange:q=>setQuery({page:q.page,pageSize:q.pageSize,sortField:q.sortField,sortOrder:q.sortOrder})}} pagination={{pageSize:query.pageSize}}/>
  </div>;
}
const detailTabs=[{key:"mps-weekly-plans",label:"关联周计划"},{key:"mps-technical-reports",label:"图纸"},{key:"mps-material-reports",label:"主材"},{key:"mps-outsourcing-reports",label:"外协"},{key:"mps-weekly-process-plans",label:"工序任务"},{key:"mps-process-reports",label:"实际报工"}];
const detailLabels:Record<string,string>={divisionId:"事业部",orderNumber:"订单号",itemCode:"品号",itemName:"品名",deliveryNumber:"交期编码",orderDate:"订单日期",latestCustomerDueDate:"交付日期",plannedQuantity:"周计划数量",technicalStatus:"图纸状态",hardwareStatus:"五金状态",woodStatus:"木作状态",outsourcingStatus:"外协状态",drawingDueDate:"图纸交期",hardwareDueDate:"五金交期",woodDueDate:"木作交期",materialName:"主材",received:"已到位",actualInboundDate:"实际入库日期",outsourcingDueDate:"外协交期",status:"状态",processCode:"工序",productionDate:"报工日期",productionQuantity:"本次报工数量",exceptionText:"人工异常",exceptionSummary:"人工异常"};
function Detail({item,filters,session,user,close}:{item:MpsProgressRow;filters:MpsOrderProgressFilters;session:string;user:Parameters<typeof hasSessionResourcePermission>[0];close:()=>void}){
  const tabs=detailTabs.filter(t=>hasSessionResourcePermission(user,t.key,"read"));const [code,setCode]=useState(tabs[0]?.key??""),[query,setQuery]=useState<Query>(blankQuery);
  const result=useQuery({queryKey:[resource,session,"detail",item.id,filters,code,query],queryFn:()=>api<MpsProgressPage>(orderProgressUrl(filters,`/detail/${code}`,{...params(query),orderId:String(item.orderId),itemId:item.id})),enabled:!!code,retry:false});
  const columns=(result.data?.visibleFields??[]).filter(k=>detailLabels[k]).map(k=>({key:k,dataIndex:k,title:detailLabels[k],width:k==="exceptionText"||k==="exceptionSummary"?300:150,ellipsis:true,render:(value:unknown,row:MpsProgressRow)=>k==="divisionId"?String(row.divisionName??"—"):k==="processCode"?standardProcesses.find(p=>p.code===value)?.name??"—":k==="received"?value===true?"已到位":value===false?"未到位":"—":String(value??"—")}));
  return <Drawer title={`${String(item.itemCode??"品号")} · ${String(item.itemName??"")}`} width="90vw" open onClose={close} destroyOnHidden>
    {!tabs.length?<Alert type="info" message="没有关联业务表的查看权限"/>:<>
      <Tabs activeKey={code} items={tabs} onChange={key=>{setCode(key);setQuery(blankQuery())}}/>
      {result.error&&<Alert type="error" showIcon message={(result.error as Error).message}/>}
      <KdosDataTable<MpsProgressRow> key={code} resource={resource} viewKey={`detail-${code}`} simple systemFields={false} rowKey="id" dataSource={result.data?.rows??[]} loading={result.isFetching} columns={columns} scroll={{x:columns.length*150}} serverData={{total:result.data?.total??0,onQueryChange:q=>setQuery({page:q.page,pageSize:q.pageSize})}} pagination={{pageSize:query.pageSize}}/>
    </>}
  </Drawer>;
}
export function MasterPlanOrderProgress({navigationFilters}:{navigationFilters?:MpsDashboardFilters}={}){
  const user=JSON.parse(localStorage.getItem("sessionUser")??"{}"),session=JSON.stringify(user),canRead=hasSessionResourcePermission(user,resource,"read");
  const [draft,setFilters]=useState<MpsOrderProgressFilters>(()=>navigationFilters?{...navigationFilters,onlyUnfinishedOrders:true,onlyUnfinishedItems:true}:initialFilters()),[query,setQuery]=useState<Query>(blankQuery),[expanded,setExpanded]=useState<Key[]>([]),[item,setItem]=useState<MpsProgressRow|null>(null);
  const client=useQueryClient();
  const meta=useQuery({queryKey:[resource,session,"meta"],queryFn:()=>api<{visibleFields:string[];canExport:boolean}>(orderProgressUrl({},"/meta")),enabled:canRead,retry:false});
  const fields=meta.data?.visibleFields??[],has=(k:string)=>fields.includes(k);
  const filters={...draft,onlyUnfinishedOrders:has("orderPendingQuantity")&&has("coverageStatus")?draft.onlyUnfinishedOrders:false,onlyUnfinishedItems:has("pendingQuantity")&&has("planStatus")?draft.onlyUnfinishedItems:false,...(!has("orderDate")&&!has("deliveryDate")?{dateType:"NONE" as const}:!has("orderDate")&&draft.dateType==="ORDER"?{dateType:"NONE" as const}:{})};
  const result=useQuery({queryKey:[resource,session,"orders",filters,query],queryFn:()=>api<MpsProgressPage>(orderProgressUrl(filters,"/orders",params(query))),enabled:canRead&&!!meta.data,retry:false,staleTime:60_000});
  const apply=(patch:Partial<MpsOrderProgressFilters>)=>{setFilters(f=>({...f,...patch}));setQuery(blankQuery());setExpanded([]);setItem(null)};
  const canExport=!!meta.data?.canExport;
  const columns:ColumnsType<MpsProgressRow>=mpsOrderProgressOrderColumns.filter(([k])=>has(k)).map(([key,title])=>({key,title,dataIndex:key,width:key==="exceptionSummary"?280:key==="orderNumber"?180:150,ellipsis:true,fixed:key==="orderNumber"?"left" as const:undefined,sorter:true,render:(value:unknown,row)=>key==="divisionId"?String(row.divisionName??"—"):key==="orderCompletionRate"?<Tooltip title="集团主计划正式订单完成率">{mpsMetric(value,key)}</Tooltip>:/Quantity$|Rate$/.test(key)?mpsMetric(value,key):String(value??"—")}));
  if(!canRead)return <Alert type="error" message="没有在制订单进度看板权限"/>;
  return <div className="mps-order-progress">
    <div className="mps-order-filters">
      {(["divisionId","customerCode","orderNumber","itemCode"]as const).filter(has).map(field=><MpsRemoteSelect key={session+field} field={field} filters={filters} session={session} onChange={apply} resourceCode={resource} url={orderProgressUrl}/>)}
      {!!meta.data&&<MpsDateFilter filters={filters} onChange={apply} allowOrder={has("orderDate")} allowDelivery={has("deliveryDate")}/>}
      {has("orderPendingQuantity")&&has("coverageStatus")&&<Checkbox checked={filters.onlyUnfinishedOrders} onChange={e=>apply({onlyUnfinishedOrders:e.target.checked})}>只看未完成订单</Checkbox>}
      {has("pendingQuantity")&&has("planStatus")&&<Checkbox checked={filters.onlyUnfinishedItems} onChange={e=>apply({onlyUnfinishedItems:e.target.checked})}>只看未完成品号</Checkbox>}
      <Button onClick={()=>{setFilters(initialFilters());setQuery(blankQuery());setExpanded([]);setItem(null)}}>重置筛选</Button>
      <Button aria-label="刷新" loading={result.isFetching} onClick={()=>void client.invalidateQueries({queryKey:[resource,session]})}>刷新</Button><TablePermissionButton resource={resource}/>
    </div>
    {(meta.error||result.error)&&<Alert type="error" showIcon message={((meta.error||result.error)as Error).message}/>}
    {meta.isLoading&&<Spin aria-label="加载字段权限"/>}
    <Card title="订单进度" extra={<Space wrap><ExportButton kind="orders" filters={filters} query={query} allowed={canExport}/><ExportButton kind="items" filters={filters} allowed={canExport}/></Space>}>
      <KdosDataTable<MpsProgressRow> resource={resource} viewKey="orders" simple systemFields={false} rowKey="id" dataSource={result.data?.rows??[]} columns={columns} loading={result.isFetching} locale={{emptyText:<Empty description="暂无匹配订单"/>}} scroll={{x:columns.reduce((n,c)=>n+Number(c.width??150),0)}}
        expandable={{expandedRowKeys:expanded,onExpandedRowsChange:keys=>setExpanded([...keys]),expandedRowRender:row=><ItemTable key={session+row.id+JSON.stringify(filters)} order={row} filters={filters} session={session} canExport={canExport} onOpen={setItem}/>}}
        serverData={{resetKey:JSON.stringify(filters),total:result.data?.total??0,onQueryChange:q=>{if(query.page!==q.page||query.pageSize!==q.pageSize||query.sortField!==q.sortField||query.sortOrder!==q.sortOrder){setQuery({page:q.page,pageSize:q.pageSize,sortField:q.sortField,sortOrder:q.sortOrder});setExpanded([])}}}} pagination={{pageSize:query.pageSize}}/>
    </Card>
    {item&&<Detail key={item.id+JSON.stringify(filters)} item={item} filters={filters} session={session} user={user} close={()=>setItem(null)}/>}
  </div>;
}
