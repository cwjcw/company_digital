import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { KnowledgeFolder, KnowledgeFolderResult } from "@kdos/contracts";
import type { EntityManager } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeAuthorizationService, assertKnowledgeAction, assertKnowledgeFields, canKnowledge, canKnowledgeField } from "./knowledge.scope";
import { knowledgeId, knowledgeText } from "./knowledge.content";
import { folderBreadcrumbSql, validateKnowledgeFolder } from "./knowledge.folder";
import type { KnowledgeActor } from "./knowledge.types";

/** Folders inherit Space access. No page ACL, draft, publication, or page-content counts. */
@Injectable()
export class KnowledgeFoldersService {
  constructor(private readonly app: KnowledgeApplicationService, private readonly access: KnowledgeAuthorizationService) {}
  private async space(m: EntityManager, spaceId: string, actor: KnowledgeActor, action = "read") {
    assertKnowledgeAction(actor, "knowledge-pages", action);
    assertKnowledgeFields(actor,"knowledge-spaces",["name"],"read");
    if(action !== "read") assertKnowledgeFields(actor,"knowledge-pages",["parentId"]);
    const p:unknown[]=[actor.tenantId,knowledgeId(spaceId)];
    const clause=await this.access.spaceClause(actor,p,"read",action === "delete" ? 3 : action === "read" ? 1 : 2,m);
    const [space]=await m.query(`SELECT record.* FROM knowledge_spaces record WHERE record.tenant_id=$1 AND record.id=$2 AND ${clause}`,p);
    if(!space)throw new NotFoundException("知识空间不存在或无操作权限");
    if(space.status !== "ACTIVE")throw new BadRequestException("知识空间已归档");
    return space;
  }
  list(spaceId: string, input: Record<string, unknown>, actor: KnowledgeActor): Promise<KnowledgeFolderResult> {
    const page=Number(input.page??1),pageSize=Number(input.pageSize??100);
    if(!Number.isInteger(page)||page<1||page>1000000||!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw new BadRequestException("分页无效");
    const search=knowledgeText(input.search,"搜索词",200);
    return this.access.transaction(actor,async m=>{
      const space=await this.space(m,spaceId,actor,input.selectable === "true" ? "create" : "read");
      const p:unknown[]=[actor.tenantId,space.id], conditions=["record.tenant_id=$1","record.space_id=$2","record.status='ACTIVE'"];
      if(input.selectedId)conditions.push(`record.id=$${p.push(knowledgeId(input.selectedId))}::uuid`);
      else if(search)conditions.push(`record.name ILIKE $${p.push('%'+search.replace(/[\\%_]/g,v=>'\\'+v)+'%')}`);
      else conditions.push(input.parentFolderId ? `record.parent_folder_id=$${p.push(knowledgeId(input.parentFolderId))}::uuid` : "record.parent_folder_id IS NULL");
      if(input.parentFolderId)await validateKnowledgeFolder(m,actor,space.id,input.parentFolderId);
      if(input.excludeId) {
        const index=p.push(knowledgeId(input.excludeId));
        conditions.push(`record.id NOT IN(WITH RECURSIVE descendants AS (SELECT id FROM knowledge_folders WHERE tenant_id=$1 AND id=$${index}::uuid UNION SELECT f.id FROM knowledge_folders f JOIN descendants d ON f.parent_folder_id=d.id WHERE f.tenant_id=$1) SELECT id FROM descendants)`);
      }
      const where=conditions.join(" AND ");
      const [{total}]=await m.query(`SELECT count(*)::int total FROM knowledge_folders record WHERE ${where}`,p);
      const level=this.access.spaceRank(actor,await this.access.membership(actor,m),p,"space");
      const rows=await m.query(`SELECT record.id,record.space_id AS "spaceId",record.parent_folder_id AS "parentFolderId",record.name,record.sort_order AS "sortOrder",record.status,record.version,
        jsonb_build_array(jsonb_build_object('id',space.id,'title',space.name,'kind','space'))||${folderBreadcrumbSql("record.tenant_id","record.space_id","record.id")} AS breadcrumb,
        EXISTS(SELECT 1 FROM knowledge_folders child WHERE child.tenant_id=record.tenant_id AND child.space_id=record.space_id AND child.parent_folder_id=record.id AND child.status='ACTIVE') AS "hasChildren", (${level}) AS rank
        FROM knowledge_folders record JOIN knowledge_spaces space ON space.tenant_id=record.tenant_id AND space.id=record.space_id WHERE ${where}
        ORDER BY record.sort_order,record.name,record.id LIMIT $${p.push(pageSize)} OFFSET $${p.push((page-1)*pageSize)}`,p);
      return {rows:rows.map(({rank,...r}: Record<string,any>)=>({...r,canEdit:rank>=2&&canKnowledge(actor,"knowledge-pages","update")&&canKnowledgeField(actor,"knowledge-pages","parentId","update"),canDelete:rank>=3&&canKnowledge(actor,"knowledge-pages","delete")&&canKnowledgeField(actor,"knowledge-pages","parentId","update")} as KnowledgeFolder)),total,page,pageSize};
    });
  }
  create(input: Record<string,unknown>,actor:KnowledgeActor) {
    this.app.keys(input,["spaceId","parentFolderId","name","sortOrder"]);
    return this.app.command(actor,async m=>{
      const space=await this.space(m,String(input.spaceId),actor,"create"),id=uuidv7();
      const parent=await validateKnowledgeFolder(m,actor,space.id,input.parentFolderId),name=knowledgeText(input.name,"文件夹名称",200,true);
      try { await m.query(`INSERT INTO knowledge_folders(id,tenant_id,space_id,parent_folder_id,name,sort_order,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7::uuid,$7::text)`,[id,actor.tenantId,space.id,parent,name,this.app.sort(input.sortOrder),actor.userId]); }
      catch(e){if((e as {code?:string}).code==='23505')throw new BadRequestException("同一目录下已存在同名文件夹");throw e;}
      await this.app.audit(m,actor,"knowledge-folders",id,"folder.created",{spaceId:space.id,parentFolderId:parent,name});
      return {id,version:1};
    });
  }
  private async lock(m:EntityManager,id:string,actor:KnowledgeActor,action:string) {
    const [row]=await m.query("SELECT * FROM knowledge_folders WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE",[actor.tenantId,knowledgeId(id)]);
    if(!row)throw new NotFoundException("文件夹不存在或已删除");
    await this.space(m,row.space_id,actor,action); return row;
  }
  update(id:string,input:Record<string,unknown>,actor:KnowledgeActor) {
    this.app.keys(input,["name","parentFolderId","expectedVersion"]);
    return this.app.command(actor,async m=>{
      const row=await this.lock(m,id,actor,"update");this.app.version(row.version,input.expectedVersion);
      const parent='parentFolderId' in input ? await validateKnowledgeFolder(m,actor,row.space_id,input.parentFolderId) : row.parent_folder_id;
      if(parent===id)throw new BadRequestException("不能将文件夹移到自己下面");
      if(parent) {
        const [cycle]=await m.query(`WITH RECURSIVE descendants AS (SELECT id FROM knowledge_folders WHERE tenant_id=$1 AND id=$2 UNION SELECT f.id FROM knowledge_folders f JOIN descendants d ON f.parent_folder_id=d.id WHERE f.tenant_id=$1) SELECT 1 FROM descendants WHERE id=$3`,[actor.tenantId,id,parent]);
        if(cycle)throw new BadRequestException("不能将文件夹移到自己的后代下面");
      }
      const name=knowledgeText(input.name??row.name,"文件夹名称",200,true);
      try{await m.query("UPDATE knowledge_folders SET name=$3,parent_folder_id=$4,version=version+1,updated_by=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2",[actor.tenantId,id,name,parent,actor.userId]);}
      catch(e){if((e as {code?:string}).code==='23505')throw new BadRequestException("同一目录下已存在同名文件夹");throw e;}
      await this.app.rebuildSearch(m,actor,undefined,row.space_id);
      await this.app.audit(m,actor,"knowledge-folders",id,"folder.updated",{before:{name:row.name,parentFolderId:row.parent_folder_id},after:{name,parentFolderId:parent}});
      return {id,version:row.version+1};
    });
  }
  delete(id:string,input:Record<string,unknown>,actor:KnowledgeActor) {
    this.app.keys(input,["expectedVersion"]);
    return this.app.command(actor,async m=>{
      const row=await this.lock(m,id,actor,"delete");this.app.version(row.version,input.expectedVersion);
      const [nonempty]=await m.query(`SELECT 1 WHERE EXISTS(SELECT 1 FROM knowledge_folders WHERE tenant_id=$1 AND parent_folder_id=$2 AND status='ACTIVE')
        OR EXISTS(SELECT 1 FROM knowledge_pages p LEFT JOIN knowledge_page_versions v ON v.tenant_id=p.tenant_id AND v.id=p.published_version_id WHERE p.tenant_id=$1 AND (p.folder_id=$2 OR v.folder_id=$2))`,[actor.tenantId,id]);
      if(nonempty)throw new BadRequestException("文件夹中存在子目录或知识内容，不能删除；请先移动内容（已发布内容需发布移动）或清理回收站");
      await m.query("UPDATE knowledge_folders SET status='ARCHIVED',version=version+1,updated_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",[actor.tenantId,id,actor.userId]);
      await this.app.audit(m,actor,"knowledge-folders",id,"folder.deleted",{retainedHistoricalReferences:true});
      return {id,version:row.version+1};
    });
  }
}
