import type { TableFilterActor } from "../../common/filtering/table-filter.registry";
export type KnowledgeActor = TableFilterActor & {
  username: string;
  requestId: string;
  source?: "web" | "api";
};
export type KnowledgeResource = "knowledge-spaces" | "knowledge-pages";
export type KnowledgeRow = Record<string, any>;
export type KnowledgeMode = "published" | "working" | "trash";
export const spaceColumns = {
  id: "id",
  version: "version",
  code: "code",
  name: "name",
  description: "description",
  icon: "icon",
  status: "status",
  sortOrder: "sort_order",
  createdBy: "created_by",
  createdAt: "created_at",
  updatedBy: "updated_by",
  updatedAt: "updated_at",
};
export const pageColumns = {
  id: "id",
  version: "version",
  spaceId: "space_id",
  parentId: "parent_id",
  title: "title",
  slug: "slug",
  status: "status",
  sortOrder: "sort_order",
  content: "working_content",
  contentText: "working_content_text",
  createdBy: "created_by",
  createdAt: "created_at",
  updatedBy: "updated_by",
  updatedAt: "updated_at",
};
export const publishedJoin =
  "LEFT JOIN knowledge_page_versions published ON published.tenant_id=record.tenant_id AND published.page_id=record.id AND published.id=record.published_version_id";
export function knowledgeExpressions(
  resource: KnowledgeResource,
  mode: KnowledgeMode = "working",
): Record<string, string> {
  if (resource === "knowledge-spaces")
    return Object.fromEntries(
      Object.entries(spaceColumns).map(([key, col]) => [key, `record.${col}`]),
    );
  return {
    ...Object.fromEntries(
      Object.entries(pageColumns).map(([key, col]) => [key, `record.${col}`]),
    ),
    title: mode !== "published" ? "record.title" : "published.title",
    content:
      mode !== "published" ? "record.working_content" : "published.content",
    contentText:
      mode !== "published"
        ? "record.working_content_text"
        : "published.content_text",
    tags:
      mode !== "published"
        ? `(SELECT COALESCE(jsonb_agg(tag.name ORDER BY tag.name),'[]'::jsonb) FROM knowledge_page_tags link JOIN knowledge_tags tag ON tag.tenant_id=link.tenant_id AND tag.id=link.tag_id WHERE link.tenant_id=record.tenant_id AND link.page_id=record.id)`
        : "published.tags",
    attachmentIds:
      mode !== "published"
        ? `(SELECT COALESCE(jsonb_agg(file.id),'[]'::jsonb) FROM knowledge_attachments file WHERE file.tenant_id=record.tenant_id AND file.page_id=record.id AND file.detached_at IS NULL)`
        : `(SELECT COALESCE(jsonb_agg(link.attachment_id),'[]'::jsonb) FROM knowledge_page_version_attachments link WHERE link.tenant_id=record.tenant_id AND link.page_id=record.id AND link.version_id=published.id)`,
    publishedVersion: "published.version_no",
    publishedBy: "published.published_by",
    publishedAt: "published.published_at",
  };
}
