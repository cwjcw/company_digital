import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, message } from "antd";
import { api } from "../../api";

type Webhook = { id:string; groupName:string; robotName:string; channelType:string; webhookMasked:string; webhookConfigured:boolean; moduleCode:string; responsibleUserId?:string|null; enabled:boolean; remark?:string; version:number };
type Route = { id?:string; eventType:string; label:string; name:string; moduleCode:string; enabled:boolean; remark?:string; version:number; targets:Array<{id:string;group_name:string;webhook_enabled:boolean;route_enabled:boolean}> };
type Event = {eventType:string;label:string;moduleCode:string};
type Props = { tab:"webhooks"|"routes"; access:{groupWebhooks:Record<string,boolean>;routes:Record<string,boolean>} };

export function NotificationGroupRouting({tab,access}:Props) {
  const client=useQueryClient(); const [editing,setEditing]=useState<Webhook|null|undefined>(); const [routeEditing,setRouteEditing]=useState<Route>(); const [form]=Form.useForm();
  const webhooks=useQuery({queryKey:["notification-group-webhooks"],queryFn:()=>api<Webhook[]>("/notifications/group-webhooks"),enabled:tab==="webhooks"||access.routes.read===true});
  const people=useQuery({queryKey:["notification-recipient-users"],queryFn:()=>api<Array<{id:string;displayName:string;username:string}>>("/notifications/recipient-users"),enabled:tab==="webhooks"});
  const routes=useQuery({queryKey:["notification-routes"],queryFn:()=>api<Route[]>("/notifications/routes"),enabled:tab==="routes"});
  const events=useQuery({queryKey:["notification-group-route-events"],queryFn:()=>api<Event[]>("/notifications/routes/events"),enabled:tab==="routes"});
  const refresh=async()=>{await Promise.all([client.invalidateQueries({queryKey:["notification-group-webhooks"]}),client.invalidateQueries({queryKey:["notification-routes"]})]);};
  const edit=(row?:Webhook)=>{setEditing(row??null);form.setFieldsValue(row?{...row,webhook:""}:{enabled:true,moduleCode:"planning"});};
  const saveWebhook=async()=>{try{const values=await form.validateFields();const path=editing?`/notifications/group-webhooks/${editing.id}`:"/notifications/group-webhooks";await api(path,{method:editing?"PATCH":"POST",body:JSON.stringify({...values,...(editing?{expectedVersion:editing.version}:{})})});message.success("群机器人配置已保存");setEditing(undefined);await refresh();}catch(e){if((e as Error).message)message.error((e as Error).message);}};
  const runTest=async(row:Webhook)=>{try{await api(`/notifications/group-webhooks/${row.id}/test`,{method:"POST"});message.success("测试消息已进入发送队列，可查看发送记录");}catch(e){message.error((e as Error).message);}};
  const delWebhook=async(row:Webhook)=>{try{await api(`/notifications/group-webhooks/${row.id}/delete`,{method:"POST",body:JSON.stringify({expectedVersion:row.version})});message.success("群机器人已删除");await refresh();}catch(e){message.error((e as Error).message);}};
  const saveRoute=async()=>{if(!routeEditing)return;try{const values=await form.validateFields();await api("/notifications/routes",{method:"POST",body:JSON.stringify({eventType:routeEditing.eventType,name:values.name,enabled:values.enabled,remark:values.remark,targetIds:values.targetIds,expectedVersion:routeEditing.version||undefined})});message.success("消息路由已保存");setRouteEditing(undefined);await refresh();}catch(e){message.error((e as Error).message);}};
  const editRoute=(row:Route)=>{setRouteEditing(row);form.setFieldsValue({name:row.name,enabled:row.enabled,remark:row.remark,targetIds:row.targets.map(t=>t.id)});};
  const deleteRoute=async(row:Route)=>{if(!row.id)return;try{await api(`/notifications/routes/${row.id}/delete`,{method:"POST",body:JSON.stringify({expectedVersion:row.version})});message.success("消息路由已删除");await refresh();}catch(e){message.error((e as Error).message);}};
  if(tab==="webhooks") return <>
    {webhooks.error&&<Alert type="error" message={(webhooks.error as Error).message} showIcon/>}
    <Space style={{marginBottom:12}}><Button type="primary" disabled={!access.groupWebhooks.create} onClick={()=>edit()}>新增群机器人</Button></Space>
    <Table rowKey="id" loading={webhooks.isLoading} dataSource={webhooks.data??[]} pagination={{pageSize:20}} scroll={{x:1100}} columns={[
      {title:"群名称",dataIndex:"groupName"},{title:"机器人名称",dataIndex:"robotName"},{title:"所属模块",dataIndex:"moduleCode"},{title:"Webhook",dataIndex:"webhookMasked",render:(v:string)=><span>{v||"未配置"}</span>},{title:"状态",dataIndex:"enabled",render:(v:boolean)=><Tag color={v?"success":"default"}>{v?"启用":"停用"}</Tag>},{title:"操作",render:(_:unknown,row:Webhook)=><Space><Button type="link" disabled={!access.groupWebhooks.test||!row.enabled} onClick={()=>void runTest(row)}>测试发送</Button><Button type="link" disabled={!access.groupWebhooks.update} onClick={()=>edit(row)}>编辑</Button><Popconfirm title="删除该群机器人？" onConfirm={()=>void delWebhook(row)}><Button type="link" danger disabled={!access.groupWebhooks.delete}>删除</Button></Popconfirm></Space>}
    ]}/>
    <Modal title={editing?"编辑群机器人":"新增群机器人"} open={editing!==undefined} onCancel={()=>setEditing(undefined)} onOk={()=>void saveWebhook()} destroyOnHidden>
      <Form form={form} layout="vertical"><Form.Item name="groupName" label="群名称" rules={[{required:true}]}><Input maxLength={128}/></Form.Item><Form.Item name="robotName" label="机器人名称" rules={[{required:true}]}><Input maxLength={128}/></Form.Item>
        <Form.Item name="moduleCode" label="所属模块" rules={[{required:true}]}><Select options={[["system","系统管理"],["planning","PMC中心"],["finance","财务中心"],["marketing","营销中心"],["rd","研发中心"],["hr","人力资源"],["data","数据中心"],["project-task","项目与任务"],["workflow","流程审批"],["knowledge","知识库"],["cockpit","公司驾驶舱"]].map(([value,label])=>({value,label}))}/></Form.Item>
        {editing?.webhookConfigured&&<Alert type="info" message={`已配置：${editing.webhookMasked}`} style={{marginBottom:12}}/>}<Form.Item name="webhook" label="Webhook" rules={editing?[]:[{required:true,message:"请输入Webhook"}]} extra="仅接受企业微信官方机器人地址；编辑时留空保持原值。"><Input.Password autoComplete="new-password" placeholder={editing?"留空则保持原Webhook不变":"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"}/></Form.Item>
        <Form.Item name="responsibleUserId" label="负责人"><Select allowClear showSearch optionFilterProp="label" placeholder="可选负责人" options={(people.data??[]).map(user=>({value:user.id,label:`${user.displayName}（${user.username}）`}))}/></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea maxLength={1000}/></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch/></Form.Item></Form>
    </Modal>
  </>;

  return <>
    {routes.error&&<Alert type="error" message={(routes.error as Error).message} showIcon/>}
    <Table rowKey="eventType" loading={routes.isLoading||events.isLoading} dataSource={routes.data??[]} pagination={{pageSize:20}} scroll={{x:900}} columns={[
      {title:"消息类型",dataIndex:"eventType"},{title:"消息名称",dataIndex:"label"},{title:"接收群机器人",render:(_:unknown,row:Route)=>row.targets.map(target=><Tag key={target.id} color={!target.webhook_enabled?"default":target.route_enabled?"blue":"default"}>{target.group_name}</Tag>)},{title:"状态",dataIndex:"enabled",render:(v:boolean)=><Tag color={v?"success":"default"}>{v?"启用":"停用"}</Tag>},{title:"操作",render:(_:unknown,row:Route)=><Space><Button type="link" disabled={!access.routes.update&&!access.routes.create} onClick={()=>editRoute(row)}>配置</Button>{row.id&&<Popconfirm title="删除该消息路由？" onConfirm={()=>void deleteRoute(row)}><Button type="link" danger disabled={!access.routes.delete}>删除</Button></Popconfirm>}</Space>}
    ]}/>
    <Modal title={`消息路由：${routeEditing?.eventType??""}`} open={Boolean(routeEditing)} onCancel={()=>setRouteEditing(undefined)} onOk={()=>void saveRoute()} destroyOnHidden>
      <Form form={form} layout="vertical"><Form.Item name="name" label="消息名称" rules={[{required:true}]}><Input maxLength={255}/></Form.Item><Form.Item name="targetIds" label="接收群机器人" rules={[{required:true,message:"至少选择一个目标群"}]}><Checkbox.Group style={{display:"flex",flexDirection:"column",gap:8}} options={(webhooks.data??[]).map(row=>({label:`${row.groupName}（${row.enabled?"启用":"停用"}）`,value:row.id,disabled:!row.enabled}))}/></Form.Item><Form.Item name="enabled" label="启用路由" valuePropName="checked"><Switch/></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea maxLength={1000}/></Form.Item></Form>
      {webhooks.data?.length===0&&<Alert type="warning" message="请先添加群机器人，再配置路由。"/>}
    </Modal>
  </>;
}
