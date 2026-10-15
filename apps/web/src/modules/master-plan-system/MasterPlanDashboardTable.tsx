import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, message } from "antd";
import { mpsDashboardReadinessColumns, mpsDashboardExecutionColumns, type MpsDashboardFilters, type MpsDashboardTableData, type MpsDashboardTableKey } from "@kdos/contracts";
import { api } from "../../api";
import { KdosDataTable, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import { downloadApiFile } from "../../shared/legacy-ui";
import { mpsDashboardUrl, mpsMetric } from "./master-plan-dashboard.utils";
export function MpsTableExport({tableKey,filters,extra={},allowed}:{tableKey:MpsDashboardTableKey;filters:MpsDashboardFilters;extra?:Record<string,string>;allowed:boolean}) {
  return allowed?<Button aria-label="导出" onClick={()=>{void downloadApiFile(mpsDashboardUrl(filters,"/export",{...extra,tableKey}),`mps_${tableKey.replaceAll("-","_")}_${new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}).replaceAll("-","")}.xlsx`).catch(e=>message.error((e as Error).message));}}>导出</Button>:null;
}
export function MpsDashboardDetailTable({tableKey,filters,session,canExport}:{tableKey:"plan-readiness"|"process-execution";filters:MpsDashboardFilters;session:string;canExport:boolean}) {
  const [query,setQuery]=useState<{page:number;pageSize:number;sortField?:string;sortOrder?:string}>({page:1,pageSize:kdosDefaultPageSize});
  const extra=Object.fromEntries(Object.entries(query).filter(([,v])=>v!=null).map(([k,v])=>[k,String(v)]));
  const result=useQuery({queryKey:["mps-overview-dashboard",session,tableKey,filters,query],queryFn:()=>api<MpsDashboardTableData>(mpsDashboardUrl(filters,"/table",{...extra,tableKey})),placeholderData:(previous,old)=>old?.queryKey[1]===session?previous:undefined,staleTime:60_000});
  const definitions=tableKey==="plan-readiness"?mpsDashboardReadinessColumns:mpsDashboardExecutionColumns,fields=result.data?.visibleFields??[];
  const numeric=["plannedQuantity","requiredQuantity","reportedQuantity","productionProgress"];
  const columns=definitions.filter(([key])=>tableKey==="process-execution"&&["processName","requiredQuantity","reportedQuantity","productionProgress","status"].includes(key)?key==="processName"||result.data?.rows.some(r=>key in r):key==="issueCategory"?fields.includes("weeklyPlanState"):fields.includes(key));
  return <Card title={tableKey==="plan-readiness"?"计划待完善明细":"工序执行明细"} extra={<MpsTableExport tableKey={tableKey} filters={filters} extra={extra} allowed={canExport}/>}>{result.error&&<Alert type="error" message={(result.error as Error).message}/>}<KdosDataTable resource="mps-overview-dashboard" viewKey={tableKey} simple systemFields={false} density="default" rowKey="id" loading={result.isFetching} dataSource={result.data?.rows??[]} columns={columns.map(([key,title])=>({title,key,dataIndex:key,width:["weeklyPlanMissingFields","weeklyPlanGenerationIssue"].includes(key)?300:170,ellipsis:true,render:(value:unknown,row)=>key==="divisionId"?String(row.divisionName??"—"):numeric.includes(key)?mpsMetric(value,key):String(value??"—")}))} scroll={{x:columns.length*170}} serverData={{total:result.data?.total??0,onQueryChange:q=>setQuery({page:q.page,pageSize:q.pageSize,sortField:q.sortField,sortOrder:q.sortOrder})}} pagination={{pageSize:query.pageSize}}/></Card>;
}
