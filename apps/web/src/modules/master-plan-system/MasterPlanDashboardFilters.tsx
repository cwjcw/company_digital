import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatePicker, Select } from "antd";
import dayjs from "dayjs";
import { mpsDashboardResource as resource, type MpsDashboardFilters } from "@kdos/contracts";
import { api } from "../../api";
import { mpsDashboardUrl } from "./master-plan-dashboard.utils";

type Field = "divisionId" | "customerCode" | "orderNumber" | "itemCode";
const labels = { divisionId:"事业部", customerCode:"客户", orderNumber:"订单号", itemCode:"品号" };
export function MpsRemoteSelect({ field, filters, session, onChange, resourceCode = resource, url = mpsDashboardUrl }: { resourceCode?: string; url?: typeof mpsDashboardUrl; field: Field; filters: MpsDashboardFilters; session: string; onChange:(patch:MpsDashboardFilters)=>void }) {
  const [search,setSearch]=useState(""),[query,setQuery]=useState(""),[selectedLabels,setSelectedLabels]=useState<Record<string,string>>({});
  useEffect(()=>{const id=setTimeout(()=>setQuery(search),250);return()=>clearTimeout(id);},[search]);
  const multiple=field==="orderNumber"||field==="itemCode", key=field==="orderNumber"?"orderNumbers":field==="itemCode"?"itemCodes":field;
  const context={...filters};delete context[key];
  const result=useQuery({queryKey:[resourceCode,session,"candidates",field,context,query],queryFn:()=>api<{options:Array<{value:string;label:string}>;hasMore:boolean}>(url(context,"/candidates",{field,search:query})),staleTime:60_000,placeholderData:undefined});
  const values=filters[key],value=multiple?(values as string[]|undefined)?.map(v=>({value:v,label:selectedLabels[v]??result.data?.options.find(o=>o.value===v)?.label??v})):values?{value:values as string,label:selectedLabels[values as string]??result.data?.options.find(o=>o.value===values)?.label??values}:undefined;
  return <Select className="mps-dashboard-select" mode={multiple?"multiple":undefined} maxTagCount="responsive" labelInValue aria-label={labels[field]} placeholder={`全部${labels[field]}`} allowClear showSearch filterOption={false} value={value} onSearch={setSearch} onChange={next=>{
    const entries=(multiple?next:next?[next]:[]) as Array<{value:string;label:string}>;
    setSelectedLabels(prev=>({...prev,...Object.fromEntries(entries.map(v=>[v.value,v.label]))}));
    onChange({[key]:multiple?entries.map(v=>v.value):entries[0]?.value});
  }} loading={result.isFetching} options={result.data?.options} notFoundContent={result.error?<span role="alert">{(result.error as Error).message}</span>:undefined} popupRender={menu=><>{menu}{result.data?.hasMore&&<div className="mps-candidate-more">请继续输入缩小范围</div>}</>}/>;
}
export function MpsDateFilter({filters,onChange,allowOrder,allowDelivery}:{filters:MpsDashboardFilters;onChange:(patch:MpsDashboardFilters)=>void;allowOrder:boolean;allowDelivery:boolean}) {
  const yesterday=dayjs(new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"})).subtract(1,"day"),period=filters.datePeriod??"DAY";
  const changePeriod=(next:NonNullable<MpsDashboardFilters["datePeriod"]>)=>{
    const date=filters.dateValue?dayjs(filters.dateValue):yesterday;
    onChange({datePeriod:next,dateValue:next==="CUSTOM"?undefined:date.format(next==="MONTH"?"YYYY-MM":next==="YEAR"?"YYYY":"YYYY-MM-DD"),dateFrom:next==="CUSTOM"?date.format("YYYY-MM-DD"):undefined,dateTo:next==="CUSTOM"?date.format("YYYY-MM-DD"):undefined});
  };
  return <><Select aria-label="日期类型" value={filters.dateType??"NONE"} onChange={value=>onChange({dateType:value,datePeriod:"DAY",dateValue:value==="NONE"?undefined:yesterday.format("YYYY-MM-DD"),dateFrom:undefined,dateTo:undefined})} options={[{value:"NONE",label:"不限日期"},...(allowOrder?[{value:"ORDER",label:"订单日期"}]:[]),...(allowDelivery?[{value:"DELIVERY",label:"交付日期"}]:[])]}/>
    {filters.dateType&&filters.dateType!=="NONE"&&<><Select aria-label="日期周期" value={period} onChange={changePeriod} options={[{value:"DAY",label:"按日"},{value:"MONTH",label:"按月"},{value:"YEAR",label:"按年"},{value:"CUSTOM",label:"自定义"}]}/>
      {period==="CUSTOM"?<DatePicker.RangePicker aria-label="日期范围" allowClear={false} value={filters.dateFrom&&filters.dateTo?[dayjs(filters.dateFrom),dayjs(filters.dateTo)]:null} onChange={dates=>dates?.[0]&&dates[1]&&onChange({dateFrom:dates[0].format("YYYY-MM-DD"),dateTo:dates[1].format("YYYY-MM-DD")})}/>:<DatePicker aria-label="日期值" allowClear={false} picker={period==="MONTH"?"month":period==="YEAR"?"year":"date"} value={filters.dateValue?dayjs(filters.dateValue):null} onChange={date=>date&&onChange({dateValue:date.format(period==="MONTH"?"YYYY-MM":period==="YEAR"?"YYYY":"YYYY-MM-DD")})}/>}</>}
  </>;
}
