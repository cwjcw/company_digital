import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, List, Modal, Pagination, Tree } from "antd";
import { FolderOutlined } from "@ant-design/icons";
import type { KnowledgeFolder, KnowledgeFolderResult } from "@kdos/contracts";
import { api } from "../../api";
import { knowledgeFoldersUrl } from "./knowledge-ui";
export function KnowledgeFolderCreate({spaceId,parentFolderId,onClose,onCreated}:{spaceId:string;parentFolderId?:string;onClose:()=>void;onCreated:(id:string)=>void}) {
  const [name,setName]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const client=useQueryClient(),running=useRef(false);
  return <Modal open title="新建文件夹" okText="创建文件夹" confirmLoading={busy} cancelButtonProps={{disabled:busy}} closable={!busy} maskClosable={!busy} okButtonProps={{disabled:!name.trim()}} onCancel={onClose} onOk={()=>{
    if(running.current||!name.trim())return;running.current=true;setBusy(true);setError("");
    void api<{id:string}>("/knowledge/folders",{method:"POST",body:JSON.stringify({spaceId,parentFolderId:parentFolderId??null,name:name.trim()})})
      .then(async r=>{await client.invalidateQueries({queryKey:["knowledge"]});onCreated(r.id);})
      .catch(e=>setError((e as Error).message)).finally(()=>{running.current=false;setBusy(false);});
  }}><Input autoFocus aria-label="文件夹名称" placeholder="文件夹名称" maxLength={200} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/>{error&&<Alert type="error" message={error}/>}</Modal>;
}
export function KnowledgeFolderTree({spaceId,parentFolderId,excludeId,onSelect,selectable=false,refresh=0}:{spaceId:string;parentFolderId?:string;excludeId?:string;onSelect:(id:string)=>void;selectable?:boolean;refresh?:number}) {
  const [page,setPage]=useState(1),[expanded,setExpanded]=useState<string[]>([]),[children,setChildren]=useState<Record<string,KnowledgeFolderResult>>({}),[childError,setChildError]=useState<{id:string;message:string}>();
  const running=useRef(new Map<string,Promise<void>>()),generation=useRef(0);
  const rows=useQuery({queryKey:["knowledge","folder-tree",spaceId,parentFolderId,excludeId,selectable,page,refresh],queryFn:()=>api<KnowledgeFolderResult>(knowledgeFoldersUrl(spaceId,{parentFolderId,excludeId,selectable:String(selectable),page:String(page),pageSize:"100"})),retry:false});
  useEffect(()=>{generation.current++;setChildren({});setExpanded([]);setChildError(undefined);},[spaceId,parentFolderId,excludeId,selectable,refresh,rows.dataUpdatedAt]);
  const load=(id:string,nextPage=1):Promise<void>=>{
    const existing=running.current.get(id);if(existing)return existing;
    const current=generation.current;
    const request=api<KnowledgeFolderResult>(knowledgeFoldersUrl(spaceId,{parentFolderId:id,excludeId,selectable:String(selectable),page:String(nextPage),pageSize:"100"}))
      .then(result=>{if(current!==generation.current)return;setChildren(old=>({...old,[id]:{...result,rows:nextPage===1?result.rows:[...(old[id]?.rows??[]),...result.rows]}}));setChildError(undefined);})
      .catch(e=>{if(current===generation.current)setChildError({id,message:(e as Error).message});})
      .finally(()=>running.current.delete(id));
    running.current.set(id,request);return request;
  };
  type Node={key:string;isLeaf:boolean;title:React.ReactNode;children?:Node[]};
  const nodes=(folders:KnowledgeFolder[]):Node[]=>folders.map(row=>{
    const cached=children[row.id],nested=cached?nodes(cached.rows):undefined;
    if(cached&&cached.rows.length<cached.total)nested!.push({key:row.id+":more",isLeaf:true,title:<Button type="link" onClick={e=>{e.stopPropagation();void load(row.id,cached.page+1);}}>加载更多子文件夹</Button>});
    return {key:row.id,isLeaf:!row.hasChildren,title:<Button type="text" className="knowledge-folder-tree-link" icon={<FolderOutlined aria-hidden/>} title={row.breadcrumb.map(b=>b.title).join(" > ")} onClick={e=>{e.stopPropagation();onSelect(row.id);}}>{row.name}</Button>,children:nested};
  });
  if(rows.error)return <Alert type="error" message={rows.error.message} action={<Button onClick={()=>void rows.refetch()}>重试</Button>}/>;
  return <>{childError&&<Alert type="error" message={childError.message} action={<Button onClick={()=>void load(childError.id)}>重试加载子目录</Button>}/>}
    <Tree aria-label="文件夹目录树" blockNode selectable={false} expandedKeys={expanded} loadedKeys={Object.keys(children)} onExpand={keys=>setExpanded(keys.map(String))} loadData={node=>children[String(node.key)]?Promise.resolve():load(String(node.key))} treeData={nodes(rows.data?.rows??[])}/>
    {rows.isFetching&&<p>正在加载文件夹…</p>}{rows.data?.total===0&&<p>当前目录为空</p>}
    {(rows.data?.total??0)>100&&<Pagination size="small" current={page} pageSize={100} total={rows.data?.total} showSizeChanger={false} onChange={setPage}/>}</>;
}
export function KnowledgeFolderSelect({spaceId,excludeId,onSelect,selectable=true}:{spaceId:string;excludeId?:string;onSelect:(id:string)=>void;selectable?:boolean}) {
  const [search,setSearch]=useState(""),[page,setPage]=useState(1);
  const rows=useQuery({queryKey:["knowledge","folder-search",spaceId,excludeId,selectable,search,page],queryFn:()=>api<KnowledgeFolderResult>(knowledgeFoldersUrl(spaceId,{search,excludeId,selectable:String(selectable),page:String(page),pageSize:"100"})),enabled:!!search.trim(),retry:false});
  return <><Input.Search aria-label="搜索保存位置" placeholder="搜索文件夹" value={search} allowClear onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
    {search.trim()?<>{rows.error&&<Alert type="error" message={rows.error.message}/>}<List loading={rows.isFetching} dataSource={rows.data?.rows} locale={{emptyText:"没有匹配的文件夹"}} renderItem={row=><List.Item><Button type="link" icon={<FolderOutlined aria-hidden/>} onClick={()=>onSelect(row.id)}>{row.breadcrumb.map(b=>b.title).join(" > ")}</Button></List.Item>}/>
      {(rows.data?.total??0)>100&&<Pagination current={page} pageSize={100} total={rows.data?.total} showSizeChanger={false} onChange={setPage}/>}</>:<KnowledgeFolderTree key={spaceId} spaceId={spaceId} excludeId={excludeId} onSelect={onSelect} selectable={selectable}/>}</>;
}
