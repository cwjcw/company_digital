import { useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Table, Upload } from 'antd';
import { api } from '../../api';
type Preview={previewId:string|null;total:number;errors:Array<{row:number;reason:string}>;counts:Record<string,number|null>;restrictedComparison?:boolean;rows:Array<Record<string,unknown>&{row:number}>};
const summaryLabels:Record<string,string>={total:'总记录数',created:'新增',updated:'更新',earlier:'交期提前',later:'交期推迟',quantityChanged:'数量变化',unchanged:'未变化',conflicts:'冲突',errors:'错误'};
export function ReviewDueImportModal({onClose,onCreated}:{onClose:()=>void;onCreated:()=>Promise<void>}){
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[result,setResult]=useState<{created:number;updated:number;unchanged:number}|null>(null);
  const lock=useRef(false),confirmed=useRef(false);
  const parse=async(file:File)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError(null);setPreview(null);setResult(null);confirmed.current=false;
    const body=new FormData();body.append('file',file);
    try{setPreview(await api<Preview>(`/master-plan-system/resources/mps-review-due-dates/import-preview`,{method:'POST',body}));}
    catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
  };
  const confirm=async()=>{
    if(lock.current||!preview?.previewId||preview.errors.length||result)return;lock.current=true;setBusy(true);setError(null);
    try{
      // A failed refresh may be retried without re-submitting the completed import.
      if(!confirmed.current){const response=await api<{created:number;updated:number;unchanged:number}>(`/master-plan-system/resources/mps-review-due-dates/import-confirm`,{method:'POST',body:JSON.stringify({previewId:preview.previewId})});confirmed.current=true;setResult(response);}
      await onCreated();
    }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
  };
  return <Modal title="导入Excel" width={1250} open onCancel={()=>{if(!lock.current)onClose();}} maskClosable={!busy} closable={!busy} footer={<Space>
    <Button disabled={busy} onClick={onClose}>{result?'关闭':'取消'}</Button>
    {!result&&<Button type="primary" disabled={!preview?.previewId||!!preview.errors.length} loading={busy} onClick={()=>void confirm()}>确认导入</Button>}
    {result&&error&&<Button loading={busy} onClick={()=>void onCreated().then(()=>setError(null)).catch(e=>setError((e as Error).message))}>重新刷新</Button>}
  </Space>}>
    <Space direction="vertical" style={{width:'100%'}}>
      <Alert type="info" message="使用含事业部的当前模板；记录ID和版本同时为空表示新增，同时有效表示更新。更新时可选字段空白保留原值，填写[清空]才清空。交期变更次数及上次入库时间由人工维护，日期变化不自动计次。"/>
      <Upload accept=".xlsx" disabled={busy||!!result} showUploadList={false} beforeUpload={file=>{void parse(file);return false;}}><Button disabled={busy||!!result} loading={busy}>选择Excel文件</Button></Upload>
      {error&&<Alert type="error" showIcon message={error}/>}
      {result&&<Alert type="success" message={`导入完成：新增${result.created}，更新${result.updated}，未变化${result.unchanged}`}/>}
      {preview?.restrictedComparison&&<Alert type="info" message="部分记录无查看权限，既有值和变更比较已隐藏；导入仍按当前授权校验。"/>}
      {preview&&<>
        <Space wrap>{Object.entries(summaryLabels).map(([key,label])=><span key={key}>{label}：{Object.hasOwn(preview.counts,key)?preview.counts[key]??'—':0}</span>)}</Space>
        {preview.errors.length>0&&<Alert type="error" message="整批未提交，请修正后重新预览" description={preview.errors.map(e=>`第${e.row}行：${e.reason}`).join('；')}/>}
        <Table size="small" rowKey="row" dataSource={preview.rows} pagination={{pageSize:20}} scroll={{x:'max-content'}} columns={[
          {title:'行',dataIndex:'row'},{title:'处理',dataIndex:'classification'},...([['divisionName','事业部'],['orderNumber','订单号'],['batchNumber','批次号'],['drawingNumber','品项编码'],['oldInboundDate','原入库时间'],['newInboundDate','新入库时间'],['oldQuantity','原数量'],['newQuantity','新数量'],['expectedChangeCount','交期变更次数（手工）']] as const).map(([dataIndex,title])=>({dataIndex,title,render:(v:unknown)=>v==null?'—':String(v)}))
        ]}/>
      </>}
    </Space>
  </Modal>;
}
