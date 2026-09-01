import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, message, Modal, Select, Space, Tag } from "antd";
import { api } from "../../api";
import { KdosDataTable, hasResourcePermission } from "../../shared/KdosDataTable";
import { PageHeader, downloadApiFile } from "../../shared/legacy-ui";

const levelColor:Record<string,string>={HIGH_CONFIDENCE_DUPLICATE:"red",NEEDS_REVIEW:"gold",SAME_NUMBER_CONFLICT:"purple",NO_MATCH:"default"};
const fields:Array<[string,string,number?]>=[
  ["duplicateLevel","重复等级",230],["suggestedAction","建议动作",280],["e10OrderNumber","E10订单号",180],["tplusOrderNumber","T+订单号",180],
  ["sourceAccountName","来源账套",300],["customerSummary","客户",280],["e10ItemQuantitySummary","E10品项及数量摘要",420],["tplusItemQuantitySummary","T+品项及数量摘要",420],
  ["totalQuantityConsistent","总数量是否一致",150],["deliveryDateConsistent","交期是否一致",130],["matchingRule","匹配规则",340],["matchingReason","匹配理由",560],
  ["systemSuggestion","系统建议",300],["businessConfirmationStatus","业务确认状态",190],["businessConfirmedBy","业务确认人",160],["businessConfirmedAt","业务确认日期",190],["businessRemark","备注",300]
];

export function DuplicateOrderReviewPage(){
  const client=useQueryClient(); const [current,setCurrent]=useState<any>(); const [form]=Form.useForm();
  const query=useQuery({queryKey:["duplicate-order-review"],queryFn:async()=>{
    const first=await api<any>("/data-operations/order-sync/reviews?page=1&pageSize=200"); const rows=[...first.rows];
    for(let page=2;rows.length<first.total;page++) rows.push(...(await api<any>(`/data-operations/order-sync/reviews?page=${page}&pageSize=200`)).rows); return rows;
  }});
  const refresh=()=>void client.invalidateQueries({queryKey:["duplicate-order-review"]});
  const columns:any[]=fields.map(([key,title,width])=>({title,dataIndex:key,width:width??160,render:(value:any)=>key==="duplicateLevel"?<Tag color={levelColor[value]}>{value}</Tag>
    :["totalQuantityConsistent","deliveryDateConsistent"].includes(key)?(value?"是":"否"):value??"-"}));
  columns.push({title:"复核",dataIndex:"action",width:100,render:(_:unknown,row:any)=><Button size="small" disabled={!hasResourcePermission("duplicate-order-review","update")} onClick={()=>{setCurrent(row);form.setFieldsValue({status:row.businessConfirmationStatus,remark:row.businessRemark});}}>处理</Button>});
  return <div><PageHeader title="重复订单业务复核" subtitle="治理清单，不是第二张订单表；原始记录保持独立，未经业务确认不会自动合并" actions={<Space>
    {hasResourcePermission("duplicate-order-review","import")&&<Button onClick={async()=>{const result=await api<any>("/data-operations/order-sync/reviews/rebuild",{method:"POST"});message.success(`已重建 ${result.total} 条候选`);refresh();}}>重建候选</Button>}
    {hasResourcePermission("duplicate-order-review","export")&&<Button onClick={()=>void downloadApiFile("/data-operations/order-sync/reviews-export.xlsx","重复订单业务复核.xlsx")}>导出 Excel</Button>}
  </Space>}/>
    <KdosDataTable resource="duplicate-order-review" rowKey="id" loading={query.isLoading} dataSource={query.data} columns={columns} editable={false} scroll={{x:"max-content",y:"calc(100vh - 290px)"}}/>
    <Modal title="业务复核" open={Boolean(current)} onCancel={()=>setCurrent(undefined)} onOk={()=>form.validateFields().then(async values=>{
      await api(`/data-operations/order-sync/reviews/${current.id}`,{method:"PATCH",body:JSON.stringify({expectedVersion:current.version,status:values.status,remark:values.remark??null})});
      message.success("复核结果已保存");setCurrent(undefined);refresh();
    })}><Form form={form} layout="vertical"><Form.Item name="status" label="业务确认状态" rules={[{required:true}]}><Select options={[
      {value:"PENDING",label:"待确认"},{value:"CONFIRMED_DUPLICATE",label:"确认重复"},{value:"CONFIRMED_SEPARATE",label:"确认独立订单"}
    ]}/></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea rows={4}/></Form.Item></Form></Modal>
  </div>;
}
