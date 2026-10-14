import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Tabs, Tag, message } from "antd";
import { api } from "../../api";
import { KdosDataTable } from "../../shared/KdosDataTable";
import { PageHeader } from "../../shared/legacy-ui";

type ConfigRow={id:string;version:number;enabled:boolean;division_id:string;divisionName:string;supplier_name?:string;user_ids?:string[]};
type User={id:string;displayName:string;username:string;employeeNo?:string;enabled:boolean;hasWechatId:boolean};
type Config={vendors:ConfigRow[];recipients:ConfigRow[];rule:{id:string;enabled:boolean;version:number};users:User[];units:string[];lastSentAt?:string;complete:boolean};
const endpoint="/master-plan-system/order-allocation-notification-config";
export function OrderAllocationNotificationConfig() {
  const query=useQuery({queryKey:["allocation-notification-config"],queryFn:()=>api<Config>(endpoint)});
  const [editor,setEditor]=useState<{kind:"vendors"|"recipients";row?:ConfigRow}|null>(null),[saving,setSaving]=useState(false),[testUser,setTestUser]=useState<string>();
  const [form]=Form.useForm();const data=query.data;
  const save=async(kind:string,values:Record<string,unknown>)=>{setSaving(true);try{await api(`${endpoint}/${kind}`,{method:"POST",body:JSON.stringify(values)});message.success("已保存");setEditor(null);await query.refetch();}catch(e){message.error((e as Error).message);}finally{setSaving(false);}};
  const open=(kind:"vendors"|"recipients",row?:ConfigRow)=>{form.setFieldsValue({supplierName:row?.supplier_name??"",divisionId:row?.division_id,userIds:row?.user_ids??[],enabled:row?.enabled??true});setEditor({kind,row});};
  if(query.error)return <Alert type="error" message={(query.error as Error).message}/>;
  const people=(data?.users??[]).filter(u=>u.enabled).map(u=>({value:u.id,label:`${u.displayName}（${u.employeeNo||u.username}）${u.hasWechatId?"":" · 缺少企业微信账号"}`}));
  return <div style={{maxWidth:1280,margin:"0 auto",padding:24}}>
    <PageHeader title="订单分配通知配置" actions={<Button onClick={()=>void query.refetch()}>刷新</Button>}/>
    <Space wrap style={{marginBottom:20}}><span>启用企业微信通知</span><Switch checked={data?.rule.enabled??false} disabled={!data||saving} onChange={enabled=>void save("rule",{enabled,expectedVersion:data?.rule.version})}/><Tag color={data?.rule.enabled?"success":"default"}>{data?.rule.enabled?"已启用":"已停用"}</Tag><span>最近发送：{data?.lastSentAt?new Date(data.lastSentAt).toLocaleString("zh-CN",{hour12:false}):"暂无"}</span></Space>
    {data&&!data.complete&&<Alert type="warning" showIcon message="请为五个承接单位配置有效接收人员，并检查企业微信账号。业务员按完整姓名自动匹配。" style={{marginBottom:16}}/>}
    <Tabs items={[
      {key:"vendors",label:"供应商名称映射",children:<><Button onClick={()=>open("vendors")} style={{marginBottom:12}}>新增映射</Button><KdosDataTable simple resource="mps-allocation-vendor-config" rowKey="id" dataSource={data?.vendors??[]} loading={query.isLoading} columns={[
        {title:"供应商名称",dataIndex:"supplier_name"},{title:"承接事业部",dataIndex:"divisionName"},{title:"状态",render:(_:unknown,r:ConfigRow)=><Tag>{r.enabled?"启用":"停用"}</Tag>},{title:"操作",render:(_:unknown,r:ConfigRow)=><Button onClick={()=>open("vendors",r)}>编辑</Button>}
      ]}/></>},
      {key:"recipients",label:"通知接收人对应表",children:<KdosDataTable simple resource="mps-allocation-recipient-config" rowKey="id" dataSource={data?.recipients??[]} loading={query.isLoading} columns={[
        {title:"承接事业部",dataIndex:"divisionName"},{title:"企业微信接收人员",render:(_:unknown,r:ConfigRow)=>(r.user_ids??[]).map(id=>{const u=data?.users.find(u=>u.id===id);return u?`${u.displayName}（${u.employeeNo||u.username}）${u.enabled&&u.hasWechatId?"":" [账号异常]"}`:"[员工不存在]";}).join("、")||"未配置"},{title:"状态",render:(_:unknown,r:ConfigRow)=><Tag>{r.enabled?"启用":"停用"}</Tag>},{title:"操作",render:(_:unknown,r:ConfigRow)=><Button onClick={()=>open("recipients",r)}>编辑</Button>}
      ]}/>}
    ]}/>
    <Space wrap style={{marginTop:24}}><Select style={{minWidth:300}} showSearch optionFilterProp="label" placeholder="选择唯一测试接收人" options={people} value={testUser} onChange={setTestUser}/><Button disabled={!testUser||saving} onClick={()=>Modal.confirm({title:"发送受控测试通知",content:`仅向 ${people.find(p=>p.value===testUser)?.label} 发送一条文本及测试Excel，不修改订单或正式通知开关。`,onOk:async()=>{try{await api(`${endpoint}/test`,{method:"POST",body:JSON.stringify({userId:testUser})});message.success("测试通知已入队，可在消息中心查看文本和文件各自状态");}catch(e){message.error((e as Error).message);throw e;}}})}>发送文本和Excel测试</Button></Space>
    <Modal title={editor?.kind==="vendors"?"供应商名称映射":"通知接收人员"} open={Boolean(editor)} onCancel={()=>setEditor(null)} confirmLoading={saving} onOk={()=>void form.validateFields().then(values=>save(editor!.kind,{...values,id:editor?.row?.id,expectedVersion:editor?.row?.version}))}>
      <Form form={form} layout="vertical">{editor?.kind==="vendors"&&<><Form.Item name="supplierName" label="供应商名称" rules={[{required:true}]}><Input/></Form.Item><Form.Item name="divisionId" label="承接事业部" rules={[{required:true}]}><Select options={(data?.recipients??[]).map(r=>({value:r.division_id,label:r.divisionName}))}/></Form.Item></>}
        {editor?.kind==="recipients"&&<Form.Item name="userIds" label="企业微信接收人员"><Select mode="multiple" showSearch optionFilterProp="label" options={people}/></Form.Item>}
        <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch/></Form.Item>
      </Form>
    </Modal>
  </div>;
}
