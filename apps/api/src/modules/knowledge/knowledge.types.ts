import type { TableFilterActor } from "../../common/filtering/table-filter.registry";
export type KnowledgeActor = TableFilterActor & { username: string; requestId: string; source?: "web" | "api" };
export type KnowledgeResource = "knowledge-categories" | "knowledge-articles";
export type KnowledgePageInput = { page?: unknown; pageSize?: unknown; search?: unknown; sortField?: unknown; sortOrder?: unknown; filterGroup?: unknown; categoryId?: unknown; tag?: unknown };
export type KnowledgeRow = Record<string, any>;
export const categoryColumns = { id: "id", version: "version", parentId: "parent_id", level: "level", code: "code", name: "name", description: "description", sortOrder: "sort_order", enabled: "enabled", createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at" };
export const articleColumns = { id: "id", version: "version", title: "title", summary: "summary", categoryId: "category_id", content: "content", contentText: "content_text", visibility: "visibility", attachmentIds: "attachment_ids", status: "status", workingRevision: "working_revision", publishedVersion: "published_version", publishedBy: "published_by", publishedAt: "published_at", viewCount: "view_count", createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at" };
export function knowledgeExpressions(resource: KnowledgeResource, mode: "browse" | "manage" = "manage"): Record<string, string> {
  const cols = resource === "knowledge-categories" ? categoryColumns : articleColumns;
  const expressions: Record<string, string> = { ...Object.fromEntries(Object.entries(cols).map(([key, col]) => [key, `record.${col}`])), ...(resource === "knowledge-articles" ? { tags: `(SELECT COALESCE(jsonb_agg(tag.name ORDER BY tag.name),'[]'::jsonb) FROM knowledge_article_tags link JOIN knowledge_tags tag ON tag.tenant_id=link.tenant_id AND tag.id=link.tag_id WHERE link.tenant_id=record.tenant_id AND link.article_id=record.id)` } : {}) };
  if (resource === "knowledge-articles" && mode === "browse") for (const [key, column] of Object.entries({ title: "title", summary: "summary", categoryId: "category_id", content: "content", contentText: "content_text", visibility: "visibility", tags: "tags", publishedBy: "published_by", publishedAt: "published_at" })) expressions[key] = `published.${column}`;
  return expressions;
}
