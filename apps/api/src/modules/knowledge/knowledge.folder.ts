import { BadRequestException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { KnowledgeActor } from "./knowledge.types";
import { knowledgeId } from "./knowledge.content";

export async function validateKnowledgeFolder(m: EntityManager, actor: KnowledgeActor, spaceId: string, folderId: unknown) {
  if (folderId == null || folderId === "") return null;
  const id = knowledgeId(folderId);
  const [row] = await m.query("SELECT id FROM knowledge_folders WHERE tenant_id=$1 AND space_id=$2 AND id=$3 AND status='ACTIVE'", [actor.tenantId,spaceId,id]);
  if (!row) throw new BadRequestException("文件夹不存在、已删除或不属于所选知识空间");
  return id;
}
/** Parameterized recursive ancestry, never a fixed depth or a truncated first page. */
export const folderBreadcrumbSql = (tenant: string, space: string, folder: string) => `(WITH RECURSIVE directory AS (
  SELECT id,name,parent_folder_id,ARRAY[id] visited FROM knowledge_folders WHERE tenant_id=${tenant} AND space_id=${space} AND id=${folder}
  UNION ALL SELECT f.id,f.name,f.parent_folder_id,d.visited||f.id FROM knowledge_folders f JOIN directory d ON f.id=d.parent_folder_id WHERE f.tenant_id=${tenant} AND f.space_id=${space} AND NOT f.id=ANY(d.visited))
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'title',name,'kind','folder') ORDER BY cardinality(visited) DESC),'[]'::jsonb) FROM directory)`;
export async function knowledgeFolderBreadcrumb(m: EntityManager, actor: KnowledgeActor, spaceId: string, folderId: string | null) {
  const [row] = await m.query(`SELECT ${folderBreadcrumbSql("$1", "$2", "$3::uuid")} AS path`, [actor.tenantId,spaceId,folderId]);
  return row.path as Array<{id:string;title:string;kind:"folder"}>;
}
