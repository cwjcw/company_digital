import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import type { DataSource } from "typeorm";
import type { ObjectStorage } from "../../storage/object-storage";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { KnowledgeFilesService } from "./knowledge.files.service";
import { KnowledgePreviewJobs } from "./knowledge.preview.service";
import type { KnowledgeActor } from "./knowledge.types";

export async function validateKnowledgePortal(ds: DataSource, app: KnowledgeApplicationService, query: KnowledgeQueryService, storage: ObjectStorage, originalAdmin: KnowledgeActor, originalViewer: KnowledgeActor, check: (label: string) => void) {
  const admin = { ...originalAdmin, tenantId: "KNOWLEDGE_PORTAL_TEST" }, viewer = { ...originalViewer, tenantId: admin.tenantId };
  const user = originalAdmin.userId!;
  const actions = ["read", "create", "update", "delete", "import"];
  const editor: KnowledgeActor = { ...viewer, userId: user, permissions: ["knowledge-spaces:*:read", ...tablePermissionFieldsFor("knowledge-spaces").map(f=>`knowledge-spaces:${f.key}:read`), ...actions.map(a=>`knowledge-pages:*:${a}`),
    ...tablePermissionFieldsFor("knowledge-pages").flatMap(f=>[`knowledge-pages:${f.key}:read`, ...(f.editable?[`knowledge-pages:${f.key}:update`]:[])])],
    tableDataScopes: [{resource:"knowledge-spaces",scope:"ALL",actions:["read"]},{resource:"knowledge-pages",scope:"ALL",actions}] };
  const space = await app.createSpace({name:"门户验证空间"}, admin);
  await app.setAccess("space",space.id,{expectedVersion:1,entries:[{subjectType:"USER",subjectId:user,accessLevel:"EDITOR"},{subjectType:"ALL",subjectId:null,accessLevel:"VIEWER"}]},admin);
  const hiddenOwner = uuidv7();
  await ds.query("INSERT INTO users(id,username,display_name) VALUES($1,'portal-fixture-owner','隔离测试成员')", [hiddenOwner]);
  const hiddenSpace = await app.createSpace({name:"不可见空间"},{...admin,userId:hiddenOwner});
  assert.deepEqual((await query.spaces(viewer)).map((s: {id:string})=>s.id),[space.id]);
  assert.equal((await query.capabilities(viewer)).canManage,false);
  const caps = await query.capabilities(editor);
  assert.equal(caps.canCreatePages,true);assert.equal(caps.canManageSpaces,false);assert.equal(caps.canCreateSpaces,false);
  check("portal reader Space cards are ACL-filtered; real editor creation uses EDITOR ACL and fields, without space administration");
  const first = await app.createPage({spaceId:space.id,title:"已发布甲",content:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"正式检索正文"}]}]}},admin);
  const p1 = await app.publish(first.id,{expectedVersion:1},admin);
  const second = await app.createPage({spaceId:space.id,title:"已发布乙"},admin);
  const p2 = await app.publish(second.id,{expectedVersion:1},admin);
  await app.updatePage(first.id,{expectedVersion:p1.version,title:"未发布秘密标题"},admin);
  const recent = await query.list({pageSize:10,mode:"published",sortField:"publishedAt",sortOrder:"desc"},viewer);
  assert.deepEqual(recent.rows.map((r: {id:string})=>r.id),[second.id,first.id]);assert.equal(recent.rows[1].title,"已发布甲");
  assert.equal(new Date(recent.rows[1].updatedAt).getTime(),new Date(recent.rows[1].publishedAt).getTime());
  assert.equal((await query.list({search:"未发布秘密标题"},viewer)).total,0);
  assert.equal((await query.list({search:"正式检索正文"},viewer)).rows[0].id,first.id);
  check("portal publication order/title/search/updated metadata remain immutable despite newer working edits");
  for (const parentId of [first.id, second.id]) {
    const duplicate = await app.createPage({spaceId:space.id,parentId,title:"同名门户制度"},admin);
    await app.publish(duplicate.id,{expectedVersion:1},admin);
  }
  const duplicates=await query.list({spaceId:space.id,search:"同名门户制度"},viewer);
  assert.equal(duplicates.rows.length,2);assert.notDeepEqual(duplicates.rows[0].breadcrumb,duplicates.rows[1].breadcrumb);
  assert.equal(duplicates.rows[0].breadcrumb.length,3);
  check("portal duplicate titles keep complete published ancestor paths across multi-level directories");
  const secret = await app.createPage({spaceId:space.id,title:"受限父目录"},admin);await app.publish(secret.id,{expectedVersion:1},admin);
  const child = await app.createPage({spaceId:space.id,parentId:secret.id,title:"不可见子知识"},admin);await app.publish(child.id,{expectedVersion:1},admin);
  const sv = await query.detail(secret.id,{mode:"working"},admin);
  await app.setAccess("page",secret.id,{expectedVersion:sv.version,restricted:true,entries:[{subjectType:"USER",subjectId:user,accessLevel:"FULL_ACCESS"}]},admin);
  for(const input of [{},{tree:true,spaceId:space.id},{search:"不可见"}]) assert(!(await query.list(input,viewer)).rows.some((r: {id:string})=>[secret.id,child.id].includes(r.id)));
  await assert.rejects(()=>query.detail(child.id,{},viewer),/不存在/);
  await assert.rejects(()=>query.detail(first.id,{mode:"working"},viewer),/权限/);
  await assert.rejects(()=>query.detail(first.id,{}, {...viewer,tenantId:"PORTAL_ALIEN"}),/不存在/);
  assert.equal((await query.capabilities({...editor,tenantId:"PORTAL_ALIEN"})).canManage,false);
  await assert.rejects(async()=>query.capabilities({...viewer,permissions:[]}),/权限/);
  check("portal recent/search/tree/detail/capabilities enforce ancestors, resource read and tenant isolation");
  const manager = {...editor,permissions:[...editor.permissions,"knowledge-spaces:*:update",...tablePermissionFieldsFor("knowledge-spaces").filter(f=>f.editable).map(f=>`knowledge-spaces:${f.key}:update`)],tableDataScopes:[...editor.tableDataScopes!,{resource:"knowledge-spaces",scope:"ALL" as const,actions:["update"]}]};
  assert.equal((await query.capabilities(manager)).canManageSpaces,false);
  await app.setAccess("space",space.id,{expectedVersion:2,entries:[{subjectType:"USER",subjectId:user,accessLevel:"FULL_ACCESS"},{subjectType:"ALL",subjectId:null,accessLevel:"VIEWER"}]},admin);
  assert.equal((await query.capabilities(manager)).canManageSpaces,true);
  assert.equal((await query.capabilities(editor)).canManageSpaces,false);
  const readonlyFields={...editor,permissions:editor.permissions.filter(p=>!p.endsWith(":update")&&!p.endsWith(":create")&&!p.endsWith(":delete"))};
  assert.equal((await query.capabilities(readonlyFields)).canManage,false);
  const scoped={...editor,tableDataScopes:[{resource:"knowledge-spaces",scope:"ALL" as const,actions:["read"]},{resource:"knowledge-pages",scope:"OWN" as const,actions}] ,userId:viewer.userId};
  assert.equal((await query.capabilities(scoped)).canEditPages,false);
  check("portal space manager requires FULL_ACCESS plus field/action/data permissions; editors and OWN scope cannot bypass this boundary");
  for(let index=0;index<103;index++){const row=await app.createPage({spaceId:space.id,title:`目录${index}`},admin);await app.publish(row.id,{expectedVersion:1},admin);}
  const tree1=await query.tree(space.id,{pageSize:100,page:1},viewer),tree2=await query.tree(space.id,{pageSize:100,page:2},viewer);
  assert.equal(tree1.total,105);assert.equal(tree1.rows.length,100);assert.equal(tree2.rows.length,5);assert.equal(new Set([...tree1.rows,...tree2.rows].map((r: {id:string})=>r.id)).size,105);
  check("portal published directory pages beyond100 without truncation or restricted parent/child leakage");
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),"knowledge-portal-test-"));
  try {
    const disk=async(name:string)=>{const filename=path.join(folder,uuidv7());const bytes=Buffer.from("%PDF-1.7\nfixture\n%%EOF");await fs.writeFile(filename,bytes);return {path:filename,size:bytes.length,originalname:name} as Express.Multer.File;};
    const files=new KnowledgeFilesService(app,new KnowledgePreviewJobs(ds),storage);
    const file=await files.create({spaceId:space.id,title:"文件门户",idempotencyKey:uuidv7()},await disk("已发布原件.pdf"),admin);
    const published=await app.publish(file.id,{expectedVersion:1},admin);
    await files.upload(file.id,{expectedVersion:published.version,role:"PRIMARY"},await disk("未发布原件.pdf"),admin);
    const list=await query.list({ids:[file.id]},viewer);assert.equal(list.rows[0].primaryFile.id,file.attachment.id);assert.equal(list.rows[0].primaryFile.originalName,"已发布原件.pdf");assert(!("key" in list.rows[0].primaryFile));
    const hiddenFiles={...viewer,permissions:viewer.permissions.filter(p=>p!=="knowledge-pages:attachmentIds:read")};
    assert.equal((await query.list({ids:[file.id]},hiddenFiles)).rows[0].primaryFile,undefined);
    assert.equal((await query.detail(file.id,{},viewer)).primaryFile.id,file.attachment.id);
    await query.attachment(file.attachment.id,{},viewer);
    check("portal FILE list/detail/download use immutable published primary while replacement stays private; file field permission prunes metadata");
  } finally {await fs.rm(folder,{recursive:true,force:true});}
  assert.equal((await query.spaces(viewer)).some((s: {id:string})=>s.id===hiddenSpace.id),false);
  assert.equal((await query.capabilities(admin)).canManage,true);
  void p2;
}
