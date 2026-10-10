import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Breadcrumb, Button, Dropdown, Empty, Input, List, Modal, Pagination } from "antd";
import { FileOutlined, FolderOutlined, MoreOutlined } from "@ant-design/icons";
import type { KnowledgeFolder, KnowledgeFolderResult, KnowledgePage, KnowledgePageResult, KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import { KnowledgeLocationPicker } from "./KnowledgeLocationPicker";
import { KnowledgeFolderCreate } from "./KnowledgeFolderTree";
import { knowledgeFoldersUrl } from "./knowledge-ui";
export function KnowledgeFolderContents({space,folderId,working=false,manage=false,onFolder,onPage}:{space:KnowledgeSpace;folderId?:string;working?:boolean;manage?:boolean;onFolder:(id?:string)=>void;onPage:(page:KnowledgePage)=>void}) {
  const [folderPage,setFolderPage]=useState(1),[page,setPage]=useState(1),[action,setAction]=useState<{kind:"rename"|"move";folder:KnowledgeFolder}>(),[name,setName]=useState(""),[target,setTarget]=useState<string>(),[valid,setValid]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [creatingParent,setCreatingParent]=useState<string>();
  const {modal,message}=App.useApp(),client=useQueryClient();
  const folders=useQuery({queryKey:["knowledge","folder-contents",space.id,folderId,folderPage],queryFn:()=>api<KnowledgeFolderResult>(knowledgeFoldersUrl(space.id,{parentFolderId:folderId,page:String(folderPage),pageSize:"20"})),retry:false});
  const selected=useQuery({queryKey:["knowledge","folder-path",space.id,folderId],queryFn:()=>api<KnowledgeFolderResult>(knowledgeFoldersUrl(space.id,{selectedId:folderId})),enabled:!!folderId,retry:false});
  const pages=useQuery({queryKey:["knowledge","folder-pages",space.id,folderId,working,page],queryFn:()=>api<KnowledgePageResult>(`/knowledge/spaces/${space.id}/tree?${new URLSearchParams({folderId:folderId??"",mode:working?"working":"published",page:String(page),pageSize:"20"})}`),enabled:!folderId||!!selected.data?.rows.length,retry:false});
  const path=selected.data?.rows[0]?.breadcrumb??[{id:space.id,title:space.name,kind:"space"}];
  const openFolder=(id?:string)=>{setFolderPage(1);setPage(1);onFolder(id);};
  const save=async()=>{if(!action||busy)return;setBusy(true);setError("");try{await api(`/knowledge/folders/${action.folder.id}`,{method:"PATCH",body:JSON.stringify({expectedVersion:action.folder.version,...(action.kind==="rename"?{name}:{parentFolderId:target??null})})});await client.invalidateQueries({queryKey:["knowledge"]});setAction(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="knowledge-folder-contents"><Breadcrumb items={path.map((b,i)=>({title:<Button type="link" onClick={()=>openFolder(i===0?undefined:b.id)}>{b.title}</Button>}))}/>
    {!!folderId&&<Button onClick={()=>openFolder(selected.data?.rows[0]?.parentFolderId??undefined)}>返回上级目录</Button>}
    {(folders.error||pages.error||selected.error)&&<Alert type="error" message={(folders.error||pages.error||selected.error)!.message}/>}
    {folderId&&selected.data&&!selected.data.rows.length&&<Alert type="warning" message="文件夹不存在或无查看权限"/>}
    <List loading={folders.isFetching} dataSource={folders.data?.rows} locale={{emptyText:<></>}} renderItem={folder=><List.Item actions={manage&&(folder.canEdit||space.canCreateFolders)?[<Dropdown key="actions" menu={{items:[...(space.canCreateFolders?[{key:"create",label:"新建子文件夹"}]:[]),...(folder.canEdit?[{key:"rename",label:"重命名"},{key:"move",label:"移动文件夹"}]:[]),...(folder.canDelete?[{key:"delete",label:"删除空文件夹",danger:true}]:[])],onClick:({key})=>{setError("");if(key==="create")setCreatingParent(folder.id);else if(key==="delete")modal.confirm({title:"删除空文件夹？",content:"包含子目录或知识内容的文件夹不能删除。",onOk:async()=>{try{await api(`/knowledge/folders/${folder.id}`,{method:"DELETE",body:JSON.stringify({expectedVersion:folder.version})});await client.invalidateQueries({queryKey:["knowledge"]});}catch(e){message.error((e as Error).message);throw e;}}});else{setAction({kind:key as "rename"|"move",folder});setName(folder.name);setTarget(folder.parentFolderId??undefined);}}}}><Button aria-label={`文件夹操作：${folder.name}`} icon={<MoreOutlined aria-hidden/>}/></Dropdown>]:[] }><Button type="link" icon={<FolderOutlined aria-hidden/>} onClick={()=>openFolder(folder.id)}>{folder.name}</Button></List.Item>}/>
    {(folders.data?.total??0)>20&&<Pagination current={folderPage} pageSize={20} total={folders.data?.total} showSizeChanger={false} onChange={setFolderPage}/>}
    <List loading={pages.isFetching} dataSource={pages.data?.rows} locale={{emptyText:folders.data?.rows.length?<></>:<Empty description="当前文件夹暂无可见知识"/>}} renderItem={row=><List.Item><div><Button type="link" icon={<FileOutlined aria-hidden/>} onClick={()=>onPage(row)}>{row.title}</Button>{row.hasChildren&&<span className="knowledge-legacy-note">（保留历史子页面）</span>}{working&&row.status==="DRAFT"&&<span> 草稿</span>}</div></List.Item>}/>
    {(pages.data?.total??0)>20&&<Pagination current={page} pageSize={20} total={pages.data?.total} showSizeChanger={false} onChange={setPage}/>}
    {creatingParent&&<KnowledgeFolderCreate spaceId={space.id} parentFolderId={creatingParent} onClose={()=>setCreatingParent(undefined)} onCreated={id=>{setCreatingParent(undefined);openFolder(id);}}/>}
    {action&&<Modal open title={action.kind==="rename"?"重命名文件夹":"移动文件夹"} onCancel={()=>setAction(undefined)} onOk={()=>void save()} confirmLoading={busy} okButtonProps={{disabled:action.kind==="rename"?!name.trim():!valid}}>
      {action.kind==="rename"?<Input aria-label="文件夹名称" value={name} maxLength={200} disabled={busy} onChange={e=>setName(e.target.value)}/>:<KnowledgeLocationPicker operation="moveFolder" spaces={[space]} value={{spaceId:space.id,folderId:target}} onChange={v=>setTarget(v.folderId)} excludeId={action.folder.id} onValidityChange={setValid} disabled={busy}/>}{error&&<Alert type="error" message={error}/>}</Modal>}
  </div>;
}
