import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, message } from "antd";
import { api } from "../../api";

type Webhook = { id:string; groupName:string; robotName:string; channelType:string; webhookMasked:string; webhookConfigured:boolean; moduleCode:string; responsibleUserId?:string|null; enabled:boolean; remark?:string; version:number };
type GroupMember = {id:string;groupName:string;robotName:string;enabled:boolean;webhookConfigured:boolean};
type RecipientGroup = {id:string;name:string;category:string;purpose:string;description:string;enabled:boolean;version:number;createdAt?:string;updatedAt?:string;members:GroupMember[]};
type RouteTarget = {id:string;type:"WECHAT_GROUP_WEBHOOK"|"RECIPIENT_GROUP";name:string;target_enabled:boolean;route_enabled:boolean};
type Route = { id?:string; eventType:string; label:string; name:string; moduleCode:string; enabled:boolean; remark?:string; version:number; targets:RouteTarget[] };
type Event = {eventType:string;label:string;moduleCode:string};
type Props = { tab:"webhooks"|"recipient-groups"|"routes"; access:{groupWebhooks:Record<string,boolean>;recipientGroups:Record<string,boolean>;routes:Record<string,boolean>} };
const NO_MEMBER_IDS: string[] = [];

export function NotificationGroupRouting({tab,access}:Props) {
  const client=useQueryClient();
  const [editing,setEditing]=useState<Webhook|null|undefined>();
  const [groupEditing,setGroupEditing]=useState<RecipientGroup|null|undefined>();
  const [routeEditing,setRouteEditing]=useState<Route>();
  const [groupSearch,setGroupSearch]=useState("");
  const [groupStatus,setGroupStatus]=useState<string>();
  const [memberSearch,setMemberSearch]=useState("");
  const [memberStatus,setMemberStatus]=useState<string>();
  const [memberOnlySelected,setMemberOnlySelected]=useState(false);
  const [webhookForm]=Form.useForm(); const [groupForm]=Form.useForm(); const [routeForm]=Form.useForm();
  const webhooks=useQuery({queryKey:["notification-group-webhooks"],queryFn:()=>api<Webhook[]>("/notifications/group-webhooks"),enabled:tab==="webhooks"||tab==="recipient-groups"||access.routes.read===true});
  const people=useQuery({queryKey:["notification-recipient-users"],queryFn:()=>api<Array<{id:string;displayName:string;username:string}>>("/notifications/recipient-users"),enabled:tab==="webhooks"});
  const groups=useQuery({queryKey:["notification-recipient-groups"],queryFn:()=>api<RecipientGroup[]>("/notifications/recipient-groups"),enabled:tab==="recipient-groups"||tab==="routes"&&access.recipientGroups.read===true});
  const routes=useQuery({queryKey:["notification-routes"],queryFn:()=>api<Route[]>("/notifications/routes"),enabled:tab==="routes"});
  const events=useQuery({queryKey:["notification-group-route-events"],queryFn:()=>api<Event[]>("/notifications/routes/events"),enabled:tab==="routes"});
  const refresh=async()=>{await Promise.all([client.invalidateQueries({queryKey:["notification-group-webhooks"]}),client.invalidateQueries({queryKey:["notification-recipient-groups"]}),client.invalidateQueries({queryKey:["notification-routes"]})]);};
  const editWebhook=(row?:Webhook)=>{setEditing(row??null);webhookForm.setFieldsValue(row?{...row,webhook:""}:{enabled:true,moduleCode:"planning"});};
  const saveWebhook=async()=>{try{const values=await webhookForm.validateFields();const path=editing?`/notifications/group-webhooks/${editing.id}`:"/notifications/group-webhooks";await api(path,{method:editing?"PATCH":"POST",body:JSON.stringify({...values,...(editing?{expectedVersion:editing.version}:{})})});message.success("群机器人配置已保存");setEditing(undefined);await refresh();}catch(e){if((e as Error).message)message.error((e as Error).message);}};
  const runTest=async(row:Webhook)=>{try{await api(`/notifications/group-webhooks/${row.id}/test`,{method:"POST"});message.success("测试消息已进入发送队列，可查看发送记录");}catch(e){message.error((e as Error).message);}};
  const deleteWebhook=async(row:Webhook)=>{try{await api(`/notifications/group-webhooks/${row.id}/delete`,{method:"POST",body:JSON.stringify({expectedVersion:row.version})});message.success("群机器人已删除");await refresh();}catch(e){message.error((e as Error).message);}};
  const selectedMemberIds=(Form.useWatch("memberIds",groupForm)??NO_MEMBER_IDS) as string[];
  const memberOptions=useMemo(()=>{const selected=new Set(selectedMemberIds);return (webhooks.data??[]).filter(row=>{
    const matchesSearch=!memberSearch||`${row.groupName} ${row.robotName}`.toLowerCase().includes(memberSearch.toLowerCase());
    const matchesStatus=!memberStatus||(memberStatus==="enabled")===row.enabled;
    return selected.has(row.id)||(!memberOnlySelected&&matchesSearch&&matchesStatus);
  }).map(row=>({value:row.id,label:`${row.groupName}｜${row.robotName}${row.enabled?"":"（成员已停用）"}`}));},[webhooks.data,memberSearch,memberStatus,memberOnlySelected,selectedMemberIds]);
  const editGroup=(row?:RecipientGroup)=>{setGroupEditing(row??null);setMemberSearch("");setMemberStatus(undefined);setMemberOnlySelected(false);groupForm.setFieldsValue(row?{...row,memberIds:row.members.map(m=>m.id)}:{enabled:true,memberIds:[]});};
  const saveGroup=async()=>{try{const values=await groupForm.validateFields();const path=groupEditing?`/notifications/recipient-groups/${groupEditing.id}`:"/notifications/recipient-groups";await api(path,{method:groupEditing?"PATCH":"POST",body:JSON.stringify({...values,...(groupEditing?{expectedVersion:groupEditing.version}:{})})});message.success("收件人组已保存");setGroupEditing(undefined);await refresh();}catch(e){message.error((e as Error).message);}};
  const deleteGroup=async(row:RecipientGroup)=>{try{await api(`/notifications/recipient-groups/${row.id}/delete`,{method:"POST",body:JSON.stringify({expectedVersion:row.version})});message.success("收件人组已删除");await refresh();}catch(e){message.error((e as Error).message);}};
  const saveRoute=async()=>{if(!routeEditing)return;try{const values=await routeForm.validateFields();const targets=(values.targets??[]).map((value:string)=>{const [type,id]=value.split(":",2);return {type,id};});await api("/notifications/routes",{method:"POST",body:JSON.stringify({eventType:routeEditing.eventType,name:values.name,enabled:values.enabled,remark:values.remark,targets,expectedVersion:routeEditing.version||undefined})});message.success("消息路由已保存");setRouteEditing(undefined);await refresh();}catch(e){message.error((e as Error).message);}};
  const editRoute=(row:Route)=>{setRouteEditing(row);routeForm.setFieldsValue({name:row.name,enabled:row.enabled,remark:row.remark,targets:row.targets.map(t=>`${t.type}:${t.id}`)});};
  const deleteRoute=async(row:Route)=>{if(!row.id)return;try{await api(`/notifications/routes/${row.id}/delete`,{method:"POST",body:JSON.stringify({expectedVersion:row.version})});message.success("消息路由已删除");await refresh();}catch(e){message.error((e as Error).message);}};
  const filteredGroups=useMemo(()=> (groups.data??[]).filter(row=>(!groupSearch||`${row.name} ${row.category} ${row.purpose}`.toLowerCase().includes(groupSearch.toLowerCase()))&&(!groupStatus||(groupStatus==="enabled")===row.enabled)),[groups.data,groupSearch,groupStatus]);

  if(tab==="webhooks") return <>
    {webhooks.error&&<Alert type="error" message={(webhooks.error as Error).message} showIcon/>}
    <Space style={{marginBottom:12}}><Button type="primary" disabled={!access.groupWebhooks.create} onClick={()=>editWebhook()}>新增群机器人</Button></Space>
    <Table rowKey="id" loading={webhooks.isLoading} dataSource={webhooks.data??[]} pagination={{pageSize:20}} scroll={{x:1100}} columns={[
      {title:"群名称",dataIndex:"groupName"},{title:"机器人名称",dataIndex:"robotName"},{title:"所属模块",dataIndex:"moduleCode"},{title:"Webhook",dataIndex:"webhookMasked",render:(v:string)=><span>{v||"未配置"}</span>},{title:"状态",dataIndex:"enabled",render:(v:boolean)=><Tag color={v?"success":"default"}>{v?"启用":"停用"}</Tag>},{title:"操作",render:(_:unknown,row:Webhook)=><Space><Button type="link" disabled={!access.groupWebhooks.test||!row.enabled} onClick={()=>void runTest(row)}>测试发送</Button><Button type="link" disabled={!access.groupWebhooks.update} onClick={()=>editWebhook(row)}>编辑</Button><Popconfirm title="删除该群机器人？" onConfirm={()=>void deleteWebhook(row)}><Button type="link" danger disabled={!access.groupWebhooks.delete}>删除</Button></Popconfirm></Space>}
    ]}/>
    <Modal title={editing?"编辑群机器人":"新增群机器人"} open={editing!==undefined} onCancel={()=>setEditing(undefined)} onOk={()=>void saveWebhook()} destroyOnHidden>
      <Form form={webhookForm} layout="vertical"><Form.Item name="groupName" label="群名称" rules={[{required:true}]}><Input maxLength={128}/></Form.Item><Form.Item name="robotName" label="机器人名称" rules={[{required:true}]}><Input maxLength={128}/></Form.Item>
        <Form.Item name="moduleCode" label="所属模块" rules={[{required:true}]}><Select options={[["system","系统管理"],["planning","PMC中心"],["finance","财务中心"],["marketing","营销中心"],["rd","研发中心"],["hr","人力资源"],["data","数据中心"],["project-task","项目与任务"],["workflow","流程审批"],["knowledge","知识库"],["cockpit","公司驾驶舱"]].map(([value,label])=>({value,label}))}/></Form.Item>
        {editing?.webhookConfigured&&<Alert type="info" message={`已配置：${editing.webhookMasked}`} style={{marginBottom:12}}/>}<Form.Item name="webhook" label="Webhook" rules={editing?[]:[{required:true,message:"请输入Webhook"}]} extra="仅接受企业微信官方机器人地址；编辑时留空保持原值。"><Input.Password autoComplete="new-password" placeholder={editing?"留空则保持原Webhook不变":"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"}/></Form.Item>
        <Form.Item name="responsibleUserId" label="负责人"><Select allowClear showSearch optionFilterProp="label" placeholder="可选负责人" options={(people.data??[]).map(user=>({value:user.id,label:`${user.displayName}（${user.username}）`}))}/></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea maxLength={1000}/></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch/></Form.Item></Form>
    </Modal>
  </>;

  if(tab==="recipient-groups") return <>
    {groups.error&&<Alert type="error" message={(groups.error as Error).message} showIcon/>}
    <Space style={{marginBottom:12}}><Input.Search allowClear placeholder="搜索组名称、分类或用途" value={groupSearch} onChange={e=>setGroupSearch(e.target.value)} style={{width:280}}/><Select allowClear placeholder="全部状态" value={groupStatus} onChange={setGroupStatus} options={[{value:"enabled",label:"启用"},{value:"disabled",label:"停用"}]}/><Button type="primary" disabled={!access.recipientGroups.create} onClick={()=>editGroup()}>新增收件人组</Button></Space>
    <Table rowKey="id" loading={groups.isLoading} dataSource={filteredGroups} pagination={{pageSize:20}} scroll={{x:1450}} columns={[
      {title:"组名称",dataIndex:"name"},{title:"组织/业务分类",dataIndex:"category",render:(value:string)=>value||"—"},{title:"用途",dataIndex:"purpose",render:(value:string)=>value||"—"},{title:"成员",dataIndex:"members",render:(members:GroupMember[])=>members.map(member=><Tag key={member.id} color={member.enabled?"blue":"default"}>{member.groupName}{member.enabled?"":"（机器人停用）"}</Tag>)},{title:"状态",dataIndex:"enabled",render:(value:boolean)=><Tag color={value?"success":"default"}>{value?"启用":"停用"}</Tag>},{title:"创建时间",dataIndex:"createdAt",render:(value:string)=>value?new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"—"},{title:"更新时间",dataIndex:"updatedAt",render:(value:string)=>value?new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"—"},{title:"操作",render:(_:unknown,row:RecipientGroup)=><Space><Button type="link" disabled={!access.recipientGroups.update} onClick={()=>editGroup(row)}>编辑</Button><Popconfirm title="删除该收件人组？" onConfirm={()=>void deleteGroup(row)}><Button type="link" danger disabled={!access.recipientGroups.delete}>删除</Button></Popconfirm></Space>}
    ]}/>
    <Modal title={groupEditing?"编辑收件人组":"新增收件人组"} open={groupEditing!==undefined} onCancel={()=>setGroupEditing(undefined)} onOk={()=>void saveGroup()} destroyOnHidden>
      <Form form={groupForm} layout="vertical"><Form.Item name="name" label="组名称" rules={[{required:true}]}><Input maxLength={128}/></Form.Item><Form.Item name="category" label="组织/业务分类"><Input maxLength={128}/></Form.Item><Form.Item name="purpose" label="用途"><Input maxLength={255}/></Form.Item><Form.Item name="description" label="说明"><Input.TextArea maxLength={1000}/></Form.Item><Form.Item name="memberIds" label="群机器人" extra={`已选择 ${selectedMemberIds.length} 个群机器人；启用收件人组时至少选择一个机器人。`}><div><Space wrap style={{marginBottom:8}}><Input.Search allowClear placeholder="搜索群名称或机器人名称" value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} style={{width:240}}/><Select allowClear placeholder="全部机器人状态" value={memberStatus} onChange={setMemberStatus} options={[{value:"enabled",label:"启用"},{value:"disabled",label:"停用"}]}/><Checkbox checked={memberOnlySelected} onChange={e=>setMemberOnlySelected(e.target.checked)}>仅显示已选择</Checkbox></Space><Select mode="multiple" options={memberOptions} style={{width:"100%"}}/></div></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch/></Form.Item></Form>
      {webhooks.data?.length===0&&<Alert type="warning" message="请先添加群机器人，再维护收件人组。"/>}
    </Modal>
  </>;

  const targetOptions=[...(groups.data??[]).map(row=>({value:`RECIPIENT_GROUP:${row.id}`,label:`收件人组｜${row.name}${row.category?`｜${row.category}`:""}${row.enabled?"":"（停用）"}`})),...(webhooks.data??[]).map(row=>({value:`WECHAT_GROUP_WEBHOOK:${row.id}`,label:`单个群｜${row.groupName}${row.enabled?"":"（停用）"}`}))];
  return <>
    {routes.error&&<Alert type="error" message={(routes.error as Error).message} showIcon/>}{groups.error&&access.recipientGroups.read&&<Alert type="error" message={(groups.error as Error).message} showIcon/>}
    <Table rowKey="eventType" loading={routes.isLoading||events.isLoading} dataSource={routes.data??[]} pagination={{pageSize:20}} scroll={{x:900}} columns={[
      {title:"消息类型",dataIndex:"eventType"},{title:"消息名称",dataIndex:"label"},{title:"接收目标",render:(_:unknown,row:Route)=>row.targets.map(target=><Tag key={`${target.type}:${target.id}`} color={!target.target_enabled?"default":target.route_enabled?"blue":"default"}>{target.type==="RECIPIENT_GROUP"?`组｜${target.name}`:`群｜${target.name}`}</Tag>)},{title:"状态",dataIndex:"enabled",render:(v:boolean)=><Tag color={v?"success":"default"}>{v?"启用":"停用"}</Tag>},{title:"操作",render:(_:unknown,row:Route)=><Space><Button type="link" disabled={!access.routes.update&&!access.routes.create} onClick={()=>editRoute(row)}>配置</Button>{row.id&&<Popconfirm title="删除该消息路由？" onConfirm={()=>void deleteRoute(row)}><Button type="link" danger disabled={!access.routes.delete}>删除</Button></Popconfirm>}</Space>}
    ]}/>
    <Modal title={`消息路由：${routeEditing?.eventType??""}`} open={Boolean(routeEditing)} onCancel={()=>setRouteEditing(undefined)} onOk={()=>void saveRoute()} destroyOnHidden>
      <Form form={routeForm} layout="vertical"><Form.Item name="name" label="消息名称" rules={[{required:true}]}><Input maxLength={255}/></Form.Item><Form.Item name="targets" label="接收人组 / 单个群机器人" rules={[{required:true,message:"至少选择一个接收目标"}]}><Select mode="multiple" showSearch optionFilterProp="label" options={targetOptions}/></Form.Item><Form.Item name="enabled" label="启用路由" valuePropName="checked"><Switch/></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea maxLength={1000}/></Form.Item></Form>
      {targetOptions.length===0&&<Alert type="warning" message="请先添加群机器人或收件人组，再配置路由。"/>}
    </Modal>
  </>;
}
