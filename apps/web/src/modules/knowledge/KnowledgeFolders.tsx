import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Breadcrumb, Button, Dropdown, Empty, Input, List, Modal, Pagination } from "antd";
import { FileOutlined, FolderOutlined, MoreOutlined } from "@ant-design/icons";
import type { KnowledgeFolder, KnowledgeFolderResult, KnowledgePage, KnowledgePageResult, KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import { KnowledgeLocationPicker } from "./KnowledgeLocationPicker";
import { KnowledgeFolderCreate } from "./KnowledgeFolderTree";
import { knowledgeFoldersUrl } from "./knowledge-ui";
export function KnowledgeFolderContents({space,folderId,parentId,working=false,manage=false,onFolder,onParent,onPage}:{space:KnowledgeSpace;folderId?:string;parentId?:string;working?:boolean;manage?:boolean;onFolder:(id?:string)=>void;onParent:(id:string)=>void;onPage:(page:KnowledgePage)=>void}) {
  const [folderPage,setFolderPage]=useState(1),[page,setPage]=useState(1),[action,setAction]=useState<{kind:"rename"|"move";folder:KnowledgeFolder}>(),[name,setName]=useState(""),[target,setTarget]=useState<string>(),[valid,setValid]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [creatingParent,setCreatingParent]=useState<string>();
  const {modal,message}=App.useApp(),client=useQueryClient();
  const parent=useQuery({queryKey:["knowledge","contents-parent",space.id,parentId,working],queryFn:()=>api<KnowledgePage>(`/knowledge/pages/${parentId}?mode=${working?"working":"published"}`),enabled:!!parentId,retry:false});
  const validParent=!!parent.data&&parent.data.spaceId===space.id;
  const folders=useQuery({queryKey:["knowledge","folder-contents",space.id,folderId,folderPage],queryFn:()=>api<KnowledgeFolderResult>(knowledgeFoldersUrl(space.id,{parentFolderId:folderId,page:String(folderPage),pageSize:"20"})),enabled:!parentId,retry:false});
  const selected=useQuery({queryKey:["knowledge","folder-path",space.id,folderId],queryFn:()=>api<KnowledgeFolderResult>(knowledgeFoldersUrl(space.id,{selectedId:folderId})),enabled:!!folderId&&!parentId,retry:false});
  const pages=useQuery({queryKey:["knowledge","folder-pages",space.id,folderId,parentId,working,page],queryFn:()=>api<KnowledgePageResult>(`/knowledge/spaces/${space.id}/tree?${new URLSearchParams({...(parentId?{parentId}:{folderId:folderId??""}),mode:working?"working":"published",page:String(page),pageSize:"20"})}`),enabled:parentId?validParent:!folderId||!!selected.data?.rows.length,retry:false});
  const path=(parentId?(validParent?parent.data?.breadcrumb:undefined):selected.data?.rows[0]?.breadcrumb)??[{id:space.id,title:space.name,kind:"space"}];
  const openFolder=(id?:string)=>{setFolderPage(1);setPage(1);onFolder(id);};
  const save=async()=>{if(!action||busy)return;setBusy(true);setError("");try{await api(`/knowledge/folders/${action.folder.id}`,{method:"PATCH",body:JSON.stringify({expectedVersion:action.folder.version,...(action.kind==="rename"?{name}:{parentFolderId:target??null})})});await client.invalidateQueries({queryKey:["knowledge"]});setAction(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="knowledge-folder-contents"><Breadcrumb items={path.map((b,i)=>({title:i===path.length-1&&!(i===0&&(parentId||folderId))?<span>{b.title}</span>:<Button type="link" onClick={()=>i===0||b.kind==="space"?openFolder():b.kind==="folder"?openFolder(b.id):onParent(b.id)}>{b.title}</Button>}))}/>
    {(folders.error||pages.error||selected.error||parent.error)&&<Alert type="error" message={(folders.error||pages.error||selected.error||parent.error)!.message}/>}
    {parentId&&parent.data&&!validParent&&<Alert type="warning" message="该知识页面不属于当前知识空间"/>}
    {!parentId&&folderId&&selected.data&&!selected.data.rows.length&&<Alert type="warning" message="文件夹不存在或无查看权限"/>}
    {parentId&&validParent&&<Button type="link" icon={<FileOutlined aria-hidden/>} onClick={()=>onPage(parent.data!)}>阅读当前知识</Button>}
    <List loading={folders.isFetching} dataSource={parentId?[]:folders.data?.rows} locale={{emptyText:<></>}} renderItem={folder=><List.Item actions={manage&&(folder.canEdit||space.canCreateFolders)?[<Dropdown key="actions" menu={{items:[...(space.canCreateFolders?[{key:"create",label:"新建子文件夹"}]:[]),...(folder.canEdit?[{key:"rename",label:"重命名"},{key:"move",label:"移动文件夹"}]:[]),...(folder.canDelete?[{key:"delete",label:"删除空文件夹",danger:true}]:[])],onClick:({key})=>{setError("");if(key==="create")setCreatingParent(folder.id);else if(key==="delete")modal.confirm({title:"删除空文件夹？",content:"包含子目录或知识内容的文件夹不能删除。",onOk:async()=>{try{await api(`/knowledge/folders/${folder.id}`,{method:"DELETE",body:JSON.stringify({expectedVersion:folder.version})});await client.invalidateQueries({queryKey:["knowledge"]});}catch(e){message.error((e as Error).message);throw e;}}});else{setAction({kind:key as "rename"|"move",folder});setName(folder.name);setTarget(folder.parentFolderId??undefined);}}}}><Button aria-label={`文件夹操作：${folder.name}`} icon={<MoreOutlined aria-hidden/>}/></Dropdown>]:[] }><Button type="link" icon={<FolderOutlined aria-hidden/>} onClick={()=>openFolder(folder.id)}>{folder.name}</Button></List.Item>}/>
    {!parentId&&(folders.data?.total??0)>20&&<Pagination current={folderPage} pageSize={20} total={folders.data?.total} showSizeChanger={false} onChange={setFolderPage}/>}
    <List loading={pages.isFetching||!!parentId&&parent.isFetching} dataSource={pages.data?.rows} locale={{emptyText:folders.data?.rows.length?<></>:<Empty description={parentId?"当前知识暂无可见子页面":"当前文件夹暂无可见知识"}/>}} renderItem={row=><List.Item><div><Button type="link" icon={<FileOutlined aria-hidden/>} onClick={()=>onPage(row)}>{row.title}</Button>{row.hasChildren&&<Button type="link" aria-label={`浏览子页面：${row.title}`} onClick={()=>onParent(row.id)}>浏览子页面</Button>}{working&&row.status==="DRAFT"&&<span> 草稿</span>}</div></List.Item>}/>
    {(pages.data?.total??0)>20&&<Pagination current={page} pageSize={20} total={pages.data?.total} showSizeChanger={false} onChange={setPage}/>}
    {creatingParent&&<KnowledgeFolderCreate spaceId={space.id} parentFolderId={creatingParent} onClose={()=>setCreatingParent(undefined)} onCreated={id=>{setCreatingParent(undefined);openFolder(id);}}/>}
    {action&&<Modal open title={action.kind==="rename"?"重命名文件夹":"移动文件夹"} onCancel={()=>setAction(undefined)} onOk={()=>void save()} confirmLoading={busy} okButtonProps={{disabled:action.kind==="rename"?!name.trim():!valid}}>
      {action.kind==="rename"?<Input aria-label="文件夹名称" value={name} maxLength={200} disabled={busy} onChange={e=>setName(e.target.value)}/>:<KnowledgeLocationPicker operation="moveFolder" spaces={[space]} value={{spaceId:space.id,folderId:target}} onChange={v=>setTarget(v.folderId)} excludeId={action.folder.id} onValidityChange={setValid} disabled={busy}/>}{error&&<Alert type="error" message={error}/>}</Modal>}
  </div>;
}
